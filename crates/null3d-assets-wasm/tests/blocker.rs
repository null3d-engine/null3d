//! Blocker meshes against the shapes they stand for.
//!
//! - The check passes the blockers that the tool makes, and fails blockers that bulge out of
//!   convex, concave and thin shapes, or reach into a hole.
//! - Shapes that enclose no space get no blocker.
//! - Random shapes: unions of boxes, turned at random, some open at the bottom, some with a
//!   tunnel through them. Each blocker passes the check, and in random scenes the occlusion
//!   buffer that the blockers draw never hides a sphere that a plain depth buffer of the shapes
//!   themselves, at four times its resolution, shows.

#[path = "../../null3d-core/tests/common/mod.rs"]
mod common;

use common::Rng;
use null3d_assets_wasm::blocker::{self, Dropped, Failure, Settings, Shape};
use null3d_core::bvh::mesh::IndexedTriangles;
use null3d_core::jobs::JobSystem;
use null3d_core::occlusion::{Blocker, BlockerMesh, OcclusionBuffer, clip_matrix};

/// A mesh's corners and triangles.
#[derive(Clone, Debug, Default)]
struct Mesh {
    positions: Vec<f32>,
    indices: Vec<u32>,
}

impl Mesh {
    fn shape(&self) -> Shape<'_> {
        Shape {
            positions: &self.positions,
            indices: &self.indices,
        }
    }

    /// Adds a closed box from `lo` to `hi`, its faces outward, leaving out the faces whose
    /// outward axis and sign `skip` names, as (axis, positive).
    fn add_box(&mut self, lo: [f32; 3], hi: [f32; 3], skip: &[(usize, bool)]) -> &mut Self {
        for axis in 0..3 {
            for out in [false, true] {
                if skip.contains(&(axis, out)) {
                    continue;
                }
                let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
                let first = self.positions.len() as u32 / 3;
                for (du, dv) in [(0, 0), (1, 0), (1, 1), (0, 1)] {
                    let mut p = [0.0; 3];
                    p[axis] = if out { hi[axis] } else { lo[axis] };
                    p[u] = if du == 0 { lo[u] } else { hi[u] };
                    p[v] = if dv == 0 { lo[v] } else { hi[v] };
                    self.positions.extend(p);
                }
                let [a, b, c, d] = [first, first + 1, first + 2, first + 3];
                if out {
                    self.indices.extend([a, b, c, a, c, d]);
                } else {
                    self.indices.extend([a, c, b, a, d, c]);
                }
            }
        }
        self
    }

    /// The mesh turned by a rotation, given as a row-major matrix.
    fn turned(&self, r: &[[f32; 3]; 3]) -> Mesh {
        Mesh {
            positions: self
                .positions
                .chunks(3)
                .flat_map(|p| {
                    std::array::from_fn::<f32, 3, _>(|i| {
                        r[i][0] * p[0] + r[i][1] * p[1] + r[i][2] * p[2]
                    })
                })
                .collect(),
            indices: self.indices.clone(),
        }
    }
}

fn settings(ground: bool) -> Settings {
    Settings {
        ground,
        ..Settings::default()
    }
}

/// The blocker's positions moved away from their centre by `factor`.
fn swollen(b: &blocker::Blocker, factor: f32) -> Vec<f32> {
    let n = (b.positions.len() / 3) as f32;
    let centre: [f32; 3] =
        std::array::from_fn(|k| b.positions.iter().skip(k).step_by(3).sum::<f32>() / n);
    b.positions
        .chunks(3)
        .flat_map(|p| std::array::from_fn::<f32, 3, _>(|k| centre[k] + (p[k] - centre[k]) * factor))
        .collect()
}

