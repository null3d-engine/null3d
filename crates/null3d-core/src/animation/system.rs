//! The animation table: skeletons, clips and animated instances, and the frame step that writes
//! every instance's skinning matrices on the job workers.

use std::cell::UnsafeCell;

use super::pose::{add_weights, blend, local_matrices, rest_shares, start_weights};
use super::{AnimationError, Clip, NO_PARENT, POSE_FIELDS, Skeleton, filled, out_of_memory};
use crate::error::{CoreError, Resource};
use crate::jobs::{JobSystem, WorkerId};
use crate::math::{Affine, mul};
use crate::shared::SharedMut;
use crate::world::MATRIX_FLOATS;

/// The most clips one instance blends in a frame: its sample slots.
pub const MAX_BLEND: usize = 4;

/// Instances per chunk of the frame step's parallel loop. A character of 30 to 60 joints takes a
/// few microseconds, so a few of them make a chunk worth handing to another thread.
pub const INSTANCE_CHUNK: u32 = 4;

/// The sample slots of every instance: slot `k` of instance `i` sits at `i * MAX_BLEND + k`. Each
/// frame, every slot with a weight above 0 samples its clip at its time, and the instance's pose
/// is the blend of those samples. A slot whose clip belongs to another skeleton, or whose weight
/// is not a positive number, is skipped. The arrays never move, so another thread's view of them
/// stays valid.
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

/// One thread's scratch memory for the frame step, sized for the largest skeleton.
#[derive(Default)]
struct Scratch {
    /// The blend of an instance's clips so far.
    pose: Box<[f32]>,
    /// A pose that one clip samples into.
    sample: Box<[f32]>,
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

/// Skeletons, clips and animated instances, with fixed capacities for instances and their joints.
/// See [`crate::animation`].
pub struct Animations {
    skeletons: Vec<Skeleton>,
    clips: Vec<Clip>,
    /// The skeleton of each clip.
    clip_skeletons: Vec<u32>,
    /// The skeleton of each instance.
    instance_skeletons: Box<[u32]>,
    /// The first joint of each instance in the matrix buffer.
    first_joints: Box<[u32]>,
    instances: u32,
    joints: u32,
    slots: SampleSlots,
    /// [`MATRIX_FLOATS`] floats per joint of every instance.
    matrices: Box<[f32]>,
    scratch: Box<[ThreadScratch]>,
    /// The lanes the scratch memory holds.
    scratch_lanes: u32,
}

impl Animations {
    /// A table for up to `instances` animated instances with `joints` joints between them, whose
    /// frame step runs on `jobs`. The capacities fix the arrays that other threads view.
    pub fn new(jobs: &JobSystem, instances: u32, joints: u32) -> Result<Self, AnimationError> {
        let slots = instances as usize * MAX_BLEND;
        let mut scratch = Vec::new();
        scratch
            .try_reserve_exact(jobs.thread_count() as usize)
            .map_err(|_| out_of_memory(jobs.thread_count() as usize * size_of::<Scratch>()))?;
        scratch.extend((0..jobs.thread_count()).map(|_| ThreadScratch(UnsafeCell::default())));
        Ok(Animations {
            skeletons: Vec::new(),
            clips: Vec::new(),
            clip_skeletons: Vec::new(),
            instance_skeletons: boxed(instances as usize, 0)?,
            first_joints: boxed(instances as usize, 0)?,
            instances: 0,
            joints: 0,
            slots: SampleSlots {
                clip: boxed(slots, 0)?,
                time: boxed(slots, 0.0)?,
                weight: boxed(slots, 0.0)?,
            },
            matrices: boxed(joints as usize * MATRIX_FLOATS, 0.0)?,
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
                    weights: boxed(3 * lanes as usize, 0.0)?,
                    shares: boxed(3 * lanes as usize, 0.0)?,
                    matrices: boxed(lanes as usize, [0.0; MATRIX_FLOATS])?,
                };
            }
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
        self.clips
            .try_reserve(1)
            .and_then(|()| self.clip_skeletons.try_reserve(1))
            .map_err(|_| out_of_memory(size_of::<Clip>()))?;
        self.clips.push(clip);
        self.clip_skeletons.push(skeleton);
        Ok(self.clips.len() as u32 - 1)
    }

    /// The clip with this id.
    pub fn clip(&self, clip: u32) -> Option<&Clip> {
        self.clips.get(clip as usize)
    }

    /// Adds an instance of skeleton `skeleton`, with its sample slots empty, and returns its id.
    /// Until a slot gets a weight, the instance holds the rest pose.
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
        let instance = self.instances as usize;
        if instance >= self.instance_skeletons.len() {
            return Err(full(
                Resource::AnimatedInstances,
                self.instance_skeletons.len(),
            ));
        }
        let capacity = self.matrices.len() / MATRIX_FLOATS;
        if self.joints as usize + joints as usize > capacity {
            return Err(full(Resource::AnimatedJoints, capacity));
        }
        self.instance_skeletons[instance] = skeleton;
        self.first_joints[instance] = self.joints;
        let first_slot = instance * MAX_BLEND;
        self.slots.weight[first_slot..first_slot + MAX_BLEND].fill(0.0);
        self.instances += 1;
        self.joints += joints;
        Ok(instance as u32)
    }

