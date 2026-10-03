//! Builds a [`Clip`] from keys at any times, once at load: the keys are resampled at one fixed
//! rate, rotations are quantized to 16 bits per component, and constant tracks are folded into the
//! base pose.
//!
//! Resampling evaluates each track as three.js's `AnimationMixer` would: linear tracks with
//! `slerp` for rotations and `lerp` for the rest, step tracks with the key at or before the time.
//! Before the first key a track holds its first value, and after the last its last value.

use super::clip::{ClipParts, Groups, ROTATION_KEY, VECTOR_KEY};
use super::{AnimationError, Clip, Skeleton, TrackProblem, field, filled, out_of_memory};

/// The rate at which clips keep their keys, in keys per second, unless the caller asks for
/// another.
pub const DEFAULT_RATE: f32 = 30.0;

/// The most frames one clip holds: about 9.7 hours at 30 keys per second. Longer clips come from
/// broken files.
pub const MAX_FRAMES: u32 = 1 << 20;

/// The scale of a quantized rotation component: the largest 16-bit value.
const QUANTIZED_ONE: f64 = 32767.0;

/// What a track animates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum Channel {
    /// The joint's translation: three values per key.
    Translation = 0,
    /// The joint's rotation as a quaternion `(x, y, z, w)`: four values per key.
    Rotation = 1,
    /// The joint's scale: three values per key.
    Scale = 2,
}

impl Channel {
    /// Values per key.
    pub const fn components(self) -> usize {
        match self {
            Channel::Rotation => 4,
            Channel::Translation | Channel::Scale => 3,
        }
    }

    /// The channel with this number, as `repr(u32)` gives it.
    pub const fn from_u32(value: u32) -> Option<Channel> {
        match value {
            0 => Some(Channel::Translation),
            1 => Some(Channel::Rotation),
            2 => Some(Channel::Scale),
            _ => None,
        }
    }
}

/// How a track's value moves between its keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum Interpolation {
    /// Straight between the keys; rotations along the shorter arc.
    Linear = 0,
    /// The key at or before the time, with no change until the next key.
    Step = 1,
}

impl Interpolation {
    /// The interpolation with this number, as `repr(u32)` gives it.
    pub const fn from_u32(value: u32) -> Option<Interpolation> {
        match value {
            0 => Some(Interpolation::Linear),
            1 => Some(Interpolation::Step),
            _ => None,
        }
    }
}

/// One track of a clip as a file holds it: keys at any times, which [`resample`] reads.
#[derive(Clone, Copy, Debug)]
pub struct SourceTrack<'a> {
    /// The joint the track moves.
    pub joint: u32,
    /// What it moves.
    pub channel: Channel,
    /// How the value moves between keys.
    pub interpolation: Interpolation,
    /// The key times in seconds, from 0 up, never decreasing. Two equal times make a jump.
    pub times: &'a [f32],
    /// [`Channel::components`] values per key.
    pub values: &'a [f32],
}

fn check_track(
    skeleton: &Skeleton,
    index: usize,
    track: &SourceTrack<'_>,
    seen: &mut [u8],
) -> Result<(), AnimationError> {
    let problem = |problem| AnimationError::Track {
        track: index as u32,
        problem,
    };
    if track.joint >= skeleton.joints() {
        return Err(problem(TrackProblem::Joint));
    }
    let bit = 1u8 << track.channel as u32;
    let seen = &mut seen[track.joint as usize];
    if *seen & bit != 0 {
        return Err(problem(TrackProblem::Duplicate));
    }
    *seen |= bit;
    if track.times.is_empty()
        || track.values.len() != track.times.len() * track.channel.components()
    {
        return Err(problem(TrackProblem::Keys));
    }
    let ordered = track.times.windows(2).all(|w| w[0] <= w[1]);
    if !ordered || track.times.iter().any(|t| !t.is_finite() || *t < 0.0) {
        return Err(problem(TrackProblem::Times));
    }
    if track.values.iter().any(|v| !v.is_finite()) {
        return Err(problem(TrackProblem::Values));
    }
    Ok(())
}

