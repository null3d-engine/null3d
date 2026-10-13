//! Joint overrides: rotations that game code sets on an animated instance's joints, on top of its
//! clips, and a look-at that turns a chain of joints toward a point.
//!
//! # Data
//!
//! TypeScript writes one block of [`BLOCK_FLOATS`] floats per instance, in a table that the first
//! use creates, so a scene that never overrides a joint pays for no table and no work. A block
//! holds [`MAX_OVERRIDES`] rotation overrides of [`OVERRIDE_FLOATS`] floats each, then a look-at
//! record. The look-at's target is a point in the world, in 64-bit floats, which the serial step
//! before the frame step ([`super::Animations::resolve_look_targets`]) carries into the space of
//! the instance's object.
//!
//! # Order
//!
//! The frame step blends the clips into the local pose, then applies the rotation overrides in
//! slot order, then the look-at, then composes the skinning matrices. A look-at therefore aims
//! from the pose that the clips and the overrides give.

use super::{NO_PARENT, Skeleton, field};
use crate::math::{Affine, compose, mul};

/// The rotation overrides of one instance.
pub const MAX_OVERRIDES: usize = 8;

/// Floats per rotation override: the joint plus one (0 for an empty slot), the mode, the weight,
/// then the rotation `(x, y, z, w)`, and one float that is not used.
pub const OVERRIDE_FLOATS: usize = 8;

/// The joints of a look-at chain at most.
pub const MAX_LOOK_JOINTS: usize = 4;

/// The places of the numbers in a rotation override and in the look-at record of a block.
pub mod place {
    use super::{MAX_LOOK_JOINTS, MAX_OVERRIDES, OVERRIDE_FLOATS};

    /// The joint plus one; 0 marks an empty slot.
    pub const JOINT: usize = 0;
    /// [`super::mode::SET`] or [`super::mode::ADD`].
    pub const MODE: usize = 1;
    /// How far the override moves the joint, from 0 to 1.
    pub const WEIGHT: usize = 2;
    /// The rotation `(x, y, z, w)`.
    pub const ROTATION: usize = 3;
    /// The look-at record's place in a block.
    pub const LOOK: usize = MAX_OVERRIDES * OVERRIDE_FLOATS;
    /// How far the look-at turns its chain, from 0 to 1; 0 or less turns nothing.
    pub const LOOK_WEIGHT: usize = LOOK;
    /// The joints of the chain, at most [`MAX_LOOK_JOINTS`].
    pub const LOOK_COUNT: usize = LOOK + 1;
    /// The direction that the chain's last joint aims, in the object's space when the mesh was
    /// bound: 3 floats. A direction of length 0 aims along +Z, where glTF models face.
    pub const LOOK_FORWARD: usize = LOOK + 2;
    /// Each joint of the chain, parents first: its index, its share of the turn and its limit in
    /// radians, [`LOOK_JOINT_FLOATS`] floats each.
    pub const LOOK_JOINTS: usize = LOOK + 5;
    /// Floats per joint of the chain.
    pub const LOOK_JOINT_FLOATS: usize = 3;
    /// Floats per block.
    pub const BLOCK: usize = LOOK_JOINTS + MAX_LOOK_JOINTS * LOOK_JOINT_FLOATS;
}

/// Floats per instance's block.
pub const BLOCK_FLOATS: usize = place::BLOCK;

/// How a rotation override changes its joint.
pub mod mode {
    /// The joint's rotation moves from the animated one toward the override's, by the weight.
    pub const SET: u32 = 0;
    /// The override's rotation, scaled by the weight, turns the joint on top of its animated
    /// rotation, in the joint's own frame.
    pub const ADD: u32 = 1;
}

type Quat = [f32; 4];
type Vec3 = [f32; 3];

