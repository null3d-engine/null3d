//! Software occlusion culling against a reference. Random scenes of blockers (closed boxes, closed
//! concave prisms, open folded sheets drawn on one face or both, mirrored objects, and walls that
//! pass beside the camera through the near plane) and spheres behind and between them. A plain
//! depth buffer at four times the masked buffer's resolution in each direction draws the same
//! triangles as the GPU would. Every sphere that the masked buffer hides must lie behind that
//! depth buffer at every sample its surface covers, and the job workers must draw the same
//! buffer as one thread.

mod common;

use common::{Rng, Workers};
use null3d_core::bvh::mesh::IndexedTriangles;
use null3d_core::jobs::JobSystem;
use null3d_core::occlusion::{Blocker, BlockerMesh, OcclusionBuffer, clip_matrix};

/// The reference's samples per masked buffer pixel, in each direction.
const FINER: u32 = 4;
const NEAR: f32 = 0.1;
const FAR: f32 = 500.0;

/// A column-major perspective matrix with reversed depth, as the engine's lenses make it.
fn perspective(fov_y: f32, aspect: f32) -> [f32; 16] {
    let f = 1.0 / (fov_y / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[10] = NEAR / (FAR - NEAR);
    m[11] = -1.0;
    m[14] = NEAR * FAR / (FAR - NEAR);
    m
}

fn multiply(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            out[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    out
}

/// A rotation as a row-major 3 x 3 matrix.
fn rotation(q: [f32; 4]) -> [[f32; 3]; 3] {
    let [x, y, z, w] = q;
    [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - z * w),
            2.0 * (x * z + y * w),
        ],
        [
            2.0 * (x * y + z * w),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - x * w),
        ],
        [
            2.0 * (x * z - y * w),
            2.0 * (y * z + x * w),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ]
}

/// A camera at the origin turned by `yaw` and `pitch`: its view matrix, a rotation alone, and the
/// rotation from view space back to the world.
fn camera(yaw: f32, pitch: f32) -> ([f32; 16], [[f32; 3]; 3]) {
    let (sy, cy, sp, cp) = (yaw.sin(), yaw.cos(), pitch.sin(), pitch.cos());
    // The camera's world rotation: yaw about y, then pitch about x. Columns are its axes.
    let r = [
        [cy, sy * sp, sy * cp],
        [0.0, cp, -sp],
        [-sy, cy * sp, cy * cp],
    ];
    // The view matrix is the inverse: the transpose.
    let mut v = [0.0; 16];
    for row in 0..3 {
        for col in 0..3 {
            v[col * 4 + row] = r[col][row];
        }
    }
    v[15] = 1.0;
    (v, r)
}

/// A mesh's corners and triangles.
struct Shape {
    positions: Vec<f32>,
    indices: Vec<u32>,
}

/// A prism over a counterclockwise polygon, cut into the given triangles, from z = 0 to 1, with
/// faces wound counterclockwise seen from outside.
fn prism(polygon: &[[f32; 2]], cap: &[[u32; 3]]) -> Shape {
    let n = polygon.len() as u32;
    let mut positions = Vec::new();
    for z in [0.0, 1.0] {
        for p in polygon {
            positions.extend_from_slice(&[p[0], p[1], z]);
        }
    }
    let mut indices = Vec::new();
    for t in cap {
        indices.extend_from_slice(&[t[0], t[2], t[1]]);
        indices.extend_from_slice(&[t[0] + n, t[1] + n, t[2] + n]);
    }
    for i in 0..n {
        let j = (i + 1) % n;
        indices.extend_from_slice(&[i, j, j + n, i, j + n, i + n]);
    }
    Shape { positions, indices }
}

fn unit_box() -> Shape {
    let square = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    prism(&square, &[[0, 1, 2], [0, 2, 3]])
}

fn l_prism() -> Shape {
    let l = [
        [0.0, 0.0],
        [1.0, 0.0],
        [1.0, 0.5],
        [0.5, 0.5],
        [0.5, 1.0],
        [0.0, 1.0],
    ];
    prism(&l, &[[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]])
}

/// Two squares that meet at an angle along one edge: an open sheet that folds.
fn folded_sheet(angle: f32) -> Shape {
    let (s, c) = angle.sin_cos();
    let positions = vec![
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, // the first square
        -c, 0.0, s, -c, 1.0, s, // the far edge of the second
    ];
    let indices = vec![0, 1, 2, 0, 2, 3, 4, 0, 3, 4, 3, 5];
    Shape { positions, indices }
}