/// The rate of the grid that every key time lies on, when the grid has at most `max_rate` keys
/// per second. A rate within a thousandth of a whole number snaps to it.
fn source_grid(tracks: &[SourceTrack<'_>], max_rate: f64) -> Option<f64> {
    let step = tracks
        .iter()
        .flat_map(|t| t.times.windows(2))
        .map(|w| f64::from(w[1]) - f64::from(w[0]))
        .filter(|gap| *gap > 0.0)
        .fold(f64::INFINITY, f64::min);
    if !step.is_finite() {
        return None;
    }
    let mut rate = 1.0 / step;
    if (rate - rate.round()).abs() < 1e-3 {
        rate = rate.round();
    }
    if rate > max_rate * (1.0 + 1e-6) {
        return None;
    }
    let tolerance = 1e-3 / rate;
    let on_grid = tracks.iter().flat_map(|t| t.times).all(|&time| {
        let time = f64::from(time);
        (time - (time * rate).round() / rate).abs() <= tolerance
    });
    on_grid.then_some(rate)
}

/// A track's value at `time`, as three.js evaluates it, into `out`. `cursor` is the key at or
/// before the last time asked, which only moves forward.
fn evaluate(track: &SourceTrack<'_>, time: f64, cursor: &mut usize, out: &mut [f64]) {
    let n = track.channel.components();
    let times = track.times;
    let key = |k: usize| &track.values[k * n..k * n + n];
    let copy = |out: &mut [f64], k: usize| {
        for (o, v) in out.iter_mut().zip(key(k)) {
            *o = f64::from(*v);
        }
    };
    if time < f64::from(times[0]) {
        copy(out, 0);
        return;
    }
    while *cursor + 1 < times.len() && f64::from(times[*cursor + 1]) <= time {
        *cursor += 1;
    }
    let k = *cursor;
    if k + 1 == times.len() || track.interpolation == Interpolation::Step {
        copy(out, k);
        return;
    }
    let (t0, t1) = (f64::from(times[k]), f64::from(times[k + 1]));
    let alpha = (time - t0) / (t1 - t0);
    let (a, b) = (key(k), key(k + 1));
    if track.channel == Channel::Rotation {
        slerp(a, b, alpha, out);
    } else {
        for c in 0..n {
            let (a, b) = (f64::from(a[c]), f64::from(b[c]));
            out[c] = a + (b - a) * alpha;
        }
    }
}

/// Spherical interpolation along the shorter arc, as three.js's `Quaternion.slerpFlat`.
fn slerp(a: &[f32], b: &[f32], t: f64, out: &mut [f64]) {
    let a: [f64; 4] = std::array::from_fn(|k| f64::from(a[k]));
    let b: [f64; 4] = std::array::from_fn(|k| f64::from(b[k]));
    let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let dir = if cos >= 0.0 { 1.0 } else { -1.0 };
    let sin_sq = 1.0 - cos * cos;
    let (mut s, mut u) = (1.0 - t, t);
    let along_arc = sin_sq > f64::EPSILON;
    if along_arc {
        let sin = sin_sq.sqrt();
        let angle = sin.atan2(cos * dir);
        s = (s * angle).sin() / sin;
        u = (u * angle).sin() / sin;
    }
    for k in 0..4 {
        out[k] = a[k] * s + b[k] * u * dir;
    }
    if !along_arc {
        let length = out.iter().map(|v| v * v).sum::<f64>().sqrt();
        if length > 0.0 {
            out.iter_mut().for_each(|v| *v /= length);
        }
    }
}

/// One track resampled at the clip's frames.
struct Resampled {
    joint: u32,
    channel: Channel,
    step: bool,
    /// Frame by frame, [`Channel::components`] values each: quantized rotations, or the bits of
    /// 32-bit floats.
    values: Vec<i32>,
    /// The value at the first frame, rotations normalized: what a constant track stores.
    first: [f32; 4],
    constant: bool,
}

fn resample_track(
    track: &SourceTrack<'_>,
    frames: u32,
    duration: f64,
) -> Result<Resampled, AnimationError> {
    let n = track.channel.components();
    let mut values = filled(frames as usize * n, 0i32)?;
    let mut cursor = 0;
    let mut current = [0.0f64; 4];
    let mut previous = [0.0f64; 4];
    let mut first = [0.0f32; 4];
    for frame in 0..frames as usize {
        let time = if frames > 1 {
            duration * frame as f64 / f64::from(frames - 1)
        } else {
            0.0
        };
        evaluate(track, time, &mut cursor, &mut current[..n]);
        let out = &mut values[frame * n..frame * n + n];
        if track.channel == Channel::Rotation {
            let length = current.iter().map(|v| v * v).sum::<f64>().sqrt();
            let mut q = if length > 0.0 {
                current.map(|v| v / length)
            } else {
                [0.0, 0.0, 0.0, 1.0]
            };
            let dot: f64 = q.iter().zip(&previous).map(|(a, b)| a * b).sum();
            if frame > 0 && dot < 0.0 {
                q = q.map(|v| -v);
            }
            previous = q;
            if frame == 0 {
                first = q.map(|v| v as f32);
            }
            for (o, v) in out.iter_mut().zip(q) {
                *o = (v * QUANTIZED_ONE).round() as i32;
            }
        } else {
            for (c, (o, v)) in out.iter_mut().zip(&current[..n]).enumerate() {
                *o = (*v as f32).to_bits() as i32;
                if frame == 0 {
                    first[c] = *v as f32;
                }
            }
        }
    }
    let first_key = &values[..n];
    let constant = values.chunks_exact(n).all(|key| key == first_key);
    Ok(Resampled {
        joint: track.joint,
        channel: track.channel,
        step: track.interpolation == Interpolation::Step,
        values,
        first,
        constant,
    })
}

/// Lays out the animated tracks of one channel in groups of four: linear tracks first, then step
/// tracks, each in joint order. `convert` turns a resampled value into a key.
fn groups<T: Copy + Default>(
    tracks: &[Resampled],
    channel: Channel,
    frames: u32,
    key: usize,
    convert: impl Fn(i32) -> T,
) -> Result<Groups<T>, AnimationError> {
    let mut animated: Vec<&Resampled> = tracks
        .iter()
        .filter(|t| t.channel == channel && !t.constant)
        .collect();
    // A channel has one track per joint, so the keys are unique and an unstable sort is exact.
    animated.sort_unstable_by_key(|t| (t.step, t.joint));
    let linear = animated.iter().filter(|t| !t.step).count();
    // Linear and step tracks never share a group.
    let linear_groups = linear.div_ceil(4);
    let count = linear_groups + (animated.len() - linear).div_ceil(4);
    let mut joints = filled(count, [0u32; 4])?;
    let mut keys = filled(frames as usize * count * key, T::default())?;
    let n = channel.components();
    for (g, joint) in joints.iter_mut().enumerate() {
        let members = if g < linear_groups {
            &animated[g * 4..(g * 4 + 4).min(linear)]
        } else {
            let start = linear + (g - linear_groups) * 4;
            &animated[start..(start + 4).min(animated.len())]
        };
        for lane in 0..4 {
            // A group with fewer than four tracks repeats its last one.
            let track = members[lane.min(members.len() - 1)];
            joint[lane] = track.joint;
            for frame in 0..frames as usize {
                let base = (frame * count + g) * key;
                for c in 0..n {
                    keys[base + c * 4 + lane] = convert(track.values[frame * n + c]);
                }
            }
        }
    }
    Ok(Groups {
        joints: joints.into_boxed_slice(),
        first_step: linear_groups,
        keys: keys.into_boxed_slice(),
    })
}

/// Builds a clip for `skeleton` from its tracks. A joint that no track moves keeps its rest pose.
///
/// The clip lasts until the last key of its longest track. When every key time lies on one grid
/// of at most `rate` keys per second, the clip keeps that grid and loses nothing. Otherwise it
/// takes keys at `rate` per second, adjusted so that the last key falls on the clip's end. A rate
/// that is not a positive number takes [`DEFAULT_RATE`].
///
/// Load code runs this once per clip, on a job worker; it allocates.
pub fn resample(
    skeleton: &Skeleton,
    tracks: &[SourceTrack<'_>],
    rate: f32,
) -> Result<Clip, AnimationError> {
    let mut seen = filled(skeleton.joints() as usize, 0u8)?;
    for (index, track) in tracks.iter().enumerate() {
        check_track(skeleton, index, track, &mut seen)?;
    }
    let rate = if rate.is_finite() && rate > 0.0 {
        f64::from(rate)
    } else {
        f64::from(DEFAULT_RATE)
    };
    let duration = tracks
        .iter()
        .map(|t| f64::from(t.times[t.times.len() - 1]))
        .fold(0.0, f64::max);
    let frames = if duration > 0.0 {
        let keys_per_second = source_grid(tracks, rate).unwrap_or(rate);
        let intervals = (duration * keys_per_second - 1e-6).ceil().max(1.0);
        if intervals >= f64::from(MAX_FRAMES) {
            return Err(AnimationError::Frames {
                frames: intervals.min(f64::from(u32::MAX)) as u32,
            });
        }
        intervals as u32 + 1
    } else {
        1
    };

    let mut resampled = Vec::new();
    resampled
        .try_reserve_exact(tracks.len())
        .map_err(|_| out_of_memory(tracks.len() * size_of::<Resampled>()))?;
    for track in tracks {
        resampled.push(resample_track(track, frames, duration)?);
    }

    let mut base = skeleton.rest().clone();
    let lanes = base.lanes() as usize;
    let mut channels = filled(3 * lanes, 0.0f32)?;
    for track in &resampled {
        let joint = track.joint as usize;
        channels[track.channel as usize * lanes + joint] = 1.0;
        if track.constant {
            let first = match track.channel {
                Channel::Translation => field::TRANSLATION,
                Channel::Rotation => field::ROTATION,
                Channel::Scale => field::SCALE,
            };
            let values = base.values_mut();
            for c in 0..track.channel.components() {
                values[(first + c) * lanes + joint] = track.first[c];
            }
        }
    }

    let as_float = |v: i32| f32::from_bits(v as u32);
    Ok(Clip::from_parts(ClipParts {
        joints: skeleton.joints(),
        duration: duration as f32,
        rate: if frames > 1 {
            (f64::from(frames - 1) / duration) as f32
        } else {
            0.0
        },
        frames,
        tracks: tracks.len() as u32,
        base,
        channels: channels.into_boxed_slice(),
        rotations: groups(&resampled, Channel::Rotation, frames, ROTATION_KEY, |v| {
            v as i16
        })?,
        translations: groups(
            &resampled,
            Channel::Translation,
            frames,
            VECTOR_KEY,
            as_float,
        )?,
        scales: groups(&resampled, Channel::Scale, frames, VECTOR_KEY, as_float)?,
    }))
}
