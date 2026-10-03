//! Clips stored for sampling: keys at one fixed rate, animated tracks in groups of four, and
//! constant tracks folded into a base pose.
//!
//! # Layout
//!
//! The animated tracks of each kind (rotation, translation, scale) sit in groups of four, one
//! track per SIMD lane. A group with fewer than four tracks repeats its last track, which writes
//! the same value twice. The keys are stored frame by frame; within a frame, group by group; within
//! a group, component by component, with one value per lane. Sampling a frame therefore reads two
//! runs of memory, the keys before and after the time.
//!
//! A rotation key is four signed 16-bit integers, the quaternion times 32767. Consecutive keys of a
//! track lie in one hemisphere, so interpolating them never takes the long way round. Sampling
//! interpolates the integers linearly and normalizes the result, which also removes the scale.
//! Translations and scales stay 32-bit floats.
//!
//! Groups of step tracks follow the groups of linear tracks of their kind. They take the key at
//! or before the time, with no interpolation.

use std::simd::prelude::*;

use super::pose::normalized;
use super::{POSE_FIELDS, Pose, field};

/// Values per rotation group per frame: four components of four lanes.
pub(crate) const ROTATION_KEY: usize = 16;
/// Values per translation or scale group per frame: three components of four lanes.
pub(crate) const VECTOR_KEY: usize = 12;

/// The animated tracks of one kind.
#[derive(Clone, Debug, Default)]
pub(crate) struct Groups<T> {
    /// The joint that each lane of each group writes.
    pub joints: Box<[[u32; 4]]>,
    /// The first group of step tracks; every group from here on takes keys without interpolation.
    pub first_step: usize,
    /// The keys, frame by frame (see the module documentation).
    pub keys: Box<[T]>,
}

impl<T> Groups<T> {
    fn bytes(&self) -> usize {
        self.keys.len() * size_of::<T>() + self.joints.len() * 16
    }
}

/// An animation clip for one skeleton, stored for sampling. [`super::resample`] builds it.
#[derive(Clone, Debug)]
pub struct Clip {
    joints: u32,
    duration: f32,
    rate: f32,
    frames: u32,
    tracks: u32,
    /// The skeleton's rest pose, with each constant track's value in place.
    base: Pose,
    /// 1 where the clip has a track and 0 elsewhere: a row of lanes for translations, one for
    /// rotations and one for scales.
    channels: Box<[f32]>,
    rotations: Groups<i16>,
    translations: Groups<f32>,
    scales: Groups<f32>,
}

/// The parts of a [`Clip`], as [`super::resample`] builds them.
pub(crate) struct ClipParts {
    pub joints: u32,
    pub duration: f32,
    /// Keys per second, so frame `k` is at time `k / rate`.
    pub rate: f32,
    pub frames: u32,
    pub tracks: u32,
    pub base: Pose,
    pub channels: Box<[f32]>,
    pub rotations: Groups<i16>,
    pub translations: Groups<f32>,
    pub scales: Groups<f32>,
}

impl Clip {
    /// Puts a clip together from its parts.
    pub(crate) fn from_parts(parts: ClipParts) -> Clip {
        let ClipParts {
            joints,
            duration,
            rate,
            frames,
            tracks,
            base,
            channels,
            rotations,
            translations,
            scales,
        } = parts;
        Clip {
            joints,
            duration,
            rate,
            frames,
            tracks,
            base,
            channels,
            rotations,
            translations,
            scales,
        }
    }

    /// Where the clip has tracks: 1 for a joint's channel that a track moves, constant tracks
    /// included, and 0 elsewhere. Three rows of the skeleton's lanes: translations, rotations and
    /// scales. A blend counts a clip's weight only where it has tracks.
    pub fn channels(&self) -> &[f32] {
        &self.channels
    }

    /// The number of joints of the skeleton that the clip animates.
    pub fn joints(&self) -> u32 {
        self.joints
    }

    /// The clip's length in seconds: the time of its last key.
    pub fn duration(&self) -> f32 {
        self.duration
    }

    /// Keys per second. Frame `k` is at time `k / rate`, and the last frame is at the duration.
    pub fn rate(&self) -> f32 {
        self.rate
    }

    /// The number of keys of each animated track. A clip of one frame has no animated track.
    pub fn frames(&self) -> u32 {
        self.frames
    }

    /// The number of tracks the clip was built from, constant ones included.
    pub fn tracks(&self) -> u32 {
        self.tracks
    }

    /// The number of tracks that change over time, and so store a key per frame.
    pub fn animated_tracks(&self) -> u32 {
        let distinct = |g: &[[u32; 4]]| {
            g.iter()
                .map(|lanes| 1 + (1..4).filter(|&k| lanes[k] != lanes[k - 1]).count() as u32)
                .sum::<u32>()
        };
        distinct(&self.rotations.joints)
            + distinct(&self.translations.joints)
            + distinct(&self.scales.joints)
    }

    /// The bytes the clip's keys and tables take.
    pub fn bytes(&self) -> usize {
        (self.base.values().len() + self.channels.len()) * 4
            + self.rotations.bytes()
            + self.translations.bytes()
            + self.scales.bytes()
    }