/// The product `a * b`: `b` turns first, then `a`.
#[inline]
fn multiply(a: Quat, b: Quat) -> Quat {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

/// `q` divided by its length, or `None` for a length of 0 or a value that is not finite.
#[inline]
fn unit(q: Quat) -> Option<Quat> {
    let length = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    (length > 0.0 && length.is_finite()).then(|| q.map(|v| v / length))
}

/// `v` divided by its length, or `None` when it is too short to have a direction.
#[inline]
fn direction(v: Vec3) -> Option<Vec3> {
    let length = dot(v, v).sqrt();
    (length > 1e-12 && length.is_finite()).then(|| v.map(|c| c / length))
}

#[inline]
fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The rotation by `angle` radians about the unit axis `axis`.
#[inline]
fn about(axis: Vec3, angle: f32) -> Quat {
    let (s, c) = (angle * 0.5).sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, c]
}

/// The rotation from unit quaternion `a` toward unit quaternion `b` by `t` from 0 to 1, along the
/// shorter arc, as three.js's `Quaternion.slerp` turns.
pub fn slerp(a: Quat, b: Quat, t: f32) -> Quat {
    let mut d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    // A negated quaternion is the same rotation: take the one in `a`'s hemisphere.
    let b = if d < 0.0 {
        d = -d;
        b.map(|v| -v)
    } else {
        b
    };
    let (from_a, to_b) = if d > 0.9995 {
        (1.0 - t, t)
    } else {
        let angle = d.min(1.0).acos();
        let s = angle.sin();
        (((1.0 - t) * angle).sin() / s, (t * angle).sin() / s)
    };
    let q = std::array::from_fn(|k| a[k] * from_a + b[k] * to_b);
    unit(q).unwrap_or(a)
}

/// The local rotation of joint `j` in a pose by field of `lanes` lanes.
#[inline]
fn rotation_of(pose: &[f32], lanes: usize, j: usize) -> Quat {
    std::array::from_fn(|k| pose[(field::ROTATION + k) * lanes + j])
}

#[inline]
fn set_rotation(pose: &mut [f32], lanes: usize, j: usize, q: Quat) {
    for (k, v) in q.into_iter().enumerate() {
        pose[(field::ROTATION + k) * lanes + j] = v;
    }
}

/// The local matrix of joint `j` in a pose by field.
#[inline]
fn local_matrix(pose: &[f32], lanes: usize, j: usize) -> Affine {
    let read = |f: usize| pose[f * lanes + j];
    compose(
        std::array::from_fn(|k| read(field::TRANSLATION + k)),
        rotation_of(pose, lanes, j),
        std::array::from_fn(|k| read(field::SCALE + k)),
    )
}

/// The 3 × 3 part of `m` times `v`.
#[inline]
fn turn(m: &Affine, v: Vec3) -> Vec3 {
    std::array::from_fn(|r| m[4 * r] * v[0] + m[4 * r + 1] * v[1] + m[4 * r + 2] * v[2])
}

/// The transpose of the 3 × 3 part of `m` times `v`: for a rotation with one scale on every axis,
/// the direction `v` in the frame that `m` maps from, up to its length.
#[inline]
fn turn_back(m: &Affine, v: Vec3) -> Vec3 {
    std::array::from_fn(|c| m[c] * v[0] + m[4 + c] * v[1] + m[8 + c] * v[2])
}

/// Applies the rotation overrides of `block` to the local pose `pose` of `skeleton`, in slot order.
/// Slots that name no joint of the skeleton, or hold a weight that is not above 0 or a rotation
/// of length 0, change nothing. Weights above 1 count as 1.
pub(super) fn apply_overrides(block: &[f32], skeleton: &Skeleton, pose: &mut [f32]) {
    let lanes = skeleton.lanes() as usize;
    let joints = skeleton.joints() as usize;
    for slot in block[..place::LOOK].as_chunks::<OVERRIDE_FLOATS>().0 {
        let joint = slot[place::JOINT];
        let weight = slot[place::WEIGHT];
        // Comparisons with NaN are false, so NaN joints and weights change nothing.
        if !(joint >= 1.0 && (joint as usize) <= joints && weight > 0.0) {
            continue;
        }
        let r = place::ROTATION;
        let Some(q) = unit([slot[r], slot[r + 1], slot[r + 2], slot[r + 3]]) else {
            continue;
        };
        let j = joint as usize - 1;
        let animated = rotation_of(pose, lanes, j);
        let target = if slot[place::MODE] as u32 == mode::ADD {
            multiply(animated, q)
        } else {
            q
        };
        let turned = if weight >= 1.0 {
            unit(target).unwrap_or(animated)
        } else {
            slerp(animated, target, weight)
        };
        set_rotation(pose, lanes, j, turned);
    }
}

