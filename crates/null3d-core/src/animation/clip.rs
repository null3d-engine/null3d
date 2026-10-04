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
//! or before the time, with no interpolation. Among the linear rotation groups, those with a track
//! that turns far between two frames come first, because only they may need the correction toward
//! the arc that sampling applies.

use std::simd::prelude::*;

use super::pose::{arc_weight, normalized};
use super::resample::QUANTIZED_ONE;
use super::{AnimationError, POSE_FIELDS, Pose, field, filled};

/// Values per rotation group per frame: four components of four lanes.
pub(crate) const ROTATION_KEY: usize = 16;
/// Values per translation or scale group per frame: three components of four lanes.
pub(crate) const VECTOR_KEY: usize = 12;

/// The animated tracks of one kind.
#[derive(Clone, Debug, Default)]
pub(crate) struct Groups<T> {
    /// The joint that each lane of each group writes.
    pub joints: Box<[[u32; 4]]>,
    /// The first group whose rotations turn by at most [`SMALL_TURN_DOT`] between frames, which
    /// interpolate without correction toward the arc.
    pub first_small_turn: usize,
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

    /// The clip as differences from its first frame, for additive blending: each rotation key is
    /// the first frame's rotation, inverted, times the key, and each translation or scale key is
    /// the key minus the first frame's value. three.js's `AnimationUtils.makeClipAdditive` builds
    /// the same keys with its default reference frame. A joint that no track moves holds no
    /// change. Load code runs this once per clip; it allocates.
    pub fn additive(&self) -> Result<Clip, AnimationError> {
        let lanes = self.base.lanes() as usize;
        let mut reference = filled(self.pose_len(), 0.0f32)?;
        self.sample(0.0, &mut reference);
        let rotation_of = |joint: usize| -> [f64; 4] {
            std::array::from_fn(|c| f64::from(reference[(field::ROTATION + c) * lanes + joint]))
        };
        let mut base = self.base.clone();
        {
            let values = base.values_mut();
            for joint in 0..lanes {
                let at = |f: usize| f * lanes + joint;
                for f in (field::TRANSLATION..field::ROTATION).chain(field::SCALE..POSE_FIELDS) {
                    values[at(f)] -= reference[at(f)];
                }
                let q: [f64; 4] =
                    std::array::from_fn(|c| f64::from(values[at(field::ROTATION + c)]));
                let delta = relative(rotation_of(joint), q);
                for (c, v) in delta.iter().enumerate() {
                    values[at(field::ROTATION + c)] = *v as f32;
                }
            }
        }
        let mut rotations = self.rotations.clone();
        let groups = rotations.joints.len();
        for (k, key) in rotations
            .keys
            .as_chunks_mut::<ROTATION_KEY>()
            .0
            .iter_mut()
            .enumerate()
        {
            let joints = rotations.joints[k % groups];
            for (lane, &joint) in joints.iter().enumerate() {
                let q: [f64; 4] =
                    std::array::from_fn(|c| f64::from(key[4 * c + lane]) / QUANTIZED_ONE);
                // The keys of a track stay in one hemisphere after the product, which keeps the
                // angle between any two quaternions.
                let delta = relative(rotation_of(joint as usize), q);
                for (c, v) in delta.iter().enumerate() {
                    key[4 * c + lane] = (v * QUANTIZED_ONE)
                        .round()
                        .clamp(-QUANTIZED_ONE, QUANTIZED_ONE)
                        as i16;
                }
            }
        }
        let subtract = |groups: &Groups<f32>, first_field: usize| {
            let mut out = groups.clone();
            let count = out.joints.len();
            for (k, key) in out
                .keys
                .as_chunks_mut::<VECTOR_KEY>()
                .0
                .iter_mut()
                .enumerate()
            {
                for (lane, &joint) in out.joints[k % count].iter().enumerate() {
                    for c in 0..3 {
                        key[4 * c + lane] -= reference[(first_field + c) * lanes + joint as usize];
                    }
                }
            }
            out
        };
        Ok(Clip {
            base,
            channels: self.channels.clone(),
            rotations,
            translations: subtract(&self.translations, field::TRANSLATION),
            scales: subtract(&self.scales, field::SCALE),
            ..*self
        })
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

/// The dot product of two rotation keys that lie about 0.2 radians apart: cos(0.1).
pub(crate) const SMALL_TURN_DOT: f32 = 0.995;

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
    // The keys' dot product, scaled from quantized units to 1.
    let unit = f32x4::splat((1.0 / (QUANTIZED_ONE * QUANTIZED_ONE)) as f32);
    for (g, joints) in groups.joints.iter().enumerate() {
        let at = g * ROTATION_KEY;
        let key = |keys: &[i16], c: usize| -> f32x4 {
            let o = at + 4 * c;
            i16x4::from_slice(&keys[o..o + 4]).cast()
        };
        let ka: [f32x4; 4] = std::array::from_fn(|c| key(a, c));
        let kb: [f32x4; 4] = std::array::from_fn(|c| key(b, c));
        // Resampling keeps each key in the hemisphere of the key before, so the dot product is
        // positive, and the correction makes the blend follow the arc as `slerp` does. Files
        // whose joints turn fast between keys, such as Fox's run at 24 keys per second, turn a
        // joint up to 1.5 radians from one key to the next.
        // Below about 0.2 radians between keys, plain interpolation already stays within 3.2e-5
        // radians of `slerp`. Groups whose tracks never turn further skip the test, and the
        // others skip the correction at frames where they turn no further.
        let mut t = weight_of(groups, g, fraction);
        if g < groups.first_small_turn {
            let dot = (ka[0] * kb[0] + ka[1] * kb[1] + ka[2] * kb[2] + ka[3] * kb[3]) * unit;
            let dot = dot.abs().simd_min(f32x4::splat(1.0));
            if dot.simd_lt(f32x4::splat(SMALL_TURN_DOT)).any() {
                t = arc_weight(t, dot);
            }
        }
        let lerp = |c: usize| ka[c] + (kb[c] - ka[c]) * t;
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

/// The rotation that turns `reference` into `q`, normalized: the conjugate of `reference` times
/// `q`. A quaternion of length 0 becomes the identity.
fn relative(reference: [f64; 4], q: [f64; 4]) -> [f64; 4] {
    let [ax, ay, az, aw] = [-reference[0], -reference[1], -reference[2], reference[3]];
    let [bx, by, bz, bw] = q;
    let out = [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
    let length = out.iter().map(|v| v * v).sum::<f64>().sqrt();
    if length > 0.0 {
        out.map(|v| v / length)
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}