    /// The pose with the constant tracks in place, which sampling starts from.
    pub fn base(&self) -> &Pose {
        &self.base
    }

    /// The frame before `time` and the fraction of the way to the next frame. Times outside the
    /// clip take its first or last key, and NaN takes the first.
    #[inline]
    fn position(&self, time: f32) -> (usize, f32) {
        let p = time.max(0.0).min(self.duration) * self.rate;
        let last = self.frames.saturating_sub(2);
        // A cast to an integer saturates, and turns NaN into 0.
        let frame = (p as u32).min(last);
        (frame as usize, (p - frame as f32).clamp(0.0, 1.0))
    }

    /// Samples the clip at `time` seconds into `pose`, a pose by field of the clip's skeleton
    /// (see [`crate::animation`]): the base pose, with every animated track interpolated between
    /// the keys around the time.
    ///
    /// # Panics
    /// When `pose` does not hold [`POSE_FIELDS`] fields of the skeleton's lanes.
    #[inline(never)]
    pub fn sample(&self, time: f32, pose: &mut [f32]) {
        pose.copy_from_slice(self.base.values());
        if self.frames < 2 {
            return;
        }
        let lanes = self.base.lanes() as usize;
        let (frame, fraction) = self.position(time);
        sample_rotations(&self.rotations, frame, fraction, pose, lanes);
        sample_vectors(
            &self.translations,
            frame,
            fraction,
            field::TRANSLATION,
            pose,
            lanes,
        );
        sample_vectors(&self.scales, frame, fraction, field::SCALE, pose, lanes);
    }

    /// The length of a pose by field of the clip's skeleton.
    pub fn pose_len(&self) -> usize {
        POSE_FIELDS * self.base.lanes() as usize
    }
}

/// The two frames' keys of one kind's groups: frame `frame` and the next.
#[inline(always)]
fn frame_pair<T>(groups: &Groups<T>, frame: usize, stride: usize) -> (&[T], &[T]) {
    let size = groups.joints.len() * stride;
    let at = frame * size;
    (
        &groups.keys[at..at + size],
        &groups.keys[at + size..at + 2 * size],
    )
}

/// The interpolation weight of group `group`: the fraction for linear groups, and for step groups
/// 0, or 1 at the clip's end, where only the last key applies.
#[inline(always)]
fn weight_of<T>(groups: &Groups<T>, group: usize, fraction: f32) -> f32x4 {
    if group < groups.first_step {
        f32x4::splat(fraction)
    } else {
        f32x4::splat(if fraction >= 1.0 { 1.0 } else { 0.0 })
    }
}

/// Writes four lanes of each of `N` consecutive fields to the lanes' joints.
#[inline(always)]
fn scatter<const N: usize>(
    pose: &mut [f32],
    lanes: usize,
    first_field: usize,
    joints: &[u32; 4],
    values: [f32x4; N],
) {
    for (k, v) in values.iter().enumerate() {
        let row = &mut pose[(first_field + k) * lanes..(first_field + k + 1) * lanes];
        let v = v.to_array();
        for lane in 0..4 {
            row[joints[lane] as usize] = v[lane];
        }
    }
}

fn sample_rotations(
    groups: &Groups<i16>,
    frame: usize,
    fraction: f32,
    pose: &mut [f32],
    lanes: usize,
) {
    if groups.joints.is_empty() {
        return;
    }
    let (a, b) = frame_pair(groups, frame, ROTATION_KEY);
    for (g, joints) in groups.joints.iter().enumerate() {
        let t = weight_of(groups, g, fraction);
        let at = g * ROTATION_KEY;
        let lerp = |c: usize| {
            let o = at + 4 * c;
            let ka: f32x4 = i16x4::from_slice(&a[o..o + 4]).cast();
            let kb: f32x4 = i16x4::from_slice(&b[o..o + 4]).cast();
            ka + (kb - ka) * t
        };
        let (x, y, z, w) = normalized(lerp(0), lerp(1), lerp(2), lerp(3));
        scatter(pose, lanes, field::ROTATION, joints, [x, y, z, w]);
    }
}

#[inline(never)]
fn sample_vectors(
    groups: &Groups<f32>,
    frame: usize,
    fraction: f32,
    first_field: usize,
    pose: &mut [f32],
    lanes: usize,
) {
    if groups.joints.is_empty() {
        return;
    }
    let (a, b) = frame_pair(groups, frame, VECTOR_KEY);
    for (g, joints) in groups.joints.iter().enumerate() {
        let t = weight_of(groups, g, fraction);
        let at = g * VECTOR_KEY;
        let lerp = |c: usize| {
            let o = at + 4 * c;
            let ka = f32x4::from_slice(&a[o..o + 4]);
            let kb = f32x4::from_slice(&b[o..o + 4]);
            ka + (kb - ka) * t
        };
        scatter(
            pose,
            lanes,
            first_field,
            joints,
            [lerp(0), lerp(1), lerp(2)],
        );
    }
}
