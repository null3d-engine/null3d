//! The job system: fork-join parallel loops for frame work, and a queue of small background
//! tasks that run in the gaps.
//!
//! # Threads
//!
//! [`JobSystem::new`] only builds the shared state. Each job worker is a thread (a Web Worker in
//! the browser) that calls [`JobSystem::worker_loop`] with its index; the call returns after
//! [`JobSystem::shutdown`]. Job worker `i` runs chunks as [`WorkerId`] `i + 1`. The thread that
//! calls [`JobSystem::parallel_for`] (the sketch worker) runs chunks as [`WorkerId::CALLER`], so a
//! system with `n` job workers has `n + 1` worker ids, and per-thread storage such as frame
//! arenas needs `n + 1` entries.
//!
//! How a loop's chunks fall across the threads changes from loop to loop, and any thread may run
//! none of them or all of them. The caller runs every chunk that no job worker claims, for example
//! while the workers wake, and a fast core claims more chunks than a slow one. Per-thread storage
//! that chunks fill must therefore hold what the whole loop writes, or let a thread that runs out
//! continue in the other threads' storage, as [`ArenaPool`](crate::arena::ArenaPool) does.
//!
//! The single-threaded WebAssembly build has no job workers: [`JobSystem::new`] ignores the count
//! and every loop runs on the calling thread.
//!
//! # Frame jobs
//!
//! One frame job runs at a time. Its descriptor (the closure pointer, item count and chunk size)
//! lives in a slot allocated with the system, so a call allocates nothing.
//!
//! Claims go through one 64-bit ticket: the job's chunk count in the high half and the next
//! chunk to hand out in the low half.
//!
//! 1. The caller writes the descriptor and resets the done counter, then publishes the job by
//!    storing the ticket (chunk count, chunk 0). That store is sequentially consistent, so it
//!    also releases the descriptor.
//! 2. It bumps the wake word and wakes sleeping workers.
//! 3. Everyone, the caller included, claims a chunk with one atomic add of 1 to the ticket. The
//!    add returns the chunk index and the chunk count of the same job, so a claim is valid exactly
//!    when the index is below the count, whatever job the ticket held when the claimer last
//!    looked. A fast core simply claims more chunks, which is how the system meets the plan's
//!    work-stealing goal without per-worker queues. A plain load first skips the add when no
//!    chunk is left, so idle workers do not write the shared line.
//! 4. Only a successful claim reads the descriptor. The add's acquire half pairs with the
//!    publishing store (later adds continue its release sequence), and the job cannot finish while
//!    the claimed chunk is unfinished, so the descriptor and the closure stay valid while the
//!    chunk runs.
//! 5. Each finished chunk adds one to the done counter with release ordering. When no chunk is
//!    left to claim, the caller spins with [`core::hint::spin_loop`] until the done counter
//!    (loaded with acquire ordering) reaches the chunk count, so it only waits for chunks already
//!    in flight. It never blocks: the sketch worker must stay responsive.
//!
//! A job worker that dies inside a chunk, as a WebAssembly trap ends a thread, never counts its
//! chunk as done. Each job worker marks the chunk it holds, so the host can call
//! [`JobSystem::worker_failed`] from the dead worker's thread: that counts the held chunk as done
//! and as panicked, and the caller's wait ends with the panic instead of spinning for good.
//!
//! An add after the last chunk only moves the index past the count; each thread makes at most
//! one such add per job, so the index never reaches the count's half.
//!
//! A call made while a frame job is running (a nested call from inside a chunk), or made on a job
//! worker thread, runs its loop inline on that thread with that thread's worker id.
//!
//! # Background tasks
//!
//! [`JobSystem::spawn_background`] pushes a small task (a function pointer and one argument) into
//! a fixed-capacity queue. An idle worker takes a background task only when no frame chunk is
//! left to claim, and it checks for frame work again before each further task. A worker already
//! inside a task when a frame job starts joins the job when that task ends, so background work
//! delays a frame job's helpers by at most one task each, and never blocks the caller, which
//! runs any chunk no worker has taken.
//!
//! # Calls from the host
//!
//! The host can ask one job worker to leave its loop for a while, to run host code such as a
//! decoder that loads on first use. [`JobSystem::call_worker`] adds one to that worker's call
//! count and wakes the workers. The worker returns [`LoopExit::Called`] from
//! [`JobSystem::worker_loop`] only when no frame chunk is left to claim, so a call never takes a
//! worker away from a frame job's open chunks. The host runs its work, takes one off the count
//! for each piece with [`JobSystem::call_done`], and calls the loop again. The calling thread runs
//! every chunk that no job worker claims, so a frame never waits for a worker that is away.
//!
//! # Busy time
//!
//! With a clock in its settings, the system adds up the time each job worker spends in frame
//! chunks and background tasks. A worker adds a chunk's time before it counts the chunk as done,
//! so when [`JobSystem::parallel_for`] returns, the time of every chunk is included.
//! [`JobSystem::take_busy_ms`] reads a worker's total and starts it again from zero.
//!
//! # Sleeping
//!
//! An idle worker spins for a configurable number of rounds, then blocks on the wake word with
//! `memory.atomic.wait32` (a futex in native builds). To avoid a lost wakeup it reads the wake
//! word, registers as a sleeper, and re-checks for work and for a changed wake word before it
//! blocks. Publishers make the work visible, bump the wake word, and notify only when a sleeper
//! is registered. All of these steps are sequentially consistent.

