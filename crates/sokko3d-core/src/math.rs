//! Affine transform math on 3 × 4 row-major matrices.
//!
//! The last row of an affine 4 × 4 matrix is always (0, 0, 0, 1), so the engine stores and uploads
//! only the first three rows: 12 floats (48 bytes) instead of 16. The conventions match three.js:
//! right-handed, Y up, and a local matrix of translation × rotation × scale.

use std::simd::prelude::*;

/// A 3 × 4 row-major affine matrix. Rows are `[m00 m01 m02 tx]`, `[m10 m11 m12 ty]` and
/// `[m20 m21 m22 tz]`; the implied fourth row is `[0 0 0 1]`.
pub type Affine = [f32; 12];

/// The identity matrix.
pub const IDENTITY: Affine = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 1.0, 0.0,
];

/// The identity rotation as a quaternion `(x, y, z, w)`.
pub const IDENTITY_ROTATION: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

/// The matrix of a translation, a rotation (a unit quaternion `(x, y, z, w)`) and a scale,
/// applied scale first. It matches three.js `Matrix4.compose`.
#[inline(always)]
pub fn compose(position: [f32; 3], rotation: [f32; 4], scale: [f32; 3]) -> Affine {
    let [x, y, z, w] = rotation;
    let [sx, sy, sz] = scale;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        (1.0 - (yy + zz)) * sx,
        (xy - wz) * sy,
        (xz + wy) * sz,
        position[0],
        (xy + wz) * sx,
        (1.0 - (xx + zz)) * sy,
        (yz - wx) * sz,
        position[1],
        (xz - wy) * sx,
        (yz + wx) * sy,
        (1.0 - (xx + yy)) * sz,
        position[2],
    ]
}

/// The product `a × b` of two affine matrices: `b` applied first, then `a`. A child's world
/// matrix is `mul(parent_world, child_local)`.
#[inline(always)]
pub fn mul(a: &Affine, b: &Affine) -> Affine {
    let b0 = f32x4::from_slice(&b[0..4]);
    let b1 = f32x4::from_slice(&b[4..8]);
    let b2 = f32x4::from_slice(&b[8..12]);
    let row = |r: usize| {
        let a = &a[4 * r..4 * r + 4];
        f32x4::splat(a[0]) * b0
            + f32x4::splat(a[1]) * b1
            + f32x4::splat(a[2]) * b2
            + f32x4::from_array([0.0, 0.0, 0.0, a[3]])
    };
    let mut out = [0.0; 12];
    row(0).copy_to_slice(&mut out[0..4]);
    row(1).copy_to_slice(&mut out[4..8]);
    row(2).copy_to_slice(&mut out[8..12]);
    out
}

/// The length of the longest basis vector (column) of the matrix's 3 × 3 part: the largest
/// scale along any axis, as three.js `Matrix4.getMaxScaleOnAxis` computes it.
#[inline(always)]
pub fn max_axis_scale(m: &Affine) -> f32 {
    let c0 = m[0] * m[0] + m[4] * m[4] + m[8] * m[8];
    let c1 = m[1] * m[1] + m[5] * m[5] + m[9] * m[9];
    let c2 = m[2] * m[2] + m[6] * m[6] + m[10] * m[10];
    c0.max(c1).max(c2).sqrt()
}

/// The world bounding sphere `(x, y, z, radius)` of a mesh whose local bounding sphere is
/// centred on its origin: the centre is the matrix's translation, and the radius is scaled by
/// the largest axis scale.
#[inline(always)]
pub fn world_sphere(m: &Affine, local_radius: f32) -> [f32; 4] {
    [m[3], m[7], m[11], local_radius * max_axis_scale(m)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &[f32], b: &[f32]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() <= 1e-5)
    }

    #[test]
    fn compose_matches_rotation_about_y() {
        let half = std::f32::consts::FRAC_PI_4; // A quarter turn about Y.
        let m = compose(
            [1.0, 2.0, 3.0],
            [0.0, half.sin(), 0.0, half.cos()],
            [2.0, 2.0, 2.0],
        );
        // The local X axis maps to world -Z, scaled by 2.
        let expected = [0.0, 0.0, 2.0, 1.0, 0.0, 2.0, 0.0, 2.0, -2.0, 0.0, 0.0, 3.0];
        assert!(close(&m, &expected), "{m:?}");
        assert!((max_axis_scale(&m) - 2.0).abs() < 1e-6);
        assert!(close(&world_sphere(&m, 0.5), &[1.0, 2.0, 3.0, 1.0]));
    }

    #[test]
    fn mul_applies_the_right_matrix_first() {
        let parent = compose([10.0, 0.0, 0.0], IDENTITY_ROTATION, [2.0, 1.0, 1.0]);
        let child = compose([1.0, 1.0, 0.0], IDENTITY_ROTATION, [1.0, 1.0, 1.0]);
        let world = mul(&parent, &child);
        assert_eq!(world[3], 12.0);
        assert_eq!(world[7], 1.0);
        assert_eq!(mul(&IDENTITY, &world), world);
        assert_eq!(mul(&world, &IDENTITY), world);
        // An infinite translation stays out of the 3 × 3 part.
        let far = compose([f32::INFINITY, 0.0, 0.0], IDENTITY_ROTATION, [1.0; 3]);
        assert!(mul(&far, &child)[..3].iter().all(|v| v.is_finite()));
    }
}
