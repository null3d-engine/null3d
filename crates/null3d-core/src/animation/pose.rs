//! Local poses stored by field, and the SIMD loops over them: weighted blending, normalization,
//! and the local matrices of four joints at once.

use std::simd::StdFloat;
use std::simd::prelude::*;

use super::{AnimationError, POSE_FIELDS, field, filled, lanes_for};
use crate::math::Affine;

/// A local pose by field: translation, rotation and scale of each joint, in ten arrays of `lanes`
/// values (see the module documentation of [`crate::animation`]). Joints past the skeleton's
/// count hold the identity transform.
#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    lanes: u32,
    values: Box<[f32]>,
}

impl Pose {
    /// The pose of `joints` joints that all hold the identity transform.
    pub fn identity(joints: u32) -> Result<Pose, AnimationError> {
        let lanes = lanes_for(joints);
        let row = lanes as usize;
        let mut values = filled(POSE_FIELDS * row, 0.0f32)?;
        values[(field::ROTATION + 3) * row..(field::ROTATION + 4) * row].fill(1.0);
        values[field::SCALE * row..].fill(1.0);
        Ok(Pose {
            lanes,
            values: values.into_boxed_slice(),
        })
    }

    /// The joint count rounded up to a multiple of four.
    pub fn lanes(&self) -> u32 {
        self.lanes
    }

    /// Every value, field by field.
    pub fn values(&self) -> &[f32] {
        &self.values
    }

    /// The translation, rotation `(x, y, z, w)` and scale of joint `joint`.
    ///
    /// # Panics
    /// When the joint is past the pose's lanes.
    pub fn joint(&self, joint: u32) -> ([f32; 3], [f32; 4], [f32; 3]) {
        let read = |f: usize| self.values[f * self.lanes as usize + joint as usize];
        (
            std::array::from_fn(|k| read(field::TRANSLATION + k)),
            std::array::from_fn(|k| read(field::ROTATION + k)),
            std::array::from_fn(|k| read(field::SCALE + k)),
        )
    }

    /// Sets the translation, rotation `(x, y, z, w)` and scale of joint `joint`.
    ///
    /// # Panics
    /// When the joint is past the pose's lanes.
    pub fn set_joint(
        &mut self,
        joint: u32,
        translation: [f32; 3],
        rotation: [f32; 4],
        scale: [f32; 3],
    ) {
        let lanes = self.lanes as usize;
        let mut write = |f: usize, value: f32| self.values[f * lanes + joint as usize] = value;
        for k in 0..3 {
            write(field::TRANSLATION + k, translation[k]);
            write(field::SCALE + k, scale[k]);
        }
        for (k, &value) in rotation.iter().enumerate() {
            write(field::ROTATION + k, value);
        }
    }

    /// Every value, field by field, to change.
    pub(crate) fn values_mut(&mut self) -> &mut [f32] {
        &mut self.values
    }
}

#[inline(always)]
fn load(values: &[f32], at: usize) -> f32x4 {
    f32x4::from_slice(&values[at..at + 4])
}

#[inline(always)]
fn store(values: &mut [f32], at: usize, v: f32x4) {
    v.copy_to_slice(&mut values[at..at + 4]);
}

/// The weight that makes normalized linear interpolation follow the arc, as `slerp` does, for
/// quaternions whose dot product is `d` (from 0 to 1) at weight `t`. Plain normalized
/// interpolation moves too slowly near the ends and too fast in the middle. A polynomial fit to
/// that drift (Arseny Kapoulkine, "Approximating slerp", 2015) cuts the error from 3.4e-2 to
/// 7.7e-5 radians for rotations up to 2 radians apart.
#[inline(always)]
fn arc_weight(t: f32x4, d: f32x4) -> f32x4 {
    let c = f32x4::splat;
    let a = c(1.0904) + d * (c(-3.2452) + d * (c(3.55645) - d * c(1.43519)));
    let b = c(0.848013) + d * (c(-1.06021) + d * c(0.215638));
    let centered = t - c(0.5);
    let k = a * centered * centered + b;
    t + t * centered * (t - c(1.0)) * k
}

/// Starts the blend weights of a pose: each lane of `weights` (three rows of lanes: translation,
/// rotation and scale) gets `weight` where the clip has a track, as its `channels` mask says, and
/// 0 elsewhere.
pub(crate) fn start_weights(weights: &mut [f32], channels: &[f32], weight: f32) {
    let w = f32x4::splat(weight);
    for at in (0..weights.len()).step_by(4) {
        store(weights, at, load(channels, at) * w);
    }
}

/// Adds a clip of weight `weight` to the blend weights, and sets `shares` to the fraction of the
/// way that each lane moves toward the clip: its weight over the lane's weight so far. Lanes the
/// clip has no track for keep their weight and move by 0.
pub(crate) fn add_weights(weights: &mut [f32], shares: &mut [f32], channels: &[f32], weight: f32) {
    let w = f32x4::splat(weight);
    let zero = f32x4::splat(0.0);
    for at in (0..weights.len()).step_by(4) {
        let added = load(channels, at) * w;
        let total = load(weights, at) + added;
        store(weights, at, total);
        store(shares, at, total.simd_gt(zero).select(added / total, zero));
    }
}

