//! Frame code allocates nothing: a counting global allocator watches the test thread and every
//! job worker while whole frames run (structural commands, transforms, late transform updates,
//! batch updates, culling, cluster builds, parallel loops with arena scratch memory, background
//! tasks, and the frame handoff).
#![allow(clippy::disallowed_methods)] // The self-check reads the clock.

mod common;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use common::{Rng, Workers, mul4, perspective, translation};
use null3d_core::arena::{ArenaPool, FrameArena};
use null3d_core::cells::{CellPosition, MAX_CELLS, ORIGIN_CELL};
use null3d_core::clusters::{ClusterScratch, RowClusters};
use null3d_core::culling::{
    BY_ROW, BucketedCull, CULL_CHUNK, CullOutput, CullRun, CullSet, CullView, Frustum, ROW_CELLS,
    SetLayers, cull_into_buckets, cull_parallel,
};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::{BackgroundTask, JobConfig, JobSystem, WorkerId};
use null3d_core::scene::{Command, CommandRing, SceneStorage, flags};
use null3d_core::snapshot::FrameHandoff;
use null3d_core::testing::CountingAllocator;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

static BACKGROUND_SUM: AtomicU64 = AtomicU64::new(0);

/// The items of the frame's scratch loop, and its chunk size. Each chunk takes one `u32` of
/// scratch per item.
const SCRATCH_ITEMS: u32 = 100_000;
const SCRATCH_CHUNK: u32 = 1000;
/// The most scratch one chunk takes, and the most the frame takes.
const CHUNK_SCRATCH: usize = FrameArena::bytes_for::<u32>(SCRATCH_CHUNK as usize);
const FRAME_SCRATCH: usize = SCRATCH_ITEMS.div_ceil(SCRATCH_CHUNK) as usize * CHUNK_SCRATCH;

fn background(arg: u64, _: WorkerId) {
    BACKGROUND_SUM.fetch_add(arg, Ordering::Relaxed);
}

/// A camera at z = 60 looking down -Z.
fn camera() -> Frustum {
    Frustum::from_view_projection(&mul4(
        &perspective(1.2, 1.0, 0.5, 500.0),
        &translation(0.0, 0.0, -60.0),
    ))
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
    /// The scene and both batches culled into draw buckets, as the WebGL2 frame builder culls.
    bucketed: BucketedCull,
    runs: Vec<CullRun>,
    row_buckets: Vec<u32>,
    /// The offset from the camera to each cell.
    offsets: Vec<[f32; 4]>,
    /// The still batch's rows in clusters, which the bucketed cull also culls.
    clusters: RowClusters,
    cluster_scratch: ClusterScratch,
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
        bucketed: {
            let mut out = BucketedCull::default();
            out.try_reserve(8193 + 40_000 + 313, 17, 3, 4).unwrap();
            out
        },
        runs: Vec::with_capacity(16),
        row_buckets: (0..8193).map(|slot| slot % 3).collect(),
        offsets: vec![[0.0; 4]; MAX_CELLS as usize],
        clusters: {
            let mut clusters = RowClusters::default();
            clusters.try_reserve(20_000).unwrap();
            clusters
        },
        cluster_scratch: {
            let mut scratch = ClusterScratch::default();
            scratch.try_reserve(20_000).unwrap();
            scratch
        },
        arenas: ArenaPool::new(5, FRAME_SCRATCH, CHUNK_SCRATCH),
        handoff: FrameHandoff::new(4096),
    }
}

