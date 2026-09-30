//! Affine transform math on 3 × 4 row-major matrices.
//!
//! The last row of an affine 4 × 4 matrix is always (0, 0, 0, 1), so the engine stores and uploads
//! only the first three rows: 12 floats (48 bytes) instead of 16. The conventions match three.js:
//! right-handed, Y up, and a local matrix of translation × rotation × scale.
//!
//! Frame code works in 32-bit floats. The functions for [`Affine64`] serve rare work on the serial
//! path that must stay exact far from the origin, such as keeping an object's place in the world
//! when its parent changes.

use std::ops::{Add, Mul, Sub};
use std::simd::prelude::*;
use std::simd::{StdFloat, simd_swizzle};

/// A 3 × 4 row-major affine matrix. Rows are `[m00 m01 m02 tx]`, `[m10 m11 m12 ty]` and
/// `[m20 m21 m22 tz]`; the implied fourth row is `[0 0 0 1]`.
pub type Affine = [f32; 12];

/// An [`Affine`] matrix in 64-bit floats.
pub type Affine64 = [f64; 12];

/// The identity matrix.
pub const IDENTITY: Affine = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 1.0, 0.0,
];

/// The identity matrix in 64-bit floats.
pub const IDENTITY64: Affine64 = [
    1.0, 0.0, 0.0, 0.0, //
    0.0, 1.0, 0.0, 0.0, //
    0.0, 0.0, 1.0, 0.0,
];

/// The identity rotation as a quaternion `(x, y, z, w)`.
pub const IDENTITY_ROTATION: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

/// A float type that [`compose`] works in: `f32` for frame code, `f64` for exact work.
pub trait Float:
    Copy + Add<Output = Self> + Sub<Output = Self> + Mul<Output = Self> + From<f32>
{
}

impl<T: Copy + Add<Output = T> + Sub<Output = T> + Mul<Output = T> + From<f32>> Float for T {}

/// The matrix of a translation, a rotation (a unit quaternion `(x, y, z, w)`) and a scale,
/// applied scale first. It matches three.js `Matrix4.compose`.
#[inline(always)]
pub fn compose<T: Float>(position: [T; 3], rotation: [T; 4], scale: [T; 3]) -> [T; 12] {
    let one = T::from(1.0);
    let [x, y, z, w] = rotation;
    let [sx, sy, sz] = scale;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    [
        (one - (yy + zz)) * sx,
        (xy - wz) * sy,
        (xz + wy) * sz,
        position[0],
        (xy + wz) * sx,
        (one - (xx + zz)) * sy,
        (yz - wx) * sz,
        position[1],
        (xz - wy) * sx,
        (yz + wx) * sy,
        (one - (xx + yy)) * sz,
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

/// The world bounding sphere `(x, y, z, radius)` of a local sphere centred on `center`: the
/// matrix moves the centre, and the radius is scaled by the largest axis scale.
#[inline(always)]
pub fn world_sphere_at(m: &Affine, center: [f32; 3], local_radius: f32) -> [f32; 4] {
    let [x, y, z] = center;
    [
        m[0] * x + m[1] * y + m[2] * z + m[3],
        m[4] * x + m[5] * y + m[6] * z + m[7],
        m[8] * x + m[9] * y + m[10] * z + m[11],
        local_radius * max_axis_scale(m),
    ]
}

/// The product `a × b` of two affine matrices in 64-bit floats: `b` applied first, as in [`mul`].
pub fn mul64(a: &Affine64, b: &Affine64) -> Affine64 {
    let mut out = [0.0; 12];
    for r in 0..3 {
        let row = &a[4 * r..4 * r + 4];
        for c in 0..4 {
            out[4 * r + c] = row[0] * b[c] + row[1] * b[4 + c] + row[2] * b[8 + c];
        }
        out[4 * r + 3] += row[3];
    }
    out
}

/// The determinant of a matrix's 3 × 3 part: negative when it mirrors space, 0 when it flattens it.
fn determinant64(m: &Affine64) -> f64 {
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8])
        + m[2] * (m[4] * m[9] - m[5] * m[8])
}

