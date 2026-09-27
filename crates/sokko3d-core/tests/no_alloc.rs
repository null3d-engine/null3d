//! Frame code allocates nothing: a counting global allocator watches the test thread and every
//! job worker while whole frames run (structural commands, transforms, batch updates, culling,
//! parallel loops with arena scratch memory, background tasks, and the frame handoff).
#![allow(clippy::disallowed_methods)] // The self-check reads the clock.

mod common;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::{CountingAllocator, Rng, Workers};
use sokko3d_core::arena::ArenaPool;
use sokko3d_core::culling::{CullOutput, Frustum, cull_parallel};
use sokko3d_core::handle::Handle;
use sokko3d_core::instances::BatchTable;
use sokko3d_core::jobs::{BackgroundTask, JobConfig, WorkerId};
use sokko3d_core::scene::{Command, CommandRing, SceneStorage, flags};
use sokko3d_core::snapshot::FrameHandoff;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

static BACKGROUND_SUM: AtomicU64 = AtomicU64::new(0);

fn background(arg: u64, _: WorkerId) {
    BACKGROUND_SUM.fetch_add(arg, Ordering::Relaxed);
}

/// A column-major perspective view-projection looking down -Z from z = 60.
fn camera() -> Frustum {
    let (near, far, f) = (0.5f32, 500.0f32, 1.5f32);
    let mut m = [0.0; 16];
    m[0] = f;
    m[5] = f;
    m[10] = far / (near - far);
    m[11] = -1.0;
    m[14] = near * far / (near - far) - 60.0 * m[10];
    m[15] = 60.0;
    Frustum::from_view_projection(&m)
}

struct World {
    scene: SceneStorage,
    ring: CommandRing,
    roots: Vec<Handle>,
    leaves: Vec<Handle>,
    spare: Vec<Handle>,
    table: BatchTable,
    moving: Handle,
    still: Handle,
    scene_culled: CullOutput,
    batch_culled: CullOutput,
    arenas: ArenaPool,
    handoff: FrameHandoff,
}

/// The S2 hierarchy: 14 roots with 3 children each, 6 levels deep.
fn build() -> World {
    let mut scene = SceneStorage::with_capacity(8192);
    let mut ring = CommandRing::with_capacity(8192);
    let mut level: Vec<Handle> = Vec::new();
    let mut roots = Vec::new();
    for depth in 0..6 {
        let parents = if depth == 0 {
            vec![Handle::NONE; 14]
        } else {
            level.repeat(3)
        };
        level = Vec::new();
        for (i, parent) in parents.into_iter().enumerate() {
            let h = scene.reserve().unwrap();
            scene.set_position(h, [i as f32 * 0.1, 1.0, 0.0]).unwrap();
            scene.set_local_radius(h, 0.5).unwrap();
            let f = if depth == 0 {
                flags::DYNAMIC | flags::VISIBLE
            } else {
                flags::VISIBLE
            };
            ring.push(Command::create(h, parent, 1, f)).unwrap();
            level.push(h);
        }
        if depth == 0 {
            roots.clone_from(&level);
        }
    }
    let mut table = BatchTable::with_capacity(4);
    let moving = table.create(20_000, true, true, 2, 2, 0.5).unwrap();
    let still = table.create(20_000, false, false, 3, 3, 0.5).unwrap();
    World {
        scene,
        ring,
        roots,
        leaves: level,
        spare: Vec::with_capacity(64),
        table,
        moving,
        still,
        scene_culled: CullOutput::with_capacity(8193),
        batch_culled: CullOutput::with_capacity(20_000),
        arenas: ArenaPool::new(5, 256 * 1024),
        handoff: FrameHandoff::new(4096),
    }
}

