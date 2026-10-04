//! The animation table: skeletons, clips, joint masks and animated instances, and the frame step
//! that advances every instance's clips and writes its skinning matrices on the job workers.

use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicU32, Ordering};

use super::actions::{Action, Advance, EventSink, flag};
use super::pose::{
    add_additive, add_weights, apply_additive, blend, clear_additive, layer_shares, local_matrices,
    rest_shares, start_weights,
};
use super::{AnimationError, Clip, NO_PARENT, POSE_FIELDS, Skeleton, filled, out_of_memory};
use crate::error::{CoreError, Resource};
use crate::jobs::{JobSystem, WorkerId};
use crate::math::{Affine, mul};
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

/// The skeleton of an instance id that holds no instance: one that was removed.
const REMOVED: u32 = u32::MAX;

/// The sample slots of every instance: slot `k` of instance `i` sits at `i * MAX_BLEND + k`. Each
/// frame, every slot with a weight above 0 samples its clip at its time, and the instance's pose
/// is the blend of those samples. A slot whose clip belongs to another skeleton, or whose weight
/// is not a positive number, is skipped. The arrays never move, so another thread's view of them
/// stays valid. A slot that [`Animations::play`] fills also advances its time and fades its
/// weight in each frame step.
#[derive(Debug)]
pub struct SampleSlots {
    /// The clip of each slot.
    pub clip: Box<[u32]>,
    /// The time in seconds at which each slot samples its clip; times outside the clip take its
    /// first or last key.
    pub time: Box<[f32]>,
    /// The weight of each slot; 0 leaves the slot out.
    pub weight: Box<[f32]>,
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
}

