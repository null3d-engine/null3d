//! Builds a [`Clip`] from keys at any times, once at load: the keys are resampled at one fixed
//! rate, rotations are quantized to 16 bits per component, and constant tracks are folded into the
//! base pose.
//!
//! Resampling evaluates each track as three.js's `AnimationMixer` would: linear tracks with
//! `slerp` for rotations and `lerp` for the rest, step tracks with the key at or before the time,
//! and cubic spline tracks with the Hermite curve of glTF, as three.js's `GLTFLoader` evaluates
//! them. Before the first key a track holds its first value, and after the last its last value.
//!
//! A track of one key, or of one key at each frame's time, needs no evaluation: its keys are
//! copied. [`bake`] gives every track of a clip that form, which the asset tool writes, so its
//! files load with copies only.

use super::clip::{ClipParts, Groups, ROTATION_KEY, SMALL_TURN_DOT, VECTOR_KEY};
use super::{AnimationError, Clip, Skeleton, TrackProblem, field, filled, out_of_memory};

/// The rate at which clips keep their keys, in keys per second, unless the caller asks for
/// another.
pub const DEFAULT_RATE: f32 = 30.0;

/// The most frames one clip holds: about 9.7 hours at 30 keys per second. Longer clips come from
/// broken files.
pub const MAX_FRAMES: u32 = 1 << 20;

/// How far past a whole number of frames a clip's end may lie and still end on that frame, in
/// frames, as far as a key may lie from the source grid.
const FRAME_TOLERANCE: f64 = 1e-3;

/// How far after a frame's time, as a share of the time, a key still counts as at the frame: a
/// few times the rounding of a 32-bit float.
const KEY_TIME_TOLERANCE: f64 = 1e-6;

/// The scale of a quantized rotation component: the largest 16-bit value.
pub(super) const QUANTIZED_ONE: f64 = 32767.0;

/// How far a rotation key's length may lie from 1 and still be quantized as it is: a few steps of
/// a 16-bit component. A key stored as 16-bit integers then keeps its integers exactly.
const UNIT_TOLERANCE: f64 = 4.0 / QUANTIZED_ONE;

/// The words of each track's header in a clip's staging words: joint, channel, interpolation and
/// key count.
pub const TRACK_WORDS: u32 = 4;

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
    /// glTF's cubic spline: each key holds an in-tangent, a value and an out-tangent, in that
    /// order, and the value between two keys follows the Hermite curve through them.
    CubicSpline = 2,
}

