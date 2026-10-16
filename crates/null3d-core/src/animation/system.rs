//! The animation table: skeletons, clips, joint masks and animated instances, and the frame step
//! that advances every instance's clips and writes its skinning matrices on the job workers.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use super::actions::{Action, Advance, EventSink, flag, start_time};
use super::joints::{self, BLOCK_FLOATS};
use super::pose::{
    add_additive, add_weights, apply_additive, blend, clear_additive, dead_blend, layer_shares,
    local_matrices, rest_shares, smoothstep, start_weights,
};
use super::{AnimationError, Clip, NO_PARENT, POSE_FIELDS, Skeleton, field, filled, out_of_memory};
use crate::error::{CoreError, Resource};
use crate::jobs::{JobSystem, WorkerId};
use crate::math::{Affine, Affine64, invert64, mul};
use crate::shared::SharedMut;
use crate::world::MATRIX_FLOATS;

/// The most clips one instance blends in a frame: its sample slots. Two layers that each fade
/// between two clips, with an additive clip on top and a slot to spare for a quick change of
/// mind, fit.
pub const MAX_BLEND: usize = 8;

/// The layers of each instance. Layer 0 blends its clips as three.js's mixer does; each layer
/// above replaces the pose below by its weight.
pub const MAX_LAYERS: usize = 4;

/// Instances per chunk of the frame step's parallel loop. A character of 30 to 60 joints takes a
/// few microseconds, so a few of them make a chunk worth handing to another thread.
pub const INSTANCE_CHUNK: u32 = 4;

/// The events that one frame step reports at most. Later ones are counted, not kept.
pub const EVENT_CAPACITY: usize = 1024;

/// Words per event record: the instance; the event's order within the instance's frame (high 16
/// bits), its kind (bits 8 to 15) and its clip's layer (low 8 bits); the clip; the clip event's id.
pub const EVENT_WORDS: usize = 4;

/// The skeleton of an instance id that holds no instance, and of a removed clip or mask.
const REMOVED: u32 = u32::MAX;

/// The source clip of a sample slot that no play fills ([`SampleSlots::source`]).
pub const NO_SOURCE: u32 = u32::MAX;

/// The pose step of an instance whose matrices no frame step has written yet. The next step counts
/// its pose as changed, whatever the matrices it replaces.
const FRESH: u32 = u32::MAX;

/// The dead-blend record of a layer that runs no blend ([`Animations::transition_of`]).
const NO_TRANSITION: u32 = u32::MAX;

/// The dead-blend records a table's pool starts with. A record costs one pose of the largest
/// skeleton, so the pool starts small and doubles as blends start ([`Animations::grow_pool`]).
const SEED_TRANSITIONS: usize = 8;

/// The sample slots of every instance: slot `k` of instance `i` sits at `i * MAX_BLEND + k`. Each
/// frame, every slot with a weight above 0 samples its clip at its time, and the instance's pose
/// is the blend of those samples. A slot whose clip belongs to another skeleton, or whose weight
/// is not a positive number, is skipped. The arrays move only when the table grows, so another
/// thread's view of them stays valid until then. A slot that [`Animations::play`] fills also advances its time and fades its
/// weight in each frame step.
#[derive(Debug)]
pub struct SampleSlots {
    /// The clip of each slot.
    pub clip: Box<[u32]>,
    /// The time in seconds at which each slot samples its clip; times outside the clip take its
    /// first or last key.
    pub time: Box<[f32]>,
    /// The weight of each slot; 0 leaves the slot out. A play's weight multiplies its fade, and
    /// a blend's share of the clip multiplies both.
    pub weight: Box<[f32]>,
    /// The clip that a play put in each slot, as the play named it (for an additive play, the
    /// clip it was made from), or [`NO_SOURCE`] for a slot that no play fills. TypeScript reads
    /// it to find the slots of a clip whose weight it sets.
    pub source: Box<[u32]>,
}

/// How [`Animations::play`] plays a clip.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Play {
    /// The layer, below [`MAX_LAYERS`].
    pub layer: u32,
    /// Seconds over which the clip fades in and the layer's other clips fade out; 0 switches at
    /// once.
    pub fade: f32,
    /// The rate of the clip's time: 1 plays it as made, a negative rate plays it backward.
    pub speed: f32,
    /// True to repeat the clip; false to play it once and hold its last frame.
    pub looping: bool,
    /// True to add the clip's change from its first frame to the pose of the layers, as an
    /// additive clip does, instead of blending it in.
    pub additive: bool,
    /// The time in seconds at which the clip starts, or `None` for its first frame. A repeating
    /// clip wraps the time into its length, and a clip that plays once holds it within its
    /// length.
    pub time: Option<f32>,
    /// The clip's own weight, 0 or more, which its fade multiplies; `None` gives a clip that
    /// starts a weight of 1, and leaves the weight of a clip that plays.
    pub weight: Option<f32>,
    /// True to play the clip beside the other clips of its layer; false to fade them out.
    pub join: bool,
    /// True to switch the layer with an inertial transition instead of a weighted cross-fade: the
    /// pose the layer leaves extrapolates and decays into the new clip, which is the only clip
    /// sampled while the transition runs. Needs a fade above 0, no `join` and no `weight`; without
    /// them the play fades as usual.
    pub inertial: bool,
}

impl Default for Play {
    fn default() -> Self {
        Play {
            layer: 0,
            fade: 0.0,
            speed: 1.0,
            looping: true,
            additive: false,
            time: None,
            weight: None,
            join: false,
            inertial: false,
        }
    }
}

/// How [`Animations::play_blend`] plays a 1D blend.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Blend {
    /// The layer, below [`MAX_LAYERS`].
    pub layer: u32,
    /// Seconds over which the blend fades in and the layer's other clips fade out.
    pub fade: f32,
    /// The rate of the blend's phase: 1 moves it one cycle per weight-averaged length of its
    /// clips. A negative rate plays it backward.
    pub speed: f32,
    /// True to repeat the clips; false to play them once and hold their last frames.
    pub looping: bool,
    /// The share of their cycle at which the clips start, or `None` to keep the phase of the
    /// layer's clips.
    pub phase: Option<f32>,
    /// The layer's blend value ([`Animations::blend_values_mut`]) from this play on, or `None` to
    /// keep the value it has.
    pub value: Option<f32>,
}

impl Default for Blend {
    fn default() -> Self {
        Blend {
            layer: 0,
            fade: 0.0,
            speed: 1.0,
            looping: true,
            phase: None,
            value: None,
        }
    }
}

/// One thread's scratch memory for the frame step, sized for the largest skeleton.
#[derive(Default)]
struct Scratch {
    /// The blend of an instance's clips so far.
    pose: Box<[f32]>,
    /// A pose that one clip samples into.
    sample: Box<[f32]>,
    /// The blend of one layer's clips, above the first.
    layer: Box<[f32]>,
    /// The additive clips' change so far.
    add: Box<[f32]>,
    /// The weight so far of each lane: rows for translations, rotations and scales.
    weights: Box<[f32]>,
    /// How far each lane moves in the current blend step, in the same rows.
    shares: Box<[f32]>,
    /// The joints' local matrices, then their matrices in the skeleton's space.
    matrices: Box<[Affine]>,
    /// A look-at's path of joints, from a root down to the chain's last joint.
    path: Box<[u32]>,
}

/// The dead blends running in a frame step. Each instance's layers name a record of the pool
/// through `of`, and a record holds `stride` floats of the extrapolated pose it decays from, its
/// velocity, the channels the outgoing clips animated, and its timer. The buffers are absent until
/// a play asks for an inertial transition, and a play that never does pays nothing.
#[derive(Clone, Copy)]
pub(super) struct Transition {
    /// The extrapolated outgoing pose of each running record.
    pub pose: Option<SharedMut<f32>>,
    /// Its velocity: a rate per second for translations and scales, and a scaled axis (radians
    /// per second) for rotations.
    pub vel: Option<SharedMut<f32>>,
    /// The record each instance layer's blend runs in, or [`NO_TRANSITION`].
    pub of: Option<SharedMut<u32>>,
    /// The channels the outgoing clips animated, 3 rows of lanes per record.
    pub cover: Option<SharedMut<f32>>,
    /// Seconds elapsed in each record's blend.
    pub time: Option<SharedMut<f32>>,
    /// Seconds each record's blend lasts; 0 when the record is free.
    pub len: Option<SharedMut<f32>>,
    /// The floats of one pose of the largest skeleton.
    pub stride: usize,
}

impl Transition {
    /// A transition whose buffers are absent, for a table that has no dead blends.
    pub(super) fn empty() -> Self {
        Transition {
            pose: None,
            vel: None,
            of: None,
            cover: None,
            time: None,
            len: None,
            stride: 0,
        }
    }
}

/// A thread's [`Scratch`], which only that thread's chunks touch.
struct ThreadScratch(UnsafeCell<Scratch>);

// SAFETY: scratch `i` is used only by chunks that run as worker id `i`. A worker id runs one chunk
// at a time, the frame step runs no nested loop, and it takes `&mut Animations`, so no two
// threads touch one scratch at once.
unsafe impl Sync for ThreadScratch {}

fn boxed<T: Clone>(len: usize, value: T) -> Result<Box<[T]>, AnimationError> {
    filled(len, value).map(Vec::into_boxed_slice)
}

/// A pool of dead-blend records: each record's extrapolated pose, its velocity, the channels its
/// outgoing clips animated, its timer and its length.
type Pool = (Box<[f32]>, Box<[f32]>, Box<[f32]>, Box<[f32]>, Box<[f32]>);

/// The arrays of a pool of `records` dead-blend records. No blend runs in any of them, so every
/// record starts free.
fn pool_of(records: usize, stride: usize, lanes: usize) -> Result<Pool, AnimationError> {
    // Every allocation comes first, so a failure leaves no pool behind.
    let pose = boxed(records * stride, 0.0)?;
    let vel = boxed(records * stride, 0.0)?;
    let cover = boxed(records * 3 * lanes, 0.0)?;
    let time = boxed(records, 0.0)?;
    let len = boxed(records, 0.0)?;
    Ok((pose, vel, cover, time, len))
}

/// True when a weight counts in a blend: above 0. NaN does not count.
#[inline]
pub(super) fn counts(weight: f32) -> bool {
    weight > 0.0
}