/// The matrix that undoes `m`, or `None` when `m` flattens space and nothing can undo it.
pub fn invert64(m: &Affine64) -> Option<Affine64> {
    let det = determinant64(m);
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    let k = 1.0 / det;
    // The inverse of the 3 × 3 part is its adjugate over the determinant.
    let r = [
        (m[5] * m[10] - m[6] * m[9]) * k,
        (m[2] * m[9] - m[1] * m[10]) * k,
        (m[1] * m[6] - m[2] * m[5]) * k,
        (m[6] * m[8] - m[4] * m[10]) * k,
        (m[0] * m[10] - m[2] * m[8]) * k,
        (m[2] * m[4] - m[0] * m[6]) * k,
        (m[4] * m[9] - m[5] * m[8]) * k,
        (m[1] * m[8] - m[0] * m[9]) * k,
        (m[0] * m[5] - m[1] * m[4]) * k,
    ];
    let t = [m[3], m[7], m[11]];
    let moved = |row: usize| -(r[3 * row] * t[0] + r[3 * row + 1] * t[1] + r[3 * row + 2] * t[2]);
    Some([
        r[0],
        r[1],
        r[2],
        moved(0),
        r[3],
        r[4],
        r[5],
        moved(1),
        r[6],
        r[7],
        r[8],
        moved(2),
    ])
}

/// The rotation (a unit quaternion `(x, y, z, w)`) and the scale that the 3 × 3 part of `m` holds,
/// as three.js's `Matrix4.decompose` finds them: each scale is the length of a column, and a
/// matrix that mirrors space gets a negative X scale. `None` when `m` flattens space.
pub fn rotation_and_scale64(m: &Affine64) -> Option<([f64; 4], [f64; 3])> {
    let det = determinant64(m);
    if det == 0.0 || !det.is_finite() {
        return None;
    }
    let length = |c: usize| (m[c] * m[c] + m[4 + c] * m[4 + c] + m[8 + c] * m[8 + c]).sqrt();
    let mut scale = [length(0), length(1), length(2)];
    if det < 0.0 {
        scale[0] = -scale[0];
    }
    // The rotation matrix: each column divided by its scale. `r[row][column]`.
    let r = |row: usize, column: usize| m[4 * row + column] / scale[column];
    let (m11, m12, m13) = (r(0, 0), r(0, 1), r(0, 2));
    let (m21, m22, m23) = (r(1, 0), r(1, 1), r(1, 2));
    let (m31, m32, m33) = (r(2, 0), r(2, 1), r(2, 2));
    let trace = m11 + m22 + m33;
    // three.js's `Quaternion.setFromRotationMatrix`.
    let rotation = if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s]
    } else if m11 > m22 && m11 > m33 {
        let s = 2.0 * (1.0 + m11 - m22 - m33).sqrt();
        [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s]
    } else if m22 > m33 {
        let s = 2.0 * (1.0 + m22 - m11 - m33).sqrt();
        [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s]
    } else {
        let s = 2.0 * (1.0 + m33 - m11 - m22).sqrt();
        [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s]
    };
    Some((rotation, scale))
}

/// Four affine matrices, one per SIMD lane: element `[r][c]` holds row `r`, column `c` of each.
pub(crate) type Affine4 = [[f32x4; 4]; 3];

/// Four [`compose`] results at once, one per lane. Every lane performs the same operations in
/// the same order as [`compose`], so the results match it bit for bit.
#[inline(always)]
pub(crate) fn compose4(position: [f32x4; 3], rotation: [f32x4; 4], scale: [f32x4; 3]) -> Affine4 {
    let [x, y, z, w] = rotation;
    let [sx, sy, sz] = scale;
    let (x2, y2, z2) = (x + x, y + y, z + z);
    let (xx, xy, xz) = (x * x2, x * y2, x * z2);
    let (yy, yz, zz) = (y * y2, y * z2, z * z2);
    let (wx, wy, wz) = (w * x2, w * y2, w * z2);
    let one = f32x4::splat(1.0);
    [
        [
            (one - (yy + zz)) * sx,
            (xy - wz) * sy,
            (xz + wy) * sz,
            position[0],
        ],
        [
            (xy + wz) * sx,
            (one - (xx + zz)) * sy,
            (yz - wx) * sz,
            position[1],
        ],
        [
            (xz - wy) * sx,
            (yz + wx) * sy,
            (one - (xx + yy)) * sz,
            position[2],
        ],
    ]
}

