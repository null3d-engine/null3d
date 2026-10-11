//! Planar reflections: a view that draws the camera's view mirrored across a plane, as water and
//! polished floors show it.
//!
//! A mirror view draws from the camera's own place, and keeps positions relative to the camera, so
//! the sun's shadows, the cascade that each surface reads and the fog work as in the camera's
//! view. Its view matrix is the camera's, after the reflection across the plane, with x turned
//! around. The reflection alone would reverse every triangle's winding. Turning x around reverses
//! it back, so materials draw with their own pipelines. The image comes out mirrored across x, and
//! a material reads it at the mirrored place on the screen (`null3d::reflection`).
//!
//! The projection's near plane is the mirror's plane, as Eric Lengyel's oblique near-plane clipping
//! makes it. The GPU clips everything below the plane, which the mirror must not show, at no cost
//! in any shader, and the view's culling frustum, which comes from the same matrix, leaves those
//! objects out. The far plane tilts to pass through the far corner of the view that lies farthest
//! along the plane's normal, so it clips nothing that the camera's own far plane keeps.
//!
//! A camera that stands on the plane or behind it sees no reflection, and the view draws nothing.

use null3d_core::scene::SceneStorage;

use crate::camera::{Affine, Lens, Mat4, ViewDepth, invert, multiply, view_matrix};
use crate::view::CameraTransform;

/// The plane that a mirror view reflects the scene across, in the world.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mirror {
    /// The plane's normal, of length 1, toward the side that the mirror shows.
    pub normal: [f32; 3],
    /// A point on the plane, from the world's origin.
    pub point: [f64; 3],
}

impl Mirror {
    /// The plane through `point` facing `normal`, or `None` for a normal without length.
    pub fn new(normal: [f32; 3], point: [f64; 3]) -> Option<Self> {
        let length = normal.iter().map(|v| v * v).sum::<f32>().sqrt();
        (length > 0.0 && length.is_finite()).then(|| Self {
            normal: normal.map(|v| v / length),
            point,
        })
    }

    /// The plane as `(n, d)`, with `n · p + d = 0` for a position `p` relative to a camera at
    /// `camera` from the world's origin. `d` is the camera's height above the plane, positive on
    /// the side that the mirror shows.
    pub fn relative_to(&self, camera: [f64; 3]) -> [f32; 4] {
        let [x, y, z] = self.normal;
        let height: f64 = (0..3)
            .map(|k| f64::from(self.normal[k]) * (camera[k] - self.point[k]))
            .sum();
        [x, y, z, height as f32]
    }

    /// Where the camera's view, drawn mirrored across the plane, stands and how it sees, for a
    /// camera with world transform `world` at `camera` from the world's origin, through `lens`
    /// onto a target of `aspect`. `None` when the camera stands on the plane or behind it, or when
    /// nothing of the view lies in front of the plane.
    pub fn view(
        &self,
        world: &Affine,
        camera: [f64; 3],
        lens: &Lens,
        aspect: f32,
    ) -> Option<MirrorView> {
        let plane = self.relative_to(camera);
        if plane[3] <= 0.0 {
            return None;
        }
        let mut at_origin = *world;
        (at_origin[3], at_origin[7], at_origin[11]) = (0.0, 0.0, 0.0);
        let view = mirrored_view(&view_matrix(&at_origin), plane);
        let seen = plane_through(&view, plane)?;
        let projection = oblique_near(&lens.projection(aspect), seen)?;
        let (near, far, perspective) = match lens {
            Lens::Perspective(lens) => (lens.near, lens.far, true),
            Lens::Orthographic(lens) => (lens.near, lens.far, false),
        };
        let eye = match lens {
            Lens::Perspective(_) => reflect_point([0.0; 3], plane),
            Lens::Orthographic(_) => reflect_direction(back_axis(world), plane),
        };
        Some(MirrorView {
            view_proj: multiply(&projection, &view),
            eye,
            depth: ViewDepth {
                row: [-view[2], -view[6], -view[10], -view[14]],
                near,
                far,
                perspective,
            },
        })
    }

