//! The job system with real threads: coverage of every index, nested and back-to-back jobs,
//! panics, background tasks and their priority, and shutdown.
#![allow(clippy::disallowed_methods)] // Tests time work and sleep on native threads.

mod common;

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::Workers;
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
fn job_workers_share_the_work() {
    let pool = Workers::start(4);
    let ids = AtomicU64::new(0);
    pool.jobs().parallel_for(400, 1, &|_, worker| {
        ids.fetch_or(1 << worker.index(), Ordering::Relaxed);
        spin_for(Duration::from_micros(50));
    });
    let distinct = ids.load(Ordering::Relaxed).count_ones();
    assert!(distinct >= 2, "only {distinct} thread ran chunks");
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
    let deadline = Instant::now() + Duration::from_secs(10);
    while BACKGROUND_RUNS.load(Ordering::Relaxed) < 500 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(BACKGROUND_RUNS.load(Ordering::Relaxed), 500);
    assert_eq!(pool.jobs().pending_background(), 0);
}

/// Background task starts: the worker index and nanoseconds since the test began.
struct TaskLog {
    epoch: Instant,
    starts: Mutex<Vec<(u32, u64)>>,
}

static TASK_LOG: OnceLock<TaskLog> = OnceLock::new();
const TASK_TIME: Duration = Duration::from_millis(5);

fn long_background_task(_: u64, worker: WorkerId) {
    let log = TASK_LOG.get().unwrap();
    let start = log.epoch.elapsed().as_nanos() as u64;
    log.starts
        .lock()
        .unwrap()
        .push((worker.index() as u32, start));
    spin_for(TASK_TIME);
}

#[test]
fn background_work_never_delays_frame_work_beyond_one_task() {
    const WORKERS: u32 = 4;
    const CHUNKS: u32 = 400;
    const CHUNK_TIME: Duration = Duration::from_micros(250);
    // Generous slack for thread scheduling on a busy machine.
    const SLACK: Duration = Duration::from_millis(20);

    let log = TASK_LOG.get_or_init(|| TaskLog {
        epoch: Instant::now(),
        starts: Mutex::new(Vec::with_capacity(4096)),
    });
    let pool = Workers::with_config(JobConfig {
        workers: WORKERS,
        background_capacity: 4096,
        ..JobConfig::default()
    });
    let jobs = pool.jobs();
    for i in 0..4000 {
        jobs.spawn_background(BackgroundTask {
            run: long_background_task,
            arg: i,
        })
        .unwrap();
    }
    let now = || log.epoch.elapsed().as_nanos() as u64;
    for round in 0..15 {
        // Let the workers pick up background tasks between frame jobs.
        std::thread::sleep(Duration::from_millis(3));
        let chunk_starts: Vec<AtomicU64> = (0..CHUNKS).map(|_| AtomicU64::new(0)).collect();
        let chunk_workers: Vec<AtomicU32> = (0..CHUNKS).map(|_| AtomicU32::new(0)).collect();
        let job_start = now();
        jobs.parallel_for(CHUNKS, 1, &|range, worker| {
            chunk_starts[range.start as usize].store(now(), Ordering::Relaxed);
            chunk_workers[range.start as usize].store(worker.index() as u32, Ordering::Relaxed);
            spin_for(CHUNK_TIME);
        });
        let last_claim = chunk_starts
            .iter()
            .map(|s| s.load(Ordering::Relaxed))
            .max()
            .unwrap();

        let starts = log.starts.lock().unwrap();
        for w in 1..=WORKERS {
            // Each job worker joined the frame job within one background task of its start.
            let first = (0..CHUNKS as usize)
                .filter(|&c| chunk_workers[c].load(Ordering::Relaxed) == w)
                .map(|c| chunk_starts[c].load(Ordering::Relaxed))
                .min()
                .unwrap_or_else(|| panic!("round {round}: worker {w} ran no chunk"));
            let joined_after = Duration::from_nanos(first - job_start);
            assert!(
                joined_after <= TASK_TIME + SLACK,
                "round {round}: worker {w} joined {joined_after:?} after the job started"
            );
            // While chunks waited to be claimed, a worker started at most one background task:
            // one it took just before the job became visible.
            let started = starts
                .iter()
                .filter(|&&(sw, s)| sw == w && s > job_start && s < last_claim)
                .count();
            assert!(
                started <= 1,
                "round {round}: worker {w} started {started} background tasks during the frame job"
            );
        }
    }
    // Background tasks did run in the gaps.
    assert!(!log.starts.lock().unwrap().is_empty());
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
    let seen = Mutex::new(HashSet::new());
    pool.jobs().parallel_for(200, 1, &|_, worker| {
        seen.lock().unwrap().insert(worker);
        spin_for(Duration::from_micros(50));
    });
    assert!(
        seen.lock().unwrap().len() >= 2,
        "sleeping workers never woke"
    );
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