    /// The number of instances.
    pub fn instances(&self) -> u32 {
        self.instances
    }

    /// The joints of every instance together.
    pub fn joints(&self) -> u32 {
        self.joints
    }

    /// The sample slots of every instance, which the animator writes before each frame step.
    pub fn slots(&self) -> &SampleSlots {
        &self.slots
    }

    /// The sample slots of every instance, to change.
    pub fn slots_mut(&mut self) -> &mut SampleSlots {
        &mut self.slots
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
    /// frame step. The buffer never moves.
    pub fn matrices(&self) -> &[f32] {
        &self.matrices
    }

    /// The skinning matrices of instance `instance`, one per joint of its skeleton.
    ///
    /// # Panics
    /// When the instance does not exist.
    pub fn instance_matrices(&self, instance: u32) -> &[f32] {
        assert!(
            instance < self.instances,
            "instance {instance} does not exist"
        );
        let i = instance as usize;
        let joints = self.skeletons[self.instance_skeletons[i] as usize].joints() as usize;
        let first = self.first_joints[i] as usize * MATRIX_FLOATS;
        &self.matrices[first..first + joints * MATRIX_FLOATS]
    }

    /// The frame step: samples, blends and composes every instance's pose and writes its skinning
    /// matrices, in parallel on `jobs`. It allocates nothing.
    ///
    /// # Panics
    /// When `jobs` has more threads than the job system the table was made for.
    pub fn update(&mut self, jobs: &JobSystem) {
        if self.instances == 0 {
            return;
        }
        assert!(
            jobs.thread_count() as usize <= self.scratch.len(),
            "the animation table was made for a job system with fewer threads"
        );
        let out = SharedMut::new(&mut self.matrices);
        let this = &*self;
        jobs.parallel_for(
            this.instances,
            INSTANCE_CHUNK,
            &|range, worker: WorkerId| {
                // SAFETY: see `ThreadScratch`: only this thread's chunks use this scratch.
                let scratch = unsafe { &mut *this.scratch[worker.index()].0.get() };
                for i in range {
                    let i = i as usize;
                    let skeleton = &this.skeletons[this.instance_skeletons[i] as usize];
                    let first = this.first_joints[i] as usize * MATRIX_FLOATS;
                    let len = skeleton.joints() as usize * MATRIX_FLOATS;
                    // SAFETY: instances own disjoint runs of the buffer, from their first joint for as
                    // many joints as their skeleton has, and each instance is in one chunk.
                    let matrices = unsafe { out.slice(first, len) };
                    this.pose_instance(i, skeleton, scratch, matrices);
                }
            },
        );
    }

    /// Writes instance `i`'s skinning matrices into `out`.
    fn pose_instance(&self, i: usize, skeleton: &Skeleton, scratch: &mut Scratch, out: &mut [f32]) {
        let lanes = skeleton.lanes() as usize;
        let len = POSE_FIELDS * lanes;
        let skeleton_id = self.instance_skeletons[i];
        let mut active = [(0usize, 0.0f32, 0.0f32); MAX_BLEND];
        let mut count = 0;
        for slot in i * MAX_BLEND..(i + 1) * MAX_BLEND {
            let weight = self.slots.weight[slot];
            let clip = self.slots.clip[slot] as usize;
            // Comparisons with NaN are false, so NaN weights are skipped too.
            let usable = weight > 0.0
                && weight < f32::INFINITY
                && self.clip_skeletons.get(clip) == Some(&skeleton_id);
            if usable {
                active[count] = (clip, self.slots.time[slot], weight);
                count += 1;
            }
        }

        if count == 0 {
            skinning_matrices(
                skeleton,
                skeleton.rest().values(),
                &mut scratch.matrices,
                out,
            );
            return;
        }
        // As three.js's mixer, per joint and channel: each clip with a track there moves the blend
        // so far by its share of the weight so far, and below a total weight of 1 the rest pose
        // makes up the remainder.
        let pose = &mut scratch.pose[..len];
        let weights = &mut scratch.weights[..3 * lanes];
        let shares = &mut scratch.shares[..3 * lanes];
        let (clip, time, weight) = active[0];
        let clip = &self.clips[clip];
        clip.sample(time, pose);
        start_weights(weights, clip.channels(), weight);
        for &(clip, time, weight) in &active[1..count] {
            let clip = &self.clips[clip];
            let sample = &mut scratch.sample[..len];
            clip.sample(time, sample);
            add_weights(weights, shares, clip.channels(), weight);
            blend(pose, sample, shares, lanes);
        }
        if rest_shares(weights, shares) {
            blend(pose, skeleton.rest().values(), shares, lanes);
        }
        skinning_matrices(skeleton, pose, &mut scratch.matrices, out);
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