/// Raises the share of the lanes that `cover` names, which the outgoing clips of a layer above the
/// first animated and its new clips do not: the pose the blend decays from shows there while the
/// blend runs, by `layer_weight` less the fade's ease `alpha`.
fn cover_shares(weights: &[f32], cover: &[f32], shares: &mut [f32], layer_weight: f32, alpha: f32) {
    let share = layer_weight * (1.0 - alpha);
    for ((slot, &covered), &weight) in shares.iter_mut().zip(cover).zip(weights) {
        if covered > 0.0 && !counts(weight) {
            *slot = share;
        }
    }
}

/// A copy of `old` lengthened to `len` with copies of `value`.
fn grown<T: Clone>(old: &[T], len: usize, value: T) -> Result<Box<[T]>, AnimationError> {
    let mut v = filled(len, value)?;
    v[..old.len()].clone_from_slice(old);
    Ok(v.into_boxed_slice())
}

/// An empty vector with room for `len` values, so pushes up to that many allocate nothing.
fn reserved<T>(len: usize) -> Result<Vec<T>, AnimationError> {
    let mut v = Vec::new();
    v.try_reserve_exact(len)
        .map_err(|_| out_of_memory(len * size_of::<T>()))?;
    Ok(v)
}

/// A weight per joint of one skeleton, padded with zeros to its lanes.
struct Mask {
    skeleton: u32,
    weights: Box<[f32]>,
}

/// The events of one clip: times in seconds in order, and the id of each.
#[derive(Default)]
pub(super) struct ClipEvents {
    pub times: Box<[f32]>,
    pub ids: Box<[u32]>,
}

/// One sample of an instance's frame: a slot's clip at its time and weight.
#[derive(Clone, Copy, Default)]
struct Entry {
    clip: u32,
    time: f32,
    weight: f32,
    layer: usize,
    additive: bool,
}

/// Skeletons, clips and animated instances, with capacities for instances and their joints that
/// grow on request ([`Animations::try_grow`]). See [`crate::animation`].
pub struct Animations {
    skeletons: Vec<Skeleton>,
    pub(super) clips: Vec<Clip>,
    /// The skeleton of each clip.
    clip_skeletons: Vec<u32>,
    /// The clip each clip was made from: itself, or for an additive clip, its source.
    pub(super) clip_sources: Vec<u32>,
    /// The additive version of each clip, or [`u32::MAX`] until a play asks for it.
    additive_clips: Vec<u32>,
    pub(super) clip_events: Vec<ClipEvents>,
    masks: Vec<Mask>,
    /// The ids of removed skeletons, clips and masks, which the next ones added take.
    free_skeletons: Vec<u32>,
    free_clips: Vec<u32>,
    free_masks: Vec<u32>,
    /// The skeleton of each instance, or [`REMOVED`].
    instance_skeletons: Box<[u32]>,
    /// The first joint of each instance in the matrix buffer.
    first_joints: Box<[u32]>,
    /// Instance ids handed out so far, removed ones included.
    instances: u32,
    /// Removed instance ids, which the next instances take first.
    free_instances: Vec<u32>,
    /// Joints handed out from the start of the matrix buffer so far.
    joints: u32,
    /// Runs of joints that removed instances gave back, below the joints handed out: first joint
    /// and length. Runs that touch merge, so each run has a live instance's joints after it, and
    /// the list holds at most one run per instance.
    free_joints: Vec<(u32, u32)>,
    pub(super) slots: SampleSlots,
    /// How each slot that a play filled advances.
    pub(super) actions: Box<[Action]>,
    /// The frames between two frame steps of each instance's pose: 1 by default, which poses it
    /// every frame. A value of `n` poses the instance once every `n` frame steps and leaves its
    /// matrices as they were in between, so a far crowd samples and skins less often. TypeScript
    /// writes it ([`Animations::update_intervals_mut`], [`Animations::update_intervals`]).
    update_intervals: Box<[u32]>,
    /// The rate of each instance's time; TypeScript writes it.
    time_scales: Box<[f32]>,
    /// The weight of each layer of each instance, [`MAX_LAYERS`] per instance; TypeScript writes
    /// them.
    layer_weights: Box<[f32]>,
    /// The joint mask of each layer of each instance: a mask id plus one, or 0 for every joint.
    layer_masks: Box<[u32]>,
    /// The blend value of each layer of each instance, [`MAX_LAYERS`] per instance, which picks
    /// the mix of the layer's 1D blend; TypeScript writes them.
    pub(super) blend_values: Box<[f32]>,
    /// Two buffers of [`MATRIX_FLOATS`] floats per joint of every instance. Each frame step writes
    /// the buffer that the step before did not, so a frame's draw list can upload the matrices of
    /// its step while the next frame's step runs.
    matrices: [Box<[f32]>; 2],
    /// The buffer that the last frame step wrote.
    written: usize,
    /// The frame steps so far, never [`FRESH`].
    step: u32,
    /// The last frame step that changed each instance's skinning matrices, or [`FRESH`].
    pose_steps: Box<[u32]>,
    /// The last frame step that posed each instance, or [`FRESH`]: the rate's schedule reads it, so
    /// a held pose with the same matrices still counts its frames.
    sampled_steps: Box<[u32]>,
    /// The seconds of an instance's own time that its skipped frames held, added up: its `dt` times
    /// its time scale in each of them. The instance's next pose spends the sum, so each frame
    /// counts once, however long the last one took.
    skipped_time: Box<[f32]>,
    /// The last frame step that changed some instance's skinning matrices.
    changed_step: u32,
    /// True once the running frame step has changed some instance's matrices.
    pose_changed: AtomicBool,
    /// The last frame step's events, in order of instance and time.
    events: Box<[[u32; EVENT_WORDS]]>,
    /// The events of the last frame step, then those it could not keep.
    event_totals: Box<[u32]>,
    event_count: AtomicU32,
    events_dropped: AtomicU32,
    /// A mask of 1 for every lane, for layers with no joint mask.
    ones: Box<[f32]>,
    scratch: Box<[ThreadScratch]>,
    /// The lanes the scratch memory holds.
    scratch_lanes: u32,
    /// The object that each instance animates, as the caller names it, for a look-at's target.
    objects: Box<[u32]>,
    /// The joint overrides of every instance, [`BLOCK_FLOATS`] per instance, which TypeScript
    /// writes ([`joints`]). Empty until [`Animations::enable_joint_overrides`].
    overrides: Box<[f32]>,
    /// Each instance's look-at target in the world, 3 per instance, which TypeScript writes.
    look_targets: Box<[f64]>,
    /// Each instance's look-at target in its object's space, which
    /// [`Animations::resolve_look_targets`] writes for the frame step.
    look_local: Box<[f32]>,
    /// The dead-blend record of each layer of each instance, [`MAX_LAYERS`] per instance, or
    /// [`NO_TRANSITION`] where no blend runs. Empty until a play asks for an inertial transition.
    transition_of: Box<[u32]>,
    /// The extrapolated outgoing pose of each dead-blend record in the pool,
    /// `POSE_FIELDS * scratch_lanes` floats each.
    pool_pose: Box<[f32]>,
    /// The velocity of each of those poses, laid out as `pool_pose`.
    pool_vel: Box<[f32]>,
    /// The channels the outgoing clips of each record's layer animated, 3 rows of lanes per record,
    /// 1 where they did. A layer above the first keeps those lanes' shares while its blend runs, so
    /// the pose it decays from shows instead of snapping away at the switch.
    pool_cover: Box<[f32]>,
    /// The seconds elapsed in each record's blend.
    pool_time: Box<[f32]>,
    /// The seconds each record's blend lasts; 0 when the record holds no blend and is free.
    pool_len: Box<[f32]>,
    /// The floats of one pose in the pool, `POSE_FIELDS * scratch_lanes`; 0 until the pool exists.
    inertial_stride: usize,
    /// The last frame step of each instance's own time, in seconds, which an inertial capture
    /// divides by to get the outgoing velocity.
    last_steps: Box<[f32]>,
}

impl Animations {
    /// A table for up to `instances` animated instances with `joints` joints between them, whose
    /// frame step runs on `jobs`. The capacities fix the arrays that other threads view until the
    /// table grows.
    pub fn new(jobs: &JobSystem, instances: u32, joints: u32) -> Result<Self, AnimationError> {
        let n = instances as usize;
        let slots = n * MAX_BLEND;
        let mut scratch = Vec::new();
        scratch
            .try_reserve_exact(jobs.thread_count() as usize)
            .map_err(|_| out_of_memory(jobs.thread_count() as usize * size_of::<Scratch>()))?;
        scratch.extend((0..jobs.thread_count()).map(|_| ThreadScratch(UnsafeCell::default())));
        Ok(Animations {
            skeletons: Vec::new(),
            clips: Vec::new(),
            clip_skeletons: Vec::new(),
            clip_sources: Vec::new(),
            additive_clips: Vec::new(),
            clip_events: Vec::new(),
            masks: Vec::new(),
            free_skeletons: Vec::new(),
            free_clips: Vec::new(),
            free_masks: Vec::new(),
            instance_skeletons: boxed(n, REMOVED)?,
            first_joints: boxed(n, 0)?,
            instances: 0,
            free_instances: reserved(n)?,
            joints: 0,
            free_joints: reserved(n)?,
            slots: SampleSlots {
                clip: boxed(slots, 0)?,
                time: boxed(slots, 0.0)?,
                weight: boxed(slots, 0.0)?,
                source: boxed(slots, NO_SOURCE)?,
            },
            actions: boxed(slots, Action::default())?,
            update_intervals: boxed(n, 1)?,
            time_scales: boxed(n, 1.0)?,
            layer_weights: boxed(n * MAX_LAYERS, 1.0)?,
            layer_masks: boxed(n * MAX_LAYERS, 0)?,
            blend_values: boxed(n * MAX_LAYERS, 0.0)?,
            matrices: [
                boxed(joints as usize * MATRIX_FLOATS, 0.0)?,
                boxed(joints as usize * MATRIX_FLOATS, 0.0)?,
            ],
            written: 0,
            step: 0,
            pose_steps: boxed(n, FRESH)?,
            sampled_steps: boxed(n, FRESH)?,
            skipped_time: boxed(n, 0.0)?,
            changed_step: 0,
            pose_changed: AtomicBool::new(false),
            events: boxed(EVENT_CAPACITY, [0; EVENT_WORDS])?,
            event_totals: boxed(2, 0)?,
            event_count: AtomicU32::new(0),
            events_dropped: AtomicU32::new(0),
            ones: Box::default(),
            scratch: scratch.into_boxed_slice(),
            scratch_lanes: 0,
            objects: boxed(n, u32::MAX)?,
            overrides: Box::default(),
            look_targets: Box::default(),
            look_local: Box::default(),
            transition_of: Box::default(),
            pool_pose: Box::default(),
            pool_vel: Box::default(),
            pool_cover: Box::default(),
            pool_time: Box::default(),
            pool_len: Box::default(),
            inertial_stride: 0,
            last_steps: boxed(n, 1.0 / 60.0)?,
        })
    }

