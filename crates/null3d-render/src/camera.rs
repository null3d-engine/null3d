//! Cameras: perspective and orthographic lenses with reversed depth, and the view matrix of a
//! camera's world transform. Matrices here are 4 × 4 and column-major, the layout WGSL's `mat4x4f`
//! reads. World transforms are the engine's 3 × 4 row-major affine matrices.
//!
//! Both lenses project into WebGPU's clip space with reversed depth: depth is 1 at the near plane
//! and 0 at the far plane. The WebGL2 backend maps that depth into its own depth mode in every
//! vertex shader, so each lens draws in every mode unchanged.

/// A 3 × 4 row-major affine matrix, the engine's world transform.
pub type Affine = [f32; 12];

/// A 4 × 4 column-major matrix.
pub type Mat4 = [f32; 16];

/// A perspective camera's lens. The aspect ratio comes from the render target each frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Perspective {
    /// Vertical field of view in degrees, as three.js's `PerspectiveCamera.fov`.
    pub fov_degrees: f32,
    pub near: f32,
    pub far: f32,
}

/// An orthographic camera's lens: a box-shaped view, in which an object keeps its size at every
/// distance. The view is `height` tall and `width` wide, around a center on the camera's view
/// plane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Orthographic {
    /// The view's height, in world units.
    pub height: f32,
    /// The view's width in world units, or `None` for a width that follows the render target's
    /// aspect ratio.
    pub width: Option<f32>,
    /// The view's center, right of and above the camera's axis, in world units.
    pub center: [f32; 2],
    /// The distances along the view to the near and far planes. The near plane may lie behind the
    /// camera, since an orthographic view has no vanishing point.
    pub near: f32,
    pub far: f32,
}

/// How a camera projects the scene onto its target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lens {
    Perspective(Perspective),
    Orthographic(Orthographic),
}

impl From<Perspective> for Lens {
    fn from(lens: Perspective) -> Self {
        Lens::Perspective(lens)
    }
}

impl From<Orthographic> for Lens {
    fn from(lens: Orthographic) -> Self {
        Lens::Orthographic(lens)
    }
}

/// How far positions lie along a camera's view, in the units of the view, which the camera's scale
/// scales.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewDepth {
    /// The row that gives a position's distance in front of the camera along its view: the dot
    /// product of the row with `(x, y, z, 1)`, for a position relative to the camera.
    pub row: [f32; 4],
    /// The distance of the near plane. An orthographic lens's near plane may lie behind the
    /// camera, at a distance below 0.
    pub near: f32,
    /// The distance of the far plane.
    pub far: f32,
    /// True for a perspective lens, whose view starts at the camera.
    pub perspective: bool,
}

/// A world transform moved to the origin: the camera's rotation and scale alone.
fn at_origin(world: &Affine) -> Affine {
    let mut moved = *world;
    (moved[3], moved[7], moved[11]) = (0.0, 0.0, 0.0);
    moved
}

/// A perspective projection into WebGPU's clip space with reversed depth: depth is 1 at the near
/// plane and 0 at the far plane, which spreads floating-point precision evenly over distance.
pub fn perspective_reversed(fov_y_radians: f32, aspect: f32, near: f32, far: f32) -> Mat4 {
    let f = 1.0 / (fov_y_radians / 2.0).tan();
    let mut m = [0.0; 16];
    m[0] = f / aspect;
    m[5] = f;
    m[10] = near / (far - near);
    m[11] = -1.0;
    m[14] = near * far / (far - near);
    m
}

/// An orthographic projection into WebGPU's clip space with reversed depth. It maps `left` to
/// `right` and `bottom` to `top` onto -1 to 1, and depth from 1 at the near plane to 0 at the far
/// plane, in proportion to distance.
pub fn orthographic_reversed(
    left: f32,
    right: f32,
    bottom: f32,
    top: f32,
    near: f32,
    far: f32,
) -> Mat4 {
    let mut m = [0.0; 16];
    m[0] = 2.0 / (right - left);
    m[5] = 2.0 / (top - bottom);
    m[10] = 1.0 / (far - near);
    m[12] = -(right + left) / (right - left);
    m[13] = -(top + bottom) / (top - bottom);
    m[14] = far / (far - near);
    m[15] = 1.0;
    m
}