/// Sets `shares` to the fraction of the way each lane moves toward the rest pose: what its weight
/// falls short of 1. Lanes no clip has a track for already hold the rest pose and move by 0.
/// Returns false when no lane moves.
pub(crate) fn rest_shares(weights: &[f32], shares: &mut [f32]) -> bool {
    let zero = f32x4::splat(0.0);
    let mut moves = zero.simd_ne(zero);
    for at in (0..weights.len()).step_by(4) {
        let total = load(weights, at);
        let short = (f32x4::splat(1.0) - total).simd_max(zero);
        let share = total.simd_gt(zero).select(short, zero);
        store(shares, at, share);
        moves |= share.simd_gt(zero);
    }
    moves.any()
}

/// Moves each lane of `pose` toward `other` by its share, from `shares` (three rows of lanes, as
/// [`start_weights`] lays them out): translations and scales in a straight line, and rotations
/// along the shorter arc, as three.js's `AnimationMixer` blends clips. Rotations use normalized
/// linear interpolation with [`arc_weight`]'s correction.
#[inline(never)]
pub(crate) fn blend(pose: &mut [f32], other: &[f32], shares: &[f32], lanes: usize) {
    for f in (0..field::ROTATION).chain(field::SCALE..POSE_FIELDS) {
        let row = if f < field::ROTATION { 0 } else { 2 };
        for lane in (0..lanes).step_by(4) {
            let at = f * lanes + lane;
            let a = load(pose, at);
            store(
                pose,
                at,
                a + (load(other, at) - a) * load(shares, row * lanes + lane),
            );
        }
    }
    let r = field::ROTATION * lanes;
    for lane in (0..lanes).step_by(4) {
        let at = |k: usize| r + k * lanes + lane;
        let a: [f32x4; 4] = std::array::from_fn(|k| load(pose, at(k)));
        let b: [f32x4; 4] = std::array::from_fn(|k| load(other, at(k)));
        let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        let toward = arc_weight(load(shares, lanes + lane), dot.abs());
        // A negated quaternion is the same rotation: take the one in `pose`'s hemisphere.
        let toward_b = dot.simd_lt(f32x4::splat(0.0)).select(-toward, toward);
        let from_a = f32x4::splat(1.0) - toward;
        let (x, y, z, w) = normalized(
            a[0] * from_a + b[0] * toward_b,
            a[1] * from_a + b[1] * toward_b,
            a[2] * from_a + b[2] * toward_b,
            a[3] * from_a + b[3] * toward_b,
        );
        for (k, v) in [x, y, z, w].into_iter().enumerate() {
            store(pose, at(k), v);
        }
    }
}

/// Four quaternions divided by their lengths. One of length 0 becomes the identity.
#[inline(always)]
pub(crate) fn normalized(x: f32x4, y: f32x4, z: f32x4, w: f32x4) -> (f32x4, f32x4, f32x4, f32x4) {
    let length_sq = x * x + y * y + z * z + w * w;
    let empty = length_sq.simd_le(f32x4::splat(0.0));
    let inverse = length_sq.sqrt().recip();
    let zero = f32x4::splat(0.0);
    (
        empty.select(zero, x * inverse),
        empty.select(zero, y * inverse),
        empty.select(zero, z * inverse),
        empty.select(f32x4::splat(1.0), w * inverse),
    )
}