impl Default for Play {
    fn default() -> Self {
        Play {
            layer: 0,
            fade: 0.0,
            speed: 1.0,
            looping: true,
            additive: false,
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

/// True when a weight counts in a blend: above 0. NaN does not count.
#[inline]
pub(super) fn counts(weight: f32) -> bool {
    weight > 0.0
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

/// Skeletons, clips and animated instances, with fixed capacities for instances and their joints.
/// See [`crate::animation`].
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
    /// Runs of joints that removed instances gave back: first joint and length.
    free_joints: Vec<(u32, u32)>,
    pub(super) slots: SampleSlots,
    /// How each slot that a play filled advances.
    pub(super) actions: Box<[Action]>,
    /// The rate of each instance's time; TypeScript writes it.
    time_scales: Box<[f32]>,
    /// The weight of each layer of each instance, [`MAX_LAYERS`] per instance; TypeScript writes
    /// them.
    layer_weights: Box<[f32]>,
    /// The joint mask of each layer of each instance: a mask id plus one, or 0 for every joint.
    layer_masks: Box<[u32]>,
    /// Two buffers of [`MATRIX_FLOATS`] floats per joint of every instance. Each frame step writes
    /// the buffer that the step before did not, so a frame's draw list can upload the matrices of
    /// its step while the next frame's step runs.
    matrices: [Box<[f32]>; 2],
    /// The buffer that the last frame step wrote.
    written: usize,
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
}

impl Animations {
    /// A table for up to `instances` animated instances with `joints` joints between them, whose
    /// frame step runs on `jobs`. The capacities fix the arrays that other threads view.
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
            },
            actions: boxed(slots, Action::default())?,
            time_scales: boxed(n, 1.0)?,
            layer_weights: boxed(n * MAX_LAYERS, 1.0)?,
            layer_masks: boxed(n * MAX_LAYERS, 0)?,
            matrices: [
                boxed(joints as usize * MATRIX_FLOATS, 0.0)?,
                boxed(joints as usize * MATRIX_FLOATS, 0.0)?,
            ],
            written: 0,
            events: boxed(EVENT_CAPACITY, [0; EVENT_WORDS])?,
            event_totals: boxed(2, 0)?,
            event_count: AtomicU32::new(0),
            events_dropped: AtomicU32::new(0),
            ones: Box::default(),
            scratch: scratch.into_boxed_slice(),
            scratch_lanes: 0,
        })
    }

    /// Adds a skeleton and returns its id.
    pub fn add_skeleton(&mut self, skeleton: Skeleton) -> Result<u32, AnimationError> {
        let lanes = skeleton.lanes();
        if lanes > self.scratch_lanes {
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
                };
            }
            self.ones = boxed(lanes as usize, 1.0)?;
            self.scratch_lanes = lanes;
        }
        self.skeletons
            .try_reserve(1)
            .map_err(|_| out_of_memory(size_of::<Skeleton>()))?;
        self.skeletons.push(skeleton);
        Ok(self.skeletons.len() as u32 - 1)
    }

    /// The skeleton with this id.
    pub fn skeleton(&self, skeleton: u32) -> Option<&Skeleton> {
        self.skeletons.get(skeleton as usize)
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
        let id = self.clips.len() as u32;
        self.push_clip(skeleton, clip, id)
    }

    /// The clips added so far that [`super::resample`] evaluated at each frame, in some track at
    /// least. The others were copied from keys already on their frames.
    pub fn resampled_clips(&self) -> u32 {
        // An additive clip counts through its source.
        self.clips
            .iter()
            .enumerate()
            .filter(|(k, clip)| self.clip_sources[*k] as usize == *k && clip.resampled_tracks() > 0)
            .count() as u32
    }

    /// Stores a clip with its skeleton and source, and returns its id.
    fn push_clip(&mut self, skeleton: u32, clip: Clip, source: u32) -> Result<u32, AnimationError> {
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

    /// The clip with this id.
    pub fn clip(&self, clip: u32) -> Option<&Clip> {
        self.clips.get(clip as usize)
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
        let id = self.push_clip(skeleton, additive, source)?;
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
        let source = *self
            .clip_sources
            .get(clip as usize)
            .ok_or(AnimationError::UnknownClip { clip })?;
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
        self.masks
            .try_reserve(1)
            .map_err(|_| out_of_memory(size_of::<Mask>()))?;
        self.masks.push(Mask {
            skeleton,
            weights: padded.into_boxed_slice(),
        });
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
        let slots = instance * MAX_BLEND..(instance + 1) * MAX_BLEND;
        self.slots.weight[slots.clone()].fill(0.0);
        self.actions[slots].fill(Action::default());
        self.time_scales[instance] = 1.0;
        let layers = instance * MAX_LAYERS..(instance + 1) * MAX_LAYERS;
        self.layer_weights[layers.clone()].fill(1.0);
        self.layer_masks[layers].fill(0);
        Ok(instance as u32)
    }

    /// Removes instance `instance`. Its id and joints go to the next instances that fit them.
    pub fn remove_instance(&mut self, instance: u32) -> Result<(), AnimationError> {
        let skeleton = self.live_skeleton(instance)?;
        let i = instance as usize;
        let joints = self.skeletons[skeleton as usize].joints();
        // Both lists hold at most one entry per instance id, which their capacity covers.
        self.free_joints.push((self.first_joints[i], joints));
        self.free_instances.push(instance);
        self.instance_skeletons[i] = REMOVED;
        self.slots.weight[i * MAX_BLEND..(i + 1) * MAX_BLEND].fill(0.0);
        Ok(())
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

    /// The rate of each instance's time, one per instance; 1 by default.
    pub fn time_scales_mut(&mut self) -> &mut [f32] {
        &mut self.time_scales
    }

    /// The weight of each layer of each instance, [`MAX_LAYERS`] per instance; 1 by default.
    pub fn layer_weights_mut(&mut self) -> &mut [f32] {
        &mut self.layer_weights
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
    /// frame step. The two buffers never move, and the steps take turns between them, so the
    /// address changes with each step.
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

    /// The frame step: advances every played clip by `dt` seconds of the instance's time,
    /// collects the events it passes, then samples, blends and composes every instance's pose
    /// and writes its skinning matrices into the buffer that the step before did not write, in
    /// parallel on `jobs`. It allocates nothing.
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
            let out = SharedMut::new(&mut self.matrices[self.written]);
            let times = SharedMut::new(&mut self.slots.time);
            let weights = SharedMut::new(&mut self.slots.weight);
            let actions = SharedMut::new(&mut self.actions);
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
                        // slots; each instance is in one chunk.
                        let (matrices, time, weight, action) = unsafe {
                            (
                                out.slice(first, len),
                                times.slice(at, MAX_BLEND),
                                weights.slice(at, MAX_BLEND),
                                actions.slice(at, MAX_BLEND),
                            )
                        };
                        let mut advance = Advance {
                            instance: i as u32,
                            time,
                            weight,
                            action,
                            sink: &sink,
                            order: 0,
                        };
                        this.advance(&mut advance, dt * this.time_scales[i]);
                        this.pose_instance(i, skeleton, scratch, &advance);
                        this.compose(skeleton, scratch, matrices);
                    }
                },
            );
        }
        let kept = (self.event_count.load(Ordering::Relaxed) as usize).min(EVENT_CAPACITY);
        // In place and without allocation; the keys are unique, so the order is exact.
        self.events[..kept].sort_unstable_by_key(|r| (r[0], r[1] >> 16));
        self.event_totals[0] = kept as u32;
        self.event_totals[1] = self.events_dropped.load(Ordering::Relaxed);
    }

    /// Blends instance `i`'s clips into the pose in its scratch memory, from its slots' times and
    /// weights. Each slot's weight is its own weight times its fade.
    fn pose_instance(
        &self,
        i: usize,
        skeleton: &Skeleton,
        scratch: &mut Scratch,
        slots: &Advance<'_, '_>,
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
            let w = weight[k] * action.factor();
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
            } else {
                layer_shares(weights, shares, layer_weight);
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
