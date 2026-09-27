//! Cameras: a perspective projection with reversed depth, and the view matrix of a camera's world
//! transform. Matrices here are 4 × 4 and column-major, the layout WGSL's `mat4x4f` reads. World
//! transforms are the engine's 3 × 4 row-major affine matrices.

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
    /// The view-projection matrix of this lens on a camera with the given world transform.
    pub fn view_projection(&self, world: &Affine, aspect: f32) -> Mat4 {
        let projection =
            perspective_reversed(self.fov_degrees.to_radians(), aspect, self.near, self.far);
        multiply(&projection, &view_matrix(world))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transform(m: &Mat4, p: [f32; 3]) -> [f32; 4] {
        let mut out = [0.0; 4];
        for (row, value) in out.iter_mut().enumerate() {
            *value = m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row];
        }
        out
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
    fn a_camera_looking_down_minus_z_sees_the_origin_in_the_middle() {
        let lens = Perspective {
            fov_degrees: 60.0,
            near: 0.1,
            far: 100.0,
        };
        let world: Affine = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0];
        let clip = transform(&lens.view_projection(&world, 2.0), [0.0, 0.0, 0.0]);
        assert!(clip[0].abs() < 1e-6 && clip[1].abs() < 1e-6);
        let depth = clip[2] / clip[3];
        assert!(depth > 0.0 && depth < 1.0, "{depth}");
    }
}
