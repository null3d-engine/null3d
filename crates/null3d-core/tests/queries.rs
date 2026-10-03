//! Scene queries against brute force: every raycast and overlap query over a scene of objects
//! and instance rows must give the answer of testing every triangle of every item in turn. The
//! scene changes across frames: objects are created, destroyed, hidden, moved across cells and
//! put on other layers, batches change their active rows, and static rows are marked dirty.

mod common;

use std::collections::BTreeSet;

use common::{Rng, Workers, sphere, terrain};
use null3d_core::bvh::mesh::{IndexedTriangles, Side, Triangles, ray_triangle};
use null3d_core::bvh::query::{
    QueryHit, QueryMeshes, QueryScene, SceneQueries, box_touches_triangle, sphere_touches_triangle,
    triangle_in_cell,
};
use null3d_core::bvh::scene::Source;
use null3d_core::bvh::top::{WorldRay, in_cell};
use null3d_core::bvh::{Aabb, Ray};
use null3d_core::cells::{CELL_SIZE, CellCoords};
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::math::Affine;
use null3d_core::scene::{Command, SceneStorage, flags};

/// Meshes by id from 1, and the materials that draw both faces, by id.
struct Meshes {
    meshes: Vec<(Vec<f32>, Vec<u32>)>,
    double: Vec<bool>,
}

impl QueryMeshes for Meshes {
    type Mesh<'a> = IndexedTriangles<'a, u32>;

    fn count(&self) -> u32 {
        self.meshes.len() as u32
    }

    fn mesh(&self, id: u32) -> Option<IndexedTriangles<'_, u32>> {
        let (positions, indices) = self.meshes.get(id.checked_sub(1)? as usize)?;
        Some(IndexedTriangles { positions, indices })
    }

    fn side(&self, material: u32) -> Side {
        if self.double.get(material as usize) == Some(&true) {
            Side::Double
        } else {
            Side::Front
        }
    }
}

/// A sphere, a height field and a box, the shapes the scenes use.
fn meshes(rng: &mut Rng) -> Meshes {
    let (p, i) = sphere(6, 10);
    let (tp, ti) = terrain(rng, 8);
    let cube_p = vec![
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, //
        -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
    ];
    let cube_i = vec![
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5,
        0, 4, 7, 0, 7, 3,
    ];
    Meshes {
        meshes: vec![
            (p, i.into_iter().map(u32::from).collect()),
            (tp, ti),
            (cube_p, cube_i),
        ],
        // Material 2 draws both faces.
        double: vec![false, false, true],
    }
}

/// One item that brute force tests: its source, world matrix, cell, mesh, faces and layers.
struct BruteItem {
    source: Source,
    matrix: Affine,
    coords: CellCoords,
    mesh: u32,
    side: Side,
}

/// Every item a query may find, as the scene and batches hold them after the frame's updates.
fn brute_items(
    scene: &SceneStorage,
    batches: &BatchTable,
    meshes: &Meshes,
    layers: u32,
) -> Vec<BruteItem> {
    let mut items = Vec::new();
    let world = scene.world(scene.parity());
    let table = scene.cell_table();
    for slot in scene.created().iter_ones() {
        let s = slot as usize;
        if scene.meshes()[s] == 0 || world.radii()[s] < 0.0 || scene.layers()[s] & layers == 0 {
            continue;
        }
        items.push(BruteItem {
            source: Source::Object(slot),
            matrix: *world.matrix(s),
            coords: table.coords(scene.cells()[s]),
            mesh: scene.meshes()[s],
            side: meshes.side(scene.materials()[s]),
        });
    }
    for (id, batch) in batches.iter() {
        if batch.frame() == 0 || batch.layers() & layers == 0 {
            continue;
        }
        let world = batch.current_world();
        for row in 0..batch.frame_active_count((batch.frame() & 1) as usize) {
            let r = row as usize;
            if world.radii()[r] < 0.0 {
                continue;
            }
            items.push(BruteItem {
                source: Source::Row { batch: id, row },
                matrix: *world.matrix(r),
                coords: table.coords(batch.cells()[r]),
                mesh: batch.mesh(),
                side: meshes.side(batch.material()),
            });
        }
    }
    items
}