    /// The mirror view of a scene's camera, as [`crate::view::View::transform`] gives a camera's
    /// own: the camera object `camera` through `lens`, in the world output of `parity`.
    pub(crate) fn transform(
        &self,
        scene: &SceneStorage,
        parity: usize,
        camera: null3d_core::handle::Handle,
        lens: &Lens,
        aspect: f32,
    ) -> Option<CameraTransform> {
        let slot = scene.resolve(camera).ok()?;
        let world: Affine = *scene.world(parity).matrix(slot as usize);
        let cell = scene.cell_position(slot, parity);
        let mirrored = self.view(&world, cell.absolute(), lens, aspect)?;
        Some(CameraTransform {
            view_proj: mirrored.view_proj,
            eye: mirrored.eye,
            cell,
            depth: mirrored.depth,
        })
    }
}

/// A mirror view in one frame, for positions relative to the camera.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MirrorView {
    /// The view-projection matrix, with the plane as its near plane.
    pub view_proj: Mat4,
    /// Where the mirrored camera stands, as [`Lens::eye`] gives a camera's place: the camera's
    /// reflection for a perspective camera, and the reflection of its backward direction, at
    /// infinity, for an orthographic camera.
    pub eye: [f32; 4],
    /// How far positions lie along the mirrored view.
    pub depth: ViewDepth,
}

/// The reflection across the plane `(n, d)`, `n · p + d = 0` with `n` of length 1, as a
/// column-major matrix.
pub fn reflection(plane: [f32; 4]) -> Mat4 {
    let [x, y, z, d] = plane;
    let n = [x, y, z];
    let mut m = [0.0; 16];
    for column in 0..3 {
        for row in 0..3 {
            let identity = if row == column { 1.0 } else { 0.0 };
            m[column * 4 + row] = identity - 2.0 * n[row] * n[column];
        }
    }
    for row in 0..3 {
        m[12 + row] = -2.0 * d * n[row];
    }
    m[15] = 1.0;
    m
}

/// The view matrix `view` of a camera, after the reflection across `plane`, with x turned around:
/// the matrix keeps each triangle's winding, and draws the reflection mirrored across x.
pub fn mirrored_view(view: &Mat4, plane: [f32; 4]) -> Mat4 {
    let mut m = multiply(view, &reflection(plane));
    for column in 0..4 {
        m[column * 4] = -m[column * 4];
    }
    m
}

/// The plane `plane`, given for positions before `matrix`, for positions after it: `None` when
/// `matrix` has no inverse.
fn plane_through(matrix: &Mat4, plane: [f32; 4]) -> Option<[f32; 4]> {
    let inverse = invert(matrix)?;
    Some(row_times(plane, &inverse))
}

/// The row vector `v` times the column-major matrix `m`.
fn row_times(v: [f32; 4], m: &Mat4) -> [f32; 4] {
    std::array::from_fn(|column| {
        (0..4)
            .map(|row| f64::from(v[row]) * f64::from(m[column * 4 + row]))
            .sum::<f64>() as f32
    })
}

/// The dot product of two 4-vectors, in 64-bit floats.
fn dot4(a: [f32; 4], b: [f32; 4]) -> f64 {
    (0..4).map(|k| f64::from(a[k]) * f64::from(b[k])).sum()
}

/// The projection `projection`, with reversed depth, whose near plane is `plane` in view space:
/// positions with `plane · (x, y, z, 1)` below 0 fall behind the near plane, and the GPU clips
/// them. The far plane passes through the corner of the far plane that lies farthest along the
/// plane's normal. `None` when no part of the view lies in front of the plane.
pub fn oblique_near(projection: &Mat4, plane: [f32; 4]) -> Option<Mat4> {
    let inverse = invert(projection)?;
    let clip_plane = row_times(plane, &inverse);
    // The far plane's corner in clip space, on the side of the plane's normal, and in view space.
    // With reversed depth, the far plane has depth 0.
    let corner_clip = [clip_plane[0].signum(), clip_plane[1].signum(), 0.0, 1.0];
    let corner: [f32; 4] = std::array::from_fn(|row| {
        (0..4)
            .map(|k| f64::from(inverse[k * 4 + row]) * f64::from(corner_clip[k]))
            .sum::<f64>() as f32
    });
    let w_row = [projection[3], projection[7], projection[11], projection[15]];
    let along = dot4(plane, corner);
    if along <= 0.0 {
        return None;
    }
    // Depth is w less the plane's value times a scale: 1 on the plane, which becomes the near
    // plane, and 0 at the corner, on the far plane.
    let scale = dot4(w_row, corner) / along;
    let mut out = *projection;
    for column in 0..4 {
        out[column * 4 + 2] = (f64::from(w_row[column]) - scale * f64::from(plane[column])) as f32;
    }
    Some(out)
}