/// True when `block`'s look-at turns something: a weight above 0 and a joint at least.
#[inline]
pub(super) fn looks(block: &[f32]) -> bool {
    block[place::LOOK_WEIGHT] > 0.0 && block[place::LOOK_COUNT] >= 1.0
}

/// Turns the look-at chain of `block` in the local pose `pose` of `skeleton`, so that its last
/// joint aims at `target`, a point in the skeleton's space. `path` and `matrices` are scratch
/// memory of one entry per joint at least.
///
/// The step finds the matrices of the last joint's ancestors alone. Then, parents first, each joint
/// of the chain takes its share of the turn that is left between the last joint's aim and the
/// direction from it to the target, up to its limit, and the joints below it follow. So the last
/// joint takes all the turn left, within its limit. Each joint's rotation then moves from its
/// animated one toward the turned one by the look-at's weight. A chain joint that is not an
/// ancestor of the last joint, or that comes after a joint below it, turns nothing.
pub(super) fn look_at(
    block: &[f32],
    target: Vec3,
    skeleton: &Skeleton,
    pose: &mut [f32],
    path: &mut [u32],
    matrices: &mut [Affine],
) {
    let lanes = skeleton.lanes() as usize;
    let joints = skeleton.joints() as usize;
    let parents = skeleton.parents();
    let weight = block[place::LOOK_WEIGHT].min(1.0);
    let count = (block[place::LOOK_COUNT] as usize).min(MAX_LOOK_JOINTS);
    if !target.iter().all(|v| v.is_finite()) {
        return;
    }
    // The chain: each joint, its share and its limit.
    let mut chain = [(0usize, 0.0f32, 0.0f32); MAX_LOOK_JOINTS];
    for (k, entry) in chain.iter_mut().enumerate().take(count) {
        let at = place::LOOK_JOINTS + k * place::LOOK_JOINT_FLOATS;
        let joint = block[at];
        if !(joint >= 0.0 && (joint as usize) < joints) {
            return;
        }
        let share = block[at + 1];
        let limit = block[at + 2];
        *entry = (
            joint as usize,
            if share > 0.0 { share } else { 0.0 },
            if limit > 0.0 { limit } else { 0.0 },
        );
    }
    let end = chain[count - 1].0;
    // The last joint's ancestors and itself, roots first.
    let mut depth = 0;
    let mut j = end as u32;
    while j != NO_PARENT && depth < path.len() {
        path[depth] = j;
        depth += 1;
        j = parents[j as usize];
    }
    let path = &mut path[..depth];
    path.reverse();
    let refresh = |from: usize, pose: &[f32], matrices: &mut [Affine], path: &[u32]| {
        for &j in &path[from..] {
            let j = j as usize;
            let local = local_matrix(pose, lanes, j);
            matrices[j] = match parents[j] {
                NO_PARENT => local,
                parent => mul(&matrices[parent as usize], &local),
            };
        }
    };
    refresh(0, pose, matrices, path);

    // The aim in the last joint's frame: the forward direction at bind time, which the inverse
    // bind matrix carries from the skeleton's space into the joint's.
    let f = place::LOOK_FORWARD;
    let forward = direction([block[f], block[f + 1], block[f + 2]]).unwrap_or([0.0, 0.0, 1.0]);
    let Some(aim) = direction(turn(&skeleton.inverse_bind()[end], forward)) else {
        return;
    };

    let mut animated = [[0.0f32; 4]; MAX_LOOK_JOINTS];
    let mut left: f32 = chain[..count].iter().map(|c| c.1).sum();
    let mut last_place = 0;
    for (k, &(joint, share, limit)) in chain[..count].iter().enumerate() {
        animated[k] = rotation_of(pose, lanes, joint);
        let Some(at) = path.iter().position(|&p| p as usize == joint) else {
            left -= share;
            continue;
        };
        if at < last_place || share <= 0.0 || left <= 0.0 {
            left -= share;
            continue;
        }
        last_place = at;
        let fraction = share / left;
        left -= share;
        let m = &matrices[end];
        let from = [m[3], m[7], m[11]];
        let (Some(facing), Some(wanted)) = (
            direction(turn(m, aim)),
            direction([
                target[0] - from[0],
                target[1] - from[1],
                target[2] - from[2],
            ]),
        ) else {
            break;
        };
        let Some(axis) = direction(cross(facing, wanted)) else {
            // Aiming at the target already, or straight away from it, where no axis is best.
            continue;
        };
        let angle = (dot(facing, wanted).clamp(-1.0, 1.0).acos() * fraction).min(limit);
        // The axis in the frame of the joint's parent, where its local rotation turns.
        let axis = match parents[joint] {
            NO_PARENT => Some(axis),
            parent => direction(turn_back(&matrices[parent as usize], axis)),
        };
        let Some(axis) = axis else { continue };
        let turned = unit(multiply(about(axis, angle), animated[k])).unwrap_or(animated[k]);
        set_rotation(pose, lanes, joint, turned);
        refresh(at, pose, matrices, path);
    }
    if weight < 1.0 {
        for (k, &(joint, ..)) in chain[..count].iter().enumerate() {
            let turned = rotation_of(pose, lanes, joint);
            set_rotation(pose, lanes, joint, slerp(animated[k], turned, weight));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::IDENTITY;

    /// A chain of `n` joints, each 1 above its parent along +Y, at rest with no rotation.
    fn chain(n: usize) -> Skeleton {
        let parents: Vec<u32> = (0..n)
            .map(|j| if j == 0 { NO_PARENT } else { j as u32 - 1 })
            .collect();
        let rest: Vec<f32> = (0..n)
            .flat_map(|j| {
                let y = if j == 0 { 0.0 } else { 1.0 };
                [0.0, y, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
            })
            .collect();
        // Each joint's inverse bind matrix undoes its place at rest: j along +Y.
        let binds: Vec<f32> = (0..n)
            .flat_map(|j| {
                let mut m = IDENTITY;
                m[7] = -(j as f32);
                m
            })
            .collect();
        Skeleton::new(&parents, &rest, &binds).unwrap()
    }

    fn block() -> Vec<f32> {
        vec![0.0; BLOCK_FLOATS]
    }

    fn set_slot(block: &mut [f32], slot: usize, joint: usize, mode: u32, weight: f32, q: Quat) {
        let at = slot * OVERRIDE_FLOATS;
        block[at + place::JOINT] = joint as f32 + 1.0;
        block[at + place::MODE] = mode as f32;
        block[at + place::WEIGHT] = weight;
        block[at + place::ROTATION..at + place::ROTATION + 4].copy_from_slice(&q);
    }

    fn angle_about_y(q: Quat) -> f32 {
        2.0 * q[1].atan2(q[3])
    }

    fn close(a: f32, b: f32, tolerance: f32) -> bool {
        (a - b).abs() < tolerance
    }

    #[test]
    fn set_moves_from_the_animated_rotation_by_the_weight() {
        let skeleton = chain(2);
        let lanes = skeleton.lanes() as usize;
        let mut pose = skeleton.rest().values().to_vec();
        // The animated rotation: a quarter turn about Y on joint 1.
        let quarter = about([0.0, 1.0, 0.0], std::f32::consts::FRAC_PI_2);
        set_rotation(&mut pose, lanes, 1, quarter);
        let mut b = block();
        set_slot(&mut b, 0, 1, mode::SET, 0.5, [0.0, 0.0, 0.0, 1.0]);
        apply_overrides(&b, &skeleton, &mut pose);
        let angle = angle_about_y(rotation_of(&pose, lanes, 1));
        assert!(close(angle, std::f32::consts::FRAC_PI_4, 1e-5), "{angle}");
        // Weight 1 takes the override's rotation, normalized.
        set_slot(&mut b, 0, 1, mode::SET, 1.0, [0.0, 2.0, 0.0, 0.0]);
        apply_overrides(&b, &skeleton, &mut pose);
        assert_eq!(rotation_of(&pose, lanes, 1), [0.0, 1.0, 0.0, 0.0]);
    }

    #[test]
    fn add_turns_on_top_of_the_animated_rotation() {
        let skeleton = chain(2);
        let lanes = skeleton.lanes() as usize;
        let mut pose = skeleton.rest().values().to_vec();
        let quarter = about([0.0, 1.0, 0.0], std::f32::consts::FRAC_PI_2);
        set_rotation(&mut pose, lanes, 1, quarter);
        let mut b = block();
        // Half of a quarter turn on top of the animated quarter turn: three eighths.
        set_slot(&mut b, 0, 1, mode::ADD, 0.5, quarter);
        apply_overrides(&b, &skeleton, &mut pose);
        let angle = angle_about_y(rotation_of(&pose, lanes, 1));
        assert!(
            close(angle, 3.0 * std::f32::consts::FRAC_PI_4, 1e-5),
            "{angle}"
        );
        // The joint's own frame: a turn about X added to a turn about Y is (y * x).
        let mut pose = skeleton.rest().values().to_vec();
        set_rotation(&mut pose, lanes, 1, quarter);
        let tilt = about([1.0, 0.0, 0.0], 0.3);
        set_slot(&mut b, 0, 1, mode::ADD, 1.0, tilt);
        apply_overrides(&b, &skeleton, &mut pose);
        let expected = multiply(quarter, tilt);
        let got = rotation_of(&pose, lanes, 1);
        for k in 0..4 {
            assert!(close(got[k], expected[k], 1e-6), "{got:?} {expected:?}");
        }
    }

    #[test]
    fn bad_slots_change_nothing() {
        let skeleton = chain(2);
        let rest = skeleton.rest().values().to_vec();
        let mut pose = rest.clone();
        let mut b = block();
        let q = about([0.0, 1.0, 0.0], 1.0);
        set_slot(&mut b, 0, 5, mode::SET, 1.0, q); // no joint 5
        set_slot(&mut b, 1, 0, mode::SET, 0.0, q); // weight 0
        set_slot(&mut b, 2, 0, mode::SET, f32::NAN, q); // weight NaN
        set_slot(&mut b, 3, 0, mode::SET, 1.0, [0.0; 4]); // no rotation
        b[4 * OVERRIDE_FLOATS] = f32::NAN; // joint NaN
        apply_overrides(&b, &skeleton, &mut pose);
        assert_eq!(pose, rest);
    }

    /// A look-at block for `joints` with equal shares and limit `limit`.
    fn look_block(joints: &[usize], weight: f32, limit: f32) -> Vec<f32> {
        let mut b = block();
        b[place::LOOK_WEIGHT] = weight;
        b[place::LOOK_COUNT] = joints.len() as f32;
        for (k, &j) in joints.iter().enumerate() {
            let at = place::LOOK_JOINTS + k * place::LOOK_JOINT_FLOATS;
            b[at] = j as f32;
            b[at + 1] = 1.0;
            b[at + 2] = limit;
        }
        b
    }

    /// The direction that joint `end` faces in a pose: its +Z, the forward at bind.
    fn facing(skeleton: &Skeleton, pose: &[f32], end: usize) -> Vec3 {
        let lanes = skeleton.lanes() as usize;
        let mut m = IDENTITY;
        let mut chain = vec![];
        let mut j = end as u32;
        while j != NO_PARENT {
            chain.push(j as usize);
            j = skeleton.parents()[j as usize];
        }
        for &j in chain.iter().rev() {
            m = mul(&m, &local_matrix(pose, lanes, j));
        }
        direction(turn(&m, [0.0, 0.0, 1.0])).unwrap()
    }

    fn scratch(skeleton: &Skeleton) -> (Vec<u32>, Vec<Affine>) {
        let n = skeleton.joints() as usize;
        (vec![0; n], vec![IDENTITY; n])
    }

    #[test]
    fn a_chain_aims_its_last_joint_at_the_target() {
        let skeleton = chain(4);
        let mut pose = skeleton.rest().values().to_vec();
        let (mut path, mut matrices) = scratch(&skeleton);
        // Joints 1 to 3 at heights 1 to 3; a target to the side, at the last joint's height.
        let target = [4.0, 3.0, 0.0];
        let b = look_block(&[1, 2, 3], 1.0, 3.0);
        look_at(&b, target, &skeleton, &mut pose, &mut path, &mut matrices);
        let lanes = skeleton.lanes() as usize;
        // Rebuild the last joint's place and aim from the turned pose.
        let mut m = IDENTITY;
        for j in 0..4 {
            m = mul(&m, &local_matrix(&pose, lanes, j));
        }
        let from = [m[3], m[7], m[11]];
        let wanted = direction([
            target[0] - from[0],
            target[1] - from[1],
            target[2] - from[2],
        ])
        .unwrap();
        let aim = facing(&skeleton, &pose, 3);
        assert!(dot(aim, wanted) > 0.9999, "{aim:?} {wanted:?}");
        // Each joint took part of the turn.
        for j in 1..4 {
            let q = rotation_of(&pose, lanes, j);
            assert!(q[3] < 0.9999, "joint {j} did not turn: {q:?}");
        }
    }

    #[test]
    fn limits_and_weight_hold_the_turn_back() {
        let skeleton = chain(3);
        let lanes = skeleton.lanes() as usize;
        let (mut path, mut matrices) = scratch(&skeleton);
        // A target straight to the side of joint 2: a quarter turn about Y.
        let target = [10.0, 2.0, 0.0];
        let mut pose = skeleton.rest().values().to_vec();
        look_at(
            &look_block(&[1, 2], 1.0, 0.2),
            target,
            &skeleton,
            &mut pose,
            &mut path,
            &mut matrices,
        );
        for j in 1..3 {
            let angle = angle_about_y(rotation_of(&pose, lanes, j)).abs();
            assert!(angle <= 0.2 + 1e-5, "joint {j}: {angle}");
        }
        // Half the weight turns half as far, as the joints have room.
        let mut full = skeleton.rest().values().to_vec();
        look_at(
            &look_block(&[2], 1.0, 3.0),
            target,
            &skeleton,
            &mut full,
            &mut path,
            &mut matrices,
        );
        let mut half = skeleton.rest().values().to_vec();
        look_at(
            &look_block(&[2], 0.5, 3.0),
            target,
            &skeleton,
            &mut half,
            &mut path,
            &mut matrices,
        );
        let a = angle_about_y(rotation_of(&full, lanes, 2));
        let b = angle_about_y(rotation_of(&half, lanes, 2));
        assert!(close(a, std::f32::consts::FRAC_PI_2, 1e-4), "{a}");
        assert!(close(b, a * 0.5, 1e-4), "{b}");
    }

    #[test]
    fn a_joint_off_the_path_turns_nothing() {
        // Joint 2 is a sibling of joint 1, not its ancestor.
        let parents = [NO_PARENT, 0, 0];
        let rest = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(3);
        let skeleton = Skeleton::new(&parents, &rest, &IDENTITY.repeat(3)).unwrap();
        let mut pose = skeleton.rest().values().to_vec();
        let (mut path, mut matrices) = scratch(&skeleton);
        let b = look_block(&[2, 1], 1.0, 3.0);
        look_at(
            &b,
            [5.0, 0.0, 0.0],
            &skeleton,
            &mut pose,
            &mut path,
            &mut matrices,
        );
        let lanes = skeleton.lanes() as usize;
        assert_eq!(rotation_of(&pose, lanes, 2), [0.0, 0.0, 0.0, 1.0]);
        // Joint 1 still takes the whole turn.
        let angle = angle_about_y(rotation_of(&pose, lanes, 1));
        assert!(close(angle, std::f32::consts::FRAC_PI_2, 1e-4), "{angle}");
    }

    #[test]
    fn slerp_follows_the_arc_and_the_shorter_way() {
        let a = [0.0, 0.0, 0.0, 1.0];
        let b = about([0.0, 0.0, 1.0], 2.0);
        for step in 0..=10 {
            let t = step as f32 / 10.0;
            let q = slerp(a, b, t);
            assert!(close(2.0 * q[2].atan2(q[3]), 2.0 * t, 1e-5));
        }
        let negated = b.map(|v| -v);
        let q = slerp(a, negated, 0.5);
        assert!(close(2.0 * q[2].atan2(q[3]), 1.0, 1e-5));
    }
}