use std::cell::{Cell, UnsafeCell};
use std::hint::spin_loop;
use std::mem::MaybeUninit;
use std::ops::Range;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

use crate::error::{CoreError, Resource};
use crate::shared::CachePadded;
use crate::wait;

/// The largest number of job workers a system accepts.
pub const MAX_WORKERS: u32 = 255;
/// The background queue's capacity when [`JobSystem::new`] builds the system.
pub const DEFAULT_BACKGROUND_CAPACITY: u32 = 1024;
/// Rounds an idle worker spins, polling for work, before it blocks. Frame jobs arrive back to
/// back, so a short spin keeps workers awake between them.
pub const DEFAULT_SPIN_ROUNDS: u32 = 1 << 12;

/// The loop body [`JobSystem::parallel_for`] runs: it gets a range of item indices and the id of
/// the thread running it.
pub type ChunkFn<'a> = dyn Fn(Range<u32>, WorkerId) + Sync + 'a;

/// A clock that the host provides, in milliseconds: the browser's `performance.now`, or a timer
/// in native tests. Any thread may call it.
pub type Clock = fn() -> f64;

/// Identifies the thread running a chunk: [`WorkerId::CALLER`] for the thread that called
/// [`JobSystem::parallel_for`], and `i + 1` for job worker `i`. Use it to index per-thread data.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WorkerId(u32);

impl WorkerId {
    /// The thread that publishes frame jobs: the sketch worker, or the only thread.
    pub const CALLER: WorkerId = WorkerId(0);

    /// The id of job worker `worker_index` (the index passed to [`JobSystem::worker_loop`]).
    pub const fn job_worker(worker_index: u32) -> WorkerId {
        WorkerId(worker_index + 1)
    }

    /// The id as an array index, from 0 to the job worker count.
    pub const fn index(self) -> usize {
        self.0 as usize
    }
}

/// A background task: a plain function and one argument, so queueing it allocates nothing. The
/// argument can carry an index or an address.
#[derive(Clone, Copy, Debug)]
pub struct BackgroundTask {
    /// The function to run.
    pub run: fn(u64, WorkerId),
    /// The value passed to it.
    pub arg: u64,
}

/// Why [`JobSystem::worker_loop`] returned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopExit {
    /// The system shut down, or the index is past the worker count.
    Stopped,
    /// The host called the worker with [`JobSystem::call_worker`].
    Called,
}

/// Settings for [`JobSystem::with_config`].
#[derive(Clone, Copy, Debug)]
pub struct JobConfig {
    /// The number of job workers the host will start. The calling thread is not counted.
    pub workers: u32,
    /// The background queue's capacity, rounded up to a power of two.
    pub background_capacity: u32,
    /// Rounds an idle worker spins before it blocks.
    pub spin_rounds: u32,
    /// The clock that times each job worker's work, or `None` to time nothing.
    pub clock: Option<Clock>,
}

impl Default for JobConfig {
    fn default() -> Self {
        Self {
            workers: 0,
            background_capacity: DEFAULT_BACKGROUND_CAPACITY,
            spin_rounds: DEFAULT_SPIN_ROUNDS,
            clock: None,
        }
    }
}

thread_local! {
    /// The worker id of the thread: set inside [`JobSystem::worker_loop`], and 0 elsewhere.
    static CURRENT_WORKER: Cell<u32> = const { Cell::new(0) };
}

/// The most chunks one loop is split into. Leaves room for every thread's one extra claim
/// above the count.
const MAX_CHUNKS: u32 = u32::MAX - 2 * MAX_WORKERS;