/// The reflection of the point `p` across `plane`, as a homogeneous point.
fn reflect_point(p: [f32; 3], plane: [f32; 4]) -> [f32; 4] {
    let [x, y, z, d] = plane;
    let along = x * p[0] + y * p[1] + z * p[2] + d;
    [
        p[0] - 2.0 * along * x,
        p[1] - 2.0 * along * y,
        p[2] - 2.0 * along * z,
        1.0,
    ]
}

/// The reflection of the direction `v` across `plane`, as a homogeneous point at infinity.
fn reflect_direction(v: [f32; 3], plane: [f32; 4]) -> [f32; 4] {
    let [x, y, z, _] = plane;
    let along = x * v[0] + y * v[1] + z * v[2];
    [
        v[0] - 2.0 * along * x,
        v[1] - 2.0 * along * y,
        v[2] - 2.0 * along * z,
        0.0,
    ]
}

/// The unit direction of a camera's +Z axis, from the scene toward the camera, or +Z when the axis
/// has no length.
fn back_axis(world: &Affine) -> [f32; 3] {
    let back = [world[2], world[6], world[10]];
    let length = back.iter().map(|v| v * v).sum::<f32>().sqrt();
    if length > 0.0 {
        back.map(|v| v / length)
    } else {
        [0.0, 0.0, 1.0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::{Orthographic, Perspective};
    use null3d_core::culling::Frustum;

    fn transform(m: &Mat4, p: [f32; 3]) -> [f32; 4] {
        std::array::from_fn(|row| {
            m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]
        })
    }

    /// A camera turned `pitch` radians about x (negative looks down), then `yaw` about y.
    fn turned(yaw: f32, pitch: f32) -> Affine {
        let (sy, cy) = yaw.sin_cos();
        let (sp, cp) = pitch.sin_cos();
        // Rows of Ry * Rx.
        [
            cy,
            sy * sp,
            sy * cp,
            0.0,
            0.0,
            cp,
            -sp,
            0.0,
            -sy,
            cy * sp,
            cy * cp,
            0.0,
        ]
    }

    fn perspective() -> Lens {
        Lens::Perspective(Perspective {
            fov_degrees: 60.0,
            near: 0.1,
            far: 200.0,
        })
    }

    fn orthographic() -> Lens {
        Lens::Orthographic(Orthographic {
            height: 10.0,
            width: None,
            center: [0.0, 0.0],
            near: 0.1,
            far: 100.0,
        })
    }

    /// The water at height 0, seen by a camera 2 units above it at (3, 2, 5).
    fn water() -> (Mirror, [f64; 3]) {
        let mirror = Mirror::new([0.0, 2.0, 0.0], [10.0, 0.0, -4.0]).unwrap();
        (mirror, [3.0, 2.0, 5.0])
    }

    fn determinant3(m: &Mat4) -> f32 {
        let a = |row: usize, column: usize| m[column * 4 + row];
        a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
            - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
            + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0))
    }

    #[test]
    fn the_plane_is_relative_to_the_camera_and_its_constant_is_the_camera_height() {
        let (mirror, camera) = water();
        assert_eq!(
            mirror.normal,
            [0.0, 1.0, 0.0],
            "the normal is made unit length"
        );
        assert_eq!(mirror.relative_to(camera), [0.0, 1.0, 0.0, 2.0]);
        assert_eq!(Mirror::new([0.0; 3], [0.0; 3]), None);
        // Far from the origin, the height keeps its digits.
        let far = Mirror::new([0.0, 1.0, 0.0], [1e7, 100.25, -3e6]).unwrap();
        assert_eq!(far.relative_to([1e7 + 4.0, 101.5, -3e6])[3], 1.25);
    }

    #[test]
    fn the_reflection_mirrors_points_across_the_plane_and_twice_is_the_identity() {
        let plane = [0.0, 1.0, 0.0, 2.0];
        let r = reflection(plane);
        assert_eq!(transform(&r, [1.0, 0.0, 3.0]), [1.0, -4.0, 3.0, 1.0]);
        assert_eq!(
            transform(&r, [1.0, -2.0, 3.0]),
            [1.0, -2.0, 3.0, 1.0],
            "the plane stays"
        );
        let twice = multiply(&r, &r);
        for (k, value) in twice.iter().enumerate() {
            let identity = if k % 5 == 0 { 1.0 } else { 0.0 };
            assert!((value - identity).abs() < 1e-6);
        }
        let tilted = Mirror::new([1.0, 1.0, 0.0], [0.0; 3])
            .unwrap()
            .relative_to([0.0; 3]);
        let p = transform(&reflection(tilted), [1.0, 0.0, 0.0]);
        assert!((p[0] - 0.0).abs() < 1e-6 && (p[1] + 1.0).abs() < 1e-6);
    }

    #[test]
    fn the_mirrored_view_keeps_winding_and_sees_a_reflected_point_where_the_camera_sees_it_mirrored()
     {
        let (mirror, camera) = water();
        let world = turned(0.4, -0.3);
        let plane = mirror.relative_to(camera);
        let mut at_origin = world;
        (at_origin[3], at_origin[7], at_origin[11]) = (0.0, 0.0, 0.0);
        let view = view_matrix(&at_origin);
        let mirrored = mirrored_view(&view, plane);
        assert!(
            determinant3(&mirrored) > 0.0,
            "the reflection and the turn of x keep each triangle's winding"
        );
        let projection = perspective().projection(1.5);
        let main = multiply(&projection, &view);
        let reflected = multiply(&projection, &mirrored);
        for p in [[0.5, -1.0, -6.0], [-2.0, 3.0, -9.0], [4.0, 0.5, -20.0]] {
            let r = transform(&reflection(plane), p);
            let seen = transform(&main, p);
            let mirror_seen = transform(&reflected, [r[0], r[1], r[2]]);
            let close = |a: f32, b: f32| (a - b).abs() < 1e-4 * (1.0 + a.abs());
            assert!(close(mirror_seen[0], -seen[0]), "x turns around: {p:?}");
            assert!(
                close(mirror_seen[1], seen[1]) && close(mirror_seen[3], seen[3]),
                "{p:?}"
            );
        }
    }

    #[test]
    fn the_oblique_near_plane_clips_what_lies_below_the_plane_and_keeps_what_lies_above() {
        let (mirror, camera) = water();
        for (lens, world) in [
            (perspective(), turned(0.4, -0.3)),
            (perspective(), turned(-1.2, 0.2)),
            (orthographic(), turned(0.9, -0.6)),
        ] {
            let mirrored = mirror.view(&world, camera, &lens, 1.5).unwrap();
            let m = mirrored.view_proj;
            let frustum = Frustum::from_view_projection(&m);
            let mut kept = 0;
            // Points around the camera on both sides of the water, which lies 2 units below it.
            for x in [-12.0f32, -3.0, 0.0, 4.0, 15.0] {
                for y in [-6.0f32, -2.5, -2.01, -1.99, 0.0, 3.0, 9.0] {
                    for z in [-40.0f32, -12.0, -3.0, 2.0, 8.0] {
                        let clip = transform(&m, [x, y, z]);
                        let height = y + 2.0;
                        let inside = clip[3] > 0.0
                            && clip[0].abs() <= clip[3]
                            && clip[1].abs() <= clip[3]
                            && clip[2] >= 0.0
                            && clip[2] <= clip[3];
                        if height < 0.0 {
                            assert!(!inside, "below the water: {x} {y} {z} {clip:?}");
                            assert!(
                                !frustum.contains_sphere(x, y, z, 0.0),
                                "the frustum culls below the water: {x} {y} {z}"
                            );
                        }
                        if inside {
                            kept += 1;
                        }
                    }
                }
            }
            assert!(kept > 0, "the view still sees what stands above the water");
        }
    }

    #[test]
    fn the_far_plane_keeps_what_the_mirrored_camera_sees_in_front_of_the_plane() {
        let (mirror, camera) = water();
        let world = turned(0.4, -0.3);
        let lens = perspective();
        let mirrored = mirror.view(&world, camera, &lens, 1.5).unwrap();
        // The plain mirrored view, with the camera's own near and far planes.
        let plane = mirror.relative_to(camera);
        let mut at_origin = world;
        (at_origin[3], at_origin[7], at_origin[11]) = (0.0, 0.0, 0.0);
        let plain = multiply(
            &lens.projection(1.5),
            &mirrored_view(&view_matrix(&at_origin), plane),
        );
        for x in [-30.0f32, -5.0, 0.0, 6.0, 40.0] {
            for y in [-1.9f32, 0.0, 5.0, 30.0] {
                for z in [-150.0f32, -60.0, -10.0, 5.0, 60.0] {
                    let p = [x, y, z];
                    let before = transform(&plain, p);
                    let seen = before[3] > 0.0
                        && before[0].abs() <= before[3]
                        && before[1].abs() <= before[3]
                        && before[2] >= 0.0
                        && before[2] <= before[3];
                    if !seen || y + 2.0 <= 0.0 {
                        continue;
                    }
                    let after = transform(&mirrored.view_proj, p);
                    assert!(
                        after[2] >= -1e-4 * after[3] && after[2] <= after[3] * (1.0 + 1e-4),
                        "kept: {p:?} {after:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn the_mirrored_eye_and_depth_follow_the_reflection() {
        let (mirror, camera) = water();
        let world = turned(0.0, -0.3);
        let mirrored = mirror.view(&world, camera, &perspective(), 1.0).unwrap();
        assert_eq!(
            mirrored.eye,
            [0.0, -4.0, 0.0, 1.0],
            "the eye 2 units below the water"
        );
        // A point on the water straight ahead of the mirrored camera lies along its view.
        let ahead = [0.0, -2.0, -2.0 / 0.3f32.tan()];
        let along: f32 = (0..3)
            .map(|k| mirrored.depth.row[k] * ahead[k])
            .sum::<f32>()
            + mirrored.depth.row[3];
        // The point lies on the view's axis, so its depth is its distance from the eye.
        let expected = ((ahead[1] + 4.0).powi(2) + ahead[2] * ahead[2]).sqrt();
        assert!((along - expected).abs() < 1e-3, "{along} {expected}");
        let ortho = mirror
            .view(&turned(0.0, -0.5), camera, &orthographic(), 1.0)
            .unwrap();
        assert_eq!(
            ortho.eye[3], 0.0,
            "an orthographic camera stays at infinity"
        );
        assert!(
            ortho.eye[1] < 0.0,
            "behind the mirrored camera lies below the water"
        );
    }

    #[test]
    fn a_camera_on_or_below_the_plane_sees_no_reflection() {
        let (mirror, _) = water();
        let world = turned(0.0, 0.2);
        for camera in [[3.0, 0.0, 5.0], [3.0, -1.0, 5.0]] {
            assert_eq!(mirror.view(&world, camera, &perspective(), 1.0), None);
        }
    }

    #[test]
    fn a_view_with_nothing_in_front_of_the_plane_draws_nothing() {
        let (mirror, camera) = water();
        // The camera looks straight up, so its mirror looks straight down, away from the water.
        let up = turned(0.0, std::f32::consts::FRAC_PI_2);
        assert_eq!(mirror.view(&up, camera, &perspective(), 1.0), None);
    }
}