    /// The most instances that the table holds now.
    pub fn instance_capacity(&self) -> u32 {
        self.instance_skeletons.len() as u32
    }

    /// The capacities, instances and joints, that the table needs for one more instance of
    /// `skeleton`: each doubles from its current one until the instance fits, and the joints stop
    /// at `max_joints`. `None` when the instance fits as the table is, or when its joints cannot
    /// fit within `max_joints`.
    pub fn growth_for(&self, skeleton: u32, max_joints: u32) -> Option<(u32, u32)> {
        let joints = self.skeleton(skeleton)?.joints();
        let instances = self.instance_capacity();
        let room_for_instance = !self.free_instances.is_empty() || self.instances < instances;
        let free_run = self.free_joints.iter().any(|&(_, len)| len >= joints);
        let needed = self.joints.saturating_add(joints);
        let room_for_joints = free_run || needed <= self.joint_capacity();
        if room_for_instance && room_for_joints {
            return None;
        }
        if !room_for_joints && needed > max_joints {
            return None;
        }
        let instances = if room_for_instance {
            instances
        } else {
            instances.saturating_mul(2).max(1)
        };
        let mut capacity = self.joint_capacity().max(1);
        while !room_for_joints && capacity < needed {
            capacity = capacity.saturating_mul(2).min(max_joints);
        }
        Some((instances, capacity))
    }

    /// Grows the table to hold `instances` instances and `joints` joints, keeping every instance,
    /// its plays and its last pose. Each array moves to new memory, so views of the old arrays
    /// must be made again. Returns the old matrix buffers, which a frame's draw list that a
    /// thread still replays may read: the caller keeps them until no such list remains. A
    /// capacity no larger than the current one stays as it is. On failure the table is unchanged.
    pub fn try_grow(
        &mut self,
        instances: u32,
        joints: u32,
    ) -> Result<[Box<[f32]>; 2], AnimationError> {
        let n = (instances as usize).max(self.instance_skeletons.len());
        let joint_floats = (joints as usize * MATRIX_FLOATS).max(self.matrices[0].len());
        let slots = n * MAX_BLEND;
        let layers = n * MAX_LAYERS;
        let overrides = if self.overrides.is_empty() {
            0
        } else {
            n * BLOCK_FLOATS
        };
        let looks = if self.overrides.is_empty() { 0 } else { n * 3 };
        // Every allocation comes first, so a failure leaves each array as it was.
        let mut free_instances = reserved(n)?;
        free_instances.extend_from_slice(&self.free_instances);
        let mut free_joints = reserved(n)?;
        free_joints.extend_from_slice(&self.free_joints);
        let instance_skeletons = grown(&self.instance_skeletons, n, REMOVED)?;
        let first_joints = grown(&self.first_joints, n, 0)?;
        let slot_clip = grown(&self.slots.clip, slots, 0)?;
        let slot_time = grown(&self.slots.time, slots, 0.0)?;
        let slot_weight = grown(&self.slots.weight, slots, 0.0)?;
        let slot_source = grown(&self.slots.source, slots, NO_SOURCE)?;
        let actions = grown(&self.actions, slots, Action::default())?;
        let time_scales = grown(&self.time_scales, n, 1.0)?;
        let layer_weights = grown(&self.layer_weights, layers, 1.0)?;
        let layer_masks = grown(&self.layer_masks, layers, 0)?;
        let blend_values = grown(&self.blend_values, layers, 0.0)?;
        let pose_steps = grown(&self.pose_steps, n, FRESH)?;
        let sampled_steps = grown(&self.sampled_steps, n, FRESH)?;
        let skipped_time = grown(&self.skipped_time, n, 0.0)?;
        let update_intervals = grown(&self.update_intervals, n, 1)?;
        let objects = grown(&self.objects, n, u32::MAX)?;
        let new_overrides = grown(&self.overrides, overrides, 0.0)?;
        let look_targets = grown(&self.look_targets, looks, 0.0)?;
        let look_local = grown(&self.look_local, looks, f32::NAN)?;
        let transition_of = if self.inertial_stride == 0 {
            Box::default()
        } else {
            grown(&self.transition_of, layers, NO_TRANSITION)?
        };
        let new_last_steps = grown(&self.last_steps, n, 1.0 / 60.0)?;
        let matrices = [
            grown(&self.matrices[0], joint_floats, 0.0)?,
            grown(&self.matrices[1], joint_floats, 0.0)?,
        ];

        self.free_instances = free_instances;
        self.free_joints = free_joints;
        self.instance_skeletons = instance_skeletons;
        self.first_joints = first_joints;
        self.slots = SampleSlots {
            clip: slot_clip,
            time: slot_time,
            weight: slot_weight,
            source: slot_source,
        };
        self.actions = actions;
        self.time_scales = time_scales;
        self.layer_weights = layer_weights;
        self.layer_masks = layer_masks;
        self.blend_values = blend_values;
        self.pose_steps = pose_steps;
        self.sampled_steps = sampled_steps;
        self.skipped_time = skipped_time;
        self.update_intervals = update_intervals;
        self.objects = objects;
        self.overrides = new_overrides;
        self.look_targets = look_targets;
        self.look_local = look_local;
        self.transition_of = transition_of;
        self.last_steps = new_last_steps;
        Ok(std::mem::replace(&mut self.matrices, matrices))
    }

    /// Makes the table of joint overrides, once: [`BLOCK_FLOATS`] floats per instance, all 0, and
    /// 3 look-at target numbers per instance. Until then, the frame step does no override work.
    pub fn enable_joint_overrides(&mut self) -> Result<(), AnimationError> {
        if !self.overrides.is_empty() {
            return Ok(());
        }
        let n = self.instance_skeletons.len();
        let look_targets = boxed(n * 3, 0.0f64)?;
        let look_local = boxed(n * 3, f32::NAN)?;
        self.overrides = boxed(n * BLOCK_FLOATS, 0.0)?;
        self.look_targets = look_targets;
        self.look_local = look_local;
        Ok(())
    }

    /// Makes the pool of dead blends, once: a record for each instance layer, all free, and a small
    /// pool of records that grows with the number of blends that run at once. Until a play asks for
    /// an inertial transition the pool stays absent and the frame step does no dead-blend work, so
    /// a scene that never uses one pays nothing.
    pub fn enable_inertial(&mut self) -> Result<(), AnimationError> {
        if self.inertial_stride != 0 {
            return Ok(());
        }
        let lanes = self.scratch_lanes as usize;
        if lanes == 0 {
            // No skeleton yet, so no pose is big enough to decay from. The play that needs the pool
            // makes it, once a skeleton gives the lanes.
            return Ok(());
        }
        let n = self.instance_skeletons.len();
        let stride = POSE_FIELDS * lanes;
        // Every allocation comes first, so a failure leaves the table without the pool.
        let of = boxed(n * MAX_LAYERS, NO_TRANSITION)?;
        let (pose, vel, cover, time, len) = pool_of(SEED_TRANSITIONS, stride, lanes)?;
        self.transition_of = of;
        self.pool_pose = pose;
        self.pool_vel = vel;
        self.pool_cover = cover;
        self.pool_time = time;
        self.pool_len = len;
        self.inertial_stride = stride;
        Ok(())
    }

    /// The first record of the pool that holds no blend, or `None` when every record runs one.
    fn free_record(&self) -> Option<u32> {
        self.pool_len
            .iter()
            .position(|&len| len <= 0.0)
            .map(|record| record as u32)
    }

    /// Doubles the pool of dead-blend records, keeping every blend that runs, and returns a record
    /// that holds none. Runs between frame steps, so no worker holds a record meanwhile.
    fn grow_pool(&mut self) -> Result<u32, AnimationError> {
        let records = self.pool_len.len().max(1) * 2;
        let stride = self.inertial_stride;
        let lanes = self.scratch_lanes as usize;
        // Every allocation comes first, so a failure leaves the pool as it was.
        let pose = grown(&self.pool_pose, records * stride, 0.0)?;
        let vel = grown(&self.pool_vel, records * stride, 0.0)?;
        let cover = grown(&self.pool_cover, records * 3 * lanes, 0.0)?;
        let time = grown(&self.pool_time, records, 0.0)?;
        let len = grown(&self.pool_len, records, 0.0)?;
        self.pool_pose = pose;
        self.pool_vel = vel;
        self.pool_cover = cover;
        self.pool_time = time;
        self.pool_len = len;
        // The records past the old ones hold no blend.
        Ok((records / 2) as u32)
    }

    /// The joint overrides of every instance, [`BLOCK_FLOATS`] floats each, laid out as
    /// [`joints::place`] says; empty until [`Animations::enable_joint_overrides`]. The array never
    /// moves once made.
    pub fn joint_overrides(&self) -> &[f32] {
        &self.overrides
    }

    /// The joint overrides of every instance, to change.
    pub fn joint_overrides_mut(&mut self) -> &mut [f32] {
        &mut self.overrides
    }

    /// Each instance's look-at target in the world, 3 numbers per instance.
    pub fn look_targets(&self) -> &[f64] {
        &self.look_targets
    }

    /// Each instance's look-at target in the world, to change.
    pub fn look_targets_mut(&mut self) -> &mut [f64] {
        &mut self.look_targets
    }

    /// Names the object that instance `instance` animates, which [`Self::resolve_look_targets`]
    /// passes to its `world` function.
    pub fn set_object(&mut self, instance: u32, object: u32) -> Result<(), AnimationError> {
        self.live_skeleton(instance)?;
        self.objects[instance as usize] = object;
        Ok(())
    }

