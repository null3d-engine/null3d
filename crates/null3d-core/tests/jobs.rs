//! The job system with real threads: coverage of every index, nested and back-to-back jobs,
//! panics, background tasks and their priority, and shutdown. The checks hold on a busy machine:
//! no test needs a thread to run within a set time.
#![allow(clippy::disallowed_methods)] // Tests time work and sleep on native threads.

mod common;

use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::{Workers, wait_for_every_thread, wait_until};
use null3d_core::jobs::{BackgroundTask, JobConfig, JobSystem, WorkerId};

/// Busy-waits for `d`, so the thread stays on its core the way real work would.
fn spin_for(d: Duration) {
    let end = Instant::now() + d;
    while Instant::now() < end {
        std::hint::spin_loop();
    }
}

#[test]
fn every_index_is_processed_exactly_once() {
    for workers in 0..=8 {
        let pool = Workers::start(workers);
        let jobs = pool.jobs();
        for count in [1u32, 2, 63, 64, 1000, 10_007] {
            for chunk in [0u32, 1, 2, 3, 7, 64, 1000, count, count + 1] {
                let hits: Vec<AtomicU32> = (0..count).map(|_| AtomicU32::new(0)).collect();
                let ids_seen = AtomicU64::new(0);
                jobs.parallel_for(count, chunk, &|range, worker| {
                    assert!(worker.index() < jobs.thread_count() as usize);
                    ids_seen.fetch_or(1 << worker.index(), Ordering::Relaxed);
                    for i in range {
                        hits[i as usize].fetch_add(1, Ordering::Relaxed);
                    }
                });
                for (i, h) in hits.iter().enumerate() {
                    assert_eq!(
                        h.load(Ordering::Relaxed),
                        1,
                        "index {i} of {count}, chunk {chunk}, {workers} workers"
                    );
                }
                assert_ne!(ids_seen.load(Ordering::Relaxed), 0);
            }
        }
        pool.stop();
    }
}

/// Milliseconds since the first call, from the native monotonic clock.
fn clock_ms() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

#[test]
fn job_workers_time_their_chunks_before_the_loop_returns() {
    const CHUNK_MS: f64 = 0.5;
    let pool = Workers::with_config(JobConfig {
        workers: 2,
        clock: Some(clock_ms),
        ..JobConfig::default()
    });
    let jobs = pool.jobs();
    let chunks = [AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0)];
    jobs.parallel_for(60, 1, &|_, worker| {
        chunks[worker.index()].fetch_add(1, Ordering::Relaxed);
        spin_for(Duration::from_secs_f64(CHUNK_MS / 1000.0));
    });
    for k in 0..2u32 {
        let ran = chunks[k as usize + 1].load(Ordering::Relaxed);
        let busy = jobs.take_busy_ms(k);
        assert!(
            busy >= CHUNK_MS * f64::from(ran),
            "worker {k}: {busy} ms for {ran} chunks"
        );
        assert_eq!(
            jobs.take_busy_ms(k),
            0.0,
            "worker {k}: the total starts again"
        );
    }
    assert_eq!(jobs.take_busy_ms(2), 0.0, "an index past the worker count");
    pool.stop();

    let untimed = Workers::start(2);
    untimed
        .jobs()
        .parallel_for(60, 1, &|_, _| spin_for(Duration::from_micros(100)));
    assert_eq!(
        untimed.jobs().take_busy_ms(0),
        0.0,
        "no clock, no busy time"
    );
    untimed.stop();
}

#[test]
fn the_caller_times_the_loops_it_hands_out_even_before_any_job_worker_joins() {
    const CHUNK_MS: f64 = 0.2;
    // Room for four job workers, none of which has joined: the caller runs every chunk.
    let jobs = JobSystem::with_config(JobConfig {
        workers: 4,
        clock: Some(clock_ms),
        ..JobConfig::default()
    });
    jobs.parallel_for(20, 1, &|_, _| {
        spin_for(Duration::from_secs_f64(CHUNK_MS / 1000.0));
    });
    let handed = jobs.take_handed_ms();
    assert!(handed >= CHUNK_MS * 20.0, "{handed} ms for 20 chunks");
    assert_eq!(jobs.take_handed_ms(), 0.0, "the total starts again");

    // A loop of one chunk runs inline, and hands nothing out.
    jobs.parallel_for(1, 1, &|_, _| spin_for(Duration::from_micros(200)));
    assert_eq!(jobs.take_handed_ms(), 0.0, "an inline loop");

    // Stopped, the timing reads no clock; started again, it times the next loop.
    jobs.time_handed_loops(false);
    jobs.parallel_for(20, 1, &|_, _| spin_for(Duration::from_micros(50)));
    assert_eq!(jobs.take_handed_ms(), 0.0, "timing stopped");
    jobs.time_handed_loops(true);
    jobs.parallel_for(20, 1, &|_, _| spin_for(Duration::from_micros(50)));
    assert!(jobs.take_handed_ms() > 0.0, "timing started again");

    let untimed = JobSystem::with_config(JobConfig {
        workers: 4,
        ..JobConfig::default()
    });
    untimed.parallel_for(20, 1, &|_, _| spin_for(Duration::from_micros(50)));
    assert_eq!(untimed.take_handed_ms(), 0.0, "no clock, no handed time");
}

