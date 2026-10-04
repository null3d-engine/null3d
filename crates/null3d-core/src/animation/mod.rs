//! Skeletal animation: skeletons, clips stored for fast sampling, and the frame step that turns
//! each animated instance's clips into skinning matrices on the job workers.
//!
//! # Data
//!
//! - A [`Skeleton`] lists its joints parents first, with each joint's rest pose and inverse bind
//!   matrix.
//! - A [`Clip`] holds keys at one fixed rate per clip, so the key before any time is a direct
//!   index. [`resample`] builds one from keys at any times, once at load. Rotations are stored as
//!   four 16-bit integers each, and a track whose value never changes is stored once.
//! - A pose is stored by field: ten arrays (translation x, y and z, rotation x, y, z and w, scale
//!   x, y and z), each with one value per joint and padded to a multiple of four joints. SIMD code
//!   then reads and writes four joints at once.
//!
//! # The frame step
//!
//! [`Animations::update`] runs one parallel loop over the animated instances. For each instance,
//! one chunk of the loop samples its clips at their times, blends them by weight, builds the local
//! matrices, composes them parents first, and applies the inverse bind matrices. It writes one
//! 3 × 4 skinning matrix of 48 bytes per joint. Characters are independent, so the loop needs no
//! synchronization beyond its end, and each thread works in scratch memory of its own.
//!
//! # Blending
//!
//! Rotations blend with normalized linear interpolation: a weighted sum of quaternions, each
//! flipped into the hemisphere of the sum so far, then normalized. Translations and scales take
//! the weighted average. When the weights add up to less than 1, the rest pose makes up the
//! remainder, as three.js's `AnimationMixer` does.

mod actions;
mod clip;
mod pose;
mod resample;
mod skeleton;
mod system;

pub use actions::{Action, event_kind, flag};
pub use clip::Clip;
pub use pose::Pose;
pub use resample::{Channel, DEFAULT_RATE, Interpolation, MAX_FRAMES, SourceTrack, resample};
pub use skeleton::{MAX_JOINTS, NO_PARENT, REST_FLOATS, Skeleton};
pub use system::{
    Animations, Blend, EVENT_CAPACITY, EVENT_WORDS, INSTANCE_CHUNK, MAX_BLEND, MAX_LAYERS,
    NO_SOURCE, Play, SampleSlots,
};

/// Floats per skinning matrix: a row-major 3 × 4 matrix of 48 bytes, as world matrices are.
pub use crate::world::MATRIX_FLOATS;

use crate::error::CoreError;

/// Why animation data makes no skeleton, clip or animated instance.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnimationError {
    /// A skeleton has no joint, or more than [`MAX_JOINTS`].
    Joints {
        /// The joint count it was given.
        joints: u32,
    },
    /// A joint's parent is the joint itself or a later joint: joints come parents first.
    Parent {
        /// The joint.
        joint: u32,
        /// Its parent.
        parent: u32,
    },
    /// An array of a skeleton has the wrong length for its joint count.
    Length {
        /// 0 for the rest pose, 1 for the inverse bind matrices.
        array: u32,
        /// The number of values it must hold.
        expected: u32,
    },
    /// A skeleton's value is NaN or infinite.
    NotFinite {
        /// The joint whose value it is.
        at: u32,
    },
    /// A clip's track is wrong.
    Track {
        /// The track's index among the clip's tracks.
        track: u32,
        /// What is wrong with it.
        problem: TrackProblem,
    },
    /// A clip would hold more than [`MAX_FRAMES`] frames.
    Frames {
        /// The frames it would hold.
        frames: u32,
    },
    /// No skeleton has this id.
    UnknownSkeleton {
        /// The id.
        skeleton: u32,
    },
    /// The clip was built for a skeleton with another joint count.
    WrongSkeleton {
        /// The clip's joint count.
        clip_joints: u32,
        /// The skeleton's joint count.
        skeleton_joints: u32,
    },
    /// No live animated instance has this id.
    UnknownInstance {
        /// The id.
        instance: u32,
    },
    /// No clip has this id, or it belongs to another skeleton.
    UnknownClip {
        /// The id.
        clip: u32,
    },
    /// A layer at or past [`MAX_LAYERS`].
    Layer {
        /// The layer.
        layer: u32,
    },
    /// A play's option is out of range: 0 for a fade that is negative or not finite, 1 for a
    /// speed that is not finite.
    Play {
        /// Which option.
        option: u32,
    },
    /// A clip event's time is not finite or lies outside the clip, or the times and ids differ
    /// in number.
    Events {
        /// The event.
        event: u32,
    },
    /// A joint mask's weight lies outside 0 to 1, or the mask has a weight count other than the
    /// skeleton's joint count.
    Mask {
        /// The joint, or the weight count.
        joint: u32,
    },
    /// No joint mask of the instance's skeleton has this id.
    UnknownMask {
        /// The id.
        mask: u32,
    },
    /// The engine's memory or a fixed capacity ran out.
    Core(CoreError),
}

/// What is wrong with one track of a clip.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum TrackProblem {
    /// It names a joint the skeleton does not have.
    Joint = 1,
    /// Another track already moves the same joint's same channel.
    Duplicate = 2,
    /// It has no key, or a number of values that is not the key count times the channel's
    /// components.
    Keys = 3,
    /// A key time is negative, NaN or infinite, or earlier than the key before it.
    Times = 4,
    /// A value is NaN or infinite.
    Values = 5,
    /// Its channel or interpolation has a number that names none.
    Kind = 6,
}

/// Values per joint in a local pose: translation (3), rotation (4) and scale (3).
pub const POSE_FIELDS: usize = 10;

/// The field index of each value of a local pose. Field `f` of joint `j` sits at `f * lanes + j`.
pub mod field {
    /// Translation along x; y and z follow.
    pub const TRANSLATION: usize = 0;
    /// Rotation quaternion's x; y, z and w follow.
    pub const ROTATION: usize = 3;
    /// Scale along x; y and z follow.
    pub const SCALE: usize = 7;
}

/// The error of an allocation of `bytes` that the engine's memory could not hold.
fn out_of_memory(bytes: usize) -> AnimationError {
    AnimationError::Core(CoreError::OutOfMemory {
        bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
    })
}

/// A vector of `len` copies of `value`, or an out-of-memory error when memory cannot grow for it.
fn filled<T: Clone>(len: usize, value: T) -> Result<Vec<T>, AnimationError> {
    crate::alloc::filled(len, value).map_err(|_| out_of_memory(len.saturating_mul(size_of::<T>())))
}

/// The joint count rounded up to a multiple of four, the width of one SIMD operation.
#[inline]
pub const fn lanes_for(joints: u32) -> u32 {
    joints.div_ceil(4) * 4
}