    /// Carries each live look-at's target from the world into the space of its instance's object,
    /// for the next frame step. `world` gives an object's world matrix, or `None` for an object
    /// that no longer exists, whose look-at then turns nothing. It runs on this thread, does work
    /// only for instances whose look-at has a weight, and allocates nothing.
    pub fn resolve_look_targets(&mut self, world: impl Fn(u32) -> Option<Affine64>) {
        if self.overrides.is_empty() {
            return;
        }
        for i in 0..self.instances as usize {
            let local = &mut self.look_local[i * 3..i * 3 + 3];
            let block = &self.overrides[i * BLOCK_FLOATS..(i + 1) * BLOCK_FLOATS];
            if self.instance_skeletons[i] == REMOVED || !joints::looks(block) {
                continue;
            }
            let t = &self.look_targets[i * 3..i * 3 + 3];
            match world(self.objects[i]).as_ref().and_then(invert64) {
                Some(m) => {
                    for (r, value) in local.iter_mut().enumerate() {
                        let row = &m[4 * r..4 * r + 4];
                        *value = (row[0] * t[0] + row[1] * t[1] + row[2] * t[2] + row[3]) as f32;
                    }
                }
                None => local.fill(f32::NAN),
            }
        }
    }

    /// Adds a skeleton and returns its id: a removed skeleton's, or a new one.
    pub fn add_skeleton(&mut self, skeleton: Skeleton) -> Result<u32, AnimationError> {
        let lanes = skeleton.lanes();
        if lanes > self.scratch_lanes {
            self.size_scratch(lanes)?;
        }
        if let Some(id) = self.free_skeletons.pop() {
            self.skeletons[id as usize] = skeleton;
            return Ok(id);
        }
        self.skeletons
            .try_reserve(1)
            .map_err(|_| out_of_memory(size_of::<Skeleton>()))?;
        self.skeletons.push(skeleton);
        Ok(self.skeletons.len() as u32 - 1)
    }

    /// Gives each thread's scratch memory room for skeletons of `lanes` lanes, and no more.
    fn size_scratch(&mut self, lanes: u32) -> Result<(), AnimationError> {
        let len = POSE_FIELDS * lanes as usize;
        for scratch in &mut self.scratch {
            *scratch.0.get_mut() = Scratch {
                pose: boxed(len, 0.0)?,
                sample: boxed(len, 0.0)?,
                layer: boxed(len, 0.0)?,
                add: boxed(len, 0.0)?,
                weights: boxed(3 * lanes as usize, 0.0)?,
                shares: boxed(3 * lanes as usize, 0.0)?,
                matrices: boxed(lanes as usize, [0.0; MATRIX_FLOATS])?,
                path: boxed(lanes as usize, 0)?,
            };
        }
        self.ones = boxed(lanes as usize, 1.0)?;
        self.scratch_lanes = lanes;
        // A dead blend's pose is a pose of the largest skeleton, so a later skeleton with more
        // lanes moves the pool's records, and the poses they held are gone. Every blend therefore
        // ends here: a layer that switched inertially plays its clips as it would after a fade,
        // which is rare, and no layer decays toward a pose of nothing.
        if self.inertial_stride != 0 {
            let lanes = lanes as usize;
            let records = self.pool_len.len();
            let stride = POSE_FIELDS * lanes;
            // Every allocation comes first, so a failure leaves the pool as it was.
            let (pose, vel, cover, time, len) = pool_of(records, stride, lanes)?;
            self.pool_pose = pose;
            self.pool_vel = vel;
            self.pool_cover = cover;
            self.pool_time = time;
            self.pool_len = len;
            self.inertial_stride = stride;
            self.transition_of.fill(NO_TRANSITION);
        }
        Ok(())
    }

    /// Removes skeleton `skeleton` with its clips, their additive versions and events, and its
    /// joint masks. Their ids go to the next ones added. Each thread's scratch memory shrinks to
    /// the largest skeleton left. Fails while a live instance uses the skeleton.
    pub fn remove_skeleton(&mut self, skeleton: u32) -> Result<(), AnimationError> {
        if self.skeleton(skeleton).is_none() {
            return Err(AnimationError::UnknownSkeleton { skeleton });
        }
        if let Some(instance) =
            (0..self.instances).find(|&i| self.instance_skeletons[i as usize] == skeleton)
        {
            return Err(AnimationError::SkeletonInUse { instance });
        }
        let failed = |_| out_of_memory(size_of::<u32>());
        let clips = self
            .clip_skeletons
            .iter()
            .filter(|&&s| s == skeleton)
            .count();
        let masks = self.masks.iter().filter(|m| m.skeleton == skeleton).count();
        self.free_skeletons.try_reserve(1).map_err(failed)?;
        self.free_clips.try_reserve(clips).map_err(failed)?;
        self.free_masks.try_reserve(masks).map_err(failed)?;
        self.skeletons[skeleton as usize] = Skeleton::default();
        self.free_skeletons.push(skeleton);
        for clip in 0..self.clips.len() {
            if self.clip_skeletons[clip] != skeleton {
                continue;
            }
            self.clips[clip] = Clip::default();
            self.clip_events[clip] = ClipEvents::default();
            self.clip_skeletons[clip] = REMOVED;
            self.additive_clips[clip] = u32::MAX;
            self.free_clips.push(clip as u32);
        }
        for (id, mask) in self.masks.iter_mut().enumerate() {
            if mask.skeleton == skeleton {
                *mask = Mask {
                    skeleton: REMOVED,
                    weights: Box::default(),
                };
                self.free_masks.push(id as u32);
            }
        }
        let lanes = self
            .skeletons
            .iter()
            .map(Skeleton::lanes)
            .max()
            .unwrap_or(0);
        if lanes < self.scratch_lanes {
            self.size_scratch(lanes)?;
        }
        Ok(())
    }

    /// The live skeleton with this id.
    pub fn skeleton(&self, skeleton: u32) -> Option<&Skeleton> {
        self.skeletons
            .get(skeleton as usize)
            .filter(|s| s.joints() > 0)
    }

    /// Adds a clip that [`super::resample`] built for skeleton `skeleton`, and returns its id.
    pub fn add_clip(&mut self, skeleton: u32, clip: Clip) -> Result<u32, AnimationError> {
        let joints = self
            .skeleton(skeleton)
            .ok_or(AnimationError::UnknownSkeleton { skeleton })?
            .joints();
        if clip.joints() != joints {
            return Err(AnimationError::WrongSkeleton {
                clip_joints: clip.joints(),
                skeleton_joints: joints,
            });
        }
        self.push_clip(skeleton, clip, None)
    }

    /// The clips held now that [`super::resample`] evaluated at each frame, in some track at
    /// least. The others were copied from keys already on their frames, and removed clips hold no
    /// tracks.
    pub fn resampled_clips(&self) -> u32 {
        // An additive clip counts through its source.
        self.clips
            .iter()
            .enumerate()
            .filter(|(k, clip)| self.clip_sources[*k] as usize == *k && clip.resampled_tracks() > 0)
            .count() as u32
    }

    /// Stores a clip with its skeleton and source, or itself as its source with `None`, and
    /// returns its id: a removed clip's, or a new one.
    fn push_clip(
        &mut self,
        skeleton: u32,
        clip: Clip,
        source: Option<u32>,
    ) -> Result<u32, AnimationError> {
        if let Some(id) = self.free_clips.pop() {
            let k = id as usize;
            self.clips[k] = clip;
            self.clip_skeletons[k] = skeleton;
            self.clip_sources[k] = source.unwrap_or(id);
            self.additive_clips[k] = u32::MAX;
            self.clip_events[k] = ClipEvents::default();
            return Ok(id);
        }
        let source = source.unwrap_or(self.clips.len() as u32);
        let failed = |_| out_of_memory(size_of::<Clip>());
        self.clips.try_reserve(1).map_err(failed)?;
        self.clip_skeletons.try_reserve(1).map_err(failed)?;
        self.clip_sources.try_reserve(1).map_err(failed)?;
        self.additive_clips.try_reserve(1).map_err(failed)?;
        self.clip_events.try_reserve(1).map_err(failed)?;
        self.clips.push(clip);
        self.clip_skeletons.push(skeleton);
        self.clip_sources.push(source);
        self.additive_clips.push(u32::MAX);
        self.clip_events.push(ClipEvents::default());
        Ok(self.clips.len() as u32 - 1)
    }

    /// The live clip with this id.
    pub fn clip(&self, clip: u32) -> Option<&Clip> {
        self.clips
            .get(clip as usize)
            .filter(|_| self.clip_skeletons[clip as usize] != REMOVED)
    }

    /// The additive version of clip `clip` ([`Clip::additive`]), which it builds on first use.
    pub fn additive_clip(&mut self, clip: u32) -> Result<u32, AnimationError> {
        let source = *self
            .clip_sources
            .get(clip as usize)
            .ok_or(AnimationError::UnknownClip { clip })?;
        let built = self.additive_clips[source as usize];
        if built != u32::MAX {
            return Ok(built);
        }
        let additive = self.clips[source as usize].additive()?;
        let skeleton = self.clip_skeletons[source as usize];
        let id = self.push_clip(skeleton, additive, Some(source))?;
        self.additive_clips[source as usize] = id;
        Ok(id)
    }

    /// Sets the events of clip `clip`: a time in seconds and an id for each. Each time lies from
    /// 0 to the clip's duration. They replace the clip's events before, and its additive version
    /// shares them.
    pub fn set_clip_events(
        &mut self,
        clip: u32,
        times: &[f32],
        ids: &[u32],
    ) -> Result<(), AnimationError> {
        if self.clip(clip).is_none() {
            return Err(AnimationError::UnknownClip { clip });
        }
        let source = self.clip_sources[clip as usize];
        let duration = self.clips[source as usize].duration();
        if times.len() != ids.len() {
            return Err(AnimationError::Events {
                event: times.len().min(ids.len()) as u32,
            });
        }
        if let Some(bad) = times
            .iter()
            .position(|t| !(t.is_finite() && *t >= 0.0 && *t <= duration))
        {
            return Err(AnimationError::Events { event: bad as u32 });
        }
        let mut order = filled(times.len(), 0usize)?;
        order.iter_mut().enumerate().for_each(|(k, o)| *o = k);
        order.sort_by(|&a, &b| times[a].total_cmp(&times[b]));
        let mut sorted_times = filled(times.len(), 0.0f32)?;
        let mut sorted_ids = filled(times.len(), 0u32)?;
        for (k, &from) in order.iter().enumerate() {
            sorted_times[k] = times[from];
            sorted_ids[k] = ids[from];
        }
        self.clip_events[source as usize] = ClipEvents {
            times: sorted_times.into_boxed_slice(),
            ids: sorted_ids.into_boxed_slice(),
        };
        Ok(())
    }