/// Writes the local matrix of each of the first `joints` joints of a pose by field into
/// `matrices`, four joints per SIMD operation. Each is translation × rotation × scale, as
/// [`crate::math::compose`] builds it.
pub(crate) fn local_matrices(pose: &[f32], lanes: usize, joints: usize, matrices: &mut [Affine]) {
    for lane in (0..joints).step_by(4) {
        let get = |f: usize| load(pose, f * lanes + lane);
        let (tx, ty, tz) = (get(0), get(1), get(2));
        let (x, y, z, w) = (get(3), get(4), get(5), get(6));
        let (sx, sy, sz) = (get(7), get(8), get(9));
        let one = f32x4::splat(1.0);
        let (x2, y2, z2) = (x + x, y + y, z + z);
        let (xx, xy, xz) = (x * x2, x * y2, x * z2);
        let (yy, yz, zz) = (y * y2, y * z2, z * z2);
        let (wx, wy, wz) = (w * x2, w * y2, w * z2);
        let m = [
            (one - (yy + zz)) * sx,
            (xy - wz) * sy,
            (xz + wy) * sz,
            tx,
            (xy + wz) * sx,
            (one - (xx + zz)) * sy,
            (yz - wx) * sz,
            ty,
            (xz - wy) * sx,
            (yz + wx) * sy,
            (one - (xx + yy)) * sz,
            tz,
        ]
        .map(f32x4::to_array);
        for (j, matrix) in matrices[lane..(lane + 4).min(joints)]
            .iter_mut()
            .enumerate()
        {
            *matrix = std::array::from_fn(|e| m[e][j]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::compose;

    #[test]
    fn identity_pose_and_joint_access() {
        let mut pose = Pose::identity(5).unwrap();
        assert_eq!(pose.lanes(), 8);
        assert_eq!(pose.joint(7), ([0.0; 3], [0.0, 0.0, 0.0, 1.0], [1.0; 3]));
        pose.set_joint(2, [1.0, 2.0, 3.0], [0.5, 0.5, 0.5, 0.5], [2.0, 3.0, 4.0]);
        assert_eq!(
            pose.joint(2),
            ([1.0, 2.0, 3.0], [0.5, 0.5, 0.5, 0.5], [2.0, 3.0, 4.0])
        );
    }

    #[test]
    fn local_matrices_match_compose() {
        let mut pose = Pose::identity(6).unwrap();
        let s = 0.5f32.sqrt();
        pose.set_joint(0, [1.0, -2.0, 0.5], [0.0, s, 0.0, s], [1.0, 2.0, 0.5]);
        pose.set_joint(
            5,
            [0.0, 3.0, 0.0],
            [0.1, 0.2, 0.3, 0.927_362],
            [1.0, 1.0, 1.0],
        );
        let mut matrices = [[0.0; 12]; 6];
        local_matrices(pose.values(), 8, 6, &mut matrices);
        for j in 0..6 {
            let (t, r, s) = pose.joint(j);
            assert_eq!(matrices[j as usize], compose(t, r, s), "joint {j}");
        }
    }

    #[test]
    fn blending_flips_rotations_into_one_hemisphere() {
        let lanes = 4;
        let mut a = Pose::identity(1).unwrap();
        let mut b = Pose::identity(1).unwrap();
        a.set_joint(0, [2.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0], [1.0; 3]);
        // The identity rotation, negated, and a translation of 4.
        b.set_joint(0, [4.0, 0.0, 0.0], [0.0, 0.0, 0.0, -1.0], [3.0; 3]);
        let mut pose = a.values().to_vec();
        blend(&mut pose, b.values(), &[0.5; 12], lanes);
        let read = |f: usize| pose[f * lanes];
        assert_eq!(read(0), 3.0);
        assert_eq!([read(3), read(4), read(5), read(6)], [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(read(7), 2.0);
    }

    #[test]
    fn weights_count_only_where_a_clip_has_tracks() {
        // Lane 0 has a track in both clips, lane 1 in the second only, lane 2 in neither.
        let first = [1.0, 0.0, 0.0, 0.0];
        let second = [1.0, 1.0, 0.0, 0.0];
        let mut weights = [0.0; 4];
        let mut shares = [0.0; 4];
        start_weights(&mut weights, &first, 0.6);
        add_weights(&mut weights, &mut shares, &second, 0.2);
        assert_eq!(weights, [0.8, 0.2, 0.0, 0.0]);
        assert_eq!(shares, [0.25, 1.0, 0.0, 0.0]);
        assert!(rest_shares(&weights, &mut shares));
        assert_eq!(shares, [1.0 - 0.8, 0.8, 0.0, 0.0]);
        start_weights(&mut weights, &first, 1.5);
        assert!(!rest_shares(&weights, &mut shares));
    }

    #[test]
    fn blended_rotations_follow_the_arc() {
        // Four lanes of rotations about z, from 0 to 0.5, 1, 2 and 3 radians, blended at weights
        // across the range: the angle of each result is the weight's share of the whole angle.
        let lanes = 4;
        let angles = [0.5f32, 1.0, 2.0, 3.0];
        let mut largest = [0.0f32; 4];
        for step in 0..=20 {
            let t = step as f32 / 20.0;
            let mut pose = Pose::identity(4).unwrap();
            let mut other = Pose::identity(4).unwrap();
            for (j, angle) in angles.iter().enumerate() {
                let (s, c) = (angle / 2.0).sin_cos();
                other.set_joint(j as u32, [0.0; 3], [0.0, 0.0, s, c], [1.0; 3]);
            }
            let mut values = pose.values_mut().to_vec();
            blend(&mut values, other.values(), &[t; 12], lanes);
            for (j, angle) in angles.iter().enumerate() {
                let z = values[(field::ROTATION + 2) * lanes + j];
                let w = values[(field::ROTATION + 3) * lanes + j];
                let error = (2.0 * z.atan2(w) - t * angle).abs();
                largest[j] = largest[j].max(error);
            }
        }
        assert!(largest[0] < 5e-5 && largest[1] < 5e-5, "{largest:?}");
        assert!(largest[2] < 1.5e-4 && largest[3] < 1e-3, "{largest:?}");
    }

    #[test]
    fn a_rotation_of_length_zero_becomes_the_identity() {
        let (x, y, z, w) = normalized(
            f32x4::splat(0.0),
            f32x4::splat(0.0),
            f32x4::splat(0.0),
            f32x4::from_array([0.0, 2.0, 0.0, 0.0]),
        );
        assert_eq!(x.to_array(), [0.0; 4]);
        assert_eq!(y.to_array(), [0.0; 4]);
        assert_eq!(z.to_array(), [0.0; 4]);
        assert_eq!(w.to_array(), [1.0, 1.0, 1.0, 1.0]);
    }
}