/// Every hit of the ray on every triangle of every item: distance bits, source and triangle.
fn brute_hits(items: &[BruteItem], meshes: &Meshes, ray: &WorldRay) -> Vec<(u32, String, u32)> {
    let mut hits = Vec::new();
    for item in items {
        let Some(local) = ray.in_cell(item.coords).to_local(&item.matrix) else {
            continue;
        };
        let mesh = meshes.mesh(item.mesh).unwrap();
        for tri in 0..mesh.count() {
            if let Some((t, ..)) = ray_triangle(&local, &mesh.triangle(tri), item.side) {
                hits.push((t.to_bits(), format!("{:?}", item.source), tri));
            }
        }
    }
    hits.sort();
    hits
}

/// The closest distance by brute force, as the trees narrow the ray: each item tested with the
/// far limit at the nearest hit so far.
fn brute_closest(items: &[BruteItem], meshes: &Meshes, ray: &WorldRay) -> Option<f32> {
    let mut best: Option<f32> = None;
    for item in items {
        let mut local: Ray = ray.in_cell(item.coords);
        local.t_max = best.unwrap_or(ray.t_max);
        let Some(local) = local.to_local(&item.matrix) else {
            continue;
        };
        let mesh = meshes.mesh(item.mesh).unwrap();
        for tri in 0..mesh.count() {
            let mut limited = local;
            limited.t_max = best.unwrap_or(ray.t_max);
            if let Some((t, ..)) = ray_triangle(&limited, &mesh.triangle(tri), item.side) {
                best = Some(t);
            }
        }
    }
    best
}

/// The items with a triangle that `touches` passes, in their cells' frames.
fn brute_overlaps(
    items: &[BruteItem],
    meshes: &Meshes,
    touches: impl Fn(&BruteItem, &[[f64; 3]; 3]) -> bool,
) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    for item in items {
        let mesh = meshes.mesh(item.mesh).unwrap();
        if (0..mesh.count())
            .any(|tri| touches(item, &triangle_in_cell(&item.matrix, &mesh.triangle(tri))))
        {
            found.insert(format!("{:?}", item.source));
        }
    }
    found
}

fn sources(hits: &[QueryHit]) -> BTreeSet<String> {
    hits.iter().map(|h| format!("{:?}", h.source)).collect()
}

/// The world position of a world matrix's translation, from the origin of the world.
fn world_point(coords: CellCoords, m: &Affine) -> [f64; 3] {
    std::array::from_fn(|k| f64::from(coords[k]) * f64::from(CELL_SIZE) + f64::from(m[k * 4 + 3]))
}