/// A placed copy of a shape: its row-major 3 x 4 world matrix, and the face rule of its material.
#[derive(Clone, Copy)]
struct Placed {
    shape: usize,
    world: [f32; 12],
    double_sided: bool,
}

fn world_matrix(rot: [[f32; 3]; 3], scale: [f32; 3], at: [f32; 3]) -> [f32; 12] {
    let mut m = [0.0; 12];
    for r in 0..3 {
        for c in 0..3 {
            m[r * 4 + c] = rot[r][c] * scale[c];
        }
        m[r * 4 + 3] = at[r];
    }
    m
}

fn apply(m: &[f32; 12], p: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|r| {
        m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]
    })
}

/// A point `distance` along the camera's view, with sideways offsets in its own frame.
fn ahead(cam: &[[f32; 3]; 3], right: f32, up: f32, distance: f32) -> [f32; 3] {
    std::array::from_fn(|i| cam[i][0] * right + cam[i][1] * up - cam[i][2] * distance)
}

/// A plain depth buffer of the placed shapes, as the GPU draws them: front faces, or both for a
/// two-sided material, clipped at the near plane, one sample at each pixel's center. Each sample
/// holds the nearest depth, or negative infinity.
fn reference(
    shapes: &[Shape],
    placed: &[Placed],
    view_proj: &[f32; 16],
    w: u32,
    h: u32,
) -> Vec<f64> {
    let mut depth = vec![f64::NEG_INFINITY; (w * h) as usize];
    let m = view_proj.map(f64::from);
    let clip = |p: [f32; 3]| -> [f64; 4] {
        let p = p.map(f64::from);
        std::array::from_fn(|r| m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
    };
    for item in placed {
        let shape = &shapes[item.shape];
        for tri in shape.indices.chunks(3) {
            let v: [[f64; 4]; 3] = std::array::from_fn(|k| {
                let i = tri[k] as usize * 3;
                let p = [
                    shape.positions[i],
                    shape.positions[i + 1],
                    shape.positions[i + 2],
                ];
                clip(apply(&item.world, p))
            });
            let det = v[0][0] * (v[1][1] * v[2][3] - v[1][3] * v[2][1])
                - v[0][1] * (v[1][0] * v[2][3] - v[1][3] * v[2][0])
                + v[0][3] * (v[1][0] * v[2][1] - v[1][1] * v[2][0]);
            if det <= 0.0 && !item.double_sided {
                continue;
            }
            // Clip at the near plane.
            let mut poly = Vec::new();
            for k in 0..3 {
                let (p, q) = (v[k], v[(k + 1) % 3]);
                let (dp, dq) = (p[3] - p[2], q[3] - q[2]);
                if dp >= 0.0 {
                    poly.push(p);
                }
                if (dp >= 0.0) != (dq >= 0.0) {
                    let s = dp / (dp - dq);
                    poly.push(std::array::from_fn(|i| p[i] + (q[i] - p[i]) * s));
                }
            }
            let pts: Vec<[f64; 3]> = poly
                .iter()
                .map(|p| {
                    [
                        (p[0] / p[3] + 1.0) * 0.5 * f64::from(w),
                        (1.0 - p[1] / p[3]) * 0.5 * f64::from(h),
                        p[2] / p[3],
                    ]
                })
                .collect();
            for k in 1..pts.len().saturating_sub(1) {
                fill(&mut depth, w, h, [pts[0], pts[k], pts[k + 1]]);
            }
        }
    }
    depth
}

/// Draws one triangle into a plain depth buffer at pixel centers.
fn fill(depth: &mut [f64], w: u32, h: u32, t: [[f64; 3]; 3]) {
    let area =
        (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
    if area.abs() < 1e-12 {
        return;
    }
    let lx = t
        .iter()
        .map(|p| p[0])
        .fold(f64::INFINITY, f64::min)
        .floor()
        .max(0.0) as u32;
    let hx = t
        .iter()
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, f64::max)
        .ceil()
        .min(f64::from(w)) as u32;
    let ly = t
        .iter()
        .map(|p| p[1])
        .fold(f64::INFINITY, f64::min)
        .floor()
        .max(0.0) as u32;
    let hy = t
        .iter()
        .map(|p| p[1])
        .fold(f64::NEG_INFINITY, f64::max)
        .ceil()
        .min(f64::from(h)) as u32;
    for y in ly..hy {
        for x in lx..hx {
            let (px, py) = (f64::from(x) + 0.5, f64::from(y) + 0.5);
            let e = |a: [f64; 3], b: [f64; 3]| {
                (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
            };
            let (e0, e1, e2) = (e(t[1], t[2]), e(t[2], t[0]), e(t[0], t[1]));
            let inside = if area > 0.0 {
                e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0
            } else {
                e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0
            };
            if inside {
                let z = (e0 * t[0][2] + e1 * t[1][2] + e2 * t[2][2]) / area;
                let at = (y * w + x) as usize;
                depth[at] = depth[at].max(z);
            }
        }
    }
}

/// True when the sphere's surface lies behind the reference at every sample it covers, past the
/// near plane. The camera is at the origin, and `view_to_world` turns view directions into world
/// ones.
#[allow(clippy::too_many_arguments)]
fn hidden_in_reference(
    depth: &[f64],
    w: u32,
    h: u32,
    proj: &[f32; 16],
    view_to_world: &[[f32; 3]; 3],
    center: [f32; 3],
    radius: f32,
) -> bool {
    let c = center.map(f64::from);
    let r = f64::from(radius);
    let (p0, p5, p10, p14) = (
        f64::from(proj[0]),
        f64::from(proj[5]),
        f64::from(proj[10]),
        f64::from(proj[14]),
    );
    // The sphere's box on the screen, from its view-space box; a sphere that reaches the camera's
    // plane counts as shown.
    let v: [f64; 3] =
        std::array::from_fn(|k| (0..3).map(|i| f64::from(view_to_world[i][k]) * c[i]).sum());
    let depth_min = -v[2] - r;
    if depth_min <= f64::from(NEAR) {
        return false;
    }
    let span = |centre: f64, scale: f64, size: u32, flip: bool| {
        let (lo, hi) = (centre - r, centre + r);
        let low = if lo < 0.0 {
            lo / depth_min
        } else {
            lo / (depth_min + 2.0 * r)
        } * scale;
        let high = if hi > 0.0 {
            hi / depth_min
        } else {
            hi / (depth_min + 2.0 * r)
        } * scale;
        let (a, b) = if flip {
            (1.0 - high, 1.0 - low)
        } else {
            (low + 1.0, high + 1.0)
        };
        let px = |ndc: f64| (ndc * 0.5 * f64::from(size)).clamp(0.0, f64::from(size));
        (px(a).floor() as u32, px(b).ceil() as u32)
    };
    let (x0, x1) = span(v[0], p0, w, false);
    let (y0, y1) = span(v[1], p5, h, true);
    for y in y0..y1 {
        for x in x0..x1 {
            let ndc_x = (f64::from(x) + 0.5) / f64::from(w) * 2.0 - 1.0;
            let ndc_y = 1.0 - (f64::from(y) + 0.5) / f64::from(h) * 2.0;
            let view = [ndc_x / p0, ndc_y / p5, -1.0];
            let d: [f64; 3] = std::array::from_fn(|i| {
                (0..3)
                    .map(|k| f64::from(view_to_world[i][k]) * view[k])
                    .sum()
            });
            let a: f64 = d.iter().map(|v| v * v).sum();
            let b: f64 = -2.0 * (0..3).map(|i| d[i] * c[i]).sum::<f64>();
            let cc: f64 = c.iter().map(|v| v * v).sum::<f64>() - r * r;
            let disc = b * b - 4.0 * a * cc;
            if disc < 0.0 {
                continue;
            }
            let (t0, t1) = (
                (-b - disc.sqrt()) / (2.0 * a),
                (-b + disc.sqrt()) / (2.0 * a),
            );
            // The view depth along this ray is t; the near plane cuts what lies before it.
            let t = t0.max(f64::from(NEAR));
            if t > t1 {
                continue;
            }
            let nearness = -p10 + p14 / t;
            if nearness > depth[(y * w + x) as usize] + 1e-9 {
                return false;
            }
        }
    }
    true
}

/// Builds a random scene, draws it into `buffer` on `jobs`, and returns the scene's spheres, the
/// shapes, the placed blockers, and the camera.
struct Scene {
    shapes: Vec<Shape>,
    placed: Vec<Placed>,
    meshes: Vec<BlockerMesh>,
    blockers: Vec<Blocker>,
    spheres: Vec<([f32; 3], f32)>,
    proj: [f32; 16],
    view_proj: [f32; 16],
    view_to_world: [[f32; 3]; 3],
}

fn random_scene(rng: &mut Rng) -> Scene {
    let shapes = vec![unit_box(), l_prism(), folded_sheet(rng.range(0.3, 2.8))];
    let meshes: Vec<BlockerMesh> = shapes
        .iter()
        .map(|s| {
            BlockerMesh::build(&IndexedTriangles {
                positions: &s.positions,
                indices: &s.indices,
            })
            .expect("a blocker")
        })
        .collect();
    assert!(meshes[0].is_closed() && meshes[1].is_closed() && !meshes[2].is_closed());
    let (view, view_to_world) = camera(rng.range(-3.1, 3.1), rng.range(-0.4, 0.4));
    let proj = perspective(rng.range(0.7, 1.4), 16.0 / 9.0);
    let view_proj = multiply(&proj, &view);
    let mut placed = Vec::new();
    for _ in 0..rng.below(30) + 10 {
        let shape = rng.below(3) as usize;
        let mut scale = [
            rng.range(0.5, 12.0),
            rng.range(0.5, 12.0),
            rng.range(0.5, 12.0),
        ];
        if rng.below(8) == 0 {
            scale[0] = -scale[0];
        }
        let at = ahead(
            &view_to_world,
            rng.range(-20.0, 20.0),
            rng.range(-8.0, 8.0),
            rng.range(2.0, 80.0),
        );
        placed.push(Placed {
            shape,
            world: world_matrix(rotation(rng.quaternion()), scale, at),
            double_sided: rng.below(2) == 0,
        });
    }
    // Walls along both sides of the view that reach behind the camera, through the near plane.
    for side in [-1.0, 1.0] {
        if rng.below(2) == 0 {
            let rot = [
                [
                    view_to_world[0][0],
                    view_to_world[0][1],
                    view_to_world[0][2],
                ],
                [
                    view_to_world[1][0],
                    view_to_world[1][1],
                    view_to_world[1][2],
                ],
                [
                    view_to_world[2][0],
                    view_to_world[2][1],
                    view_to_world[2][2],
                ],
            ];
            let at = ahead(
                &view_to_world,
                side * rng.range(1.0, 4.0),
                0.0,
                rng.range(20.0, 40.0),
            );
            placed.push(Placed {
                shape: 0,
                world: world_matrix(rot, [0.5, 30.0, 100.0], at),
                double_sided: false,
            });
        }
    }
    let distance = |p: &Placed| p.world[3].powi(2) + p.world[7].powi(2) + p.world[11].powi(2);
    placed.sort_by(|a, b| distance(a).total_cmp(&distance(b)));
    let blockers = placed
        .iter()
        .map(|p| Blocker {
            mesh: p.shape as u32,
            clip: clip_matrix(&view_proj, &p.world, [0.0; 3]),
            double_sided: p.double_sided,
        })
        .collect();
    let spheres = (0..400)
        .map(|_| {
            let at = ahead(
                &view_to_world,
                rng.range(-40.0, 40.0),
                rng.range(-15.0, 15.0),
                rng.range(0.5, 150.0),
            );
            (at, rng.range(0.05, 4.0))
        })
        .collect();
    Scene {
        shapes,
        placed,
        meshes,
        blockers,
        spheres,
        proj,
        view_proj,
        view_to_world,
    }
}

#[test]
fn the_buffer_never_hides_a_sphere_that_a_finer_depth_buffer_shows() {
    let mut rng = Rng::new(36);
    let jobs = JobSystem::new(0);
    let (mut hidden, mut hidden_in_ref, mut tested) = (0, 0, 0);
    for _ in 0..12 {
        let scene = random_scene(&mut rng);
        let mut buffer = OcclusionBuffer::new();
        buffer.resize(1920, 1080).unwrap();
        buffer
            .draw(&jobs, &scene.view_proj, &scene.meshes, &scene.blockers)
            .unwrap();
        let (w, h) = buffer.size();
        let (rw, rh) = (w * FINER, h * FINER);
        let depth = reference(&scene.shapes, &scene.placed, &scene.view_proj, rw, rh);
        for &(center, radius) in &scene.spheres {
            tested += 1;
            let truly = hidden_in_reference(
                &depth,
                rw,
                rh,
                &scene.proj,
                &scene.view_to_world,
                center,
                radius,
            );
            hidden_in_ref += usize::from(truly);
            if buffer.hides(center, radius) {
                hidden += 1;
                assert!(
                    truly,
                    "a sphere at {center:?} of radius {radius} shows in the reference"
                );
            }
        }
    }
    println!("{tested} spheres: {hidden_in_ref} hidden in the reference, {hidden} by the buffer");
    // The test means something only when the buffer hides a fair share of what it could.
    assert!(hidden * 3 >= hidden_in_ref, "{hidden} of {hidden_in_ref}");
}

#[test]
fn the_job_workers_draw_the_same_buffer_as_one_thread() {
    let workers = Workers::start(3);
    let single = JobSystem::new(0);
    let mut rng = Rng::new(7);
    for _ in 0..6 {
        let scene = random_scene(&mut rng);
        let mut a = OcclusionBuffer::new();
        let mut b = OcclusionBuffer::new();
        for buffer in [&mut a, &mut b] {
            buffer.resize(1280, 720).unwrap();
        }
        a.draw(&single, &scene.view_proj, &scene.meshes, &scene.blockers)
            .unwrap();
        b.draw(
            workers.jobs(),
            &scene.view_proj,
            &scene.meshes,
            &scene.blockers,
        )
        .unwrap();
        let (w, h) = a.size();
        for y in (0..h).step_by(4) {
            for x in (0..w).step_by(8) {
                assert_eq!(
                    a.subtile_depth(x, y).to_bits(),
                    b.subtile_depth(x, y).to_bits()
                );
            }
        }
        assert_eq!(a.drawn(), b.drawn());
    }
}

#[test]
fn a_wall_hides_what_stands_behind_it_and_nothing_in_front() {
    let jobs = JobSystem::new(0);
    let shape = unit_box();
    let mesh = BlockerMesh::build(&IndexedTriangles {
        positions: &shape.positions,
        indices: &shape.indices,
    })
    .unwrap();
    let (view, _) = camera(0.0, 0.0);
    let view_proj = multiply(&perspective(1.0, 16.0 / 9.0), &view);
    // A wall 20 m wide and 10 m high, 10 m ahead, facing the camera.
    let wall = world_matrix(
        rotation([0.0, 0.0, 0.0, 1.0]),
        [20.0, 10.0, 1.0],
        [0.0, 0.0, -10.5],
    );
    let mut buffer = OcclusionBuffer::new();
    buffer.resize(1920, 1080).unwrap();
    let blocker = Blocker {
        mesh: 0,
        clip: clip_matrix(&view_proj, &wall, [0.0; 3]),
        double_sided: false,
    };
    buffer.draw(&jobs, &view_proj, &[mesh], &[blocker]).unwrap();
    assert!(buffer.is_active());
    assert_eq!(buffer.drawn(), (1, 2));
    assert!(buffer.hides([0.0, 0.0, -20.0], 1.0));
    assert!(buffer.hides([3.0, 2.0, -40.0], 4.0));
    assert!(!buffer.hides([0.0, 0.0, -8.0], 1.0), "in front of the wall");
    assert!(
        !buffer.hides([0.0, 0.0, -20.0], 15.0),
        "wider than the wall"
    );
    assert!(
        !buffer.hides([0.0, 0.0, -9.4], 0.2),
        "through the wall's face"
    );
    // Seen from behind, a wall of one face blocks nothing; its front faces still draw for a box.
    let (behind, _) = camera(std::f32::consts::PI, 0.0);
    let view_proj = multiply(&perspective(1.0, 16.0 / 9.0), &behind);
    let sheet = folded_sheet(0.0);
    let sheet = BlockerMesh::build(&IndexedTriangles {
        positions: &sheet.positions,
        indices: &sheet.indices,
    })
    .unwrap();
    let plane = world_matrix(
        rotation([0.0, 0.0, 0.0, 1.0]),
        [10.0, 10.0, 1.0],
        [0.0, -5.0, 10.0],
    );
    for (double_sided, hides) in [(false, false), (true, true)] {
        let blocker = Blocker {
            mesh: 0,
            clip: clip_matrix(&view_proj, &plane, [0.0; 3]),
            double_sided,
        };
        buffer
            .draw(&jobs, &view_proj, std::slice::from_ref(&sheet), &[blocker])
            .unwrap();
        assert_eq!(buffer.hides([0.0, 0.0, 30.0], 1.0), hides);
    }
}