#[test]
fn a_box_gets_one_box_that_passes_and_a_swollen_one_fails() {
    let mesh = Mesh::default()
        .add_box([0.0; 3], [4.0, 10.0, 6.0], &[])
        .clone();
    let b = blocker::make(&mesh.shape(), &settings(true)).expect("a blocker");
    assert_eq!(b.boxes, 1);
    assert_eq!(b.indices.len(), 36);
    assert!(b.fill > 0.6, "fill {}", b.fill);
    // Every corner lies strictly inside the box.
    for p in b.positions.chunks(3) {
        assert!(p[0] > 0.0 && p[0] < 4.0 && p[1] > 0.0 && p[1] < 10.0 && p[2] > 0.0 && p[2] < 6.0);
    }
    for factor in [1.05, 1.5] {
        assert!(blocker::check(&mesh.shape(), &swollen(&b, factor), &b.indices, true).is_err());
    }
    // A blocker as large as the box touches its faces.
    let same = Mesh::default()
        .add_box([0.0; 3], [4.0, 10.0, 6.0], &[])
        .clone();
    assert!(matches!(
        blocker::check(&mesh.shape(), &same.positions, &same.indices, true),
        Err(Failure::Crosses { .. })
    ));
    // A blocker turned inside out is refused.
    let flipped: Vec<u32> = b
        .indices
        .chunks(3)
        .flat_map(|t| [t[0], t[2], t[1]])
        .collect();
    assert_eq!(
        blocker::check(&mesh.shape(), &b.positions, &flipped, true),
        Err(Failure::NotClosed)
    );
}

/// A U of three overlapping closed boxes: two arms joined at the bottom.
fn u_shape() -> Mesh {
    Mesh::default()
        .add_box([0.0, 0.0, 0.0], [10.0, 3.0, 4.0], &[])
        .add_box([0.0, 0.0, 0.0], [3.0, 12.0, 4.0], &[])
        .add_box([7.0, 0.0, 0.0], [10.0, 12.0, 4.0], &[])
        .clone()
}

#[test]
fn a_concave_shape_gets_a_blocker_that_stays_out_of_its_gap() {
    let mesh = u_shape();
    let b = blocker::make(&mesh.shape(), &settings(true)).expect("a blocker");
    assert!(b.boxes >= 2, "{} boxes", b.boxes);
    // No corner lies in the gap between the arms, above the base.
    for p in b.positions.chunks(3) {
        assert!(
            !(p[0] > 3.0 && p[0] < 7.0 && p[1] > 3.0),
            "{p:?} lies in the gap"
        );
    }
    // A box across the gap has every corner inside the arms, yet crosses the gap.
    let across = Mesh::default()
        .add_box([1.0, 8.0, 1.0], [9.0, 10.0, 3.0], &[])
        .clone();
    let corners_inside = across
        .positions
        .chunks(3)
        .all(|p| (p[0] < 3.0 || p[0] > 7.0) && p[1] < 12.0);
    assert!(corners_inside);
    assert!(blocker::check(&mesh.shape(), &across.positions, &across.indices, true).is_err());
    // A box in the gap alone lies wholly outside.
    let gap = Mesh::default()
        .add_box([4.0, 5.0, 1.0], [6.0, 9.0, 3.0], &[])
        .clone();
    assert!(matches!(
        blocker::check(&mesh.shape(), &gap.positions, &gap.indices, true),
        Err(Failure::Outside { .. })
    ));
}

