//! Raycasts against the rows of sprite, point and line batches, through the scene's trees, against
//! brute force: testing every row in turn with the rows' own test must give the same hits. The
//! rows sized in pixels of the screen and the rows that a threshold reaches have boxes that hold
//! only their anchors, so this checks that a query's reach grows the trees' boxes far enough, for
//! perspective and orthographic cameras, near the origin and thousands of kilometers from it.

mod common;

use common::{Rng, Workers};
use null3d_core::bvh::mesh::{IndexedTriangles, Side, Triangles, ray_triangle};
use null3d_core::bvh::query::{NO_TRIANGLE, QueryMeshes, QueryScene, SceneQueries};
use null3d_core::bvh::rows::{QueryCamera, RowQuery, RowShape, row_raycast};
use null3d_core::bvh::scene::Source;
use null3d_core::bvh::top::{WorldRay, cell_centre};
use null3d_core::bvh::{Aabb, Ray};
use null3d_core::cells::CellCoords;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::lines::{LineLook, LineMode};
use null3d_core::math::Affine;
use null3d_core::scene::{Command, SceneStorage, flags};
use null3d_core::sprites::SpriteLook;

/// The sprites' quad, whose anchor sits a quarter up from its bottom edge.
const QUAD: [f32; 12] = [
    -0.5, -0.25, 0.0, 0.5, -0.25, 0.0, 0.5, 0.75, 0.0, -0.5, 0.75, 0.0,
];
const QUAD_RADIUS: f32 = 0.901_4;
/// A box, which the scene's objects draw.
const CUBE: [f32; 24] = [
    -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, //
    -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0,
];
const CUBE_INDICES: [u32; 36] = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4,
    7, 0, 7, 3,
];
const QUAD_MESH: u32 = 1;
const CUBE_MESH: u32 = 2;
const LINE_MESH: u32 = 3;

/// The quad, the box, and a stand-in for the segment mesh, which queries never read.
struct Meshes;

impl QueryMeshes for Meshes {
    type Mesh<'a> = IndexedTriangles<'a, u32>;

    fn count(&self) -> u32 {
        3
    }

    fn mesh(&self, id: u32) -> Option<IndexedTriangles<'_, u32>> {
        match id {
            QUAD_MESH => Some(IndexedTriangles {
                positions: &QUAD,
                indices: &[0, 1, 2, 0, 2, 3],
            }),
            CUBE_MESH | LINE_MESH => Some(IndexedTriangles {
                positions: &CUBE,
                indices: &CUBE_INDICES,
            }),
            _ => None,
        }
    }

    fn side(&self, _material: u32) -> Side {
        Side::Front
    }
}

/// One item that brute force tests.
struct Item {
    source: Source,
    matrix: Affine,
    coords: CellCoords,
    /// The row's shape, or `None` for an object of the box mesh.
    shape: Option<RowShape>,
}

/// What the scene's batches are, which brute force reads to give each row its shape.
#[derive(Clone, Copy)]
enum Kind {
    Sprites { screen: bool, points: bool },
    Lines { width: f32, world: bool },
}

/// Every item that a raycast on `layers` may hit, with the shapes that `rows` gives the rows.
fn brute_items(
    scene: &SceneStorage,
    batches: &BatchTable,
    kinds: &[(Handle, Kind)],
    rows: &RowQuery,
    layers: u32,
) -> Vec<Item> {
    let quad = Aabb {
        min: [-0.5, -0.25, 0.0],
        max: [0.5, 0.75, 0.0],
    };
    let table = scene.cell_table();
    let world = scene.world(scene.parity());
    let mut items = Vec::new();
    for slot in scene.created().iter_ones() {
        let s = slot as usize;
        if scene.meshes()[s] == 0 || world.radii()[s] < 0.0 || scene.layers()[s] & layers == 0 {
            continue;
        }
        items.push(Item {
            source: Source::Object(slot),
            matrix: *world.matrix(s),
            coords: table.coords(scene.cells()[s]),
            shape: None,
        });
    }
    for &(id, kind) in kinds {
        let batch = batches.get(id).unwrap();
        if batch.layers() & layers == 0 {
            continue;
        }
        let shape = match kind {
            Kind::Sprites { points: true, .. } if rows.point_threshold.is_some() => {
                RowShape::Near(rows.point_threshold.unwrap())
            }
            Kind::Sprites { screen, .. } => RowShape::Quad { quad, screen },
            Kind::Lines { .. } if rows.line_threshold.is_some() => RowShape::Segment {
                half_width: rows.line_threshold.unwrap(),
                world: true,
            },
            Kind::Lines { width, world } => RowShape::Segment {
                half_width: 0.5 * width,
                world,
            },
        };
        let world = batch.current_world();
        for row in 0..batch.frame_active_count((batch.frame() & 1) as usize) {
            let r = row as usize;
            items.push(Item {
                source: Source::Row { batch: id, row },
                matrix: *world.matrix(r),
                coords: table.coords(batch.cells()[r]),
                shape: Some(shape),
            });
        }
    }
    items
}