/// Splits a claim ticket into (next chunk, chunk count).
#[inline(always)]
fn split_ticket(ticket: u64) -> (u32, u32) {
    (ticket as u32, (ticket >> 32) as u32)
}

/// The current frame job. Written only by the publishing caller while no claim can succeed.
struct JobDesc {
    func: *const ChunkFn<'static>,
    count: u32,
    chunk_size: u32,
}

/// The shared state of the job system. See the module documentation for the protocol.
pub struct JobSystem {
    /// High 32 bits: the current job's chunk count. Low 32 bits: the next chunk to hand out.
    ticket: CachePadded<AtomicU64>,
    done: CachePadded<AtomicU32>,
    wake: CachePadded<AtomicU32>,
    job: UnsafeCell<JobDesc>,
    busy: AtomicBool,
    panicked: AtomicBool,
    /// True once a loop handed chunks to the job workers, until [`JobSystem::prepare_frame`] reads it.
    dispatched: AtomicBool,
    sleepers: AtomicU32,
    shutdown: AtomicBool,
    workers: u32,
    spin_rounds: u32,
    background: TaskQueue,
    clock: Option<Clock>,
    /// Nanoseconds of work per job worker since its total was last taken.
    busy_ns: Box<[CachePadded<AtomicU64>]>,
    /// True while each job worker runs a frame chunk that it has not counted as done.
    holding: Box<[CachePadded<AtomicBool>]>,
    /// Calls from the host per job worker that the worker has not finished.
    calls: Box<[CachePadded<AtomicU32>]>,
}

// SAFETY: the job descriptor is written only by the thread that won the `busy` flag, while no
// claim can succeed, and read only after a successful claim (see the module documentation). Every
// other field is atomic, and the closure it points to is `Sync`.
unsafe impl Sync for JobSystem {}
// SAFETY: the raw closure pointer is only dereferenced under the protocol above, from any thread.
unsafe impl Send for JobSystem {}

impl JobSystem {
    /// A job system for `worker_count` job workers, with the default background capacity and
    /// spin. The host starts the workers, each calling [`JobSystem::worker_loop`].
    pub fn new(worker_count: u32) -> Self {
        Self::with_config(JobConfig {
            workers: worker_count,
            ..JobConfig::default()
        })
    }

    /// A job system with explicit settings. The single-threaded WebAssembly build always gets
    /// zero workers.
    pub fn with_config(config: JobConfig) -> Self {
        let workers = if cfg!(all(target_arch = "wasm32", not(target_feature = "atomics"))) {
            0
        } else {
            config.workers.min(MAX_WORKERS)
        };
        Self {
            ticket: CachePadded(AtomicU64::new(0)),
            done: CachePadded(AtomicU32::new(0)),
            wake: CachePadded(AtomicU32::new(0)),
            job: UnsafeCell::new(JobDesc {
                func: &noop_chunk,
                count: 0,
                chunk_size: 1,
            }),
            busy: AtomicBool::new(false),
            panicked: AtomicBool::new(false),
            dispatched: AtomicBool::new(false),
            sleepers: AtomicU32::new(0),
            shutdown: AtomicBool::new(false),
            workers,
            spin_rounds: config.spin_rounds,
            background: TaskQueue::new(config.background_capacity),
            clock: config.clock,
            busy_ns: (0..workers)
                .map(|_| CachePadded(AtomicU64::new(0)))
                .collect(),
            holding: (0..workers)
                .map(|_| CachePadded(AtomicBool::new(false)))
                .collect(),
            calls: (0..workers)
                .map(|_| CachePadded(AtomicU32::new(0)))
                .collect(),
        }
    }

    /// The number of job workers, not counting the calling thread.
    pub fn worker_count(&self) -> u32 {
        self.workers
    }

    /// The number of worker ids: the job workers plus the calling thread.
    pub fn thread_count(&self) -> u32 {
        self.workers + 1
    }

    /// The worker id of the current thread: [`WorkerId::CALLER`] outside job workers.
    pub fn current_worker() -> WorkerId {
        WorkerId(CURRENT_WORKER.with(Cell::get))
    }