/// Four [`max_axis_scale`] results at once, one per lane, computed the same way.
#[inline(always)]
pub(crate) fn max_axis_scale4(m: &Affine4) -> f32x4 {
    let column = |c: usize| m[0][c] * m[0][c] + m[1][c] * m[1][c] + m[2][c] * m[2][c];
    column(0).simd_max(column(1)).simd_max(column(2)).sqrt()
}

/// Transposes a 4 × 4 block given as four rows.
#[inline(always)]
pub(crate) fn transpose4(rows: [f32x4; 4]) -> [f32x4; 4] {
    let [r0, r1, r2, r3] = rows;
    let low01 = simd_swizzle!(r0, r1, [0, 4, 1, 5]);
    let high01 = simd_swizzle!(r0, r1, [2, 6, 3, 7]);
    let low23 = simd_swizzle!(r2, r3, [0, 4, 1, 5]);
    let high23 = simd_swizzle!(r2, r3, [2, 6, 3, 7]);
    [
        simd_swizzle!(low01, low23, [0, 1, 4, 5]),
        simd_swizzle!(low01, low23, [2, 3, 6, 7]),
        simd_swizzle!(high01, high23, [0, 1, 4, 5]),
        simd_swizzle!(high01, high23, [2, 3, 6, 7]),
    ]
}