/// The item's hit distance on the ray, from brute force.
fn brute_hit(item: &Item, ray: &Ray, rows: &RowQuery) -> Option<(f32, u32)> {
    match &item.shape {
        Some(shape) => {
            let centre = cell_centre(item.coords);
            let eye = rows
                .camera
                .map_or([0.0; 3], |c| std::array::from_fn(|k| c.eye[k] - centre[k]));
            row_raycast(shape, &item.matrix, ray, rows, eye).map(|t| (t, NO_TRIANGLE))
        }
        None => {
            let local = ray.to_local(&item.matrix)?;
            let mesh = Meshes.mesh(CUBE_MESH).unwrap();
            let mut best: Option<(f32, u32)> = None;
            for tri in 0..mesh.count() {
                let mut limited = local;
                limited.t_max = best.map_or(local.t_max, |b| b.0);
                if let Some((t, ..)) = ray_triangle(&limited, &mesh.triangle(tri), Side::Front) {
                    best = Some((t, tri));
                }
            }
            best
        }
    }
}

/// The camera of the scene's views: at `eye`, looking along -z, with CSS pixels of the size that a
/// 60° view 600 pixels high gives, or that an orthographic view 40 m high gives.
fn camera(eye: [f64; 3], perspective: bool) -> QueryCamera {
    let pixel = if perspective {
        2.0 * (30.0f32).to_radians().tan() / 600.0
    } else {
        40.0 / 600.0
    };
    QueryCamera {
        eye,
        right: [1.0, 0.0, 0.0],
        up: [0.0, 1.0, 0.0],
        forward: [0.0, 0.0, -1.0],
        perspective,
        pixel: [pixel, pixel],
        near: 0.1,
        far: 2000.0,
    }
}