    /// Adds a joint mask for skeleton `skeleton`, one weight from 0 to 1 per joint, and returns
    /// its id. A layer with the mask moves each joint by the joint's weight.
    pub fn add_mask(&mut self, skeleton: u32, weights: &[f32]) -> Result<u32, AnimationError> {
        let target = self
            .skeleton(skeleton)
            .ok_or(AnimationError::UnknownSkeleton { skeleton })?;
        if weights.len() != target.joints() as usize {
            return Err(AnimationError::Mask {
                joint: weights.len() as u32,
            });
        }
        if let Some(bad) = weights.iter().position(|w| !(*w >= 0.0 && *w <= 1.0)) {
            return Err(AnimationError::Mask { joint: bad as u32 });
        }
        let mut padded = filled(target.lanes() as usize, 0.0f32)?;
        padded[..weights.len()].copy_from_slice(weights);
        let mask = Mask {
            skeleton,
            weights: padded.into_boxed_slice(),
        };
        if let Some(id) = self.free_masks.pop() {
            self.masks[id as usize] = mask;
            return Ok(id);
        }
        self.masks
            .try_reserve(1)
            .map_err(|_| out_of_memory(size_of::<Mask>()))?;
        self.masks.push(mask);
        Ok(self.masks.len() as u32 - 1)
    }

