//! Raycasts against the rows of sprite, point and line batches, which pack their own values into
//! their matrices in place of a transform that places a mesh (see [`crate::sprites`] and
//! [`crate::lines`]).
//!
//! # What a ray hits
//!
//! A ray hits what each row draws, as three.js's `Raycaster` tests the same objects:
//!
//! | Row | Hit | three.js |
//! | --- | --- | --- |
//! | Sprite, or point | Its quad, which faces the camera in the camera's image plane, at its anchor's depth | `Sprite.raycast` |
//! | Point, with a point threshold | Within the threshold of its position, whatever its size | `Points.raycast` |
//! | Line segment, width in world units | Within half the width of the segment | `LineSegments2.raycast`, `worldUnits` |
//! | Line segment, width in pixels | Within half the width on the screen | `LineSegments2.raycast` |
//! | Line segment, with a line threshold | Within the threshold of the segment, whatever its width | `Line.raycast` |
//!
//! A quad faces the camera, and a width in pixels has a size in the world that grows with the
//! depth, so these rows need the query's camera ([`QueryCamera`]). Without one, rays miss them.
//! A row sized in pixels is hit only between the camera's near and far planes, where it draws.
//!
//! A quad's hit is where the ray crosses it. A hit near a point or a line, as three.js gives it,
//! is the ray's closest point to the point or the segment, and the hit's distance is that point's
//! distance along the ray. Its normal points back along the ray; a quad's faces the camera.
//!
//! # Widths in pixels for any ray
//!
//! For a ray from the camera, three.js tests a width in pixels on the screen: the ray's point on
//! the screen lies within half the width of the segment's projection. Each point of the segment
//! projects to the screen from its own depth, so the same test reads: at the depth of some point
//! of the segment, the ray passes it within half the width, in pixels at that depth. The engine
//! tests that form, which holds for any ray. Along the segment, the ray's offset at the same depth
//! and the width at that depth both change linearly, so the test is a quadratic in the place along
//! the segment, solved exactly.

use super::{Aabb, Ray};
use crate::math::Affine;
use crate::sprites::SMALL;

/// The camera that sprites and points face, and that sizes rows in pixels of the screen.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QueryCamera {
    /// The camera's position in the world.
    pub eye: [f64; 3],
    /// The camera's unit axes in the world: to the right of the view, up the view, and along it.
    pub right: [f32; 3],
    /// See `right`.
    pub up: [f32; 3],
    /// See `right`.
    pub forward: [f32; 3],
    /// True for a perspective camera, false for an orthographic one.
    pub perspective: bool,
    /// The world units of one CSS pixel across the view and up it: at a depth of 1 in front of a
    /// perspective camera, or at any depth for an orthographic one.
    pub pixel: [f32; 2],
    /// The distances along the view to the near and far planes.
    pub near: f32,
    /// See `near`.
    pub far: f32,
}

impl QueryCamera {
    /// The world units of one CSS pixel at `depth`, across the view and up it.
    #[inline(always)]
    fn pixel_at(&self, depth: f64) -> [f64; 2] {
        let scale = if self.perspective { depth } else { 1.0 };
        self.pixel.map(|p| f64::from(p) * scale)
    }

    /// The larger side of a pixel at a depth of 1, or anywhere for an orthographic camera.
    pub fn pixel_reach(&self) -> f32 {
        self.pixel[0].abs().max(self.pixel[1].abs())
    }

    /// True when `depth` lies between the near and far planes.
    #[inline(always)]
    fn sees(&self, depth: f64) -> bool {
        depth >= f64::from(self.near) && depth <= f64::from(self.far)
    }
}

/// What a query gives the rows of sprite, point and line batches: the camera, and three.js's
/// thresholds.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RowQuery {
    /// The camera that sprites and points face, or `None`, when rays miss rows that need it.
    pub camera: Option<QueryCamera>,
    /// When set, a ray hits a point within this distance of its position, as three.js's
    /// `Raycaster.params.Points.threshold`, instead of the point's square.
    pub point_threshold: Option<f32>,
    /// When set, a ray hits a line segment within this distance, as three.js's
    /// `Raycaster.params.Line.threshold`, instead of within half its width.
    pub line_threshold: Option<f32>,
}