#[test]
fn rows_give_brute_force_hits_through_the_trees() {
    let workers = Workers::start(3);
    let jobs = workers.jobs();
    let mut rng = Rng::new(77);
    let mut scene = SceneStorage::with_capacity(64);
    let mut batches = BatchTable::with_capacity(16);
    let mut queries = SceneQueries::new();
    let mut kinds: Vec<(Handle, Kind)> = Vec::new();
    // Near the origin, or at the Earth's radius, off any cell's centre.
    let far = [6_378_137.3f32, 1_234.5, -98_765.4];
    let mut sprites = |screen: bool, points: bool, dynamic: bool, batches: &mut BatchTable| {
        let look = SpriteLook::new(1, 1, screen);
        let look = if points { look.as_points() } else { look };
        let id = batches
            .create_sprites(120, dynamic, QUAD_MESH, 1, QUAD_RADIUS, look)
            .unwrap();
        kinds.push((id, Kind::Sprites { screen, points }));
        id
    };
    let world_sprites = sprites(false, false, false, &mut batches);
    let screen_sprites = sprites(true, false, true, &mut batches);
    let world_points = sprites(false, true, false, &mut batches);
    let screen_points = sprites(true, true, true, &mut batches);
    let mut lines = Vec::new();
    for (mode, width, world, dynamic) in [
        (LineMode::Strip, 6.0, false, false),
        (LineMode::Segments, 0.4, true, true),
        (LineMode::Loop, 3.0, false, true),
    ] {
        let look = LineLook::new(mode, width, world, false);
        let id = batches
            .create_lines(60, dynamic, LINE_MESH, 1, 1.5, look)
            .unwrap();
        kinds.push((id, Kind::Lines { width, world }));
        lines.push(id);
    }
    let place = |rng: &mut Rng, base: [f32; 3]| -> [f32; 3] {
        std::array::from_fn(|k| base[k] + rng.range(-40.0, 40.0))
    };
    let origin_of = |r: usize| if r.is_multiple_of(4) { far } else { [0.0; 3] };
    for &id in &[world_sprites, screen_sprites, world_points, screen_points] {
        let screen = id == screen_sprites || id == screen_points;
        let batch = batches.get_mut(id).unwrap();
        for r in 0..120 {
            let p = place(&mut rng, origin_of(r));
            batch.positions_mut()[r * 3..r * 3 + 3].copy_from_slice(&p);
        }
        let (sizes, rotations, _, _) = batch.sprite_rows_mut();
        for r in 0..120 {
            let (w, h) = if screen {
                (rng.range(4.0, 40.0), rng.range(4.0, 40.0))
            } else {
                (rng.range(0.3, 6.0), rng.range(0.3, 6.0))
            };
            // Points are square and unturned; some sprites are mirrored.
            let mirror = if r % 7 == 3 { -1.0 } else { 1.0 };
            sizes[r * 2..r * 2 + 2].copy_from_slice(&[mirror * w, h]);
            rotations[r] = rng.range(-4.0, 4.0);
        }
        if id == world_points || id == screen_points {
            sizes.fill(if screen { 12.0 } else { 1.5 });
            rotations.fill(0.0);
        }
    }
    for &id in &lines {
        let batch = batches.get_mut(id).unwrap();
        let (points, _) = batch.line_points_mut();
        let mut at = place(&mut rng, [0.0; 3]);
        for p in 0..60 {
            if p == 30 {
                at = place(&mut rng, far);
            }
            for v in &mut at {
                *v += rng.range(-8.0, 8.0);
            }
            points[p * 3..p * 3 + 3].copy_from_slice(&at);
        }
    }
    batches.get_mut(screen_points).unwrap().set_layers(0b10);
    // A few boxes, which the rays must still hit through grown boxes.
    let mut commands = Vec::new();
    for k in 0..20 {
        let h = scene.reserve().unwrap();
        scene
            .set_position(h, place(&mut rng, origin_of(k)))
            .unwrap();
        scene.set_local_radius(h, 1.8).unwrap();
        commands.push(Command::create(h, Handle::NONE, CUBE_MESH, flags::VISIBLE));
    }
    scene.apply_commands(&commands, 1).unwrap();
    let mut checked = [0u32; 3];
    for frame in 1..=3u32 {
        // The dynamic batches move, and the dynamic sprites grow, in every frame.
        for &id in &[screen_sprites, screen_points, lines[1], lines[2]] {
            let batch = batches.get_mut(id).unwrap();
            let values = if batch.line_look().is_some() {
                batch.line_points_mut().0
            } else {
                batch.positions_mut()
            };
            for v in values.iter_mut() {
                *v += rng.range(-1.0, 1.0);
            }
        }
        scene.update_transforms(jobs);
        batches.update(jobs, frame, scene.cell_table_mut());
        for (eye_base, perspective) in [([0.0f32; 3], true), (far, true), (far, false)] {
            let eye: [f64; 3] =
                std::array::from_fn(|k| f64::from(eye_base[k]) + [3.0, 6.0, 90.0][k]);
            for (point_threshold, line_threshold) in [(None, None), (Some(0.7), Some(0.3))] {
                for with_camera in [true, false] {
                    let rows = RowQuery {
                        camera: with_camera.then(|| camera(eye, perspective)),
                        point_threshold,
                        line_threshold,
                    };
                    let view = QueryScene {
                        scene: &scene,
                        batches: &batches,
                        meshes: &Meshes,
                        rows,
                    };
                    queries.sync(&view, jobs).unwrap();
                    for layers in [u32::MAX, 0b1, 0b10] {
                        let items = brute_items(&scene, &batches, &kinds, &rows, layers);
                        let mut rays = Vec::new();
                        for _ in 0..80 {
                            let target = &items[rng.below(items.len() as u32) as usize];
                            let centre = cell_centre(target.coords);
                            let m = &target.matrix;
                            let goal: [f64; 3] =
                                std::array::from_fn(|k| centre[k] + f64::from(m[k * 4 + 3]));
                            // From the camera, as pointer events cast, or from anywhere near.
                            let from_eye = rng.below(3) != 0;
                            let start: [f64; 3] = if from_eye && perspective {
                                eye
                            } else {
                                std::array::from_fn(|k| goal[k] + f64::from(rng.range(-60.0, 60.0)))
                            };
                            let mut d: [f64; 3] = std::array::from_fn(|k| {
                                goal[k] - start[k] + f64::from(rng.range(-1.5, 1.5))
                            });
                            if from_eye && !perspective {
                                d = [0.0, 0.0, -1.0];
                            }
                            let start = if from_eye && !perspective {
                                [goal[0] + f64::from(rng.range(-1.0, 1.0)), goal[1], eye[2]]
                            } else {
                                start
                            };
                            let mut ray = WorldRay::toward(start, d).unwrap();
                            if rng.below(5) == 0 {
                                ray.t_max = rng.range(1.0, 200.0);
                            }
                            rays.push(ray);
                        }
                        for (r, ray) in rays.iter().enumerate() {
                            let what = format!(
                                "frame {frame}, eye {eye:?}, perspective {perspective}, camera {with_camera}, thresholds {point_threshold:?}, layers {layers:b}, ray {r}"
                            );
                            let mut want: Vec<(u32, String, u32)> = items
                                .iter()
                                .filter_map(|item| {
                                    let local = ray.in_cell(item.coords);
                                    brute_hit(item, &local, &rows).map(|(t, tri)| {
                                        (t.to_bits(), format!("{:?}", item.source), tri)
                                    })
                                })
                                .collect();
                            want.sort();
                            let mut all: Vec<(u32, String, u32)> = queries
                                .raycast_all(&view, ray, layers)
                                .iter()
                                .map(|h| {
                                    (h.distance.to_bits(), format!("{:?}", h.source), h.triangle)
                                })
                                .collect();
                            all.sort();
                            assert_eq!(all, want, "{what}");
                            let closest = queries.raycast(&view, ray, layers);
                            assert_eq!(
                                closest.map(|h| h.distance.to_bits()),
                                want.first().map(|w| w.0),
                                "{what}"
                            );
                            assert_eq!(
                                queries.raycast_any(&view, ray, layers),
                                !want.is_empty(),
                                "{what}"
                            );
                            if let Some(hit) = closest {
                                let facing: f32 =
                                    (0..3).map(|k| hit.normal[k] * ray.direction[k]).sum();
                                assert!(facing <= 0.0, "{what}: the normal faces away");
                            }
                            let rows_hit = want.iter().filter(|w| w.2 == NO_TRIANGLE).count();
                            checked[0] += u32::from(rows_hit > 0);
                            checked[1] += rows_hit as u32;
                        }
                        let singles: Vec<_> = rays
                            .iter()
                            .map(|ray| queries.raycast(&view, ray, layers))
                            .collect();
                        let batch = queries
                            .raycast_batch(
                                &view,
                                jobs,
                                rays.len() as u32,
                                &|i| Some(rays[i as usize]),
                                layers,
                            )
                            .unwrap();
                        assert_eq!(batch, &singles[..]);
                        checked[2] += 1;
                    }
                }
            }
        }
    }
    // Enough rays hit rows to mean something.
    assert!(checked[0] > 1000 && checked[1] > 1200, "{checked:?}");
}