    /// Gives layer `layer` of instance `instance` joint mask `mask`, or with `None`, every joint.
    pub fn set_layer_mask(
        &mut self,
        instance: u32,
        layer: u32,
        mask: Option<u32>,
    ) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        if layer as usize >= MAX_LAYERS {
            return Err(AnimationError::Layer { layer });
        }
        let value = match mask {
            None => 0,
            Some(id) => match self.masks.get(id as usize) {
                Some(m) if m.skeleton == skeleton => id + 1,
                _ => return Err(AnimationError::UnknownMask { mask: id }),
            },
        };
        self.layer_masks[instance as usize * MAX_LAYERS + layer as usize] = value;
        Ok(())
    }

    /// The skeleton of a live instance.
    pub(super) fn live_skeleton(&self, instance: u32) -> Result<u32, AnimationError> {
        match self.instance_skeletons.get(instance as usize) {
            Some(&skeleton) if skeleton != REMOVED && instance < self.instances => Ok(skeleton),
            _ => Err(AnimationError::UnknownInstance { instance }),
        }
    }

    /// The skeleton of clip `clip`.
    pub(super) fn clip_skeleton(&self, clip: u32) -> Option<u32> {
        self.clip_skeletons.get(clip as usize).copied()
    }

    /// Adds an instance of skeleton `skeleton`, with its sample slots empty, and returns its id.
    /// Until a slot gets a weight, the instance holds the rest pose. It takes the id and the
    /// joints of a removed instance where they fit.
    pub fn add_instance(&mut self, skeleton: u32) -> Result<u32, AnimationError> {
        let joints = self
            .skeleton(skeleton)
            .ok_or(AnimationError::UnknownSkeleton { skeleton })?
            .joints();
        let full = |resource, capacity: usize| {
            AnimationError::Core(CoreError::CapacityExceeded {
                resource,
                capacity: capacity as u32,
            })
        };
        if self.free_instances.is_empty()
            && self.instances as usize >= self.instance_skeletons.len()
        {
            return Err(full(
                Resource::AnimatedInstances,
                self.instance_skeletons.len(),
            ));
        }
        let capacity = self.joint_capacity() as usize;
        // The first run that a removed instance gave back and that holds the joints, or new
        // joints after those handed out.
        let first = match self.free_joints.iter().position(|&(_, len)| len >= joints) {
            Some(run) => {
                let (first, len) = self.free_joints[run];
                if len == joints {
                    self.free_joints.swap_remove(run);
                } else {
                    self.free_joints[run] = (first + joints, len - joints);
                }
                first
            }
            None if self.joints as usize + joints as usize <= capacity => {
                self.joints += joints;
                self.joints - joints
            }
            None => return Err(full(Resource::AnimatedJoints, capacity)),
        };
        let instance = match self.free_instances.pop() {
            Some(id) => id as usize,
            None => {
                self.instances += 1;
                self.instances as usize - 1
            }
        };
        self.instance_skeletons[instance] = skeleton;
        self.first_joints[instance] = first;
        self.pose_steps[instance] = FRESH;
        self.sampled_steps[instance] = FRESH;
        let slots = instance * MAX_BLEND..(instance + 1) * MAX_BLEND;
        self.slots.weight[slots.clone()].fill(0.0);
        self.slots.source[slots.clone()].fill(NO_SOURCE);
        self.actions[slots].fill(Action::default());
        self.update_intervals[instance] = 1;
        self.time_scales[instance] = 1.0;
        let layers = instance * MAX_LAYERS..(instance + 1) * MAX_LAYERS;
        self.layer_weights[layers.clone()].fill(1.0);
        self.layer_masks[layers.clone()].fill(0);
        self.blend_values[layers].fill(0.0);
        self.objects[instance] = u32::MAX;
        self.skipped_time[instance] = 0.0;
        self.clear_overrides(instance);
        self.clear_transitions(instance);
        Ok(instance as u32)
    }

    /// Removes instance `instance`. Its id goes to the next instance, and its joints to the next
    /// instances that fit them: they join the free runs next to them, and joints at the end of
    /// those handed out are handed back.
    pub fn remove_instance(&mut self, instance: u32) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        let i = instance as usize;
        let joints = self.skeletons[skeleton as usize].joints();
        self.free_run(self.first_joints[i], joints);
        // The list holds at most one entry per instance id, which its capacity covers.
        self.free_instances.push(instance);
        self.instance_skeletons[i] = REMOVED;
        let slots = i * MAX_BLEND..(i + 1) * MAX_BLEND;
        self.slots.weight[slots.clone()].fill(0.0);
        self.slots.source[slots].fill(NO_SOURCE);
        self.update_intervals[i] = 1;
        self.sampled_steps[i] = FRESH;
        self.skipped_time[i] = 0.0;
        self.clear_overrides(i);
        self.clear_transitions(i);
        Ok(())
    }

    /// Ends the dead blends of instance `i`, when the pool exists: a blend the instance left
    /// running must not decay the pose of the instance that takes its id next.
    fn clear_transitions(&mut self, i: usize) {
        let at = i * MAX_LAYERS;
        let Some(of) = self.transition_of.get_mut(at..at + MAX_LAYERS) else {
            return;
        };
        for &record in of.iter() {
            if record != NO_TRANSITION {
                self.pool_len[record as usize] = 0.0;
            }
        }
        of.fill(NO_TRANSITION);
    }

    /// Empties the joint overrides and the look-at of instance `i`, when the table exists.
    fn clear_overrides(&mut self, i: usize) {
        if let Some(block) = self
            .overrides
            .get_mut(i * BLOCK_FLOATS..(i + 1) * BLOCK_FLOATS)
        {
            block.fill(0.0);
        }
    }

    /// Gives back `len` joints from joint `first`: merges them with the free runs that touch
    /// them, and hands back a run that ends where the joints handed out end. A run that merges
    /// replaces its neighbours, so the list never grows past one run per live instance, and
    /// never allocates.
    fn free_run(&mut self, first: u32, len: u32) {
        let (mut first, mut len) = (first, len);
        if let Some(k) = self.free_joints.iter().position(|&(f, l)| f + l == first) {
            let (f, l) = self.free_joints.swap_remove(k);
            first = f;
            len += l;
        }
        if let Some(k) = self.free_joints.iter().position(|&(f, _)| f == first + len) {
            len += self.free_joints.swap_remove(k).1;
        }
        if first + len == self.joints {
            self.joints = first;
        } else {
            self.free_joints.push((first, len));
        }
    }

    /// The number of instance ids handed out, removed ones included.
    pub fn instances(&self) -> u32 {
        self.instances
    }

    /// The joints handed out from the start of the matrix buffer.
    pub fn joints(&self) -> u32 {
        self.joints
    }

    /// The sample slots of every instance.
    pub fn slots(&self) -> &SampleSlots {
        &self.slots
    }

    /// The sample slots of every instance, to change.
    pub fn slots_mut(&mut self) -> &mut SampleSlots {
        &mut self.slots
    }

    /// The play state of slot `slot` of instance `instance`.
    ///
    /// # Panics
    /// When the instance or the slot is past the table's capacity.
    pub fn action(&self, instance: u32, slot: usize) -> Action {
        assert!(slot < MAX_BLEND, "an instance has {MAX_BLEND} sample slots");
        self.actions[instance as usize * MAX_BLEND + slot]
    }

    /// The frames between two frame steps of each instance's pose, one per instance; 1 by
    /// default, which poses it every frame. A value of `n` poses the instance once every `n` frame
    /// steps. Set it before the frame step: a value of 0 or 1 poses every frame, and a larger value
    /// skips the sampling and composing of the frames in between, and leaves `pose_step` unchanged
    /// so the skinning pass skips the held pose too. A change of the value takes effect on the next
    /// frame step.
    pub fn update_intervals_mut(&mut self) -> &mut [u32] {
        &mut self.update_intervals
    }

    /// The frames between two frame steps of each instance's pose, one per instance.
    pub fn update_intervals(&self) -> &[u32] {
        &self.update_intervals
    }

    /// The rate of each instance's time, one per instance; 1 by default.
    pub fn time_scales_mut(&mut self) -> &mut [f32] {
        &mut self.time_scales
    }

    /// The weight of each layer of each instance, [`MAX_LAYERS`] per instance; 1 by default.
    pub fn layer_weights_mut(&mut self) -> &mut [f32] {
        &mut self.layer_weights
    }

    /// The blend value of each layer of each instance, [`MAX_LAYERS`] per instance; 0 by
    /// default.
    pub fn blend_values_mut(&mut self) -> &mut [f32] {
        &mut self.blend_values
    }

    /// The blend value of each layer of each instance.
    pub fn blend_values(&self) -> &[f32] {
        &self.blend_values
    }

    /// Sets slot `slot` of instance `instance` to sample `clip` at `time` seconds with `weight`.
    ///
    /// # Panics
    /// When the instance or the slot is past the table's capacity.
    pub fn set_sample(&mut self, instance: u32, slot: usize, clip: u32, time: f32, weight: f32) {
        assert!(slot < MAX_BLEND, "an instance has {MAX_BLEND} sample slots");
        let at = instance as usize * MAX_BLEND + slot;
        self.slots.clip[at] = clip;
        self.slots.time[at] = time;
        self.slots.weight[at] = weight;
    }

    /// The skinning matrices of every instance, [`MATRIX_FLOATS`] floats per joint, from the last
    /// frame step. The two buffers move only when the table grows, and the steps take turns
    /// between them, so the address changes with each step.
    pub fn matrices(&self) -> &[f32] {
        &self.matrices[self.written]
    }

    /// The most joints that the matrix buffers hold.
    pub fn joint_capacity(&self) -> u32 {
        (self.matrices[0].len() / MATRIX_FLOATS) as u32
    }

    /// The first joint of instance `instance` in the matrix buffers and its skeleton's joint
    /// count, or `None` when no live instance has that id.
    pub fn instance_joints(&self, instance: u32) -> Option<(u32, u32)> {
        let skeleton = self.live_skeleton(instance).ok()?;
        let joints = self.skeletons[skeleton as usize].joints();
        Some((self.first_joints[instance as usize], joints))
    }

    /// The skinning matrices of instance `instance`, one per joint of its skeleton.
    ///
    /// # Panics
    /// When the instance does not exist.
    pub fn instance_matrices(&self, instance: u32) -> &[f32] {
        let skeleton = self
            .live_skeleton(instance)
            .unwrap_or_else(|_| panic!("instance {instance} does not exist"));
        let i = instance as usize;
        let joints = self.skeletons[skeleton as usize].joints() as usize;
        let first = self.first_joints[i] as usize * MATRIX_FLOATS;
        &self.matrices()[first..first + joints * MATRIX_FLOATS]
    }

    /// The last frame step that changed the skinning matrices of instance `instance`: a number
    /// that changes whenever its pose does, and stays the same while its pose holds still. Only
    /// equality between two readings means anything. `None` when no live instance has that id.
    pub fn pose_step(&self, instance: u32) -> Option<u32> {
        self.live_skeleton(instance).ok()?;
        Some(self.pose_steps[instance as usize])
    }

    /// The last frame step that changed some instance's skinning matrices, a new instance's first
    /// pose included. While it stays the same, every instance holds its pose.
    pub fn changed_step(&self) -> u32 {
        self.changed_step
    }

    /// The events of the last frame step, [`EVENT_WORDS`] words each, in order of instance and,
    /// within an instance, of time. The buffer never moves.
    pub fn events(&self) -> &[[u32; EVENT_WORDS]] {
        &self.events[..self.event_totals[0] as usize]
    }

    /// The events of the last frame step that did not fit in [`EVENT_CAPACITY`].
    pub fn events_dropped(&self) -> u32 {
        self.event_totals[1]
    }

    /// The rate of each instance's time.
    pub fn time_scales(&self) -> &[f32] {
        &self.time_scales
    }

    /// The weight of each layer of each instance.
    pub fn layer_weights(&self) -> &[f32] {
        &self.layer_weights
    }

    /// The event records' buffer, all [`EVENT_CAPACITY`] of them.
    pub fn event_buffer(&self) -> &[[u32; EVENT_WORDS]] {
        &self.events
    }

    /// The events of the last frame step and those it could not keep.
    pub fn event_totals(&self) -> &[u32] {
        &self.event_totals
    }

    /// The dead blends of the table, which the frame step and a capture share: absent until a play
    /// asks for an inertial transition, so a scene that never uses one pays nothing.
    fn transitions(&mut self) -> Transition {
        if self.inertial_stride == 0 {
            return Transition::empty();
        }
        Transition {
            pose: Some(SharedMut::new(&mut self.pool_pose)),
            vel: Some(SharedMut::new(&mut self.pool_vel)),
            of: Some(SharedMut::new(&mut self.transition_of)),
            cover: Some(SharedMut::new(&mut self.pool_cover)),
            time: Some(SharedMut::new(&mut self.pool_time)),
            len: Some(SharedMut::new(&mut self.pool_len)),
            stride: self.inertial_stride,
        }
    }

    /// The frame step: advances every played clip by `dt` seconds of the instance's time,
    /// collects the events it passes, then samples, blends and composes every instance's pose
    /// and writes its skinning matrices into the buffer that the step before did not write, in
    /// parallel on `jobs`. An instance whose matrices differ from the step before's, or that no
    /// step has posed yet, gets this step as its pose step. An instance whose
    /// [`update_intervals`](Self::update_intervals) value is above 1 is posed on the steps of
    /// that interval alone; on the others its matrices carry over and it is left out of the
    /// sampling, the blending and the compose. It allocates nothing.
    ///
    /// # Panics
    /// When `jobs` has more threads than the job system the table was made for.
    pub fn update(&mut self, jobs: &JobSystem, dt: f32) {
        self.event_count.store(0, Ordering::Relaxed);
        self.events_dropped.store(0, Ordering::Relaxed);
        if self.instances > 0 {
            assert!(
                jobs.thread_count() as usize <= self.scratch.len(),
                "the animation table was made for a job system with fewer threads"
            );
            self.written = 1 - self.written;
            self.step = self.step.wrapping_add(1) % FRESH;
            self.pose_changed.store(false, Ordering::Relaxed);
            let step = self.step;
            let pose_steps = SharedMut::new(&mut self.pose_steps);
            let sampled_steps = SharedMut::new(&mut self.sampled_steps);
            let skipped_time = SharedMut::new(&mut self.skipped_time);
            let out = SharedMut::new(&mut self.matrices[self.written]);
            let times = SharedMut::new(&mut self.slots.time);
            let weights = SharedMut::new(&mut self.slots.weight);
            let sources = SharedMut::new(&mut self.slots.source);
            let actions = SharedMut::new(&mut self.actions);
            let last_steps = SharedMut::new(&mut self.last_steps);
            let transition = self.transitions();
            let sink = EventSink {
                records: SharedMut::new(&mut self.events),
                count: &self.event_count,
                dropped: &self.events_dropped,
            };
            let this = &*self;
            jobs.parallel_for(
                this.instances,
                INSTANCE_CHUNK,
                &|range, worker: WorkerId| {
                    // SAFETY: see `ThreadScratch`: only this thread's chunks use this scratch.
                    let scratch = unsafe { &mut *this.scratch[worker.index()].0.get() };
                    for i in range {
                        let i = i as usize;
                        let skeleton = this.instance_skeletons[i];
                        if skeleton == REMOVED {
                            continue;
                        }
                        let skeleton = &this.skeletons[skeleton as usize];
                        let first = this.first_joints[i] as usize * MATRIX_FLOATS;
                        let len = skeleton.joints() as usize * MATRIX_FLOATS;
                        let at = i * MAX_BLEND;
                        // SAFETY: instances own disjoint runs of the matrix buffer, from their
                        // first joint for as many joints as their skeleton has, and their own
                        // slots; each instance is in one chunk, so no other thread touches its
                        // pose step either.
                        let (matrices, time, weight, source, action, pose_step) = unsafe {
                            (
                                out.slice(first, len),
                                times.slice(at, MAX_BLEND),
                                weights.slice(at, MAX_BLEND),
                                sources.slice(at, MAX_BLEND),
                                actions.slice(at, MAX_BLEND),
                                pose_steps.slice(i, 1),
                            )
                        };
                        let pose_step = &mut pose_step[0];
                        // The step before wrote the other buffer, which no thread writes now.
                        let before = &this.matrices[1 - this.written][first..first + len];
                        // A slower update rate leaves the instance in the pose of the last step
                        // that posed it: its matrices carry over unchanged, and its pose step
                        // stays, so the skinning pass skips the held pose too. The gaps between an
                        // instance's poses come from the step that last posed it, so a change of
                        // the interval takes effect at the next pose. An instance that no step has
                        // posed yet always poses, whatever its interval.
                        // SAFETY: each instance is in one chunk, so no other thread touches its
                        // sampled step.
                        let sampled = unsafe { sampled_steps.read(i) };
                        let interval = this.update_intervals[i].max(1);
                        let gap = step.wrapping_sub(sampled);
                        let held = sampled != FRESH;
                        // Each frame the instance skips keeps its own time, so the pose that
                        // follows spends the sum of them and one long frame counts once.
                        // SAFETY: each instance is in one chunk, so no other thread touches its
                        // held time.
                        let own = dt * this.time_scales[i];
                        let skipped = unsafe { skipped_time.read(i) } + own;
                        if held && gap < interval {
                            unsafe { skipped_time.write(i, skipped) };
                            matrices.copy_from_slice(before);
                            continue;
                        }
                        let mut advance = Advance {
                            instance: i as u32,
                            time,
                            weight,
                            source,
                            action,
                            shares: [1.0; MAX_BLEND],
                            sink: &sink,
                            order: 0,
                        };
                        // The clip covers the frames the instance skipped too, so its time keeps
                        // the rate it was asked for, however many frames lie between two of its
                        // poses. The first pose of an instance skips nothing.
                        let step_now = skipped;
                        // SAFETY: each instance is in one chunk.
                        unsafe { skipped_time.write(i, 0.0) };
                        unsafe { last_steps.slice(i, 1)[0] = step_now };
                        this.advance(&mut advance, step_now);
                        this.pose_instance(i, skeleton, scratch, &advance, step_now, transition);
                        if !this.overrides.is_empty() {
                            this.override_joints(i, skeleton, scratch);
                        }
                        this.compose(skeleton, scratch, matrices);
                        // SAFETY: as for the sampled step above.
                        unsafe { sampled_steps.write(i, step) };
                        if *pose_step == FRESH || *matrices != *before {
                            *pose_step = step;
                            this.pose_changed.store(true, Ordering::Relaxed);
                        }
                    }
                },
            );
        }
        if self.pose_changed.load(Ordering::Relaxed) {
            self.changed_step = self.step;
        }
        let kept = (self.event_count.load(Ordering::Relaxed) as usize).min(EVENT_CAPACITY);
        // In place and without allocation; the keys are unique, so the order is exact.
        self.events[..kept].sort_unstable_by_key(|r| (r[0], r[1] >> 16));
        self.event_totals[0] = kept as u32;
        self.event_totals[1] = self.events_dropped.load(Ordering::Relaxed);
    }

    /// Blends instance `i`'s clips into the pose in its scratch memory, from its slots' times and
    /// weights. Each slot's weight is its own weight times its fade, times its share of its
    /// layer's blend. A layer with a running dead blend has its pose moved from the extrapolated
    /// outgoing pose toward the blend's own pose by the fade's ease.
    fn pose_instance(
        &self,
        i: usize,
        skeleton: &Skeleton,
        scratch: &mut Scratch,
        slots: &Advance<'_, '_>,
        step: f32,
        transition: Transition,
    ) {
        let (time, weight) = (&*slots.time, &*slots.weight);
        let lanes = skeleton.lanes() as usize;
        let len = POSE_FIELDS * lanes;
        let skeleton_id = self.instance_skeletons[i];
        let layer_weights = &self.layer_weights[i * MAX_LAYERS..(i + 1) * MAX_LAYERS];
        let mut entries = [Entry::default(); MAX_BLEND];
        let mut count = 0;
        let mut layers_used = 0u32;
        for k in 0..MAX_BLEND {
            let action = &slots.action[k];
            let w = weight[k] * action.factor() * slots.shares[k];
            let clip = self.slots.clip[i * MAX_BLEND + k];
            // Comparisons with NaN are false, so NaN weights are skipped too.
            let usable = w > 0.0
                && w < f32::INFINITY
                && self.clip_skeletons.get(clip as usize) == Some(&skeleton_id);
            if usable {
                let layer = action.layer().min(MAX_LAYERS - 1);
                let additive = action.flags & flag::ADDITIVE != 0;
                entries[count] = Entry {
                    clip,
                    time: time[k],
                    weight: w,
                    layer,
                    additive,
                };
                count += 1;
                if !additive {
                    layers_used |= 1 << layer;
                }
            }
        }
        let entries = &entries[..count];
        let pose = &mut scratch.pose[..len];
        pose.copy_from_slice(skeleton.rest().values());
        // Each layer blends its clips as three.js's mixer does, per joint and channel: each clip
        // with a track there moves the blend so far by its share of the weight so far. Layer 0's
        // blend starts from the rest pose, which makes up any weight below 1. Each layer above
        // replaces the pose below by its weight, and by its own blend's weight up to 1.
        for (layer, &layer_weight) in layer_weights.iter().enumerate() {
            if layers_used & (1 << layer) == 0 || !counts(layer_weight) {
                continue;
            }
            let mask = self.mask_of(i, layer, lanes);
            let weights = &mut scratch.weights[..3 * lanes];
            let shares = &mut scratch.shares[..3 * lanes];
            let target = if layer == 0 {
                &mut *pose
            } else {
                &mut scratch.layer[..len]
            };
            let base_scale = if layer == 0 { layer_weight } else { 1.0 };
            let mut first = true;
            for e in entries.iter().filter(|e| e.layer == layer && !e.additive) {
                let clip = &self.clips[e.clip as usize];
                if first {
                    clip.sample(e.time, target);
                    start_weights(weights, clip.channels(), mask, e.weight * base_scale);
                    first = false;
                } else {
                    let sample = &mut scratch.sample[..len];
                    clip.sample(e.time, sample);
                    add_weights(
                        weights,
                        shares,
                        clip.channels(),
                        mask,
                        e.weight * base_scale,
                    );
                    blend(target, sample, shares, lanes);
                }
            }
            if layer == 0 {
                let masked = self.layer_masks[i * MAX_LAYERS] != 0;
                if rest_shares(weights, shares, masked) {
                    blend(pose, skeleton.rest().values(), shares, lanes);
                }
            }
            // A running dead blend moves the layer's own pose from the pose the layer left toward
            // the pose its clips make now. Layer 0 blends it straight into the pose; each layer
            // above does so before it replaces the pose below by its weight.
            let layer_pose = if layer == 0 {
                &mut *pose
            } else {
                &mut scratch.layer[..len]
            };
            let running = self.apply_dead_blend(i, layer, layer_pose, step, lanes, transition);
            if layer > 0 {
                layer_shares(weights, shares, layer_weight);
                // A joint that only the outgoing clips animated has no weight in the layer now, so
                // the pose below covers it. While the blend runs, the pose it decays from shows
                // there instead, and by the end of the fade the pose below takes over.
                if let Some(alpha) = running {
                    let cover = self.cover_of(i, layer, lanes, transition);
                    cover_shares(weights, cover, shares, layer_weight, alpha);
                }
                blend(pose, &scratch.layer[..len], shares, lanes);
            }
        }
        // Additive clips add their change from their first frame on top, in layer order, each by
        // its weight times its layer's weight and mask.
        let mut added = false;
        for (layer, &layer_weight) in layer_weights.iter().enumerate() {
            if !counts(layer_weight) {
                continue;
            }
            for e in entries.iter().filter(|e| e.layer == layer && e.additive) {
                let add = &mut scratch.add[..len];
                if !added {
                    clear_additive(add, lanes);
                    added = true;
                }
                let clip = &self.clips[e.clip as usize];
                let sample = &mut scratch.sample[..len];
                clip.sample(e.time, sample);
                let mask = self.mask_of(i, layer, lanes);
                let shares = &mut scratch.shares[..3 * lanes];
                start_weights(shares, clip.channels(), mask, e.weight * layer_weight);
                add_additive(add, sample, shares, lanes);
            }
        }
        if added {
            apply_additive(pose, &scratch.add[..len], lanes);
        }
    }

    /// Moves `pose` from the dead blend's extrapolated outgoing pose toward itself by the fade's
    /// ease, and advances the blend's timer. Returns that ease, or `None` when no blend runs on the
    /// layer.
    fn apply_dead_blend(
        &self,
        i: usize,
        layer: usize,
        pose: &mut [f32],
        step: f32,
        lanes: usize,
        transition: Transition,
    ) -> Option<f32> {
        let (Some(poses), Some(vs), Some(times), Some(lengths), Some(of)) = (
            transition.pose,
            transition.vel,
            transition.time,
            transition.len,
            transition.of,
        ) else {
            return None;
        };
        let at = i * MAX_LAYERS + layer;
        // SAFETY: `at` names this instance's own layer, which one chunk writes.
        let record = unsafe { of.read(at) };
        if record == NO_TRANSITION {
            return None;
        }
        let record = record as usize;
        // SAFETY: the running blend's own record, which one chunk writes.
        let length: f32 = unsafe { lengths.read(record) };
        if length <= 0.0 || length.is_nan() {
            return None;
        }
        let len = POSE_FIELDS * lanes;
        let base = record * transition.stride;
        // SAFETY: the range is inside this record's own pose, which one chunk writes.
        let (ext, vel) = unsafe { (poses.slice(base, len), vs.slice(base, len)) };
        let time = unsafe { times.read(record) } + step.abs();
        unsafe { times.write(record, time) };
        let alpha = smoothstep(time / length);
        dead_blend(pose, ext, vel, alpha, step, lanes);
        if time >= length {
            // SAFETY: as above.
            unsafe { lengths.write(record, 0.0) };
            unsafe { of.write(at, NO_TRANSITION) };
        }
        Some(alpha)
    }

    /// The channels the outgoing clips of instance `i`'s layer `layer` animated, 3 rows of lanes,
    /// from the record its running blend holds; nothing when no blend runs there.
    fn cover_of(&self, i: usize, layer: usize, lanes: usize, transition: Transition) -> &[f32] {
        let (Some(of), Some(covers)) = (transition.of, transition.cover) else {
            return &[];
        };
        let at = i * MAX_LAYERS + layer;
        // SAFETY: `at` names this instance's own layer, which one chunk reads.
        let record = unsafe { of.read(at) };
        if record == NO_TRANSITION {
            return &[];
        }
        // SAFETY: the running blend's own record, which one chunk reads.
        unsafe { covers.slice(record as usize * 3 * lanes, 3 * lanes) }
    }

    /// The pose that layer `layer` of instance `i` makes now, or `step` seconds earlier, written
    /// into `out`: its base clips blended as three.js's mixer blends them, by their weights and
    /// the layer's mask. Layer 0 also takes the rest pose's share. Returns false when the layer
    /// plays no base clip. `sample`, `weights` and `shares` are scratch.
    #[allow(clippy::too_many_arguments)]
    fn layer_pose(
        &self,
        i: usize,
        layer: usize,
        lanes: usize,
        step: f32,
        out: &mut [f32],
        sample: &mut [f32],
        weights: &mut [f32],
        shares: &mut [f32],
    ) -> bool {
        let skeleton = &self.skeletons[self.instance_skeletons[i] as usize];
        let rest = skeleton.rest().values();
        let len = POSE_FIELDS * lanes;
        out[..len].copy_from_slice(&rest[..len]);
        let layer_weight = self.layer_weights[i * MAX_LAYERS + layer];
        let base_scale = if layer == 0 { layer_weight } else { 1.0 };
        let mask = self.mask_of(i, layer, lanes);
        let first = i * MAX_BLEND;
        let mut any = false;
        let mut lead = true;
        for k in 0..MAX_BLEND {
            let s = first + k;
            let action = self.actions[s];
            if !action.plays_on(layer, 0) {
                continue;
            }
            let clip = &self.clips[self.slots.clip[s] as usize];
            let duration = clip.duration();
            let looping = action.flags & flag::LOOP != 0;
            // The clip's own time moved by its speed over this step, or held still when it ended,
            // so the pose `step` seconds earlier is the one this clip made then.
            let moved = if action.flags & flag::FINISHED != 0 {
                0.0
            } else {
                step * action.speed
            };
            let time = start_time(self.slots.time[s] - moved, duration, looping);
            let weight = self.slots.weight[s] * action.factor() * base_scale;
            any = true;
            if lead {
                clip.sample(time, out);
                start_weights(weights, clip.channels(), mask, weight);
                lead = false;
            } else {
                clip.sample(time, sample);
                add_weights(weights, shares, clip.channels(), mask, weight);
                blend(out, sample, shares, lanes);
            }
        }
        if !any {
            return false;
        }
        if layer == 0 {
            let masked = self.layer_masks[i * MAX_LAYERS] != 0;
            if rest_shares(weights, shares, masked) {
                blend(out, &rest[..len], shares, lanes);
            }
        }
        true
    }

    /// Starts a dead blend on layer `layer` of instance `instance` over `fade` seconds: the pose
    /// and velocity of the layer's outgoing base clips become the extrapolated pose that the blend
    /// decays from, and those clips leave their slots at once, so only the new clip is sampled.
    /// Returns false when the layer plays no base clip to switch from, or runs a 1D blend, whose
    /// clips keep weighted blending.
    pub(super) fn start_inertial(
        &mut self,
        instance: u32,
        layer: usize,
        fade: f32,
    ) -> Result<bool, AnimationError> {
        let i = instance as usize;
        let first = i * MAX_BLEND;
        let mut any = false;
        for k in 0..MAX_BLEND {
            let action = self.actions[first + k];
            if action.plays_on(layer, 0) && action.flags & flag::BLEND != 0 {
                return Ok(false);
            }
            if action.plays_on(layer, 0) && self.slots.source[first + k] != NO_SOURCE {
                any = true;
            }
        }
        if !any {
            return Ok(false);
        }
        let skeleton = self.live_skeleton(instance)?;
        let lanes = self.skeletons[skeleton as usize].lanes() as usize;
        self.enable_inertial()?;
        let stride = self.inertial_stride;
        let len = POSE_FIELDS * lanes;
        let step = self.last_steps[i];
        // SAFETY: a play runs between frame steps, so no worker holds worker 0's scratch.
        let scratch = unsafe { &mut *self.scratch[0].0.get() };
        let now = self.layer_pose(
            i,
            layer,
            lanes,
            0.0,
            &mut scratch.pose[..len],
            &mut scratch.sample[..len],
            &mut scratch.weights[..3 * lanes],
            &mut scratch.shares[..3 * lanes],
        );
        let before = self.layer_pose(
            i,
            layer,
            lanes,
            step,
            &mut scratch.add[..len],
            &mut scratch.sample[..len],
            &mut scratch.weights[..3 * lanes],
            &mut scratch.shares[..3 * lanes],
        );
        if !now || !before {
            return Ok(false);
        }
        // A blend that already runs on the layer holds the pose on screen, between its own clips
        // and the pose it decays from. Both captures take it, so a second switch during a fade
        // carries on from what the frames showed instead of jumping back to the clips. The step is
        // 0, so the running blend's own state stays as it is.
        let transition = self.transitions();
        self.apply_dead_blend(i, layer, &mut scratch.pose[..len], 0.0, lanes, transition);
        self.apply_dead_blend(i, layer, &mut scratch.add[..len], 0.0, lanes, transition);
        // The layer keeps the record its blend already runs in, and takes a free one otherwise.
        let at = i * MAX_LAYERS + layer;
        let held = self.transition_of[at];
        let record = match held {
            NO_TRANSITION => {
                let record = match self.free_record() {
                    Some(record) => record,
                    None => self.grow_pool()?,
                };
                self.transition_of[at] = record;
                record
            }
            record => record,
        };
        let record = record as usize;
        let base = record * stride;
        {
            let pose = &mut self.pool_pose[base..base + len];
            pose.copy_from_slice(&scratch.pose[..len]);
            fill_velocity(
                &scratch.pose[..len],
                &scratch.add[..len],
                step,
                lanes,
                &mut self.pool_vel[base..base + len],
            );
        }
        // The channels the outgoing clips animated are the ones whose pose the blend keeps. A
        // blend that already ran on the layer carries its own channels on too: its pose is part of
        // what the frame showed, which the captures above took.
        let cover = record * 3 * lanes;
        let carried = if held == NO_TRANSITION {
            None
        } else {
            Some(held as usize * 3 * lanes)
        };
        for k in 0..3 * lanes {
            let mut covered = scratch.weights[k] > 0.0;
            if let Some(old) = carried {
                covered |= self.pool_cover[old + k] > 0.0;
            }
            self.pool_cover[cover + k] = if covered { 1.0 } else { 0.0 };
        }
        self.pool_time[record] = 0.0;
        self.pool_len[record] = fade;
        for k in 0..MAX_BLEND {
            let s = first + k;
            if self.actions[s].plays_on(layer, 0) {
                self.actions[s] = Action::default();
                self.slots.weight[s] = 0.0;
                self.slots.source[s] = NO_SOURCE;
            }
        }
        Ok(true)
    }

    /// Applies instance `i`'s rotation overrides, then its look-at, to the pose in its scratch
    /// memory.
    fn override_joints(&self, i: usize, skeleton: &Skeleton, scratch: &mut Scratch) {
        let block = &self.overrides[i * BLOCK_FLOATS..(i + 1) * BLOCK_FLOATS];
        let len = POSE_FIELDS * skeleton.lanes() as usize;
        let pose = &mut scratch.pose[..len];
        joints::apply_overrides(block, skeleton, pose);
        if joints::looks(block) {
            let t = &self.look_local[i * 3..i * 3 + 3];
            joints::look_at(
                block,
                [t[0], t[1], t[2]],
                skeleton,
                pose,
                &mut scratch.path,
                &mut scratch.matrices,
            );
        }
    }

    /// The joint mask of layer `layer` of instance `i`: one weight per lane.
    fn mask_of(&self, i: usize, layer: usize, lanes: usize) -> &[f32] {
        match self.layer_masks[i * MAX_LAYERS + layer] {
            0 => &self.ones[..lanes],
            id => &self.masks[id as usize - 1].weights,
        }
    }

    /// Composes the pose in `scratch` into skinning matrices in `out`.
    fn compose(&self, skeleton: &Skeleton, scratch: &mut Scratch, out: &mut [f32]) {
        let len = POSE_FIELDS * skeleton.lanes() as usize;
        skinning_matrices(skeleton, &scratch.pose[..len], &mut scratch.matrices, out);
    }
}