#[test]
fn queries_give_brute_force_answers_as_the_scene_changes() {
    let workers = Workers::start(3);
    let jobs = workers.jobs();
    let mut rng = Rng::new(31);
    let meshes = meshes(&mut rng);
    let mut scene = SceneStorage::with_capacity(2000);
    let mut batches = BatchTable::with_capacity(8);
    let mut queries = SceneQueries::new();
    let far = [6_378_000.0f32, 0.0, 0.0];
    let position = |rng: &mut Rng| -> [f32; 3] {
        let base = if rng.below(4) == 0 { far } else { [0.0; 3] };
        std::array::from_fn(|k| base[k] + rng.range(-300.0, 300.0))
    };
    let static_rows = batches.create(200, false, false, 1, 1, 1.0).unwrap();
    let moving_rows = batches.create(150, true, false, 3, 2, 1.8).unwrap();
    for id in [static_rows, moving_rows] {
        let batch = batches.get_mut(id).unwrap();
        for r in 0..batch.capacity() as usize {
            let p = position(&mut rng);
            batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
            batch.rotations_mut()[r * 4..r * 4 + 4].copy_from_slice(&rng.quaternion());
            let s = rng.range(0.5, 6.0);
            batch.scales_mut()[r * 3..r * 3 + 3].copy_from_slice(&[s, s * 0.7, s * 1.3]);
        }
    }
    batches.get_mut(moving_rows).unwrap().set_layers(0b10);
    let mut live: Vec<(Handle, bool)> = Vec::new();
    let mut checked = [0u32; 4];
    for frame in 1..=10u32 {
        let mut commands = Vec::new();
        for _ in 0..if frame == 1 { 300 } else { 20 } {
            let h = scene.reserve().unwrap();
            let dynamic = rng.below(3) == 0;
            scene.set_position(h, position(&mut rng)).unwrap();
            scene.set_rotation(h, rng.quaternion()).unwrap();
            let s = [(); 3].map(|_| rng.range(0.5, 12.0));
            scene.set_scale(h, s).unwrap();
            let mesh = 1 + rng.below(3);
            // A small radius: the trees take each object's box from its mesh, not its sphere.
            scene.set_local_radius(h, 0.25).unwrap();
            let f = flags::VISIBLE | if dynamic { flags::DYNAMIC } else { 0 };
            commands.push(Command::create(h, Handle::NONE, mesh, f));
            commands.push(Command::set_material(h, 1 + rng.below(2)));
            if rng.below(4) == 0 {
                commands.push(Command::set_layers(h, 0b10));
            }
            live.push((h, dynamic));
        }
        // A group, which has no mesh, is never found.
        let group = scene.reserve().unwrap();
        commands.push(Command::create(group, Handle::NONE, 0, flags::VISIBLE));
        if frame > 1 {
            for _ in 0..10 {
                let k = rng.below(live.len() as u32) as usize;
                commands.push(Command::destroy(live.swap_remove(k).0));
            }
            for _ in 0..10 {
                let k = rng.below(live.len() as u32) as usize;
                commands.push(Command::set_visible(live[k].0, rng.below(2) == 0));
            }
        }
        scene.apply_commands(&commands, frame).unwrap();
        for &(h, dynamic) in &live {
            if dynamic || rng.below(15) == 0 {
                let slot = scene.resolve(h).unwrap() as usize;
                let at = position(&mut rng);
                if dynamic {
                    scene.positions_mut()[slot * 3..slot * 3 + 3].copy_from_slice(&at);
                } else {
                    scene.set_position(h, at).unwrap();
                }
            }
        }
        // The static batch moves some rows in some frames; the dynamic batch moves every frame
        // and changes its active rows.
        if frame % 3 == 0 {
            let batch = batches.get_mut(static_rows).unwrap();
            for r in (0..200).step_by(17) {
                let p = position(&mut rng);
                batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
                batch.mark_dirty(r as u32, 1).unwrap();
            }
        }
        {
            let batch = batches.get_mut(moving_rows).unwrap();
            for r in 0..150 {
                batch.positions_mut()[r * 3 + 1] += rng.range(-2.0, 2.0);
            }
            batch.set_active_count(100 + rng.below(51)).unwrap();
        }
        scene.update_transforms(jobs);
        batches.update(jobs, frame, scene.cell_table_mut());
        let view = QueryScene {
            scene: &scene,
            batches: &batches,
            meshes: &meshes,
        };
        queries.sync(&view, jobs).unwrap();
        // A second sync of the same frame changes nothing.
        queries.sync(&view, jobs).unwrap();
        for layers in [u32::MAX, 0b1, 0b10] {
            let items = brute_items(&scene, &batches, &meshes, layers);
            // Rays toward random items, from up to 400 m away.
            let mut rays = Vec::new();
            for _ in 0..60 {
                let target = &items[rng.below(items.len() as u32) as usize];
                let goal = world_point(target.coords, &target.matrix);
                let origin: [f64; 3] =
                    std::array::from_fn(|k| goal[k] + f64::from(rng.range(-400.0, 400.0)));
                let direction: [f32; 3] =
                    std::array::from_fn(|k| (goal[k] - origin[k]) as f32 + rng.range(-3.0, 3.0));
                let len = direction.iter().map(|v| v * v).sum::<f32>().sqrt();
                let mut ray = WorldRay::new(origin, direction.map(|v| v / len));
                if rng.below(4) == 0 {
                    ray.t_max = rng.range(0.0, 500.0);
                }
                rays.push(ray);
            }
            for (r, ray) in rays.iter().enumerate() {
                let want = brute_closest(&items, &meshes, ray);
                let got = queries.raycast(&view, ray, layers);
                assert_eq!(
                    got.map(|h| h.distance.to_bits()),
                    want.map(f32::to_bits),
                    "frame {frame}, layers {layers:b}, ray {r}"
                );
                if let Some(hit) = got {
                    checked[0] += 1;
                    // The point lies on the ray at the hit's distance, and the normal faces the
                    // ray's origin.
                    let along: f64 = (0..3)
                        .map(|k| (hit.point[k] - ray.origin[k]) * f64::from(ray.direction[k]))
                        .sum();
                    assert!((along - f64::from(hit.distance)).abs() < 1e-3);
                    let facing: f32 = (0..3).map(|k| hit.normal[k] * ray.direction[k]).sum();
                    assert!(facing <= 0.0, "the normal faces away: {facing}");
                }
                assert_eq!(queries.raycast_any(&view, ray, layers), want.is_some());
                let all: Vec<(u32, String, u32)> = queries
                    .raycast_all(&view, ray, layers)
                    .iter()
                    .map(|h| (h.distance.to_bits(), format!("{:?}", h.source), h.triangle))
                    .collect();
                let mut sorted = all.clone();
                sorted.sort();
                assert_eq!(
                    sorted,
                    brute_hits(&items, &meshes, ray),
                    "frame {frame}, ray {r}"
                );
                // Nearest first.
                assert!(
                    all.windows(2)
                        .all(|w| f32::from_bits(w[0].0) <= f32::from_bits(w[1].0))
                );
                checked[1] += all.len() as u32;
            }
            // The batch on the job workers gives each ray's closest hit, as one call does.
            let singles: Vec<Option<QueryHit>> = rays
                .iter()
                .map(|ray| queries.raycast(&view, ray, layers))
                .collect();
            let batch = queries
                .raycast_batch(
                    &view,
                    jobs,
                    rays.len() as u32,
                    &|i| rays[i as usize],
                    layers,
                )
                .unwrap();
            assert_eq!(batch, &singles[..]);
            for _ in 0..20 {
                let target = &items[rng.below(items.len() as u32) as usize];
                let goal = world_point(target.coords, &target.matrix);
                let center: [f64; 3] =
                    std::array::from_fn(|k| goal[k] + f64::from(rng.range(-20.0, 20.0)));
                let radius = rng.range(0.0, 25.0);
                let got = sources(queries.overlap_sphere(&view, center, radius, layers));
                let want = brute_overlaps(&items, &meshes, |item, v| {
                    let c = in_cell(center, item.coords).map(f64::from);
                    sphere_touches_triangle(c, f64::from(radius), v)
                });
                assert_eq!(got, want, "sphere, frame {frame}, layers {layers:b}");
                checked[2] += got.len() as u32;
                let half: [f64; 3] = std::array::from_fn(|_| f64::from(rng.range(0.0, 20.0)));
                let min: [f64; 3] = std::array::from_fn(|k| center[k] - half[k]);
                let max: [f64; 3] = std::array::from_fn(|k| center[k] + half[k]);
                let got = sources(queries.overlap_box(&view, min, max, layers));
                let want = brute_overlaps(&items, &meshes, |item, v| {
                    let b = Aabb {
                        min: in_cell(min, item.coords),
                        max: in_cell(max, item.coords),
                    };
                    box_touches_triangle(&b, v)
                });
                assert_eq!(got, want, "box, frame {frame}, layers {layers:b}");
                checked[3] += got.len() as u32;
            }
        }
    }
    // The checks found enough hits to mean something.
    assert!(checked.iter().all(|&n| n > 200), "{checked:?}");
}

