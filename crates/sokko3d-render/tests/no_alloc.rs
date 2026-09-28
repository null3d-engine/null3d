//! Steady frames allocate nothing: a counting global allocator watches the test thread while the
//! frame builder records frames of a scene whose batch moves every frame. It counts only the test
//! thread, so the test runner's own work on other threads cannot reach the count. Frames whose
//! structure changes allocate nothing either, on either frame parity, until the scene grows.

mod common;

use common::World;
use sokko3d_core::jobs::JobSystem;
use sokko3d_core::testing::CountingAllocator;
use sokko3d_gpu::drawlist::{DrawList, Op};
use sokko3d_render::geometry::sphere_geometry;
use sokko3d_render::parallel_record::ParallelRecorder;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[test]
fn recording_steady_frames_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    // Two frames per parity warm up the lists and the upload arenas.
    for frame in 1..=4 {
        world.frame = frame;
        world.record(frame == 1);
    }
    CountingAllocator::arm();
    for frame in 5..=200 {
        world.frame = frame;
        world.record(false);
    }
    assert_eq!(CountingAllocator::disarm(), 0);
}

/// Records frames up to `last`, each with its structure changed or not.
fn record_until(world: &mut World, last: u32, structure_changed: bool) {
    while world.frame < last {
        world.frame += 1;
        world.record(structure_changed);
    }
}

#[test]
fn structure_changes_after_warm_up_allocate_nothing() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    world.record(true);
    record_until(&mut world, 4, false);
    // The rebuilds land on both parities, including the one whose frames have not rebuilt yet.
    CountingAllocator::arm();
    record_until(&mut world, 40, true);
    assert_eq!(CountingAllocator::disarm(), 0);
}

#[test]
fn only_the_frames_after_the_scene_grows_allocate() {
    let _only = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let mut world = World::new();
    world.record(true);
    record_until(&mut world, 4, false);
    // A new mesh and a new batch: the next frame of each parity makes room for them.
    let ball = world
        .renderer
        .meshes_mut()
        .add(&sphere_geometry(0.5, 16, 12))
        .unwrap()
        + 1;
    let batch = world
        .batches
        .create(500, true, false, ball, 1, 0.5)
        .unwrap();
    world
        .batches
        .get_mut(batch)
        .unwrap()
        .set_active_count(500)
        .unwrap();
    record_until(&mut world, 6, true);
    CountingAllocator::arm();
    record_until(&mut world, 40, true);
    assert_eq!(CountingAllocator::disarm(), 0);
}

#[test]
fn parallel_recording_allocates_nothing() {
    let _only = CountingAllocator::exclusive();
    // No job workers: the calling thread runs every chunk, so it is the thread to watch.
    CountingAllocator::track_this_thread();
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
    CountingAllocator::arm();
    for _ in 0..100 {
        out.clear();
        recorder.record(&jobs, 1000, 32, &record, &mut out).unwrap();
    }
    assert_eq!(CountingAllocator::disarm(), 0);
}