/// Writes into `vel` the rate at which each lane of pose `now` moves from pose `before`, over
/// `step` seconds: translations and scales at their difference over the step, and rotations at the
/// scaled axis of `now * before⁻¹`. All 0 when the step is not a positive number.
fn fill_velocity(now: &[f32], before: &[f32], step: f32, lanes: usize, vel: &mut [f32]) {
    vel.fill(0.0);
    if !step.is_finite() || step <= 0.0 {
        return;
    }
    let inverse = 1.0 / step;
    for f in (0..field::ROTATION).chain(field::SCALE..POSE_FIELDS) {
        for j in 0..lanes {
            let at = f * lanes + j;
            vel[at] = (now[at] - before[at]) * inverse;
        }
    }
    let r = field::ROTATION * lanes;
    for j in 0..lanes {
        let read = |pose: &[f32], k: usize| pose[r + k * lanes + j];
        let a = [read(now, 0), read(now, 1), read(now, 2), read(now, 3)];
        let b = [
            read(before, 0),
            read(before, 1),
            read(before, 2),
            read(before, 3),
        ];
        // The change from `before` to `now`, as a quaternion `a * conj(b)`.
        let conj = [-b[0], -b[1], -b[2], b[3]];
        let mut d = [
            a[3] * conj[0] + a[0] * conj[3] + a[1] * conj[2] - a[2] * conj[1],
            a[3] * conj[1] - a[0] * conj[2] + a[1] * conj[3] + a[2] * conj[0],
            a[3] * conj[2] + a[0] * conj[1] - a[1] * conj[0] + a[2] * conj[3],
            a[3] * conj[3] - a[0] * conj[0] - a[1] * conj[1] - a[2] * conj[2],
        ];
        // The shorter arc: a negated quaternion is the same rotation.
        if d[3] < 0.0 {
            d = [-d[0], -d[1], -d[2], -d[3]];
        }
        let length = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if length > 1e-8 {
            // The scaled axis: the axis times the angle, which is `2 * atan2(|v|, w)`.
            let scale = 2.0 * length.atan2(d[3]) / length * inverse;
            for k in 0..3 {
                vel[r + k * lanes + j] = d[k] * scale;
            }
        }
    }
}