/// The inverse of an affine world transform as a 4 × 4 column-major matrix: the view matrix of a
/// camera with that world transform.
pub fn view_matrix(world: &Affine) -> Mat4 {
    let [a, b, c, tx, d, e, f, ty, g, h, i, tz] = *world;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    let inv = 1.0 / det;
    // The inverse of the 3 × 3 part, row-major.
    let r = [
        (e * i - f * h) * inv,
        (c * h - b * i) * inv,
        (b * f - c * e) * inv,
        (f * g - d * i) * inv,
        (a * i - c * g) * inv,
        (c * d - a * f) * inv,
        (d * h - e * g) * inv,
        (b * g - a * h) * inv,
        (a * e - b * d) * inv,
    ];
    let t = [
        -(r[0] * tx + r[1] * ty + r[2] * tz),
        -(r[3] * tx + r[4] * ty + r[5] * tz),
        -(r[6] * tx + r[7] * ty + r[8] * tz),
    ];
    [
        r[0], r[3], r[6], 0.0, //
        r[1], r[4], r[7], 0.0, //
        r[2], r[5], r[8], 0.0, //
        t[0], t[1], t[2], 1.0,
    ]
}

/// The product `a × b` of two column-major matrices: `b` applied first.
pub fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0; 16];
    for column in 0..4 {
        for row in 0..4 {
            out[column * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[column * 4 + k]).sum();
        }
    }
    out
}

impl Perspective {
    /// The projection matrix for a target of `aspect`, its width over its height.
    pub fn projection(&self, aspect: f32) -> Mat4 {
        perspective_reversed(self.fov_degrees.to_radians(), aspect, self.near, self.far)
    }
}

impl Orthographic {
    /// The projection matrix for a target of `aspect`, its width over its height, which sets the
    /// view's width when the width follows the target.
    pub fn projection(&self, aspect: f32) -> Mat4 {
        let half_height = self.height / 2.0;
        let half_width = self.width.unwrap_or(self.height * aspect) / 2.0;
        let [x, y] = self.center;
        orthographic_reversed(
            x - half_width,
            x + half_width,
            y - half_height,
            y + half_height,
            self.near,
            self.far,
        )
    }
}

impl Lens {
    /// The projection matrix for a target of `aspect`, its width over its height.
    pub fn projection(&self, aspect: f32) -> Mat4 {
        match self {
            Lens::Perspective(lens) => lens.projection(aspect),
            Lens::Orthographic(lens) => lens.projection(aspect),
        }
    }

    /// The view-projection matrix of this lens on a camera with the given world transform.
    pub fn view_projection(&self, world: &Affine, aspect: f32) -> Mat4 {
        multiply(&self.projection(aspect), &view_matrix(world))
    }

    /// The view-projection matrix for positions relative to the camera: the camera's rotation and
    /// scale from its world transform, with the camera itself at the origin.
    pub fn relative_view_projection(&self, world: &Affine, aspect: f32) -> Mat4 {
        self.view_projection(&at_origin(world), aspect)
    }

    /// How far positions relative to a camera with the given world transform lie along its view,
    /// and where the lens's near and far planes lie.
    pub fn depth(&self, world: &Affine) -> ViewDepth {
        // The view's z is the third row of the view matrix, and the view looks down -z.
        let v = view_matrix(&at_origin(world));
        let row = [-v[2], -v[6], -v[10], -v[14]];
        let (near, far, perspective) = match self {
            Lens::Perspective(lens) => (lens.near, lens.far, true),
            Lens::Orthographic(lens) => (lens.near, lens.far, false),
        };
        ViewDepth {
            row,
            near,
            far,
            perspective,
        }
    }