impl Interpolation {
    /// The interpolation with this number, as `repr(u32)` gives it.
    pub const fn from_u32(value: u32) -> Option<Interpolation> {
        match value {
            0 => Some(Interpolation::Linear),
            1 => Some(Interpolation::Step),
            2 => Some(Interpolation::CubicSpline),
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
    /// [`Channel::components`] values per key, or three times as many for a cubic spline track:
    /// its in-tangent, value and out-tangent.
    pub values: &'a [f32],
}

impl SourceTrack<'_> {
    /// Values per key: [`Channel::components`], or three times as many for a cubic spline track.
    pub const fn key_values(&self) -> usize {
        match self.interpolation {
            Interpolation::CubicSpline => 3 * self.channel.components(),
            Interpolation::Linear | Interpolation::Step => self.channel.components(),
        }
    }
}

/// The tracks that a clip's staging words hold: `tracks` headers of [`TRACK_WORDS`] words (joint,
/// channel, interpolation, key count), then each track's key times and values as 32-bit floats,
/// track after track.
///
/// # Errors
/// When a header names no channel or interpolation, or the words end before a track's keys.
pub fn staged_tracks(words: &[u32], tracks: usize) -> Result<Vec<SourceTrack<'_>>, AnimationError> {
    let header = TRACK_WORDS as usize;
    if tracks.saturating_mul(header) > words.len() {
        return Err(AnimationError::Track {
            track: (words.len() / header) as u32,
            problem: TrackProblem::Keys,
        });
    }
    let floats = as_floats(words);
    let mut at = tracks * header;
    let mut out = Vec::new();
    out.try_reserve_exact(tracks)
        .map_err(|_| out_of_memory(tracks.saturating_mul(size_of::<SourceTrack<'_>>())))?;
    for track in 0..tracks {
        let problem = |problem| AnimationError::Track {
            track: track as u32,
            problem,
        };
        let head = &words[track * header..track * header + header];
        let channel = Channel::from_u32(head[1]).ok_or(problem(TrackProblem::Kind))?;
        let interpolation = Interpolation::from_u32(head[2]).ok_or(problem(TrackProblem::Kind))?;
        let keys = head[3] as usize;
        let per_key = match interpolation {
            Interpolation::CubicSpline => 3 * channel.components(),
            Interpolation::Linear | Interpolation::Step => channel.components(),
        };
        let end = keys
            .checked_mul(1 + per_key)
            .and_then(|n| n.checked_add(at))
            .filter(|&end| end <= floats.len());
        let Some(end) = end else {
            return Err(problem(TrackProblem::Keys));
        };
        out.push(SourceTrack {
            joint: head[0],
            channel,
            interpolation,
            times: &floats[at..at + keys],
            values: &floats[at + keys..end],
        });
        at = end;
    }
    Ok(out)
}

/// Staging words as 32-bit floats, which have the same size and alignment.
pub fn as_floats(words: &[u32]) -> &[f32] {
    // SAFETY: `u32` and `f32` have the same size and alignment, and every bit pattern is a float.
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast(), words.len()) }
}

/// Checks every track of a clip for a skeleton of `joints` joints.
fn check_tracks(joints: u32, tracks: &[SourceTrack<'_>]) -> Result<(), AnimationError> {
    let mut seen = filled(joints as usize, 0u8)?;
    for (index, track) in tracks.iter().enumerate() {
        check_track(joints, index, track, &mut seen)?;
    }
    Ok(())
}

fn check_track(
    joints: u32,
    index: usize,
    track: &SourceTrack<'_>,
    seen: &mut [u8],
) -> Result<(), AnimationError> {
    let problem = |problem| AnimationError::Track {
        track: index as u32,
        problem,
    };
    if track.joint >= joints {
        return Err(problem(TrackProblem::Joint));
    }
    let bit = 1u8 << track.channel as u32;
    let seen = &mut seen[track.joint as usize];
    if *seen & bit != 0 {
        return Err(problem(TrackProblem::Duplicate));
    }
    *seen |= bit;
    if track.times.is_empty() || track.values.len() != track.times.len() * track.key_values() {
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
    let tolerance = FRAME_TOLERANCE / rate;
    let on_grid = tracks.iter().flat_map(|t| t.times).all(|&time| {
        let time = f64::from(time);
        (time - (time * rate).round() / rate).abs() <= tolerance
    });
    on_grid.then_some(rate)
}

/// The rate a clip keeps its keys at: its source grid when every key lies on one of at most
/// `rate` keys per second, or `rate`. A curve between cubic spline keys needs keys between them,
/// so a clip with such a track takes the finest multiple of its source grid up to `rate`; keys on
/// the source grid then stay exact.
fn keys_per_second(tracks: &[SourceTrack<'_>], rate: f64) -> f64 {
    let Some(grid) = source_grid(tracks, rate) else {
        return rate;
    };
    if tracks
        .iter()
        .any(|t| t.interpolation == Interpolation::CubicSpline)
    {
        grid * (rate / grid * (1.0 + 1e-6)).floor().max(1.0)
    } else {
        grid
    }
}

/// A track's value at `time`, as three.js evaluates it, into `out`. `cursor` is the key at or
/// before the last time asked, which only moves forward.
fn evaluate(track: &SourceTrack<'_>, time: f64, cursor: &mut usize, out: &mut [f64]) {
    let n = track.channel.components();
    let stride = track.key_values();
    let cubic = track.interpolation == Interpolation::CubicSpline;
    // A cubic key's value sits after its in-tangent.
    let value_at = if cubic { n } else { 0 };
    let times = track.times;
    let part = |k: usize, at: usize| &track.values[k * stride + at..k * stride + at + n];
    let copy = |out: &mut [f64], k: usize| {
        for (o, v) in out.iter_mut().zip(part(k, value_at)) {
            *o = f64::from(*v);
        }
    };
    // Key times are 32-bit floats, so a key on the clip's grid can sit a rounding step after the
    // frame time computed for it. A key that close counts as reached, or a step track would take
    // the key before.
    let reached = time + time.abs() * KEY_TIME_TOLERANCE;
    if reached < f64::from(times[0]) {
        copy(out, 0);
        return;
    }
    while *cursor + 1 < times.len() && f64::from(times[*cursor + 1]) <= reached {
        *cursor += 1;
    }
    let k = *cursor;
    if k + 1 == times.len() || track.interpolation == Interpolation::Step {
        copy(out, k);
        return;
    }
    let (t0, t1) = (f64::from(times[k]), f64::from(times[k + 1]));
    let alpha = ((time - t0) / (t1 - t0)).clamp(0.0, 1.0);
    if cubic {
        // The Hermite basis of glTF's cubic spline, as three.js's `GLTFCubicSplineInterpolant`
        // weights it: tangents scale by the time between the keys. Rotations are normalized
        // afterwards, as its quaternion form does.
        let span = t1 - t0;
        let (p, pp) = (alpha, alpha * alpha);
        let ppp = pp * p;
        let s2 = -2.0 * ppp + 3.0 * pp;
        let s3 = ppp - pp;
        let s0 = 1.0 - s2;
        let s1 = s3 - pp + p;
        let (v0, m0) = (part(k, n), part(k, 2 * n));
        let (m1, v1) = (part(k + 1, 0), part(k + 1, n));
        for c in 0..n {
            out[c] = s0 * f64::from(v0[c])
                + s1 * f64::from(m0[c]) * span
                + s2 * f64::from(v1[c])
                + s3 * f64::from(m1[c]) * span;
        }
        return;
    }
    let (a, b) = (part(k, 0), part(k + 1, 0));
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
    /// A rotation track that turns further than [`SMALL_TURN_DOT`] allows between two frames.
    turns_far: bool,
    /// The track was evaluated at each frame, not copied.
    resampled: bool,
}

/// The time of frame `frame` of a clip of `frames` frames that lasts `duration` seconds.
fn frame_time(frame: usize, frames: u32, duration: f64) -> f64 {
    if frames > 1 {
        duration * frame as f64 / f64::from(frames - 1)
    } else {
        0.0
    }
}

/// True when a track holds one linear or step key at each frame's time, within a thousandth of a
/// frame: its keys are then the clip's keys.
fn on_frames(track: &SourceTrack<'_>, frames: u32, duration: f64) -> bool {
    if frames < 2
        || track.times.len() != frames as usize
        || track.interpolation == Interpolation::CubicSpline
    {
        return false;
    }
    let tolerance = FRAME_TOLERANCE * duration / f64::from(frames - 1);
    track
        .times
        .iter()
        .enumerate()
        .all(|(k, &t)| (f64::from(t) - frame_time(k, frames, duration)).abs() <= tolerance)
}

fn resample_track(
    track: &SourceTrack<'_>,
    frames: u32,
    duration: f64,
) -> Result<Resampled, AnimationError> {
    let n = track.channel.components();
    // A track of one key holds it throughout, and one with a key at each frame's time holds the
    // clip's keys: both are copied. Only the others are evaluated at each frame.
    let keys = if track.times.len() == 1 {
        1
    } else {
        frames as usize
    };
    let copied = keys == 1 || on_frames(track, frames, duration);
    let stride = track.key_values();
    // A cubic key's value sits after its in-tangent.
    let value_at = if track.interpolation == Interpolation::CubicSpline {
        n
    } else {
        0
    };
    let mut values = filled(keys * n, 0i32)?;
    let mut cursor = 0;
    let mut current = [0.0f64; 4];
    let mut previous = [0.0f64; 4];
    let mut first = [0.0f32; 4];
    for frame in 0..keys {
        if copied {
            let key = &track.values[frame * stride + value_at..][..n];
            for (c, v) in current.iter_mut().zip(key) {
                *c = f64::from(*v);
            }
        } else {
            let time = frame_time(frame, frames, duration);
            evaluate(track, time, &mut cursor, &mut current[..n]);
        }
        let out = &mut values[frame * n..frame * n + n];
        if track.channel == Channel::Rotation {
            let length = current.iter().map(|v| v * v).sum::<f64>().sqrt();
            let mut q = if (length - 1.0).abs() <= UNIT_TOLERANCE {
                current
            } else if length > 0.0 {
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
    let turns_far = track.channel == Channel::Rotation
        && (1..keys).any(|frame| {
            let (a, b) = (
                &values[(frame - 1) * n..frame * n],
                &values[frame * n..][..n],
            );
            let dot: f64 = a.iter().zip(b).map(|(a, b)| f64::from(a * b)).sum();
            dot / (QUANTIZED_ONE * QUANTIZED_ONE) < f64::from(SMALL_TURN_DOT)
        });
    Ok(Resampled {
        joint: track.joint,
        channel: track.channel,
        step: track.interpolation == Interpolation::Step,
        values,
        first,
        constant,
        turns_far,
        resampled: !copied,
    })
}

/// Lays out the animated tracks of one channel in groups of four: linear tracks that turn far
/// between frames first, then the other linear tracks, then step tracks, each in joint order.
/// `convert` turns a resampled value into a key.
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
    animated.sort_unstable_by_key(|t| (t.step, !t.turns_far, t.joint));
    let linear = animated.iter().filter(|t| !t.step).count();
    let far = animated.iter().filter(|t| !t.step && t.turns_far).count();
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
        first_small_turn: far.div_ceil(4),
        first_step: linear_groups,
        keys: keys.into_boxed_slice(),
    })
}

/// Builds a clip for `skeleton` from its tracks. A joint that no track moves keeps its rest pose.
///
/// The clip lasts until the last key of its longest track. When every key time lies on one grid
/// of at most `rate` keys per second, the clip keeps that grid and loses nothing; with a cubic
/// spline track, it takes the finest multiple of that grid up to `rate`. Otherwise it takes keys
/// at `rate` per second, adjusted so that the last key falls on the clip's end. A rate that is not
/// a positive number takes [`DEFAULT_RATE`].
///
/// Load code runs this once per clip, on a job worker; it allocates.
pub fn resample(
    skeleton: &Skeleton,
    tracks: &[SourceTrack<'_>],
    rate: f32,
) -> Result<Clip, AnimationError> {
    let (frames, duration, resampled) = resample_tracks(skeleton.joints(), tracks, rate)?;
    let resampled_tracks = resampled.iter().filter(|t| t.resampled).count() as u32;

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
        resampled_tracks,
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

/// Checks a clip's tracks for a skeleton of `joints` joints, and puts each on the clip's frames:
/// returns the frame count, the clip's length in seconds and the tracks' keys.
fn resample_tracks(
    joints: u32,
    tracks: &[SourceTrack<'_>],
    rate: f32,
) -> Result<(u32, f64, Vec<Resampled>), AnimationError> {
    check_tracks(joints, tracks)?;
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
        let keys_per_second = keys_per_second(tracks, rate);
        // The clip's end is a 32-bit float, which can round past its last frame by a few
        // millionths of a frame: a key within a thousandth of a frame counts as on it, as the
        // grid's keys do (`source_grid`).
        let intervals = (duration * keys_per_second - FRAME_TOLERANCE)
            .ceil()
            .max(1.0);
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
    Ok((frames, duration, resampled))
}

/// The keys of one track that [`bake`] put on its clip's frames.
#[derive(Clone, Debug, PartialEq)]
pub enum BakedKeys {
    /// A rotation that changes: one key per frame, four 16-bit integers each, the unit quaternion
    /// times 32767, as a clip stores it. Each key lies in the hemisphere of the key before.
    Rotations(Vec<i16>),
    /// A translation or scale that changes: one key per frame, three floats each. Or a track
    /// whose value never changes: one key, with a rotation as a unit quaternion of four floats.
    Floats(Vec<f32>),
}

/// A clip's tracks put on the frames that [`resample`] gives the clip, in the form that
/// [`resample`] copies without evaluation: each track that changes holds one key at each frame's
/// time, and each track that does not holds one key.
#[derive(Clone, Debug, PartialEq)]
pub struct BakedClip {
    /// The time of each frame in seconds, from 0 to the clip's length. The one key of a track
    /// that does not change goes at the last time, so the clip keeps its length.
    pub times: Vec<f32>,
    /// Each track's keys, in the order of the tracks given.
    pub tracks: Vec<BakedKeys>,
}

/// Puts a clip's tracks on its frames, as [`resample`] would for a skeleton of `joints` joints,
/// and gives their keys in the form that [`resample`] copies: the asset tool stores clips so.
/// Step tracks keep their steps at the frames, and cubic spline tracks become linear keys on the
/// curve. The keys are the clip's keys, so a clip built from the baked tracks equals one built
/// from the source tracks. The tool runs it once per clip; it allocates.
pub fn bake(
    tracks: &[SourceTrack<'_>],
    joints: u32,
    rate: f32,
) -> Result<BakedClip, AnimationError> {
    let (frames, duration, resampled) = resample_tracks(joints, tracks, rate)?;
    let mut times = filled(frames as usize, 0.0f32)?;
    for (frame, time) in times.iter_mut().enumerate() {
        *time = frame_time(frame, frames, duration) as f32;
    }
    let mut baked = Vec::new();
    baked
        .try_reserve_exact(resampled.len())
        .map_err(|_| out_of_memory(resampled.len() * size_of::<BakedKeys>()))?;
    for track in &resampled {
        let n = track.channel.components();
        baked.push(if track.constant {
            BakedKeys::Floats(track.first[..n].to_vec())
        } else if track.channel == Channel::Rotation {
            BakedKeys::Rotations(track.values.iter().map(|&v| v as i16).collect())
        } else {
            BakedKeys::Floats(
                track
                    .values
                    .iter()
                    .map(|&v| f32::from_bits(v as u32))
                    .collect(),
            )
        });
    }
    Ok(BakedClip {
        times,
        tracks: baked,
    })
}
