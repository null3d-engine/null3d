//! Queries allocate nothing: a counting global allocator watches the test thread and every job
//! worker while frames move dynamic objects and instance rows, sync the scene's trees and run
//! every query: raycasts, raycasts that stop at the first hit, raycasts that list every hit,
//! batches of rays on the job workers, and overlap queries. Some frames also move static objects
//! and static rows within their cells, which refits the static tree.

mod common;

use common::{Rng, Workers};
use null3d_core::bvh::mesh::{IndexedTriangles, Side};
use null3d_core::bvh::query::{QueryMeshes, QueryScene, SceneQueries};
use null3d_core::bvh::top::WorldRay;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::{JobConfig, JobSystem};
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::testing::CountingAllocator;

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// A box of 12 triangles from -1 to 1 on each axis.
const BOX_POSITIONS: [f32; 24] = [
    -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, //
    -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
];
const BOX_INDICES: [u32; 36] = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4,
    7, 0, 7, 3,
];

/// One mesh, the box, which every material draws front faces of.
struct BoxMesh;

impl QueryMeshes for BoxMesh {
    type Mesh<'a> = IndexedTriangles<'static, u32>;

    fn count(&self) -> u32 {
        1
    }

    fn mesh(&self, id: u32) -> Option<IndexedTriangles<'static, u32>> {
        (id == 1).then_some(IndexedTriangles {
            positions: &BOX_POSITIONS,
            indices: &BOX_INDICES,
        })
    }

    fn side(&self, _: u32) -> Side {
        Side::Front
    }
}

/// Rays per batch of rays.
const BATCH_RAYS: u32 = 500;

/// Runs frames on `jobs` and returns the allocator calls of those after the warm-up.
fn query_frame_allocations(jobs: &JobSystem) -> u64 {
    let mut rng = Rng::new(12);
    let mut scene = SceneStorage::with_capacity(20_000);
    let mut batches = BatchTable::with_capacity(4);
    let mut dynamic = Vec::new();
    let mut fixed = Vec::new();
    let mut commands = Vec::new();
    // Some items 6,378 km away, so the trees span several cells.
    let place = |rng: &mut Rng, i: u32| {
        let base = if i.is_multiple_of(5) {
            6_378_000.0
        } else {
            0.0
        };
        [
            base + rng.range(-200.0, 200.0),
            rng.range(-50.0, 50.0),
            rng.range(-200.0, 200.0),
        ]
    };
    for i in 0..15_000 {
        let h = scene.reserve().unwrap();
        scene.set_position(h, place(&mut rng, i)).unwrap();
        scene.set_local_radius(h, 1.8).unwrap();
        let moving = i % 3 == 0;
        let f = flags::VISIBLE | if moving { flags::DYNAMIC } else { 0 };
        commands.push(Command::create(h, Handle::NONE, 1, f));
        if moving { &mut dynamic } else { &mut fixed }.push(h);
    }
    scene.apply_commands(&commands, 1).unwrap();
    let rows = [
        batches.create(3_000, false, false, 1, 1, 1.8).unwrap(),
        batches.create(3_000, true, false, 1, 1, 1.8).unwrap(),
    ];
    for id in rows {
        let batch = batches.get_mut(id).unwrap();
        for r in 0..3_000 {
            let p = place(&mut rng, r);
            batch.positions_mut()[r as usize * 3..r as usize * 3 + 3].copy_from_slice(&p);
        }
    }
    let mut queries = SceneQueries::new();
    // Room for every item, which the warm-up's overlap query finds, and as many hits of one ray.
    queries.reserve(30_000).unwrap();
    let mut allocations = 0;
    let mut hits = 0;
    let mut rays = vec![WorldRay::new([0.0; 3], [0.0, -1.0, 0.0]); BATCH_RAYS as usize];
    let ray = |rng: &mut Rng| {
        let base = if rng.below(5) == 0 { 6_378_000.0 } else { 0.0 };
        WorldRay::new(
            [
                base + f64::from(rng.range(-200.0, 200.0)),
                200.0,
                f64::from(rng.range(-200.0, 200.0)),
            ],
            [rng.range(-0.1, 0.1), -1.0, rng.range(-0.1, 0.1)],
        )
    };
    for frame in 1..=60u32 {
        if frame > 1 {
            scene.begin_frame(frame);
        }
        if frame == 4 {
            CountingAllocator::arm();
        }
        for &h in &dynamic {
            let slot = scene.resolve(h).unwrap() as usize;
            scene.positions_mut()[slot * 3 + 1] += rng.range(-1.0, 1.0);
        }
        let moving = batches.get_mut(rows[1]).unwrap();
        for r in 0..3_000 {
            moving.positions_mut()[r * 3 + 1] += rng.range(-1.0, 1.0);
        }
        if frame % 7 == 0 {
            for &h in fixed.iter().step_by(97) {
                let slot = scene.resolve(h).unwrap() as usize;
                let mut p = [0.0f32; 3];
                p.copy_from_slice(&scene.positions()[slot * 3..slot * 3 + 3]);
                p[1] += 0.5;
                scene.set_position(h, p).unwrap();
            }
            let still = batches.get_mut(rows[0]).unwrap();
            for r in (0..3_000).step_by(89) {
                still.positions_mut()[r * 3 + 1] += 0.5;
                still.mark_dirty(r as u32, 1).unwrap();
            }
        }
        scene.update_transforms(jobs);
        batches.update(jobs, frame, scene.cell_table_mut());
        let view = QueryScene {
            scene: &scene,
            batches: &batches,
            meshes: &BoxMesh,
        };
        queries.sync(&view, jobs).unwrap();
        if frame < 4 {
            let all = queries
                .overlap_sphere(&view, [0.0; 3], 1.0e4, u32::MAX)
                .len();
            assert!(all > 10_000, "{all}");
        }
        for r in &mut rays {
            *r = ray(&mut rng);
        }
        for r in &rays[..100] {
            hits += u32::from(queries.raycast(&view, r, u32::MAX).is_some());
            queries.raycast_any(&view, r, u32::MAX);
            queries.raycast_all(&view, r, u32::MAX);
            let ground = [r.origin[0], 0.0, r.origin[2]];
            queries.overlap_sphere(&view, ground, 30.0, u32::MAX);
            let low = ground.map(|v| v - 10.0);
            queries.overlap_box(&view, low, low.map(|v| v + 20.0), u32::MAX);
        }
        let batch = queries
            .raycast_batch(
                &view,
                jobs,
                BATCH_RAYS,
                &|i| Some(rays[i as usize]),
                u32::MAX,
            )
            .unwrap();
        hits += batch.iter().filter(|h| h.is_some()).count() as u32;
        if frame == 60 {
            allocations = CountingAllocator::disarm();
        }
    }
    assert!(hits > 1_000, "the rays should hit the boxes: {hits}");
    allocations
}

#[test]
fn query_frames_allocate_nothing() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let pool = Workers::with_setup(
        JobConfig {
            workers: 4,
            ..JobConfig::default()
        },
        CountingAllocator::track_this_thread,
    );
    let allocations = query_frame_allocations(pool.jobs());
    assert_eq!(
        allocations, 0,
        "query frames made {allocations} allocator calls"
    );
}

#[test]
fn query_frames_allocate_nothing_on_one_thread() {
    let _exclusive = CountingAllocator::exclusive();
    CountingAllocator::track_this_thread();
    let allocations = query_frame_allocations(&JobSystem::new(0));
    assert_eq!(
        allocations, 0,
        "query frames made {allocations} allocator calls"
    );
}