/// Composes a pose by field into skinning matrices: local matrices four joints at a time, then
/// each joint after its parent, then each joint's inverse bind matrix.
fn skinning_matrices(skeleton: &Skeleton, pose: &[f32], matrices: &mut [Affine], out: &mut [f32]) {
    let joints = skeleton.joints() as usize;
    let matrices = &mut matrices[..joints];
    local_matrices(pose, skeleton.lanes() as usize, joints, matrices);
    let parents = skeleton.parents();
    let binds = skeleton.inverse_bind();
    for j in 0..joints {
        let parent = parents[j];
        if parent != NO_PARENT {
            matrices[j] = mul(&matrices[parent as usize], &matrices[j]);
        }
        let skin = mul(&matrices[j], &binds[j]);
        out[j * MATRIX_FLOATS..(j + 1) * MATRIX_FLOATS].copy_from_slice(&skin);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A chain of `joints` joints, each one above its parent along +Y, with the inverse bind
    /// matrices of that rest pose.
    fn chain(joints: u32) -> Skeleton {
        let parents: Vec<u32> = std::iter::once(NO_PARENT).chain(0..joints - 1).collect();
        let rest = [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0].repeat(joints as usize);
        let binds = crate::math::IDENTITY.repeat(joints as usize);
        Skeleton::new(&parents, &rest, &binds).unwrap()
    }

    /// The pool a table makes holds a few dead-blend records, not one pose for every instance slot
    /// and every layer: a crowd of many characters must not pay megabytes for the few blends that
    /// run at once.
    #[test]
    fn the_dead_blend_pool_starts_small() {
        let jobs = JobSystem::new(0);
        let mut animations = Animations::new(&jobs, 1024, 8).unwrap();
        animations.add_skeleton(chain(8)).unwrap();
        animations.enable_inertial().unwrap();
        let stride = animations.inertial_stride;
        assert_eq!(animations.pool_len.len(), SEED_TRANSITIONS);
        assert_eq!(animations.pool_time.len(), SEED_TRANSITIONS);
        assert_eq!(animations.pool_pose.len(), SEED_TRANSITIONS * stride);
        assert_eq!(animations.pool_vel.len(), SEED_TRANSITIONS * stride);
        assert_eq!(animations.transition_of.len(), 1024 * MAX_LAYERS);
        assert!(
            animations.pool_pose.len() * 50 < 1024 * MAX_LAYERS * stride,
            "the pool is a small share of one pose per slot and layer"
        );
    }

    /// A play that asks for the pool before any skeleton gives the lanes makes it at the play that
    /// needs it, with the lanes of a real skeleton.
    #[test]
    fn the_pool_waits_for_a_skeleton() {
        let jobs = JobSystem::new(0);
        let mut animations = Animations::new(&jobs, 4, 8).unwrap();
        animations.enable_inertial().unwrap();
        assert_eq!(animations.inertial_stride, 0);
        animations.add_skeleton(chain(8)).unwrap();
        animations.enable_inertial().unwrap();
        assert_eq!(animations.inertial_stride, POSE_FIELDS * 8);
        assert_eq!(animations.pool_len.len(), SEED_TRANSITIONS);
    }
}