#[test]
fn thin_and_open_shapes_get_no_blocker() {
    // A wall thinner than a cell.
    let wall = Mesh::default()
        .add_box([0.0; 3], [10.0, 6.0, 0.1], &[])
        .clone();
    assert_eq!(
        blocker::make(&wall.shape(), &settings(true)),
        Err(Dropped::NoInside)
    );
    // A blocker that pokes out of the wall's faces fails.
    let poke = Mesh::default()
        .add_box([1.0, 1.0, 0.02], [9.0, 5.0, 0.2], &[])
        .clone();
    assert!(blocker::check(&wall.shape(), &poke.positions, &poke.indices, true).is_err());
    // A blocker that fits the wall exactly inside passes.
    let fits = Mesh::default()
        .add_box([1.0, 1.0, 0.02], [9.0, 5.0, 0.08], &[])
        .clone();
    assert_eq!(
        blocker::check(&wall.shape(), &fits.positions, &fits.indices, true),
        Ok(())
    );
    // A box open at a side, or at its top, encloses nothing.
    for skip in [(0, true), (2, false), (1, true)] {
        let open = Mesh::default()
            .add_box([0.0; 3], [4.0, 4.0, 4.0], &[skip])
            .clone();
        assert_eq!(
            blocker::make(&open.shape(), &settings(true)),
            Err(Dropped::NoInside),
            "open at {skip:?}"
        );
    }
}

#[test]
fn a_box_open_at_its_bottom_blocks_only_with_the_ground() {
    let open = Mesh::default()
        .add_box([0.0; 3], [4.0, 4.0, 4.0], &[(1, false)])
        .clone();
    let b = blocker::make(&open.shape(), &settings(true)).expect("a blocker");
    assert_eq!(b.boxes, 1);
    assert_eq!(
        blocker::make(&open.shape(), &settings(false)),
        Err(Dropped::NoInside)
    );
    // Without the ground, the check finds the way in from below.
    assert!(blocker::check(&open.shape(), &b.positions, &b.indices, false).is_err());
}

/// A block with a tunnel along z, like a gateway: four bars around a hole.
fn gateway() -> Mesh {
    Mesh::default()
        .add_box([0.0, 0.0, 0.0], [3.0, 10.0, 5.0], &[])
        .add_box([7.0, 0.0, 0.0], [10.0, 10.0, 5.0], &[])
        .add_box([0.0, 7.0, 0.0], [10.0, 10.0, 5.0], &[])
        .add_box([0.0, 0.0, 0.0], [10.0, 2.0, 5.0], &[])
        .clone()
}

#[test]
fn a_blocker_stays_out_of_a_tunnel() {
    let mesh = gateway();
    let b = blocker::make(&mesh.shape(), &settings(true)).expect("a blocker");
    let tri = |t: &[u32]| -> [[f32; 3]; 3] {
        std::array::from_fn(|c| {
            let at = t[c] as usize * 3;
            [b.positions[at], b.positions[at + 1], b.positions[at + 2]]
        })
    };
    // No triangle's centre lies in the tunnel.
    for t in b.indices.chunks(3) {
        let v = tri(t);
        let c: [f32; 3] = std::array::from_fn(|k| (v[0][k] + v[1][k] + v[2][k]) / 3.0);
        assert!(!(c[0] > 3.0 && c[0] < 7.0 && c[1] > 2.0 && c[1] < 7.0));
    }
    // A slab through the tunnel fails.
    let slab = Mesh::default()
        .add_box([1.0, 4.0, 1.0], [9.0, 5.0, 4.0], &[])
        .clone();
    assert!(blocker::check(&mesh.shape(), &slab.positions, &slab.indices, true).is_err());
}

#[test]
fn the_same_shape_gives_the_same_blocker() {
    let mesh = u_shape();
    let a = blocker::make(&mesh.shape(), &settings(true)).unwrap();
    let b = blocker::make(&mesh.shape(), &settings(true)).unwrap();
    assert_eq!(a, b);
}

/// A rotation about the y axis, as a row-major matrix.
fn turn_y(angle: f32) -> [[f32; 3]; 3] {
    let (s, c) = angle.sin_cos();
    [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]]
}

/// A rotation as a row-major matrix.
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

