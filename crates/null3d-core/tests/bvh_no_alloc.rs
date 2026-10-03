//! Queries allocate nothing: a counting global allocator watches the test thread and every job
//! worker while frames move dynamic objects, sync the scene's trees and run raycasts and overlap
//! queries. Some frames also move static objects within their cells, which refits the static
//! tree.

mod common;

use common::{Rng, Workers};
use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh, Side};
use null3d_core::bvh::scene::SceneBvh;
use null3d_core::bvh::top::WorldRay;
use null3d_core::handle::Handle;
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

/// Runs frames on `jobs` and returns the allocator calls of those after the warm-up.
fn query_frame_allocations(jobs: &JobSystem) -> u64 {
    let mut rng = Rng::new(12);
    let mesh = IndexedTriangles {
        positions: &BOX_POSITIONS,
        indices: &BOX_INDICES,
    };
    let mesh_bvh = MeshBvh::build(&mesh).unwrap();
    let mut scene = SceneStorage::with_capacity(20_000);
    let mut dynamic = Vec::new();
    let mut fixed = Vec::new();
    let mut commands = Vec::new();
    for i in 0..15_000 {
        let h = scene.reserve().unwrap();
        // Some objects 6,378 km away, so the trees span several cells.
        let base = if i % 5 == 0 { 6_378_000.0 } else { 0.0 };
        scene
            .set_position(
                h,
                [
                    base + rng.range(-200.0, 200.0),
                    rng.range(-50.0, 50.0),
                    rng.range(-200.0, 200.0),
                ],
            )
            .unwrap();
        scene.set_local_radius(h, 1.8).unwrap();
        let moving = i % 3 == 0;
        let f = flags::VISIBLE | if moving { flags::DYNAMIC } else { 0 };
        commands.push(Command::create(h, Handle::NONE, 1, f));
        if moving { &mut dynamic } else { &mut fixed }.push(h);
    }
    scene.apply_commands(&commands, 1).unwrap();
    let mut bvh = SceneBvh::new();
    let mut allocations = 0;
    let mut hits = 0;
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
        if frame % 7 == 0 {
            for &h in fixed.iter().step_by(97) {
                let slot = scene.resolve(h).unwrap() as usize;
                let mut p = [0.0f32; 3];
                p.copy_from_slice(&scene.positions()[slot * 3..slot * 3 + 3]);
                p[1] += 0.5;
                scene.set_position(h, p).unwrap();
            }
        }
        scene.update_transforms(jobs);
        bvh.sync(&scene, frame, jobs).unwrap();
        let world = scene.world((frame & 1) as usize);
        for _ in 0..100 {
            let base = if rng.below(5) == 0 { 6_378_000.0 } else { 0.0 };
            let ray = WorldRay::new(
                [
                    base + f64::from(rng.range(-200.0, 200.0)),
                    200.0,
                    f64::from(rng.range(-200.0, 200.0)),
                ],
                [rng.range(-0.1, 0.1), -1.0, rng.range(-0.1, 0.1)],
            );
            let hit = bvh.raycast(&ray, |slot, local| {
                let local = local.to_local(world.matrix(slot as usize))?;
                mesh_bvh.raycast(&mesh, &local, Side::Front).map(|h| h.t)
            });
            hits += u32::from(hit.is_some());
            bvh.raycast_any(&ray, |_, _| false);
            bvh.overlap_sphere(ray.origin, 30.0, |_, _| {});
            bvh.overlap_box(
                ray.origin.map(|v| v - 10.0),
                ray.origin.map(|v| v + 10.0),
                |_, _| {},
            );
        }
        if frame == 60 {
            allocations = CountingAllocator::disarm();
        }
    }
    assert!(hits > 100, "the rays should hit the boxes: {hits}");
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