/// One frame of sketch work, as the sketch worker runs it.
fn frame(world: &mut World, jobs: &JobSystem, frame: u32, rng: &mut Rng) {
    // Sketch code: roots rotate, a few static objects move, rows of both batches change.
    for (k, &root) in world.roots.iter().enumerate() {
        let slot = world.scene.resolve(root).unwrap() as usize;
        let angle = frame as f32 * 0.01;
        world.scene.rotations_mut()[slot * 4 + 1] = angle.sin();
        world.scene.rotations_mut()[slot * 4 + 3] = angle.cos();
        // Two trees hop between cells, far out and back, taking their descendants along.
        if k < 2 {
            let x = if frame.is_multiple_of(2) { 0.0 } else { 1.0e6 };
            world.scene.positions_mut()[slot * 3] = x + k as f32 * 5000.0;
        }
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
    world
        .ring
        .push(Command::set_layers(a, 1 << (frame % 32)))
        .unwrap();
    world.scene.apply_ring(&world.ring, frame).unwrap();
    world.scene.update_transforms(jobs);
    // A late update moves a leaf alone, or a root and the objects below it, in turns.
    let late = if frame.is_multiple_of(2) {
        world.leaves[rng.below(world.leaves.len() as u32) as usize]
    } else {
        world.roots[rng.below(world.roots.len() as u32) as usize]
    };
    world
        .scene
        .set_position(late, [rng.range(-1.0, 1.0), 1.0, 0.0])
        .unwrap();
    world.scene.update_late_transforms();

    let batch = world.table.get_mut(world.moving).unwrap();
    for x in batch.positions_mut().iter_mut().step_by(3) {
        *x += 0.01;
    }
    // A few moving rows cross into other cells and back.
    for row in (0..20_000).step_by(997) {
        batch.positions_mut()[row * 3 + 2] = if frame.is_multiple_of(3) {
            0.0
        } else {
            -3000.0
        };
    }
    let batch = world.table.get_mut(world.still).unwrap();
    let start = rng.below(19_000);
    batch.positions_mut()[start as usize * 3] = frame as f32;
    batch.mark_dirty(start, 1 + rng.below(500)).unwrap();
    world
        .table
        .update(jobs, frame, world.scene.cell_table_mut());

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
    // The scene's rows look up their buckets; each batch fills a bucket of its own, and the
    // still batch's clusters one more.
    world.runs.clear();
    let still = world.table.get(world.still).unwrap();
    world.clusters.build(
        still.world(parity).spheres(),
        20_000,
        &mut world.cluster_scratch,
    );
    for (set, rows, bucket, base) in [
        (0, 8193, BY_ROW, 0),
        (1, 20_000, 3, 8193),
        (2, 20_000, 3, 28_193),
        (3, world.clusters.len(), 2, 0),
    ] {
        let mut start = 0;
        while start < rows {
            let end = (start + CULL_CHUNK).min(rows);
            // The scene's and the moving batch's rows lie in different cells.
            let cell = if set < 2 { ROW_CELLS } else { ORIGIN_CELL };
            world.runs.push(CullRun {
                set,
                start,
                end,
                bucket,
                base,
                cell,
            });
            start = end;
        }
    }
    let camera_at = CellPosition {
        cell: [0, 0, 0],
        local: [0.0, 1.0, 30.0],
    };
    let cells = world
        .scene
        .cell_table()
        .write_offsets(&camera_at, &mut world.offsets);
    let (scene, clusters) = (&world.scene, &world.clusters);
    // The scene's rows have layer masks of their own; the batches' rows share their batch's.
    let sets = |set: u32| match set {
        0 => CullSet {
            spheres: scene.world(parity).spheres(),
            cells: scene.cells(),
            layers: SetLayers::Rows(scene.layers()),
        },
        1 => CullSet {
            spheres: moving.world(parity).spheres(),
            cells: moving.cells(),
            layers: SetLayers::All(moving.layers()),
        },
        2 => CullSet {
            spheres: still.world(parity).spheres(),
            cells: &[],
            layers: SetLayers::All(still.layers()),
        },
        _ => CullSet {
            spheres: clusters.spheres(),
            cells: &[],
            layers: SetLayers::All(still.layers()),
        },
    };
    let view = CullView {
        frustum: &frustum,
        offsets: &world.offsets[..cells],
        layers: 0x5555_5555,
    };
    cull_into_buckets(
        jobs,
        view,
        &sets,
        &world.runs,
        &world.row_buckets,
        4,
        &mut world.bucketed,
    );

    // A parallel loop that takes scratch memory from the threads' arenas, and a background task.
    world.arenas.reset_all();
    let total = AtomicU64::new(0);
    let arenas = &world.arenas;
    jobs.parallel_for(SCRATCH_ITEMS, SCRATCH_CHUNK, &|range, worker| {
        let scratch = arenas.alloc::<u32>(worker, range.len()).unwrap();
        for (s, i) in scratch.iter_mut().zip(range) {
            *s = i;
        }
        total.fetch_add(
            scratch.iter().map(|&v| u64::from(v)).sum(),
            Ordering::Relaxed,
        );
    });
    let items = u64::from(SCRATCH_ITEMS);
    assert_eq!(total.load(Ordering::Relaxed), (items - 1) * items / 2);
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

/// The allocator calls of a run of frames on `jobs`, counted after warm-up frames that build the
/// hierarchy order and fill both buffers. It checks that the frames culled something too.
fn frame_allocations(jobs: &JobSystem) -> u64 {
    let mut world = build();
    let mut rng = Rng::new(4);
    for f in 1..=3 {
        frame(&mut world, jobs, f, &mut rng);
    }
    CountingAllocator::arm();
    for f in 4..=200 {
        frame(&mut world, jobs, f, &mut rng);
    }
    let allocations = CountingAllocator::disarm();
    assert!(!world.scene_culled.is_empty() && !world.batch_culled.is_empty());
    assert!(!world.bucketed.is_empty());
    allocations
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
    let allocations = frame_allocations(pool.jobs());
    assert_eq!(allocations, 0, "frames made {allocations} allocator calls");

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

#[test]
fn frames_allocate_nothing_when_one_thread_runs_every_chunk() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    // Job workers that never start, like workers that wake late: every loop still hands its
    // chunks out through the job system, and the calling thread claims them all. The background
    // queue keeps each frame's task, as no worker runs them.
    let allocations = frame_allocations(&JobSystem::new(4));
    assert_eq!(allocations, 0, "frames made {allocations} allocator calls");
}