/// Without a camera, rays miss sprites, points drawn as squares and lines sized in pixels, and
/// overlap queries never find rows.
#[test]
fn rows_need_a_camera_and_overlaps_skip_them() {
    let workers = Workers::start(1);
    let jobs = workers.jobs();
    let mut scene = SceneStorage::with_capacity(4);
    let mut batches = BatchTable::with_capacity(4);
    let mut queries = SceneQueries::new();
    let look = SpriteLook::new(1, 1, false).as_points();
    let points = batches
        .create_sprites(1, false, QUAD_MESH, 1, QUAD_RADIUS, look)
        .unwrap();
    batches.get_mut(points).unwrap().positions_mut()[2] = -10.0;
    let look = LineLook::new(LineMode::Strip, 4.0, false, false);
    let line = batches
        .create_lines(2, false, LINE_MESH, 1, 1.5, look)
        .unwrap();
    batches
        .get_mut(line)
        .unwrap()
        .line_points_mut()
        .0
        .copy_from_slice(&[-1.0, 0.0, -20.0, 1.0, 0.0, -20.0]);
    scene.begin_frame(1);
    scene.update_transforms(jobs);
    batches.update(jobs, 1, scene.cell_table_mut());
    let ray = WorldRay::new([0.0; 3], [0.0, 0.0, -1.0]);
    let mut cast = |rows: RowQuery| {
        let view = QueryScene {
            scene: &scene,
            batches: &batches,
            meshes: &Meshes,
            rows,
        };
        queries.sync(&view, jobs).unwrap();
        let hit = queries.raycast(&view, &ray, u32::MAX).map(|h| h.source);
        assert!(
            queries
                .overlap_sphere(&view, [0.0, 0.0, -10.0], 30.0, u32::MAX)
                .is_empty()
        );
        hit
    };
    assert_eq!(cast(RowQuery::default()), None);
    let with_camera = RowQuery {
        camera: Some(camera([0.0; 3], true)),
        ..RowQuery::default()
    };
    assert_eq!(
        cast(with_camera),
        Some(Source::Row {
            batch: points,
            row: 0
        })
    );
    // A threshold needs no camera, for points and for lines.
    let thresholds = RowQuery {
        point_threshold: Some(0.1),
        ..RowQuery::default()
    };
    assert!(cast(thresholds).is_some());
    let lines_only = RowQuery {
        line_threshold: Some(0.1),
        ..RowQuery::default()
    };
    assert_eq!(
        cast(lines_only),
        Some(Source::Row {
            batch: line,
            row: 0
        })
    );
}