/// One frame of game work, as the game worker runs it.
fn frame(world: &mut World, jobs: &sokko3d_core::jobs::JobSystem, frame: u32, rng: &mut Rng) {
    // Game code: roots rotate, a few static objects move, rows of both batches change.
    for &root in &world.roots {
        let slot = world.scene.resolve(root).unwrap() as usize;
        let angle = frame as f32 * 0.01;
        world.scene.rotations_mut()[slot * 4 + 1] = angle.sin();
        world.scene.rotations_mut()[slot * 4 + 3] = angle.cos();
    }
    for _ in 0..5 {
        let leaf = world.leaves[rng.below(world.leaves.len() as u32) as usize];
        world
            .scene
            .set_position(leaf, [rng.range(-1.0, 1.0), 0.0, 0.0])
            .unwrap();
    }
    // Structural changes: create and destroy an object, reparent and hide others.
    let spawned = world.scene.reserve().unwrap();
    world.scene.set_local_radius(spawned, 1.0).unwrap();
    let parent = world.leaves[rng.below(world.leaves.len() as u32) as usize];
    world
        .ring
        .push(Command::create(spawned, parent, 1, flags::VISIBLE))
        .unwrap();
    if world.spare.len() == world.spare.capacity() {
        let old = world.spare.remove(0);
        world.ring.push(Command::destroy(old)).unwrap();
    }
    world.spare.push(spawned);
    let a = world.leaves[rng.below(world.leaves.len() as u32) as usize];
    let b = world.roots[rng.below(world.roots.len() as u32) as usize];
    world.ring.push(Command::set_parent(a, b)).unwrap();
    world
        .ring
        .push(Command::set_visible(b, frame.is_multiple_of(2)))
        .unwrap();
    world.scene.apply_ring(&world.ring, frame).unwrap();
    world.scene.update_transforms(jobs);

    let batch = world.table.get_mut(world.moving).unwrap();
    for x in batch.positions_mut().iter_mut().step_by(3) {
        *x += 0.01;
    }
    let batch = world.table.get_mut(world.still).unwrap();
    let start = rng.below(19_000);
    batch.positions_mut()[start as usize * 3] = frame as f32;
    batch.mark_dirty(start, 1 + rng.below(500)).unwrap();
    world.table.update(jobs, frame);

    // Culling on the job workers.
    let frustum = camera();
    let parity = world.scene.parity();
    cull_parallel(
        jobs,
        &frustum,
        world.scene.world(parity).spheres(),
        &mut world.scene_culled,
    );
    let moving = world.table.get(world.moving).unwrap();
    cull_parallel(
        jobs,
        &frustum,
        moving.current_world().spheres(),
        &mut world.batch_culled,
    );

    // A parallel loop that takes scratch memory from each thread's arena, and a background task.
    world.arenas.reset_all();
    let total = AtomicU64::new(0);
    let arenas = &world.arenas;
    jobs.parallel_for(100_000, 1000, &|range, worker| {
        let scratch = arenas.arena(worker).alloc::<u32>(range.len()).unwrap();
        for (s, i) in scratch.iter_mut().zip(range) {
            *s = i;
        }
        total.fetch_add(
            scratch.iter().map(|&v| u64::from(v)).sum(),
            Ordering::Relaxed,
        );
    });
    assert_eq!(total.load(Ordering::Relaxed), 99_999 * 100_000 / 2);
    jobs.spawn_background(BackgroundTask {
        run: background,
        arg: 1,
    })
    .unwrap();

    // The frame handoff, with one thread playing both sides as in the low-latency mode.
    let (mut producer, mut consumer) = world.handoff.split();
    let mut write = producer.try_begin().expect("the previous frame was read");
    assert_eq!(write.frame(), frame);
    write
        .snapshot_mut()
        .record(frame, &world.scene, &world.table);
    write.publish();
    let read = consumer.try_read().expect("the frame was published");
    assert!(!read.snapshot().uploads().is_empty() && !read.snapshot().overflowed());
    drop(read);
}

#[test]
fn frames_allocate_nothing() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let pool = Workers::with_setup(
        JobConfig {
            workers: 4,
            ..JobConfig::default()
        },
        CountingAllocator::track_this_thread,
    );
    let mut world = build();
    let mut rng = Rng::new(4);
    // Warm-up frames build the hierarchy order and fill both buffers.
    for f in 1..=3 {
        frame(&mut world, pool.jobs(), f, &mut rng);
    }
    CountingAllocator::arm();
    for f in 4..=200 {
        frame(&mut world, pool.jobs(), f, &mut rng);
    }
    let allocations = CountingAllocator::disarm();
    assert_eq!(allocations, 0, "frames made {allocations} allocator calls");
    assert!(!world.scene_culled.is_empty() && !world.batch_culled.is_empty());

    // The counter sees allocations on job workers: a loop whose worker chunks each allocate
    // once must be counted. The caller's chunks wait for a worker chunk, so one runs.
    let worker_ran = AtomicBool::new(false);
    CountingAllocator::arm();
    pool.jobs().parallel_for(64, 1, &|_, worker| {
        if worker == WorkerId::CALLER {
            let start = Instant::now();
            while !worker_ran.load(Ordering::Acquire) && start.elapsed() < Duration::from_secs(1) {
                std::hint::spin_loop();
            }
        } else {
            std::hint::black_box(vec![0u8; 16]);
            worker_ran.store(true, Ordering::Release);
        }
    });
    assert!(
        CountingAllocator::disarm() > 0,
        "the counter missed worker allocations"
    );
}