/// What a ray tests of one row.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RowShape {
    /// A sprite or a point drawn as its quad: the quad's corners around its anchor in units of its
    /// size, and whether its size is in pixels.
    Quad {
        /// The box of the quad's corners; only x and y count.
        quad: Aabb,
        /// True when the size is in CSS pixels, false when it is in world units.
        screen: bool,
    },
    /// A point that a threshold reaches: within this distance of its position.
    Near(f32),
    /// A line segment: within half its width, in world units or in CSS pixels.
    Segment {
        /// Half the width.
        half_width: f32,
        /// True when the width is in world units, false when it is in CSS pixels.
        world: bool,
    },
}

impl RowShape {
    /// True when the shape needs the query's camera.
    pub fn needs_camera(&self) -> bool {
        match self {
            RowShape::Quad { .. } => true,
            RowShape::Near(_) => false,
            RowShape::Segment { world, .. } => !world,
        }
    }

    /// The unit normal of a hit on the shape, facing the ray: a quad's faces the camera, and any
    /// other points back along the ray.
    pub fn normal(&self, direction: [f32; 3], camera: Option<&QueryCamera>) -> [f32; 3] {
        let back = direction.map(|v| -v);
        match (self, camera) {
            (RowShape::Quad { .. }, Some(camera)) => {
                let f = camera.forward;
                if dot32(f, direction) > 0.0 {
                    f.map(|v| -v)
                } else {
                    f
                }
            }
            _ => back,
        }
    }
}

#[inline(always)]
fn dot32(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline(always)]
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline(always)]
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

#[inline(always)]
fn wide(v: [f32; 3]) -> [f64; 3] {
    v.map(f64::from)
}

/// A row's position: its matrix's translation, relative to its cell.
#[inline(always)]
fn position(m: &Affine) -> [f64; 3] {
    [m[3], m[7], m[11]].map(f64::from)
}

/// The closest points of a ray and a segment, as three.js's `Ray.distanceSqToSegment` finds
/// them: the squared distance between them, the distance along the ray (never below 0), and
/// the place along the segment from its middle. `middle` and `half` give the segment, and the
/// ray's direction has unit length.
pub fn ray_segment(
    origin: [f64; 3],
    direction: [f64; 3],
    middle: [f64; 3],
    half: [f64; 3],
) -> (f64, f64, f64) {
    let extent = dot(half, half).sqrt();
    let along = if extent > 0.0 {
        half.map(|v| v / extent)
    } else {
        [0.0; 3]
    };
    let diff = sub(origin, middle);
    let a01 = -dot(direction, along);
    let b0 = dot(diff, direction);
    let b1 = -dot(diff, along);
    let det = (1.0 - a01 * a01).abs();
    let (s0, s1);
    if det > 0.0 {
        let r0 = a01 * b1 - b0;
        let r1 = a01 * b0 - b1;
        let ext_det = extent * det;
        if r0 >= 0.0 {
            if r1 >= -ext_det {
                if r1 <= ext_det {
                    s0 = r0 / det;
                    s1 = r1 / det;
                } else {
                    s1 = extent;
                    s0 = (-(a01 * s1 + b0)).max(0.0);
                }
            } else {
                s1 = -extent;
                s0 = (-(a01 * s1 + b0)).max(0.0);
            }
        } else if r1 <= -ext_det {
            s0 = (-(-a01 * extent + b0)).max(0.0);
            s1 = if s0 > 0.0 {
                -extent
            } else {
                (-b1).clamp(-extent, extent)
            };
        } else if r1 <= ext_det {
            s0 = 0.0;
            s1 = (-b1).clamp(-extent, extent);
        } else {
            s0 = (-(a01 * extent + b0)).max(0.0);
            s1 = if s0 > 0.0 {
                extent
            } else {
                (-b1).clamp(-extent, extent)
            };
        }
    } else {
        s1 = if a01 > 0.0 { -extent } else { extent };
        s0 = (-(a01 * s1 + b0)).max(0.0);
    }
    // The squared distance comes from the closest points themselves. three.js's sum of terms
    // cancels badly when the ray starts far from the segment, by more than a line is wide.
    let gap: [f64; 3] =
        std::array::from_fn(|k| origin[k] + s0 * direction[k] - middle[k] - s1 * along[k]);
    (dot(gap, gap), s0, s1)
}