/// Splits four (x, y, z) triples, stored as 12 consecutive floats in `a`, `b` and `c`, into an
/// x vector, a y vector and a z vector.
#[inline(always)]
pub(crate) fn deinterleave3(a: f32x4, b: f32x4, c: f32x4) -> [f32x4; 3] {
    // a = x0 y0 z0 x1, b = y1 z1 x2 y2, c = z2 x3 y3 z3.
    [
        simd_swizzle!(simd_swizzle!(a, b, [0, 3, 6, 6]), c, [0, 1, 2, 5]),
        simd_swizzle!(simd_swizzle!(a, b, [1, 4, 7, 7]), c, [0, 1, 2, 6]),
        simd_swizzle!(simd_swizzle!(a, b, [2, 5, 5, 5]), c, [0, 1, 4, 7]),
    ]
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
    fn four_lanes_match_the_scalar_functions_bit_for_bit() {
        let positions = [
            [1.0, -2.0, 3.5],
            [0.25, 7.0, -9.0],
            [100.0, 0.0, 1e-3],
            [-4.0, 5.5, 6.0],
        ];
        let rotations = [
            [0.1, 0.2, 0.3, 0.927_361_85],
            IDENTITY_ROTATION,
            [0.0, 0.707_106_77, 0.0, 0.707_106_77],
            [-0.5, 0.5, -0.5, 0.5],
        ];
        let scales = [
            [1.0, 2.0, 3.0],
            [0.5, 0.5, 0.5],
            [1.0, 1.0, 1.0],
            [3.0, 0.1, 2.0],
        ];
        let lanes = |values: &[[f32; 3]; 4], k: usize| f32x4::from_array(values.map(|v| v[k]));
        let m4 = compose4(
            [0, 1, 2].map(|k| lanes(&positions, k)),
            [0, 1, 2, 3].map(|k| f32x4::from_array(rotations.map(|q| q[k]))),
            [0, 1, 2].map(|k| lanes(&scales, k)),
        );
        let scale4 = max_axis_scale4(&m4).to_array();
        for i in 0..4 {
            let m = compose(positions[i], rotations[i], scales[i]);
            for (k, value) in m.iter().enumerate() {
                let lane = m4[k / 4][k % 4].to_array()[i];
                assert_eq!(lane.to_bits(), value.to_bits(), "lane {i}, element {k}");
            }
            assert_eq!(scale4[i].to_bits(), max_axis_scale(&m).to_bits());
        }
    }

    #[test]
    fn transposes_and_deinterleaves() {
        let v = |a: [f32; 4]| f32x4::from_array(a);
        let t = transpose4([
            v([0.0, 1.0, 2.0, 3.0]),
            v([4.0, 5.0, 6.0, 7.0]),
            v([8.0, 9.0, 10.0, 11.0]),
            v([12.0, 13.0, 14.0, 15.0]),
        ]);
        assert_eq!(t[1].to_array(), [1.0, 5.0, 9.0, 13.0]);
        assert_eq!(t[3].to_array(), [3.0, 7.0, 11.0, 15.0]);
        let [x, y, z] = deinterleave3(
            v([0.0, 1.0, 2.0, 10.0]),
            v([11.0, 12.0, 20.0, 21.0]),
            v([22.0, 30.0, 31.0, 32.0]),
        );
        assert_eq!(x.to_array(), [0.0, 10.0, 20.0, 30.0]);
        assert_eq!(y.to_array(), [1.0, 11.0, 21.0, 31.0]);
        assert_eq!(z.to_array(), [2.0, 12.0, 22.0, 32.0]);
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

    #[test]
    fn a_sphere_with_its_own_center_moves_with_the_matrix() {
        let half = std::f32::consts::FRAC_PI_4; // A quarter turn about Y.
        let m = compose(
            [1.0, 2.0, 3.0],
            [0.0, half.sin(), 0.0, half.cos()],
            [2.0, 2.0, 2.0],
        );
        // Local +X maps to world -Z, scaled by 2.
        let sphere = world_sphere_at(&m, [1.0, 0.0, 0.0], 0.5);
        assert!(close(&sphere, &[1.0, 2.0, 1.0, 1.0]), "{sphere:?}");
        assert_eq!(world_sphere_at(&m, [0.0; 3], 0.5), world_sphere(&m, 0.5));
    }

    /// True when two 64-bit values differ by at most `tolerance`, element by element.
    fn close64(a: &[f64], b: &[f64], tolerance: f64) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tolerance)
    }

    #[test]
    fn a_64_bit_matrix_splits_into_the_rotation_and_scale_that_made_it() {
        let q = {
            let (x, y, z, w) = (0.1f64, -0.4, 0.3, 0.8);
            let n = (x * x + y * y + z * z + w * w).sqrt();
            [x / n, y / n, z / n, w / n]
        };
        let m = compose([1.0e6, -2.0, 3.5], q, [2.0, 0.5, 3.0]);
        let (rotation, scale) = rotation_and_scale64(&m).unwrap();
        assert!(close64(&rotation, &q, 1e-12), "{rotation:?}");
        assert!(close64(&scale, &[2.0, 0.5, 3.0], 1e-12), "{scale:?}");
        // A mirrored matrix gets a negative X scale, as in three.js.
        let mirrored = compose([0.0; 3], q, [1.0, -2.0, 1.0]);
        let (_, scale) = rotation_and_scale64(&mirrored).unwrap();
        assert!(close64(&scale, &[-1.0, 2.0, 1.0], 1e-12), "{scale:?}");
        // A flat matrix holds no rotation, and nothing inverts it.
        let flat = compose([1.0, 0.0, 0.0], q, [1.0, 0.0, 1.0]);
        assert!(rotation_and_scale64(&flat).is_none());
        assert!(invert64(&flat).is_none());
    }

    #[test]
    fn a_64_bit_matrix_times_its_inverse_is_the_identity() {
        let q = [0.0f64, 0.6, 0.0, 0.8];
        let m = compose([1.0e6, 20.0, -3.0e5], q, [2.0, 0.5, 4.0]);
        let inverse = invert64(&m).unwrap();
        assert!(close64(&mul64(&inverse, &m), &IDENTITY64, 1e-9));
        assert!(close64(&mul64(&m, &inverse), &IDENTITY64, 1e-9));
        // `mul64` applies the right matrix first, as `mul` does.
        let parent = compose([10.0f64, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0], [2.0, 1.0, 1.0]);
        let child = compose([1.0f64, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0], [1.0; 3]);
        assert_eq!(mul64(&parent, &child)[3], 12.0);
        let f32_parent = parent.map(|v| v as f32);
        let f32_child = child.map(|v| v as f32);
        let product = mul64(&parent, &child).map(|v| v as f32);
        assert_eq!(mul(&f32_parent, &f32_child), product);
    }
}