/// A query after a late transform update in the same frame sees the late moves of static
/// objects, and a query in the next frame's update sees the batches' update.
#[test]
fn queries_follow_late_updates_and_batch_updates() {
    let workers = Workers::start(2);
    let jobs = workers.jobs();
    let mut rng = Rng::new(5);
    let meshes = meshes(&mut rng);
    let mut scene = SceneStorage::with_capacity(16);
    let mut batches = BatchTable::with_capacity(2);
    let mut queries = SceneQueries::new();
    let h = scene.reserve().unwrap();
    scene.set_position(h, [0.0, 0.0, -10.0]).unwrap();
    scene.set_local_radius(h, 2.0).unwrap();
    scene
        .apply_commands(&[Command::create(h, Handle::NONE, 3, flags::VISIBLE)], 1)
        .unwrap();
    scene.update_transforms(jobs);
    let batch = batches.create(1, false, false, 3, 1, 2.0).unwrap();
    batches.get_mut(batch).unwrap().positions_mut()[..3].copy_from_slice(&[5.0, 0.0, -10.0]);
    let forward = WorldRay::new([0.0; 3], [0.0, 0.0, -1.0]);
    let right = WorldRay::new([5.0, 0.0, 0.0], [0.0, 0.0, -1.0]);
    let distance = |queries: &mut SceneQueries, scene: &SceneStorage, batches: &BatchTable, ray| {
        let view = QueryScene {
            scene,
            batches,
            meshes: &meshes,
        };
        queries.sync(&view, jobs).unwrap();
        queries.raycast(&view, &ray, u32::MAX).map(|h| h.distance)
    };
    // The batch has not updated yet, so its row is not in the trees.
    assert_eq!(distance(&mut queries, &scene, &batches, forward), Some(9.0));
    assert_eq!(distance(&mut queries, &scene, &batches, right), None);
    // A late move of the static object in the same frame.
    scene.set_position(h, [0.0, 0.0, -20.0]).unwrap();
    scene.update_late_transforms();
    assert_eq!(
        distance(&mut queries, &scene, &batches, forward),
        Some(19.0)
    );
    batches.update(jobs, 1, scene.cell_table_mut());
    assert_eq!(distance(&mut queries, &scene, &batches, right), Some(9.0));
    // The static row moves when marked dirty.
    let rows = batches.get_mut(batch).unwrap();
    rows.positions_mut()[2] = -30.0;
    rows.mark_dirty(0, 1).unwrap();
    scene.begin_frame(2);
    scene.update_transforms(jobs);
    batches.update(jobs, 2, scene.cell_table_mut());
    assert_eq!(distance(&mut queries, &scene, &batches, right), Some(29.0));
    // No active rows: nothing to find.
    batches.get_mut(batch).unwrap().set_active_count(0).unwrap();
    scene.begin_frame(3);
    scene.update_transforms(jobs);
    batches.update(jobs, 3, scene.cell_table_mut());
    assert_eq!(distance(&mut queries, &scene, &batches, right), None);
    // A destroyed batch leaves the trees.
    batches.get_mut(batch).unwrap().set_active_count(1).unwrap();
    batches.update(jobs, 3, scene.cell_table_mut());
    assert_eq!(distance(&mut queries, &scene, &batches, right), Some(29.0));
    batches.destroy(batch, 3, scene.cell_table_mut()).unwrap();
    assert_eq!(distance(&mut queries, &scene, &batches, right), None);
}

/// Before the first frame's transform update nothing has a place, so queries find nothing.
#[test]
fn queries_before_the_first_frame_find_nothing() {
    let mut rng = Rng::new(9);
    let meshes = meshes(&mut rng);
    let mut scene = SceneStorage::with_capacity(4);
    let batches = BatchTable::with_capacity(1);
    let h = scene.reserve().unwrap();
    scene.set_position(h, [0.0, 0.0, -5.0]).unwrap();
    let jobs = null3d_core::jobs::JobSystem::new(0);
    let mut queries = SceneQueries::new();
    let view = QueryScene {
        scene: &scene,
        batches: &batches,
        meshes: &meshes,
    };
    queries.sync(&view, &jobs).unwrap();
    let ray = WorldRay::new([0.0; 3], [0.0, 0.0, -1.0]);
    assert!(queries.raycast(&view, &ray, u32::MAX).is_none());
    assert!(
        queries
            .overlap_sphere(&view, [0.0; 3], 100.0, u32::MAX)
            .is_empty()
    );
}