/// A random shape: a union of two to five boxes that overlap, sometimes with a tunnel, sometimes
/// open at the bottom, sometimes turned at random, and turned about the vertical. Returns the
/// shape and whether the ground must close it.
fn random_shape(rng: &mut Rng) -> (Mesh, bool) {
    let open_bottom = rng.below(3) == 0;
    let skip: &[(usize, bool)] = if open_bottom { &[(1, false)] } else { &[] };
    let mut mesh = if rng.below(4) == 0 {
        let mut g = Mesh::default();
        let w = rng.range(2.0, 4.0);
        let h = rng.range(6.0, 12.0);
        g.add_box([0.0, 0.0, 0.0], [w, h, 5.0], skip)
            .add_box([10.0 - w, 0.0, 0.0], [10.0, h, 5.0], skip)
            .add_box([0.0, h - 2.0, 0.0], [10.0, h, 5.0], &[]);
        g
    } else {
        let mut m = Mesh::default();
        let mut at = [0.0f32; 3];
        for _ in 0..rng.below(4) + 2 {
            let size = [
                rng.range(1.0, 8.0),
                rng.range(1.0, 12.0),
                rng.range(1.0, 8.0),
            ];
            let lo = [at[0], 0.0, at[2]];
            m.add_box(lo, [lo[0] + size[0], size[1], lo[2] + size[2]], skip);
            at = [
                at[0] + size[0] * rng.range(0.2, 0.9),
                0.0,
                at[2] + size[2] * rng.range(-0.5, 0.9),
            ];
        }
        m
    };
    if !open_bottom && rng.below(3) == 0 {
        mesh = mesh.turned(&rotation(rng.quaternion()));
    }
    (mesh.turned(&turn_y(rng.range(-3.1, 3.1))), open_bottom)
}

#[test]
fn random_shapes_get_blockers_that_pass_and_swollen_ones_fail() {
    let mut rng = Rng::new(50);
    let (mut made, mut caught, mut tested) = (0, 0, 0);
    for _ in 0..60 {
        let (mesh, open) = random_shape(&mut rng);
        match blocker::make(&mesh.shape(), &settings(true)) {
            Ok(b) => {
                made += 1;
                assert_eq!(
                    blocker::check(&mesh.shape(), &b.positions, &b.indices, true),
                    Ok(())
                );
                if open {
                    assert!(
                        blocker::check(&mesh.shape(), &b.positions, &b.indices, false).is_err()
                    );
                }
                // Moving one corner far out, past the shape, must fail.
                let mut moved = b.positions.clone();
                let corner = rng.below((moved.len() / 3) as u32) as usize * 3;
                let (lo, hi) = (
                    mesh.positions.iter().copied().fold(f32::INFINITY, f32::min),
                    mesh.positions
                        .iter()
                        .copied()
                        .fold(f32::NEG_INFINITY, f32::max),
                );
                for k in 0..3 {
                    moved[corner + k] +=
                        if moved[corner + k] > 0.0 { 1.0 } else { -1.0 } * (hi - lo);
                }
                tested += 1;
                if blocker::check(&mesh.shape(), &moved, &b.indices, true).is_err() {
                    caught += 1;
                }
            }
            Err(reason @ (Dropped::TooLittle { .. } | Dropped::NoInside)) => {
                println!("dropped: {reason}");
            }
            Err(other) => panic!("a shape lost its blocker: {other}"),
        }
    }
    println!("{made} of 60 shapes got a blocker; {caught} of {tested} moved corners caught");
    assert!(made >= 40, "{made}");
    assert_eq!(caught, tested);
}

const NEAR: f32 = 0.1;
const FAR: f32 = 1000.0;
/// The reference's samples per buffer pixel, in each direction.
const FINER: u32 = 4;

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

/// A camera at the origin turned by `yaw` and `pitch`: its view matrix, and the rotation from view
/// space to the world, as a row-major matrix whose columns are its axes.
fn camera(yaw: f32, pitch: f32) -> ([f32; 16], [[f32; 3]; 3]) {
    let (sy, cy, sp, cp) = (yaw.sin(), yaw.cos(), pitch.sin(), pitch.cos());
    let r = [
        [cy, sy * sp, sy * cp],
        [0.0, cp, -sp],
        [-sy, cy * sp, cy * cp],
    ];
    let mut v = [0.0; 16];
    for row in 0..3 {
        for col in 0..3 {
            v[col * 4 + row] = r[col][row];
        }
    }
    v[15] = 1.0;
    (v, r)
}