    /// Runs `f` over `0..count` in chunks of `chunk_size` items, on the calling thread and the
    /// job workers, and returns when every chunk has finished. A chunk size of 0 counts as 1.
    /// Any thread may run any number of the chunks (see the module documentation).
    ///
    /// The call allocates nothing. It runs inline when there is only one chunk, no job worker, a
    /// frame job already running (a nested call), or when the calling thread is a job worker.
    ///
    /// # Panics
    /// When a chunk panics, after every chunk has finished.
    pub fn parallel_for(&self, count: u32, chunk_size: u32, f: &ChunkFn<'_>) {
        if count == 0 {
            return;
        }
        let chunk_size = chunk_size.max(count.div_ceil(MAX_CHUNKS)).max(1);
        let chunks = count.div_ceil(chunk_size);
        let me = Self::current_worker();
        if chunks == 1
            || self.workers == 0
            || me != WorkerId::CALLER
            || self.shutdown.load(Ordering::Relaxed)
            || self.busy.swap(true, Ordering::Acquire)
        {
            run_inline(count, chunk_size, f, me);
            return;
        }

        let func: *const ChunkFn<'_> = f;
        // SAFETY: only the trait object's lifetime changes. The pointer is dereferenced only by a
        // thread holding a claimed, unfinished chunk, and this call does not return before every
        // chunk has finished, so the closure outlives every use.
        let func: *const ChunkFn<'static> = unsafe { std::mem::transmute(func) };
        // SAFETY: this thread won the `busy` flag, the previous job's chunks have all finished,
        // and its ticket has no chunk left to claim, so no other thread reads the descriptor
        // until the ticket store below publishes it.
        unsafe {
            *self.job.get() = JobDesc {
                func,
                count,
                chunk_size,
            };
        }
        self.done.0.store(0, Ordering::Relaxed);
        self.ticket
            .0
            .store(u64::from(chunks) << 32, Ordering::SeqCst);
        self.dispatched.store(true, Ordering::Relaxed);
        self.wake_workers(true);

        while let Some(chunk) = self.try_claim() {
            self.run_chunk(chunk, me);
        }
        while self.done.0.load(Ordering::Acquire) < chunks {
            spin_loop();
        }
        let panicked = self.panicked.swap(false, Ordering::Relaxed);
        self.busy.store(false, Ordering::Release);
        assert!(!panicked, "a parallel_for chunk panicked");
    }

    /// Wakes sleeping job workers ahead of a frame's parallel work when the previous frame handed
    /// them work, so they are spinning when this frame's work arrives: a sleeping worker takes
    /// longer to start than a short loop runs. A scene without parallel work lets them sleep.
    /// Returns true when it woke them. It also starts the frame's count of loops that handed out
    /// work, which [`JobSystem::workers_busy_this_frame`] reads.
    pub fn prepare_frame(&self) -> bool {
        let woke = self.dispatched.swap(false, Ordering::Relaxed);
        if woke {
            self.wake_workers(true);
        }
        woke
    }

    /// True when a parallel loop has handed the job workers work since the frame started. They
    /// spin for a while after a loop before they sleep, so another loop soon after starts on them
    /// in microseconds, where waking sleeping workers takes tens of microseconds.
    pub fn workers_busy_this_frame(&self) -> bool {
        self.dispatched.load(Ordering::Relaxed)
    }

    /// Queues a background task. Fails with [`CoreError::CapacityExceeded`] when the queue is
    /// full. With no job workers, tasks wait for [`JobSystem::run_background_tasks`].
    pub fn spawn_background(&self, task: BackgroundTask) -> Result<(), CoreError> {
        if !self.background.push(task) {
            return Err(CoreError::CapacityExceeded {
                resource: Resource::BackgroundTasks,
                capacity: self.background.capacity(),
            });
        }
        self.wake_workers(false);
        Ok(())
    }

    /// Runs up to `max` queued background tasks on the calling thread and returns how many ran.
    /// The single-threaded build calls this in idle time.
    pub fn run_background_tasks(&self, max: u32) -> u32 {
        let me = Self::current_worker();
        let mut ran = 0;
        while ran < max {
            let Some(task) = self.background.pop() else {
                break;
            };
            (task.run)(task.arg, me);
            ran += 1;
        }
        ran
    }

    /// The number of queued background tasks, as a snapshot that may be stale at once.
    pub fn pending_background(&self) -> u32 {
        self.background.len()
    }

    /// The milliseconds job worker `worker_index` spent on frame chunks and background tasks
    /// since the last call for it, which starts its total again from zero. It is 0 without a
    /// clock, and for an index past the worker count.
    pub fn take_busy_ms(&self, worker_index: u32) -> f64 {
        self.busy_ns
            .get(worker_index as usize)
            .map_or(0.0, |busy| busy.0.swap(0, Ordering::Relaxed) as f64 / 1e6)
    }