    /// Where the camera is for positions relative to it, as a homogeneous point `(x, y, z, w)`.
    /// A perspective camera sits at the origin, `(0, 0, 0, 1)`. An orthographic camera's view rays
    /// are parallel, so its point lies at infinity behind it: `w` is 0, and `(x, y, z)` is the
    /// unit direction of its +Z axis, from the scene toward the camera. For either kind, the
    /// direction from a position `p` toward the camera is `(x, y, z) - p × w`, normalized.
    pub fn eye(&self, world: &Affine) -> [f32; 4] {
        match self {
            Lens::Perspective(_) => [0.0, 0.0, 0.0, 1.0],
            Lens::Orthographic(_) => {
                let [x, y, z] = back_axis(world);
                [x, y, z, 0.0]
            }
        }
    }
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

/// The unit direction a camera looks along, its -Z axis, for either lens. A point's depth in the
/// view is its offset from the camera along it, as three.js's fog measures depth.
pub fn view_direction(world: &Affine) -> [f32; 3] {
    back_axis(world).map(|v| -v)
}

#[cfg(test)]
mod tests {
    use null3d_core::culling::Frustum;

    use super::*;

    fn transform(m: &Mat4, p: [f32; 3]) -> [f32; 4] {
        let mut out = [0.0; 4];
        for (row, value) in out.iter_mut().enumerate() {
            *value = m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row];
        }
        out
    }