/// The places `s` from 0 to 1 where `a + b × s` is 0 or more, narrowed into `range`; `None` when
/// none are left.
#[inline(always)]
fn at_least_zero(a: f64, b: f64, (lo, hi): (f64, f64)) -> Option<(f64, f64)> {
    let (lo, hi) = if b > 0.0 {
        (lo.max(-a / b), hi)
    } else if b < 0.0 {
        (lo, hi.min(-a / b))
    } else if a >= 0.0 {
        (lo, hi)
    } else {
        return None;
    };
    (lo <= hi).then_some((lo, hi))
}

/// The ray's distance to its hit on a row, within the ray's limits, or `None`. `m` is the row's
/// packed matrix, and the ray and `eye`, the camera's position, are in the row's cell's frame.
pub fn row_raycast(
    shape: &RowShape,
    m: &Affine,
    ray: &Ray,
    rows: &RowQuery,
    eye: [f64; 3],
) -> Option<f32> {
    let origin = wide(ray.origin);
    let direction = wide(ray.direction);
    let (t_min, t_max) = (f64::from(ray.t_min), f64::from(ray.t_max));
    let within = |t: f64| (t >= t_min && t <= t_max).then_some(t as f32);
    match *shape {
        RowShape::Near(threshold) => {
            let to = sub(position(m), origin);
            let t = dot(to, direction).max(0.0);
            let off = sub(to, direction.map(|v| v * t));
            let r = f64::from(threshold);
            if dot(off, off) <= r * r {
                within(t)
            } else {
                None
            }
        }
        RowShape::Segment { half_width, world } => {
            let middle = position(m);
            let half = [m[0], m[4], m[8]].map(f64::from);
            let (d2, t, _) = ray_segment(origin, direction, middle, half);
            let hit = if world {
                let r = f64::from(half_width);
                d2 <= r * r
            } else {
                let camera = rows.camera.as_ref()?;
                segment_on_screen(camera, eye, middle, half, ray, f64::from(half_width))
            };
            if hit { within(t) } else { None }
        }
        RowShape::Quad { quad, screen } => {
            let camera = rows.camera.as_ref()?;
            let anchor = position(m);
            let forward = wide(camera.forward);
            let across = dot(direction, forward);
            if across == 0.0 {
                return None;
            }
            let t = dot(sub(anchor, origin), forward) / across;
            within(t)?;
            let hit: [f64; 3] = std::array::from_fn(|k| origin[k] + t * direction[k]);
            let offset = sub(hit, anchor);
            let (mut x, mut y) = (
                dot(offset, wide(camera.right)),
                dot(offset, wide(camera.up)),
            );
            if screen {
                let depth = dot(sub(anchor, eye), forward);
                if !camera.sees(depth) {
                    return None;
                }
                let [px, py] = camera.pixel_at(depth);
                (x, y) = (x / px, y / py);
            }
            let rotation = f64::from(m[1] / SMALL);
            let (s, c) = rotation.sin_cos();
            let (w, h) = (f64::from(m[0]), f64::from(m[5]));
            let corner = [(c * x + s * y) / w, (c * y - s * x) / h];
            let inside = (0..2).all(|k| {
                corner[k] >= f64::from(quad.min[k]) && corner[k] <= f64::from(quad.max[k])
            });
            if inside {
                t.is_finite().then_some(t as f32)
            } else {
                None
            }
        }
    }
}