/// A world matrix that turns a shape about the vertical, scales it and moves it.
fn placement(angle: f32, scale: f32, at: [f32; 3]) -> [f32; 12] {
    let r = turn_y(angle);
    let mut m = [0.0; 12];
    for row in 0..3 {
        for col in 0..3 {
            m[row * 4 + col] = r[row][col] * scale;
        }
        m[row * 4 + 3] = at[row];
    }
    m
}

fn apply(m: &[f32; 12], p: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|r| {
        m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]
    })
}

/// A plain depth buffer of the shapes, as the GPU draws them: front faces, clipped at the near
/// plane, one sample at each pixel's centre, each holding the nearest depth or negative infinity.
fn reference(placed: &[(&Mesh, [f32; 12])], view_proj: &[f32; 16], w: u32, h: u32) -> Vec<f64> {
    let mut depth = vec![f64::NEG_INFINITY; (w * h) as usize];
    let m = view_proj.map(f64::from);
    let clip = |p: [f32; 3]| -> [f64; 4] {
        let p = p.map(f64::from);
        std::array::from_fn(|r| m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
    };
    for (mesh, world) in placed {
        for tri in mesh.indices.chunks(3) {
            let v: [[f64; 4]; 3] = std::array::from_fn(|k| {
                let i = tri[k] as usize * 3;
                clip(apply(
                    world,
                    [
                        mesh.positions[i],
                        mesh.positions[i + 1],
                        mesh.positions[i + 2],
                    ],
                ))
            });
            let det = v[0][0] * (v[1][1] * v[2][3] - v[1][3] * v[2][1])
                - v[0][1] * (v[1][0] * v[2][3] - v[1][3] * v[2][0])
                + v[0][3] * (v[1][0] * v[2][1] - v[1][1] * v[2][0]);
            if det <= 0.0 {
                continue;
            }
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

/// Draws one triangle into a plain depth buffer at pixel centres.
fn fill(depth: &mut [f64], w: u32, h: u32, t: [[f64; 3]; 3]) {
    let area =
        (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1]);
    if area.abs() < 1e-12 {
        return;
    }
    let span = |k: usize, size: u32| {
        let lo = t.iter().map(|p| p[k]).fold(f64::INFINITY, f64::min);
        let hi = t.iter().map(|p| p[k]).fold(f64::NEG_INFINITY, f64::max);
        (
            lo.floor().max(0.0) as u32,
            hi.ceil().min(f64::from(size)).max(0.0) as u32,
        )
    };
    let ((lx, hx), (ly, hy)) = (span(0, w), span(1, h));
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

/// True when the sphere lies behind the reference at every sample it covers, past the near
/// plane, for a camera at the origin.
fn hidden_in_reference(
    depth: &[f64],
    (w, h): (u32, u32),
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

#[test]
fn blockers_never_hide_a_sphere_that_their_shapes_show() {
    let mut rng = Rng::new(51);
    let jobs = JobSystem::new(0);
    let (mut by_blockers, mut by_shapes, mut by_own, mut tested) = (0, 0, 0, 0);
    let mut shapes: Vec<(Mesh, blocker::Blocker)> = Vec::new();
    while shapes.len() < 24 {
        let (mesh, _) = random_shape(&mut rng);
        if let Ok(b) = blocker::make(&mesh.shape(), &settings(true)) {
            shapes.push((mesh, b));
        }
    }
    let meshes: Vec<BlockerMesh> = shapes
        .iter()
        .map(|(_, b)| {
            BlockerMesh::build(&IndexedTriangles {
                positions: &b.positions,
                indices: &b.indices,
            })
            .expect("a blocker mesh")
        })
        .collect();
    assert!(meshes.iter().all(BlockerMesh::is_closed));
    // The shapes themselves as blockers, as the engine draws a mesh that has no blocker of its own.
    let own: Vec<BlockerMesh> = shapes
        .iter()
        .map(|(m, _)| {
            BlockerMesh::build(&IndexedTriangles {
                positions: &m.positions,
                indices: &m.indices,
            })
            .expect("a mesh")
        })
        .collect();
    for _ in 0..16 {
        let (view, view_to_world) = camera(rng.range(-3.1, 3.1), rng.range(-0.5, 0.3));
        let proj = perspective(rng.range(0.7, 1.4), 16.0 / 9.0);
        let view_proj = multiply(&proj, &view);
        // Shapes ahead of the camera, each standing on ground below the camera's height.
        let ahead = |right: f32, distance: f32| -> [f32; 3] {
            let forward = [-view_to_world[0][2], 0.0, -view_to_world[2][2]];
            let side = [view_to_world[0][0], 0.0, view_to_world[2][0]];
            std::array::from_fn(|i| side[i] * right + forward[i] * distance)
        };
        let mut placed = Vec::new();
        for _ in 0..rng.below(20) + 10 {
            let shape = rng.below(shapes.len() as u32) as usize;
            let mut at = ahead(rng.range(-40.0, 40.0), rng.range(8.0, 90.0));
            let (mesh, _) = &shapes[shape];
            let base = mesh
                .positions
                .iter()
                .skip(1)
                .step_by(3)
                .copied()
                .fold(f32::INFINITY, f32::min);
            let scale = rng.range(0.5, 2.0);
            at[1] = -rng.range(0.5, 6.0) - base * scale;
            placed.push((shape, placement(rng.range(-3.1, 3.1), scale, at)));
        }
        let distance = |m: &[f32; 12]| m[3] * m[3] + m[7] * m[7] + m[11] * m[11];
        placed.sort_by(|a, b| distance(&a.1).total_cmp(&distance(&b.1)));
        let blockers: Vec<Blocker> = placed
            .iter()
            .map(|&(shape, world)| Blocker {
                mesh: shape as u32,
                clip: clip_matrix(&view_proj, &world, [0.0; 3]),
                double_sided: false,
            })
            .collect();
        let mut buffer = OcclusionBuffer::new();
        buffer.resize(1280, 720).unwrap();
        buffer.draw(&jobs, &view_proj, &meshes, &blockers).unwrap();
        let mut own_buffer = OcclusionBuffer::new();
        own_buffer.resize(1280, 720).unwrap();
        own_buffer.draw(&jobs, &view_proj, &own, &blockers).unwrap();
        let (w, h) = buffer.size();
        let size = (w * FINER, h * FINER);
        let originals: Vec<(&Mesh, [f32; 12])> =
            placed.iter().map(|&(s, m)| (&shapes[s].0, m)).collect();
        let depth = reference(&originals, &view_proj, size.0, size.1);
        for _ in 0..400 {
            let mut centre = ahead(rng.range(-60.0, 60.0), rng.range(1.0, 160.0));
            centre[1] = rng.range(-6.0, 20.0);
            let radius = rng.range(0.05, 3.0);
            tested += 1;
            let truly = hidden_in_reference(&depth, size, &proj, &view_to_world, centre, radius);
            by_shapes += usize::from(truly);
            by_own += usize::from(own_buffer.hides(centre, radius));
            if buffer.hides(centre, radius) {
                by_blockers += 1;
                assert!(
                    truly,
                    "the blockers hide a sphere at {centre:?} of radius {radius} that shows"
                );
            }
        }
    }
    println!(
        "{tested} spheres: {by_shapes} hidden in the plain depth buffer, {by_own} by the shapes as blockers, {by_blockers} by their blockers"
    );
    assert!(by_blockers * 6 >= by_shapes, "{by_blockers} of {by_shapes}");
}