#[test]
fn every_job_worker_takes_part_in_a_loop_that_waits_for_it() {
    let pool = Workers::start(4);
    let jobs = pool.jobs();
    let threads = jobs.thread_count();
    let joined = AtomicU64::new(0);
    jobs.parallel_for(400, 1, &|_, worker| {
        wait_for_every_thread(&joined, worker, threads);
    });
}

#[test]
fn back_to_back_jobs() {
    let pool = Workers::start(4);
    let jobs = pool.jobs();
    let sum = AtomicU64::new(0);
    // Chunk counts change from job to job, which exposes a claim that reads one job's ticket
    // and the next job's chunk count.
    for round in 0..100_000u32 {
        let count = 1 + round % 97;
        sum.store(0, Ordering::Relaxed);
        jobs.parallel_for(count, 1 + round % 5, &|range, _| {
            assert!(
                range.end <= count,
                "round {round}: range {range:?} of {count}"
            );
            let s: u64 = range.map(u64::from).sum();
            sum.fetch_add(s, Ordering::Relaxed);
        });
        let n = u64::from(count);
        assert_eq!(
            sum.load(Ordering::Relaxed),
            n * (n - 1) / 2,
            "round {round}"
        );
    }
}

#[test]
fn nested_jobs_run_inline_on_the_same_thread() {
    let pool = Workers::start(4);
    let jobs = pool.jobs();
    let hits: Vec<AtomicU32> = (0..64 * 100).map(|_| AtomicU32::new(0)).collect();
    jobs.parallel_for(64, 1, &|outer, outer_worker| {
        for o in outer {
            jobs.parallel_for(100, 7, &|inner, inner_worker| {
                assert_eq!(inner_worker, outer_worker);
                assert_eq!(JobSystem::current_worker(), outer_worker);
                for i in inner {
                    hits[(o * 100 + i) as usize].fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });
    assert!(hits.iter().all(|h| h.load(Ordering::Relaxed) == 1));
}

#[test]
fn a_panicking_chunk_panics_the_caller_after_every_chunk_finishes() {
    let pool = Workers::start(3);
    let jobs = pool.jobs();
    let finished = AtomicU32::new(0);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        jobs.parallel_for(64, 1, &|range, _| {
            if range.start == 13 {
                panic!("chunk 13 fails on purpose");
            }
            spin_for(Duration::from_micros(20));
            finished.fetch_add(1, Ordering::Relaxed);
        });
    }));
    assert!(result.is_err());
    assert_eq!(finished.load(Ordering::Relaxed), 63);
    // The system still works.
    let count = AtomicU32::new(0);
    jobs.parallel_for(100, 3, &|range, _| {
        count.fetch_add(range.len() as u32, Ordering::Relaxed);
    });
    assert_eq!(count.load(Ordering::Relaxed), 100);
}

static BACKGROUND_RUNS: AtomicU32 = AtomicU32::new(0);

fn count_run(_: u64, worker: WorkerId) {
    assert_ne!(worker, WorkerId::CALLER);
    BACKGROUND_RUNS.fetch_add(1, Ordering::Relaxed);
}

#[test]
fn background_tasks_run_exactly_once_on_job_workers() {
    let pool = Workers::start(3);
    for i in 0..500 {
        pool.jobs()
            .spawn_background(BackgroundTask {
                run: count_run,
                arg: i,
            })
            .unwrap();
    }
    wait_until("every background task to run", || {
        BACKGROUND_RUNS.load(Ordering::Relaxed) >= 500
    });
    assert_eq!(BACKGROUND_RUNS.load(Ordering::Relaxed), 500);
    assert_eq!(pool.jobs().pending_background(), 0);
}

/// Numbers that every thread draws from one sequence, so a test can order what the threads did
/// without a clock.
static EVENTS: AtomicU64 = AtomicU64::new(0);

fn next_event() -> u64 {
    EVENTS.fetch_add(1, Ordering::SeqCst)
}

/// Each background task's start: the worker's index and the start's event number.
static TASK_STARTS: Mutex<Vec<(usize, u64)>> = Mutex::new(Vec::new());
/// The background tasks running now.
static TASKS_RUNNING: AtomicU32 = AtomicU32::new(0);

fn long_background_task(_: u64, worker: WorkerId) {
    TASKS_RUNNING.fetch_add(1, Ordering::SeqCst);
    let started = next_event();
    TASK_STARTS.lock().unwrap().push((worker.index(), started));
    spin_for(Duration::from_millis(2));
    TASKS_RUNNING.fetch_sub(1, Ordering::SeqCst);
}

/// A worker checks for frame work before each background task, so after a frame job becomes
/// visible it starts at most one more task: one it took just before. The test orders the events
/// by number, not by time, and each frame job waits until every worker has joined it. How long a
/// worker takes to join is a benchmark (`bench_job_workers_join_a_frame_job` in `bench.rs`).
#[test]
fn background_work_delays_each_job_worker_by_at_most_one_task() {
    const WORKERS: u32 = 4;
    let pool = Workers::with_config(JobConfig {
        workers: WORKERS,
        background_capacity: 4096,
        ..JobConfig::default()
    });
    let jobs = pool.jobs();
    let threads = jobs.thread_count();
    for i in 0..4000 {
        jobs.spawn_background(BackgroundTask {
            run: long_background_task,
            arg: i,
        })
        .unwrap();
    }
    for round in 0..15 {
        // A worker is inside a background task first, so the frame job usually starts while one
        // runs: the case under test.
        wait_until("a background task to start", || {
            TASKS_RUNNING.load(Ordering::SeqCst) > 0
        });
        let joined = AtomicU64::new(0);
        let chunk_starts: Vec<AtomicU64> = (0..threads).map(|_| AtomicU64::new(0)).collect();
        // One chunk per thread, and each chunk waits for every thread, so frame work stays
        // unclaimed until the last worker joins.
        jobs.parallel_for(threads, 1, &|_, worker| {
            chunk_starts[worker.index()].store(next_event(), Ordering::SeqCst);
            wait_for_every_thread(&joined, worker, threads);
        });
        // Chunks start only once the job is visible, so the first chunk's start comes after it.
        let visible = chunk_starts
            .iter()
            .map(|s| s.load(Ordering::SeqCst))
            .min()
            .unwrap();
        let starts = TASK_STARTS.lock().unwrap();
        for (w, joined_at) in chunk_starts.iter().enumerate().skip(1) {
            let joined_at = joined_at.load(Ordering::SeqCst);
            let started = starts
                .iter()
                .filter(|&&(sw, s)| sw == w && s > visible && s < joined_at)
                .count();
            assert!(
                started <= 1,
                "round {round}: worker {w} started {started} background tasks while the frame job waited for it"
            );
        }
    }
}

#[test]
fn shutdown_wakes_sleeping_workers_and_later_loops_run_inline() {
    let pool = Workers::with_config(JobConfig {
        workers: 4,
        spin_rounds: 0,
        ..JobConfig::default()
    });
    // Give the workers time to block.
    std::thread::sleep(Duration::from_millis(50));
    let threads = pool.jobs().thread_count();
    let joined = AtomicU64::new(0);
    // The loop ends only once every sleeping worker has woken and claimed a chunk.
    pool.jobs().parallel_for(threads, 1, &|_, worker| {
        wait_for_every_thread(&joined, worker, threads);
    });
    pool.stop();

    let jobs = JobSystem::new(4);
    jobs.shutdown();
    let count = AtomicU32::new(0);
    jobs.parallel_for(1000, 10, &|range, worker| {
        assert_eq!(worker, WorkerId::CALLER);
        count.fetch_add(range.len() as u32, Ordering::Relaxed);
    });
    assert_eq!(count.load(Ordering::Relaxed), 1000);
}

#[test]
fn a_frame_wakes_the_workers_only_after_a_frame_that_gave_them_work() {
    let pool = Workers::start(2);
    let jobs = pool.jobs();
    assert!(!jobs.prepare_frame(), "no loop has handed out work yet");
    // One chunk runs on the calling thread, and so does a loop without workers' help.
    jobs.parallel_for(10, 100, &|_, _| {});
    assert!(!jobs.prepare_frame());
    jobs.parallel_for(1000, 10, &|_, _| {});
    assert!(
        jobs.prepare_frame(),
        "the loop handed chunks to the workers"
    );
    assert!(
        !jobs.prepare_frame(),
        "each frame's work wakes the next frame's start once"
    );
}

#[test]
fn a_frame_knows_when_its_loops_have_given_the_workers_work() {
    let pool = Workers::start(2);
    let jobs = pool.jobs();
    jobs.prepare_frame();
    assert!(!jobs.workers_busy_this_frame());
    jobs.parallel_for(10, 100, &|_, _| {});
    assert!(
        !jobs.workers_busy_this_frame(),
        "one chunk runs on the calling thread"
    );
    jobs.parallel_for(1000, 10, &|_, _| {});
    assert!(jobs.workers_busy_this_frame());
    jobs.prepare_frame();
    assert!(
        !jobs.workers_busy_this_frame(),
        "a new frame starts with no work handed out"
    );
}