    fn assert_close(actual: &[f32], expected: &[f32], tolerance: f32) {
        assert_eq!(actual.len(), expected.len());
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() <= tolerance, "{actual:?} != {expected:?}");
        }
    }

    /// A camera at `position` that looks down -Z with no turn.
    fn at(position: [f32; 3]) -> Affine {
        let [x, y, z] = position;
        [1.0, 0.0, 0.0, x, 0.0, 1.0, 0.0, y, 0.0, 0.0, 1.0, z]
    }

    fn ortho(height: f32, width: Option<f32>, center: [f32; 2]) -> Lens {
        Lens::Orthographic(Orthographic {
            height,
            width,
            center,
            near: 1.0,
            far: 10.0,
        })
    }

    #[test]
    fn reversed_depth_puts_the_near_plane_at_one_and_the_far_plane_at_zero() {
        let m = perspective_reversed(1.0, 16.0 / 9.0, 0.1, 1000.0);
        let near = transform(&m, [0.0, 0.0, -0.1]);
        let far = transform(&m, [0.0, 0.0, -1000.0]);
        assert!((near[2] / near[3] - 1.0).abs() < 1e-6);
        assert!((far[2] / far[3]).abs() < 1e-6);
    }

    #[test]
    fn orthographic_depth_runs_from_one_at_the_near_plane_to_zero_at_the_far_plane_in_proportion() {
        let m = orthographic_reversed(-4.0, 4.0, -2.0, 2.0, 1.0, 10.0);
        for (distance, depth) in [(1.0, 1.0), (5.5, 0.5), (10.0, 0.0), (7.75, 0.25)] {
            let clip = transform(&m, [0.0, 0.0, -distance]);
            assert_eq!(clip[3], 1.0, "no perspective division");
            assert!((clip[2] - depth).abs() < 1e-6, "{distance}: {clip:?}");
        }
        // A near plane behind the camera, as orthographic views of 2D scenes often use.
        let behind = orthographic_reversed(-1.0, 1.0, -1.0, 1.0, -50.0, 50.0);
        assert!((transform(&behind, [0.0, 0.0, 50.0])[2] - 1.0).abs() < 1e-6);
        assert!(transform(&behind, [0.0, 0.0, -50.0])[2].abs() < 1e-6);
    }

    #[test]
    fn orthographic_edges_map_onto_the_edges_of_clip_space_at_every_distance() {
        let m = orthographic_reversed(-3.0, 5.0, -1.0, 3.0, 1.0, 10.0);
        for distance in [1.0, 4.0, 10.0] {
            let z = -distance;
            assert_close(&transform(&m, [-3.0, -1.0, z])[..2], &[-1.0, -1.0], 1e-6);
            assert_close(&transform(&m, [5.0, 3.0, z])[..2], &[1.0, 1.0], 1e-6);
            assert_close(&transform(&m, [1.0, 1.0, z])[..2], &[0.0, 0.0], 1e-6);
        }
    }

    #[test]
    fn an_orthographic_width_follows_the_target_unless_the_lens_fixes_it() {
        // A view 4 tall on a target twice as wide as it is tall is 8 wide.
        let follows = ortho(4.0, None, [0.0, 0.0]).projection(2.0);
        assert_close(
            &transform(&follows, [4.0, 2.0, -3.0])[..2],
            &[1.0, 1.0],
            1e-6,
        );
        // A fixed width of 6 stretches over any target, as three.js's edges do.
        let fixed = ortho(4.0, Some(6.0), [0.0, 0.0]);
        for aspect in [0.5, 2.0] {
            let m = fixed.projection(aspect);
            assert_close(&transform(&m, [3.0, 2.0, -3.0])[..2], &[1.0, 1.0], 1e-6);
        }
        // An offset center moves the view without resizing it.
        let offset = ortho(4.0, Some(6.0), [10.0, -1.0]).projection(1.0);
        assert_close(
            &transform(&offset, [7.0, -3.0, -3.0])[..2],
            &[-1.0, -1.0],
            1e-6,
        );
        assert_close(
            &transform(&offset, [13.0, 1.0, -3.0])[..2],
            &[1.0, 1.0],
            1e-6,
        );
    }

    #[test]
    fn the_orthographic_frustum_is_the_box_of_the_view() {
        // Planes in the order left, right, bottom, top, then the planes at depth 0 and 1: with
        // reversed depth, those are the far plane and the near plane.
        let lens = ortho(4.0, Some(8.0), [0.0, 0.0]);
        let frustum = Frustum::from_view_projection(&lens.view_projection(&at([0.0; 3]), 1.0));
        let expected = [
            [1.0, 0.0, 0.0, 4.0],
            [-1.0, 0.0, 0.0, 4.0],
            [0.0, 1.0, 0.0, 2.0],
            [0.0, -1.0, 0.0, 2.0],
            [0.0, 0.0, 1.0, 10.0],
            [0.0, 0.0, -1.0, -1.0],
        ];
        for (plane, expected) in frustum.planes().iter().zip(&expected) {
            assert_close(plane, expected, 1e-5);
        }

        // Moved, turned and offset: the box goes with the camera, and its size does not change
        // with distance, as a perspective frustum's would.
        let lens = ortho(4.0, None, [1.0, 0.0]);
        // At (0, 0, 20), turned 90 degrees about +Y: it looks down -X.
        let world: Affine = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 20.0];
        let frustum = Frustum::from_view_projection(&lens.view_projection(&world, 2.0));
        let sees = |p: [f32; 3]| frustum.contains_sphere(p[0], p[1], p[2], 0.0);
        // The view spans z from 20 - 1 - 4 to 20 - 1 + 4 (its center is 1 to the camera's right,
        // which is -Z here), y from -2 to 2, and x from -1 to -10.
        for x in [-1.5, -9.5] {
            assert!(sees([x, 1.9, 15.1]) && sees([x, -1.9, 22.9]), "x = {x}");
            assert!(!sees([x, 2.1, 19.0]) && !sees([x, 0.0, 14.9]) && !sees([x, 0.0, 23.1]));
        }
        assert!(!sees([-0.5, 0.0, 19.0]) && !sees([-10.5, 0.0, 19.0]));
        assert!(!sees([1.0, 0.0, 19.0]), "behind the camera");
    }

    #[test]
    fn the_view_matrix_inverts_the_world_transform() {
        // A camera at (1, 2, 3), turned 90 degrees about +Y, then scaled by 2.
        let world: Affine = [0.0, 0.0, 2.0, 1.0, 0.0, 2.0, 0.0, 2.0, -2.0, 0.0, 0.0, 3.0];
        let view = view_matrix(&world);
        for p in [[0.0, 0.0, 0.0], [1.0, -2.0, 0.5]] {
            let world_point = [
                world[0] * p[0] + world[1] * p[1] + world[2] * p[2] + world[3],
                world[4] * p[0] + world[5] * p[1] + world[6] * p[2] + world[7],
                world[8] * p[0] + world[9] * p[1] + world[10] * p[2] + world[11],
            ];
            let back = transform(&view, world_point);
            for k in 0..3 {
                assert!((back[k] - p[k]).abs() < 1e-5, "{back:?} != {p:?}");
            }
        }
    }

    #[test]
    fn the_relative_view_projection_sees_offsets_as_the_world_one_sees_positions() {
        let perspective = Lens::Perspective(Perspective {
            fov_degrees: 50.0,
            near: 0.1,
            far: 500.0,
        });
        let orthographic = Lens::Orthographic(Orthographic {
            height: 30.0,
            width: None,
            center: [2.0, -1.0],
            near: -5.0,
            far: 500.0,
        });
        // A camera at (3, 4, 10), turned 90 degrees about +Y.
        let world: Affine = [0.0, 0.0, 1.0, 3.0, 0.0, 1.0, 0.0, 4.0, -1.0, 0.0, 0.0, 10.0];
        for lens in [perspective, orthographic] {
            let absolute = lens.view_projection(&world, 1.5);
            let relative = lens.relative_view_projection(&world, 1.5);
            for p in [[-20.0, 1.0, 9.0], [0.5, 4.0, 10.0]] {
                let a = transform(&absolute, p);
                let r = transform(&relative, [p[0] - 3.0, p[1] - 4.0, p[2] - 10.0]);
                assert_close(&r, &a, 1e-4);
            }
        }
    }

    #[test]
    fn the_depth_row_gives_the_distance_along_the_view_and_matches_both_lenses_planes() {
        let perspective = Lens::Perspective(Perspective {
            fov_degrees: 50.0,
            near: 0.5,
            far: 80.0,
        });
        // A camera at (3, 4, 10), turned 90 degrees about +Y, so it looks down -X, and scaled 2.
        let world: Affine = [0.0, 0.0, 2.0, 3.0, 0.0, 2.0, 0.0, 4.0, -2.0, 0.0, 0.0, 10.0];
        for lens in [perspective, ortho(6.0, None, [1.0, 0.0])] {
            let depth = lens.depth(&world);
            let at = |p: [f32; 3]| (0..3).map(|k| depth.row[k] * p[k]).sum::<f32>() + depth.row[3];
            // Seven units ahead, in world units; the view's units are half of them.
            assert!((at([-7.0, 1.0, 2.0]) - 3.5).abs() < 1e-5);
            assert!((at([4.0, 0.0, 0.0]) + 2.0).abs() < 1e-5);
            // The near and far planes of reversed depth lie at the lens's distances.
            let view_proj = lens.relative_view_projection(&world, 1.0);
            for (distance, expected) in [(depth.near, 1.0), (depth.far, 0.0)] {
                let clip = transform(&view_proj, [-2.0 * distance, 0.0, 0.0]);
                assert!((clip[2] / clip[3] - expected).abs() < 1e-4, "{distance}");
            }
            assert_eq!(depth.perspective, matches!(lens, Lens::Perspective(_)));
        }
    }

    #[test]
    fn a_camera_looking_down_minus_z_sees_the_origin_in_the_middle() {
        let perspective = Lens::Perspective(Perspective {
            fov_degrees: 60.0,
            near: 0.1,
            far: 100.0,
        });
        for lens in [perspective, ortho(4.0, None, [0.0, 0.0])] {
            let clip = transform(&lens.view_projection(&at([0.0, 0.0, 5.0]), 2.0), [0.0; 3]);
            assert!(clip[0].abs() < 1e-6 && clip[1].abs() < 1e-6);
            let depth = clip[2] / clip[3];
            assert!(depth > 0.0 && depth < 1.0, "{depth}");
        }
    }

    #[test]
    fn the_eye_is_the_origin_for_perspective_and_the_direction_behind_an_orthographic_camera() {
        let perspective = Lens::Perspective(Perspective {
            fov_degrees: 60.0,
            near: 0.1,
            far: 100.0,
        });
        // Turned 90 degrees about +Y and scaled by 2: it looks down -X, so +X points back at it.
        let world: Affine = [0.0, 0.0, 2.0, 7.0, 0.0, 2.0, 0.0, 8.0, -2.0, 0.0, 0.0, 9.0];
        assert_eq!(perspective.eye(&world), [0.0, 0.0, 0.0, 1.0]);
        let eye = ortho(4.0, None, [0.0, 0.0]).eye(&world);
        assert_close(&eye, &[1.0, 0.0, 0.0, 0.0], 1e-6);
        // Every position sees the orthographic camera in the same direction.
        for p in [[3.0, 1.0, -2.0], [-40.0, 0.0, 12.0]] {
            let toward: [f32; 3] = std::array::from_fn(|k| eye[k] - p[k] * eye[3]);
            assert_close(&toward, &[1.0, 0.0, 0.0], 1e-6);
        }
    }
}
