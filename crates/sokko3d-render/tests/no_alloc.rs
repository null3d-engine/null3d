//! Steady frames allocate nothing: a counting global allocator watches while the frame builder
//! records frames of a scene whose batch moves every frame.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use common::World;
use sokko3d_core::jobs::JobSystem;
use sokko3d_gpu::drawlist::{DrawList, Op};
use sokko3d_render::parallel_record::ParallelRecorder;

struct CountingAllocator;

static ARMED: AtomicBool = AtomicBool::new(false);
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

// SAFETY: every call forwards to the system allocator unchanged; counting touches only atomics.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if ARMED.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if ARMED.load(Ordering::Relaxed) {
            ALLOCATIONS.fetch_add(1, Ordering::Relaxed);
        }
        // SAFETY: the caller's contract is forwarded as is.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Tests in this binary share the counter, so they run one at a time.
static EXCLUSIVE: Mutex<()> = Mutex::new(());

#[test]
fn recording_steady_frames_allocates_nothing() {
    let _only = EXCLUSIVE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut world = World::new();
    // Two frames per parity warm up the lists and the upload arenas.
    for frame in 1..=4 {
        world.frame = frame;
        world.record(frame == 1);
    }
    ALLOCATIONS.store(0, Ordering::SeqCst);
    ARMED.store(true, Ordering::SeqCst);
    for frame in 5..=200 {
        world.frame = frame;
        world.record(false);
    }
    ARMED.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCATIONS.load(Ordering::SeqCst), 0);
}

#[test]
fn parallel_recording_allocates_nothing() {
    let _only = EXCLUSIVE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // No job workers: the calling thread runs every chunk, and the counter watches all threads.
    let jobs = JobSystem::new(0);
    let mut recorder = ParallelRecorder::new(jobs.thread_count(), 8192, 64);
    let mut out = DrawList::with_capacity(8192);
    let record = |range: std::ops::Range<u32>, list: &mut DrawList| {
        for i in range {
            list.push(Op::Draw, &[i, 1, 0, 0])?;
        }
        Ok(())
    };
    recorder.record(&jobs, 1000, 32, &record, &mut out).unwrap();
    ALLOCATIONS.store(0, Ordering::SeqCst);
    ARMED.store(true, Ordering::SeqCst);
    for _ in 0..100 {
        out.clear();
        recorder.record(&jobs, 1000, 32, &record, &mut out).unwrap();
    }
    ARMED.store(false, Ordering::SeqCst);
    assert_eq!(ALLOCATIONS.load(Ordering::SeqCst), 0);
}