    /// The body of job worker `worker_index` (from 0 to the worker count minus 1). It runs frame
    /// chunks first. When no chunk is left, it leaves for the host's calls, then runs background
    /// tasks, and blocks when idle. It returns [`LoopExit::Called`] for a call, and
    /// [`LoopExit::Stopped`] after [`JobSystem::shutdown`] or at once for an index past the worker
    /// count.
    pub fn worker_loop(&self, worker_index: u32) -> LoopExit {
        let Some(calls) = self.calls.get(worker_index as usize) else {
            return LoopExit::Stopped;
        };
        let me = WorkerId::job_worker(worker_index);
        let previous = CURRENT_WORKER.with(|c| c.replace(me.0));
        let mut idle_rounds = 0;
        let mut exit = LoopExit::Stopped;
        while !self.shutdown.load(Ordering::Acquire) {
            if let Some(chunk) = self.try_claim() {
                self.run_chunk(chunk, me);
                idle_rounds = 0;
                continue;
            }
            let frame_work = self.frame_work_pending();
            if !frame_work && calls.0.load(Ordering::Acquire) > 0 {
                exit = LoopExit::Called;
                break;
            }
            if !frame_work && let Some(task) = self.background.pop() {
                let started = self.work_started(me);
                (task.run)(task.arg, me);
                self.work_finished(me, started);
                idle_rounds = 0;
                continue;
            }
            if idle_rounds < self.spin_rounds {
                idle_rounds += 1;
                spin_loop();
                continue;
            }
            self.sleep(&calls.0);
            idle_rounds = 0;
        }
        CURRENT_WORKER.with(|c| c.set(previous));
        exit
    }

    /// Asks job worker `worker_index` to leave [`JobSystem::worker_loop`] once no frame chunk is
    /// left to claim, and wakes the workers. Each call needs one [`JobSystem::call_done`]. Does
    /// nothing for an index past the worker count.
    pub fn call_worker(&self, worker_index: u32) {
        if let Some(calls) = self.calls.get(worker_index as usize) {
            calls.0.fetch_add(1, Ordering::SeqCst);
            self.wake_workers(true);
        }
    }

