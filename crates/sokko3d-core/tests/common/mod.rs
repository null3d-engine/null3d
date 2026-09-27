//! Helpers shared by the integration tests: native threads that act as job workers, a small
//! deterministic random number generator, and an allocation counter.
#![allow(dead_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::JoinHandle;

use sokko3d_core::jobs::{JobConfig, JobSystem};

/// A job system with native threads running its worker loops. Dropping it shuts the system down
/// and joins the threads.
pub struct Workers {
    jobs: Arc<JobSystem>,
    threads: Vec<JoinHandle<()>>,
}

impl Workers {
    /// Starts `workers` job worker threads with the default settings.
    pub fn start(workers: u32) -> Self {
        Self::with_config(JobConfig {
            workers,
            ..JobConfig::default()
        })
    }

    /// Starts job worker threads with explicit settings. `before_loop` runs on each worker thread
    /// first, for example to mark the thread for allocation counting.
    pub fn with_config(config: JobConfig) -> Self {
        Self::with_setup(config, || {})
    }

    /// Like [`Workers::with_config`], running `setup` on each worker thread before its loop.
    #[allow(clippy::disallowed_methods)]
    pub fn with_setup(config: JobConfig, setup: fn()) -> Self {
        let jobs = Arc::new(JobSystem::with_config(config));
        let threads = (0..jobs.worker_count())
            .map(|i| {
                let jobs = Arc::clone(&jobs);
                std::thread::spawn(move || {
                    setup();
                    jobs.worker_loop(i);
                })
            })
            .collect();
        Self { jobs, threads }
    }

    /// The shared job system.
    pub fn jobs(&self) -> &JobSystem {
        &self.jobs
    }

    /// Shuts the system down and waits for every worker thread to return.
    pub fn stop(mut self) {
        self.join();
    }

    fn join(&mut self) {
        self.jobs.shutdown();
        for t in self.threads.drain(..) {
            t.join().expect("a job worker thread panicked");
        }
    }
}

impl Drop for Workers {
    fn drop(&mut self) {
        self.join();
    }
}

/// A small permuted congruential generator, so tests are repeatable without a dependency.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let x = ((self.0 >> 18) ^ self.0) >> 27;
        (x as u32).rotate_right((self.0 >> 59) as u32)
    }

    /// A value in `0..n`.
    pub fn below(&mut self, n: u32) -> u32 {
        ((u64::from(self.next_u32()) * u64::from(n)) >> 32) as u32
    }

    /// A value in `lo..hi`.
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// A random unit quaternion (x, y, z, w).
    pub fn quaternion(&mut self) -> [f32; 4] {
        loop {
            let q = [
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
                self.range(-1.0, 1.0),
            ];
            let len = q.iter().map(|v| v * v).sum::<f32>().sqrt();
            if len > 0.1 {
                return q.map(|v| v / len);
            }
        }
    }
}

/// A global allocator that counts allocations made by marked threads while counting is armed.
/// A test binary installs it with `#[global_allocator]`.
pub struct CountingAllocator;

static ARMED: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static TRACKED: Cell<bool> = const { Cell::new(false) };
}

impl CountingAllocator {
    /// Counts allocations made from now on by the current thread.
    pub fn track_this_thread() {
        TRACKED.with(|t| t.set(true));
    }

    /// Starts counting from zero.
    pub fn arm() {
        ALLOCATIONS.store(0, Ordering::SeqCst);
        ARMED.store(true, Ordering::SeqCst);
    }

    /// Stops counting and returns the number of allocations counted.
    pub fn disarm() -> u64 {
        ARMED.store(false, Ordering::SeqCst);
        ALLOCATIONS.load(Ordering::SeqCst)
    }

    fn count() {
        if ARMED.load(Ordering::Relaxed) && TRACKED.with(Cell::get) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

// SAFETY: every call forwards to the system allocator unchanged; counting touches only atomics
// and a thread-local flag, neither of which allocates.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        Self::count();
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.dealloc(ptr, layout) }
    }
}