/// True when the ray passes within `half_width` CSS pixels of the segment on the screen: at the
/// depth of some point of the segment between the camera's near and far planes, the ray passes
/// that point within half the width in pixels at that depth. See the module documentation.
fn segment_on_screen(
    camera: &QueryCamera,
    eye: [f64; 3],
    middle: [f64; 3],
    half: [f64; 3],
    ray: &Ray,
    half_width: f64,
) -> bool {
    let origin = wide(ray.origin);
    let direction = wide(ray.direction);
    let forward = wide(camera.forward);
    let across = dot(direction, forward);
    if across == 0.0 {
        return false;
    }
    // The segment from `a` at s = 0 to `a + ab` at s = 1, its depth `z0 + z1 × s`, and the ray's
    // distance at each depth, `(z - oz) / across`.
    let a = sub(middle, half);
    let ab = half.map(|v| 2.0 * v);
    let z0 = dot(sub(a, eye), forward);
    let z1 = dot(ab, forward);
    let oz = dot(sub(origin, eye), forward);
    // From the ray's point at the same depth to the segment's point, across and up the view, in
    // pixels at a depth of 1: `m0 + m1 × s`.
    let t0 = (z0 - oz) / across;
    let t1 = z1 / across;
    let l0: [f64; 3] = std::array::from_fn(|k| a[k] - origin[k] - t0 * direction[k]);
    let l1: [f64; 3] = std::array::from_fn(|k| ab[k] - t1 * direction[k]);
    let (right, up) = (wide(camera.right), wide(camera.up));
    let [kx, ky] = camera.pixel.map(f64::from);
    let m0 = [dot(l0, right) / kx, dot(l0, up) / ky];
    let m1 = [dot(l1, right) / kx, dot(l1, up) / ky];
    // Half the width at the same scale: in pixels times the depth for a perspective camera.
    let (w0, w1) = if camera.perspective {
        (half_width * z0, half_width * z1)
    } else {
        (half_width, 0.0)
    };
    // The places along the segment that the camera draws, ahead of the ray's start.
    let range = at_least_zero(z0 - f64::from(camera.near), z1, (0.0, 1.0))
        .and_then(|r| at_least_zero(f64::from(camera.far) - z0, -z1, r))
        .and_then(|r| at_least_zero(t0 - f64::from(ray.t_min), t1, r));
    let Some((lo, hi)) = range else {
        return false;
    };
    // The squared offset less the squared half width, `qa × s² + qb × s + qc`, at its lowest.
    let qa = m1[0] * m1[0] + m1[1] * m1[1] - w1 * w1;
    let qb = 2.0 * (m0[0] * m1[0] + m0[1] * m1[1] - w0 * w1);
    let qc = m0[0] * m0[0] + m0[1] * m0[1] - w0 * w0;
    let g = |s: f64| (qa * s + qb) * s + qc;
    let mut lowest = g(lo).min(g(hi));
    if qa > 0.0 {
        let s = -qb / (2.0 * qa);
        if s > lo && s < hi {
            lowest = lowest.min(g(s));
        }
    }
    lowest <= 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sprites::{self, SpriteLook};

    /// A camera at `eye` looking down -z, with a CSS pixel of 0.01 at a depth of 1.
    fn camera(eye: [f64; 3], perspective: bool) -> QueryCamera {
        QueryCamera {
            eye,
            right: [1.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            forward: [0.0, 0.0, -1.0],
            perspective,
            pixel: [0.01, 0.01],
            near: 0.1,
            far: 1000.0,
        }
    }

    fn rows(camera: Option<QueryCamera>) -> RowQuery {
        RowQuery {
            camera,
            ..RowQuery::default()
        }
    }

    const QUAD: Aabb = Aabb {
        min: [-0.5, -0.5, 0.0],
        max: [0.5, 0.5, 0.0],
    };

    /// A ray from the eye toward `target`.
    fn ray_to(eye: [f64; 3], target: [f64; 3]) -> Ray {
        let d = sub(target, eye);
        let l = dot(d, d).sqrt();
        Ray::new(eye.map(|v| v as f32), d.map(|v| (v / l) as f32))
    }

    fn sprite(position: [f32; 3], size: [f32; 2], rotation: f32, screen: bool) -> Affine {
        let bits = SpriteLook::new(1, 1, screen).frame_bits(0);
        sprites::pack(position, size, rotation, [1.0; 4], bits)
    }

    #[test]
    fn rays_hit_a_sprite_where_its_quad_draws() {
        let eye = [0.0, 0.0, 10.0];
        let q = rows(Some(camera(eye, true)));
        let shape = RowShape::Quad {
            quad: QUAD,
            screen: false,
        };
        // A 2 × 1 sprite at the origin: its quad reaches 1 across and 0.5 up.
        let m = sprite([0.0; 3], [2.0, 1.0], 0.0, false);
        let cast = |x: f64, y: f64| row_raycast(&shape, &m, &ray_to(eye, [x, y, 0.0]), &q, eye);
        assert!((cast(0.9, 0.4).unwrap() - (10.0f32.hypot(0.9).hypot(0.4))).abs() < 1e-4);
        assert!(cast(1.1, 0.0).is_none());
        assert!(cast(0.0, 0.6).is_none());
        // Turned a quarter turn, counterclockwise: now 1 across and 2 up.
        let turned = sprite([0.0; 3], [2.0, 1.0], std::f32::consts::FRAC_PI_2, false);
        let cast =
            |x: f64, y: f64| row_raycast(&shape, &turned, &ray_to(eye, [x, y, 0.0]), &q, eye);
        assert!(cast(0.4, 0.9).is_some());
        assert!(cast(0.9, 0.4).is_none());
        // Without a camera, rays miss sprites.
        let m = sprite([0.0; 3], [2.0, 1.0], 0.0, false);
        assert!(row_raycast(&shape, &m, &ray_to(eye, [0.0; 3]), &rows(None), eye).is_none());
    }

    #[test]
    fn a_sprite_in_pixels_keeps_its_size_on_the_screen() {
        let eye = [0.0, 0.0, 0.0];
        let q = rows(Some(camera(eye, true)));
        let shape = RowShape::Quad {
            quad: QUAD,
            screen: true,
        };
        // 20 pixels wide: half of it, 10 pixels of 0.01 each at a depth of 1, spans 0.1 × depth.
        for depth in [1.0, 10.0, 300.0] {
            let m = sprite([0.0, 0.0, -depth as f32], [20.0, 20.0], 0.0, true);
            let cast = |x: f64| row_raycast(&shape, &m, &ray_to(eye, [x, 0.0, -depth]), &q, eye);
            assert!(cast(0.099 * depth).is_some(), "{depth}");
            assert!(cast(0.101 * depth).is_none(), "{depth}");
        }
        // Past the far plane, nothing draws.
        let m = sprite([0.0, 0.0, -2000.0], [20.0, 20.0], 0.0, true);
        assert!(row_raycast(&shape, &m, &ray_to(eye, [0.0, 0.0, -2000.0]), &q, eye).is_none());
    }

    #[test]
    fn a_threshold_reaches_a_point_whatever_its_size() {
        let shape = RowShape::Near(0.5);
        let m = sprite([0.0, 0.0, -5.0], [0.01, 0.01], 0.0, false);
        let q = RowQuery::default();
        let ray = |x: f32| Ray::new([x, 0.0, 0.0], [0.0, 0.0, -1.0]);
        // three.js's hit is the ray's closest point, at its distance along the ray.
        assert_eq!(row_raycast(&shape, &m, &ray(0.49), &q, [0.0; 3]), Some(5.0));
        assert!(row_raycast(&shape, &m, &ray(0.51), &q, [0.0; 3]).is_none());
        // A point behind the ray's start counts from the start, as three.js counts it.
        let behind = Ray::new([0.0, 0.0, -5.3], [0.0, 0.0, -1.0]);
        assert_eq!(row_raycast(&shape, &m, &behind, &q, [0.0; 3]), Some(0.0));
        assert!(row_raycast(&shape, &m, &ray(0.0).with_max(4.0), &q, [0.0; 3]).is_none());
    }

    /// A packed segment from `a` to `b`.
    fn segment(a: [f32; 3], b: [f32; 3]) -> Affine {
        let mut m = [0.0; 12];
        for k in 0..3 {
            m[k * 4] = (b[k] - a[k]) * 0.5;
            m[k * 4 + 3] = (a[k] + b[k]) * 0.5;
        }
        m
    }

    #[test]
    fn a_segment_in_world_units_is_hit_within_half_its_width() {
        let shape = RowShape::Segment {
            half_width: 0.25,
            world: true,
        };
        let m = segment([-1.0, 0.0, -4.0], [1.0, 0.0, -4.0]);
        let q = RowQuery::default();
        let ray = |y: f32, x: f32| Ray::new([x, y, 0.0], [0.0, 0.0, -1.0]);
        assert_eq!(
            row_raycast(&shape, &m, &ray(0.24, 0.0), &q, [0.0; 3]),
            Some(4.0)
        );
        assert!(row_raycast(&shape, &m, &ray(0.26, 0.0), &q, [0.0; 3]).is_none());
        // Round ends: past the end, within half the width of it.
        assert!(row_raycast(&shape, &m, &ray(0.0, 1.2), &q, [0.0; 3]).is_some());
        assert!(row_raycast(&shape, &m, &ray(0.2, 1.2), &q, [0.0; 3]).is_none());
    }

    #[test]
    fn a_segment_in_pixels_matches_the_screen_test_for_rays_from_the_camera() {
        // A segment that runs away from the camera, which three.js tests on the screen.
        let eye = [0.0, 0.0, 0.0];
        let cam = camera(eye, true);
        let q = rows(Some(cam));
        let half_width = 4.0;
        let shape = RowShape::Segment {
            half_width,
            world: false,
        };
        let (a, b) = ([-1.0f32, -0.5, -2.0], [2.0f32, 1.0, -30.0]);
        let m = segment(a, b);
        // Each screen point at a depth of 1, in pixels, against the projected segment.
        let project = |p: [f32; 3]| [p[0] / -p[2] / 0.01, p[1] / -p[2] / 0.01];
        let (pa, pb) = (project(a).map(f64::from), project(b).map(f64::from));
        let mut state = 9u32;
        let mut random = || {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            f64::from(state >> 8) / f64::from(1u32 << 24)
        };
        let (mut hits, mut checked) = (0, 0);
        for _ in 0..4000 {
            let screen = [random() * 120.0 - 60.0, random() * 80.0 - 40.0];
            let ab = [pb[0] - pa[0], pb[1] - pa[1]];
            let ap = [screen[0] - pa[0], screen[1] - pa[1]];
            let s =
                ((ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])).clamp(0.0, 1.0);
            let off = (ap[0] - s * ab[0]).hypot(ap[1] - s * ab[1]);
            // Rounding decides the screen points right at the edge.
            if (off - f64::from(half_width)).abs() < 1e-6 {
                continue;
            }
            checked += 1;
            let target = [screen[0] * 0.01, screen[1] * 0.01, -1.0];
            let got = row_raycast(&shape, &m, &ray_to(eye, target), &q, eye).is_some();
            assert_eq!(got, off < f64::from(half_width), "{screen:?} at {off}");
            hits += u32::from(got);
        }
        assert!(hits > 50 && checked > 3900, "{hits} of {checked}");
    }

    #[test]
    fn a_segment_in_pixels_on_an_orthographic_camera_keeps_its_width() {
        let eye = [0.0, 0.0, 0.0];
        let q = rows(Some(camera(eye, false)));
        let shape = RowShape::Segment {
            half_width: 5.0,
            world: false,
        };
        // Half the width is 5 pixels of 0.01: 0.05 at every depth.
        for depth in [2.0f32, 200.0] {
            let m = segment([-1.0, 0.0, -depth], [1.0, 0.0, -depth]);
            let ray = |y: f32| Ray::new([0.0, y, 0.0], [0.0, 0.0, -1.0]);
            assert!(row_raycast(&shape, &m, &ray(0.049), &q, eye).is_some());
            assert!(row_raycast(&shape, &m, &ray(0.051), &q, eye).is_none());
        }
    }

    #[test]
    fn rays_through_a_segment_point_back_at_their_own_start() {
        // Closest points as three.js finds them, for a ray that crosses a segment.
        let (d2, t, s) = ray_segment(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.0, 0.0, -3.0],
            [1.0, 0.0, 0.0],
        );
        assert_eq!((d2, t, s), (0.0, 3.0, 0.0));
        // A segment behind the ray's start: the start is the ray's closest point.
        let (d2, t, _) = ray_segment(
            [0.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            [0.0, 1.0, 2.0],
            [0.0, 0.0, 1.0],
        );
        assert_eq!(t, 0.0);
        assert!((d2 - 2.0).abs() < 1e-12);
        // A segment of no length is its one point.
        let (d2, t, _) = ray_segment([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [5.0, 2.0, 0.0], [0.0; 3]);
        assert_eq!((d2, t), (4.0, 5.0));
        let shape = RowShape::Segment {
            half_width: 1.0,
            world: true,
        };
        let normal = shape.normal([0.0, 0.0, -1.0], None);
        assert_eq!(normal, [-0.0, -0.0, 1.0]);
    }
}