    /// Ends one call to job worker `worker_index`. A count already at zero stays there.
    pub fn call_done(&self, worker_index: u32) {
        if let Some(calls) = self.calls.get(worker_index as usize) {
            let _ = calls
                .0
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1));
        }
    }

    /// The calls to job worker `worker_index` that it has not finished, as a snapshot.
    pub fn pending_calls(&self, worker_index: u32) -> u32 {
        self.calls
            .get(worker_index as usize)
            .map_or(0, |calls| calls.0.load(Ordering::SeqCst))
    }

    /// Asks every job worker to return from [`JobSystem::worker_loop`] and wakes them. Queued
    /// background tasks are not run. Later loops run inline on the calling thread. Call it when no
    /// [`JobSystem::parallel_for`] is running.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.wake.0.fetch_add(1, Ordering::SeqCst);
        wait::wake_all(&self.wake.0);
    }

    /// The wake word and the stop flag, for a thread outside the core that stops the job workers
    /// by writing the shared memory, as the page does when it leaves. Setting the flag to 1, then
    /// adding 1 to the wake word and waking every thread that waits on it, does what
    /// [`JobSystem::shutdown`] does.
    pub fn stop_words(&self) -> (&AtomicU32, &AtomicBool) {
        (&self.wake.0, &self.shutdown)
    }

    /// Counts the chunk that job worker `worker_index` held as done and as panicked, when it held
    /// one. The host calls it on the worker's thread after the worker died inside the job system,
    /// so the loop that handed out the chunk ends with a panic instead of waiting for it for good.
    /// Returns true when the worker held a chunk.
    pub fn worker_failed(&self, worker_index: u32) -> bool {
        let Some(holding) = self.holding.get(worker_index as usize) else {
            return false;
        };
        if !holding.0.swap(false, Ordering::Relaxed) {
            return false;
        }
        self.panicked.store(true, Ordering::Relaxed);
        self.done.0.fetch_add(1, Ordering::Release);
        true
    }

    /// True after [`JobSystem::shutdown`].
    pub fn is_shut_down(&self) -> bool {
        self.shutdown.load(Ordering::Acquire)
    }

    /// Claims the next chunk of the current frame job, if one is left.
    #[inline]
    fn try_claim(&self) -> Option<u32> {
        let (next, count) = split_ticket(self.ticket.0.load(Ordering::Relaxed));
        if next >= count {
            return None;
        }
        let (next, count) = split_ticket(self.ticket.0.fetch_add(1, Ordering::Acquire));
        (next < count).then_some(next)
    }

    /// True while the current frame job has chunks nobody has claimed.
    #[inline]
    fn frame_work_pending(&self) -> bool {
        let (next, count) = split_ticket(self.ticket.0.load(Ordering::SeqCst));
        next < count
    }

    /// Runs one claimed chunk and counts it as done, even when it panics. A job worker adds the
    /// chunk's time to its busy time first.
    fn run_chunk(&self, chunk: u32, worker: WorkerId) {
        let holding = self.holding.get(worker.index().wrapping_sub(1));
        if let Some(holding) = holding {
            holding.0.store(true, Ordering::Relaxed);
        }
        let started = self.work_started(worker);
        // SAFETY: the chunk was claimed from the current job, so the publishing caller is still
        // waiting inside `parallel_for` and has written the descriptor before publishing the
        // ticket our claim read. The closure is alive until our chunk is counted as done.
        let (range, f) = unsafe {
            let job = &*self.job.get();
            let start = chunk * job.chunk_size;
            let end = start.saturating_add(job.chunk_size).min(job.count);
            (start..end, &*job.func)
        };
        if catch_unwind(AssertUnwindSafe(|| f(range, worker))).is_err() {
            self.panicked.store(true, Ordering::Relaxed);
        }
        self.work_finished(worker, started);
        if let Some(holding) = holding {
            holding.0.store(false, Ordering::Relaxed);
        }
        // Nothing may touch the job after this increment: the caller may return at once.
        self.done.0.fetch_add(1, Ordering::Release);
    }

    /// The clock's time when a job worker starts a piece of work, or `None` when the work is not
    /// timed: on the calling thread, whose own timers cover it, or without a clock.
    #[inline]
    fn work_started(&self, worker: WorkerId) -> Option<f64> {
        if worker == WorkerId::CALLER {
            return None;
        }
        self.clock.map(|now| now())
    }

    /// Adds the time since `started` to the job worker's busy time.
    #[inline]
    fn work_finished(&self, worker: WorkerId, started: Option<f64>) {
        if let (Some(started), Some(now), Some(busy)) = (
            started,
            self.clock,
            self.busy_ns.get(worker.index().wrapping_sub(1)),
        ) {
            let nanos = ((now() - started).max(0.0) * 1e6) as u64;
            busy.0.fetch_add(nanos, Ordering::Relaxed);
        }
    }

    /// Makes new work visible to sleeping workers: bumps the wake word, then wakes one or all
    /// sleepers when any are registered.
    fn wake_workers(&self, all: bool) {
        self.wake.0.fetch_add(1, Ordering::SeqCst);
        if self.sleepers.load(Ordering::SeqCst) > 0 {
            if all {
                wait::wake_all(&self.wake.0);
            } else {
                wait::wake_one(&self.wake.0);
            }
        }
    }

    /// Blocks an idle worker until a publisher bumps the wake word. `calls` is the worker's count
    /// of the host's calls.
    fn sleep(&self, calls: &AtomicU32) {
        let seen = self.wake.0.load(Ordering::SeqCst);
        self.sleepers.fetch_add(1, Ordering::SeqCst);
        let work_arrived = self.shutdown.load(Ordering::SeqCst)
            || self.frame_work_pending()
            || !self.background.is_empty()
            || calls.load(Ordering::SeqCst) > 0
            || self.wake.0.load(Ordering::SeqCst) != seen;
        if !work_arrived {
            wait::wait(&self.wake.0, seen);
        }
        self.sleepers.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The closure an idle job descriptor points at.
fn noop_chunk(_: Range<u32>, _: WorkerId) {}

/// Runs every chunk of a loop on the calling thread.
fn run_inline(count: u32, chunk_size: u32, f: &ChunkFn<'_>, worker: WorkerId) {
    let mut start = 0;
    while start < count {
        let end = start.saturating_add(chunk_size).min(count);
        f(start..end, worker);
        start = end;
    }
}

/// One slot of the background queue.
struct TaskCell {
    sequence: AtomicU32,
    task: UnsafeCell<MaybeUninit<BackgroundTask>>,
}

/// A bounded multi-producer, multi-consumer queue (Dmitry Vyukov's design). Each cell's sequence
/// number says whether it is free for the producer at that position or full for the consumer.
struct TaskQueue {
    cells: Box<[TaskCell]>,
    mask: u32,
    enqueue: CachePadded<AtomicU32>,
    dequeue: CachePadded<AtomicU32>,
}

// SAFETY: a cell's task is written only by the producer that claimed its position and read only
// by the consumer that claimed the same position, and the cell's sequence number (release store,
// acquire load) orders the two.
unsafe impl Sync for TaskQueue {}

impl TaskQueue {
    fn new(capacity: u32) -> Self {
        let size = capacity.clamp(2, 1 << 30).next_power_of_two();
        let cells = (0..size)
            .map(|i| TaskCell {
                sequence: AtomicU32::new(i),
                task: UnsafeCell::new(MaybeUninit::uninit()),
            })
            .collect();
        Self {
            cells,
            mask: size - 1,
            enqueue: CachePadded(AtomicU32::new(0)),
            dequeue: CachePadded(AtomicU32::new(0)),
        }
    }

    fn capacity(&self) -> u32 {
        self.mask + 1
    }

    fn len(&self) -> u32 {
        let head = self.dequeue.0.load(Ordering::SeqCst);
        let tail = self.enqueue.0.load(Ordering::SeqCst);
        tail.wrapping_sub(head).min(self.capacity())
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn push(&self, task: BackgroundTask) -> bool {
        let mut pos = self.enqueue.0.load(Ordering::Relaxed);
        loop {
            let cell = &self.cells[(pos & self.mask) as usize];
            let lag = cell.sequence.load(Ordering::Acquire).wrapping_sub(pos) as i32;
            if lag == 0 {
                match self.enqueue.0.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::SeqCst,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // SAFETY: winning the position gives this thread the cell until the
                        // sequence store below hands it to a consumer.
                        unsafe { (*cell.task.get()).write(task) };
                        cell.sequence.store(pos.wrapping_add(1), Ordering::Release);
                        return true;
                    }
                    Err(now) => pos = now,
                }
            } else if lag < 0 {
                return false;
            } else {
                pos = self.enqueue.0.load(Ordering::Relaxed);
            }
        }
    }

    fn pop(&self) -> Option<BackgroundTask> {
        let mut pos = self.dequeue.0.load(Ordering::Relaxed);
        loop {
            let cell = &self.cells[(pos & self.mask) as usize];
            let lag = cell
                .sequence
                .load(Ordering::Acquire)
                .wrapping_sub(pos.wrapping_add(1)) as i32;
            if lag == 0 {
                match self.dequeue.0.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::SeqCst,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // SAFETY: the acquire load saw the producer's release store, so the task
                        // is written, and winning the position gives this thread the cell.
                        let task = unsafe { (*cell.task.get()).assume_init_read() };
                        cell.sequence
                            .store(pos.wrapping_add(self.mask + 1), Ordering::Release);
                        return Some(task);
                    }
                    Err(now) => pos = now,
                }
            } else if lag < 0 {
                return None;
            } else {
                pos = self.dequeue.0.load(Ordering::Relaxed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inline_loops_cover_every_index_once() {
        let jobs = JobSystem::new(0);
        for (count, chunk) in [(0, 1), (1, 1), (10, 3), (10, 0), (1000, 64), (7, 100)] {
            let hits: Vec<AtomicU32> = (0..count).map(|_| AtomicU32::new(0)).collect();
            jobs.parallel_for(count, chunk, &|range, worker| {
                assert_eq!(worker, WorkerId::CALLER);
                for i in range {
                    hits[i as usize].fetch_add(1, Ordering::Relaxed);
                }
            });
            assert!(hits.iter().all(|h| h.load(Ordering::Relaxed) == 1));
        }
    }

    #[test]
    fn worker_ids() {
        assert_eq!(WorkerId::CALLER.index(), 0);
        assert_eq!(WorkerId::job_worker(3).index(), 4);
        assert_eq!(JobSystem::current_worker(), WorkerId::CALLER);
        assert_eq!(JobSystem::new(4).thread_count(), 5);
    }

    static RAN: AtomicU64 = AtomicU64::new(0);

    fn add(arg: u64, _: WorkerId) {
        RAN.fetch_add(arg, Ordering::Relaxed);
    }

    #[test]
    fn background_queue_capacity_and_order() {
        let jobs = JobSystem::with_config(JobConfig {
            background_capacity: 4,
            ..JobConfig::default()
        });
        for i in 0..4 {
            jobs.spawn_background(BackgroundTask { run: add, arg: i })
                .unwrap();
        }
        assert_eq!(
            jobs.spawn_background(BackgroundTask { run: add, arg: 9 }),
            Err(CoreError::CapacityExceeded {
                resource: Resource::BackgroundTasks,
                capacity: 4
            })
        );
        assert_eq!(jobs.pending_background(), 4);
        assert_eq!(jobs.run_background_tasks(10), 4);
        assert_eq!(RAN.load(Ordering::Relaxed), 1 + 2 + 3);
        assert_eq!(jobs.pending_background(), 0);
    }

    #[test]
    #[allow(clippy::disallowed_methods)] // The test runs a job worker and the caller on native threads.
    fn a_worker_that_dies_inside_a_chunk_ends_the_loop_with_a_panic() {
        use std::sync::{Arc, mpsc};
        use std::time::Duration;
        static CLAIMED: AtomicBool = AtomicBool::new(false);
        let jobs = Arc::new(JobSystem::new(1));
        // Stands in for job worker 0 when its thread dies inside a chunk: it claims a chunk, holds
        // it as `run_chunk` does, and never counts it as done. Its host then reports the failure.
        let dead = Arc::clone(&jobs);
        let worker = std::thread::spawn(move || {
            while dead.try_claim().is_none() {
                spin_loop();
            }
            dead.holding[0].0.store(true, Ordering::Relaxed);
            CLAIMED.store(true, Ordering::SeqCst);
            assert!(dead.worker_failed(0));
            assert!(!dead.worker_failed(0));
        });
        let (sender, receiver) = mpsc::channel();
        let caller = Arc::clone(&jobs);
        std::thread::spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                caller.parallel_for(4, 1, &|_, _| {
                    while !CLAIMED.load(Ordering::SeqCst) {
                        spin_loop();
                    }
                });
            }));
            let _ = sender.send(outcome.is_err());
        });
        let panicked = receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("the loop waited for the dead worker's chunk");
        assert!(panicked);
        worker.join().unwrap();
    }

    #[test]
    fn a_worker_loop_past_the_worker_count_returns() {
        let jobs = JobSystem::new(1);
        assert_eq!(jobs.worker_loop(1), LoopExit::Stopped);
        jobs.shutdown();
        assert_eq!(jobs.worker_loop(0), LoopExit::Stopped);
        assert!(jobs.is_shut_down());
    }

    #[test]
    fn a_call_returns_the_worker_until_it_is_done() {
        let jobs = JobSystem::with_config(JobConfig {
            workers: 2,
            spin_rounds: 0,
            ..JobConfig::default()
        });
        jobs.call_worker(1);
        jobs.call_worker(1);
        jobs.call_worker(5);
        assert_eq!(jobs.pending_calls(1), 2);
        assert_eq!(jobs.pending_calls(0), 0);
        assert_eq!(jobs.worker_loop(1), LoopExit::Called);
        jobs.call_done(1);
        assert_eq!(jobs.worker_loop(1), LoopExit::Called);
        jobs.call_done(1);
        jobs.call_done(1);
        assert_eq!(jobs.pending_calls(1), 0);
        jobs.shutdown();
        assert_eq!(jobs.worker_loop(1), LoopExit::Stopped);
    }

    #[test]
    #[allow(clippy::disallowed_methods)] // The test runs a job worker on a native thread.
    fn a_call_wakes_a_sleeping_worker() {
        let jobs = std::sync::Arc::new(JobSystem::with_config(JobConfig {
            workers: 1,
            spin_rounds: 0,
            ..JobConfig::default()
        }));
        let worker = {
            let jobs = std::sync::Arc::clone(&jobs);
            std::thread::spawn(move || jobs.worker_loop(0))
        };
        while jobs.sleepers.load(Ordering::SeqCst) < 1 {
            std::thread::yield_now();
        }
        jobs.call_worker(0);
        assert_eq!(
            worker.join().expect("the job worker panicked"),
            LoopExit::Called
        );
    }

    #[test]
    #[allow(clippy::disallowed_methods)] // The test runs job workers on native threads.
    fn writing_the_stop_words_stops_sleeping_workers() {
        let jobs = std::sync::Arc::new(JobSystem::with_config(JobConfig {
            workers: 2,
            spin_rounds: 0,
            ..JobConfig::default()
        }));
        let threads: Vec<_> = (0..2)
            .map(|i| {
                let jobs = std::sync::Arc::clone(&jobs);
                std::thread::spawn(move || jobs.worker_loop(i))
            })
            .collect();
        while jobs.sleepers.load(Ordering::SeqCst) < 2 {
            std::thread::yield_now();
        }
        // What the page does when it leaves: it has the shared memory, not the job system.
        let (wake, stop) = jobs.stop_words();
        stop.store(true, Ordering::SeqCst);
        wake.fetch_add(1, Ordering::SeqCst);
        crate::wait::wake_all(wake);
        for thread in threads {
            thread.join().expect("a job worker panicked");
        }
        assert!(jobs.is_shut_down());
    }
}
