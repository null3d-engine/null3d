//! Frame arenas over many frames: the high-water mark stays flat, and frames never call the
//! global allocator. (The browser soak test measures memory in every worker over 10 minutes;
//! this is its native counterpart for the arenas.)

mod common;

use common::Workers;
use null3d_core::arena::{ArenaPool, FrameArena};
use null3d_core::jobs::{JobConfig, WorkerId};
use null3d_core::testing::CountingAllocator;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Frames repeat their allocation pattern with this period.
const PERIOD: u32 = 1000;
/// The most values in a part's longest slice.
const MAX_LEN: usize = 700;
/// The most bytes that one part of a frame takes, and the most that one of its slices takes.
const PART_BYTES: usize = FrameArena::bytes_for::<u32>(MAX_LEN)
    + FrameArena::bytes_for::<u8>(13)
    + FrameArena::bytes_for::<[f32; 4]>(MAX_LEN / 4 + 1);
const LARGEST: usize = FrameArena::bytes_for::<[f32; 4]>(MAX_LEN / 4 + 1);

/// One part of a frame's allocations for `worker`: a few slices whose sizes follow the frame
/// number.
fn allocate(pool: &ArenaPool, worker: WorkerId, frame: u32, part: u32) {
    let n = ((frame % PERIOD) * 37 + part * 101) as usize % MAX_LEN + 1;
    let indices = pool.alloc::<u32>(worker, n).unwrap();
    indices.fill(frame);
    let bytes = pool.alloc_filled::<u8>(worker, n % 13 + 1, 7).unwrap();
    let vectors = pool.alloc::<[f32; 4]>(worker, n / 4 + 1).unwrap();
    vectors[0] = [frame as f32; 4];
    assert_eq!(indices[n - 1], frame);
    assert_eq!(bytes[0], 7);
}

/// Worker id `w` of a system with job workers: 0 is the calling thread.
fn worker(w: u32) -> WorkerId {
    if w == 0 {
        WorkerId::CALLER
    } else {
        WorkerId::job_worker(w - 1)
    }
}

#[test]
fn a_million_frames_keep_the_high_water_mark_flat() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut pool = ArenaPool::new(4, 4 * PART_BYTES, LARGEST);
    let run = |pool: &mut ArenaPool, frames: std::ops::Range<u32>| {
        for frame in frames {
            for w in 0..4 {
                allocate(pool, worker(w), frame, w);
            }
            pool.reset_all();
        }
    };
    // One full period of the pattern reaches every size the frames use.
    run(&mut pool, 0..PERIOD);
    let marks: Vec<usize> = (0..4).map(|w| pool.high_water_of(worker(w))).collect();
    let peak = pool.high_water();
    assert!(peak > 0 && peak <= PART_BYTES);

    CountingAllocator::arm();
    run(&mut pool, PERIOD..1_000_000);
    let allocations = CountingAllocator::disarm();
    assert_eq!(allocations, 0);
    assert_eq!(pool.high_water(), peak);
    for (w, &mark) in (0..4).zip(&marks) {
        assert_eq!(pool.high_water_of(worker(w)), mark);
    }
}

#[test]
fn job_workers_take_scratch_without_growth() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let workers = Workers::with_setup(
        JobConfig {
            workers: 3,
            ..JobConfig::default()
        },
        CountingAllocator::track_this_thread,
    );
    let jobs = workers.jobs();
    // A frame asks for at most eight parts, and any thread may run any number of them.
    let mut pool = ArenaPool::for_jobs(jobs, 8 * PART_BYTES, LARGEST);
    let mut most_used = 0;
    CountingAllocator::arm();
    for frame in 0..100_000 {
        jobs.parallel_for(8, 1, &|parts, worker| {
            for part in parts {
                allocate(&pool, worker, frame, part);
            }
        });
        most_used = most_used.max(pool.used());
        pool.reset_all();
    }
    let allocations = CountingAllocator::disarm();
    assert_eq!(allocations, 0);
    assert!(most_used <= 8 * PART_BYTES, "{most_used} bytes");
}
