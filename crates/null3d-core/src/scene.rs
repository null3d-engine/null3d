//! Scene objects: per-slot transform inputs, structural commands, the hierarchy order, and the
//! transform update that writes world matrices and world bounding spheres.
//!
//! # Data
//!
//! Every field is an array indexed by slot (see [`crate::handle`]), allocated once with room for
//! `capacity + 1` rows because slot 0 is never used. TypeScript reads and writes these arrays
//! through typed-array views: positions (3 floats per slot), rotations (a quaternion, 4 floats),
//! scales (3 floats), local bounding radii, and the dirty bitset. The engine writes the rest.
//!
//! # Static and dynamic objects
//!
//! A dynamic object ([`flags::DYNAMIC`]) is recomputed every frame with no checks. A static
//! object is recomputed only when its dirty bit is set (by a setter, by TypeScript, or by a
//! command), or when its parent's world matrix changed in the same frame. Every recomputed
//! object records the frame number in its changed stamp; [`SceneStorage::changed`] turns this
//! frame's stamps into a bitset for uploads.
//!
//! # Hierarchy order
//!
//! Roots form level 0; the children of level `n` objects form level `n + 1`. Within each level,
//! dynamic objects come first, so their loop needs no branch. Levels update in order, so parents
//! finish before their children; a level with at least [`PARALLEL_LEVEL_THRESHOLD`] objects runs
//! as one parallel loop, and a smaller level runs on the calling thread. After any structural
//! change the next update rebuilds the whole order with a breadth-first pass over a child list
//! built by counting sort (linear in the object count).
//!
//! # Late updates
//!
//! Sketch code can move objects after the frame's transform update, as a camera that follows an
//! object does. [`SceneStorage::update_late_transforms`] then recomputes the objects moved since
//! the update, and the objects below them, before culling. A moved object without children
//! updates alone. Below the shallowest moved object with children, levels update in order, and an
//! object updates when it moved or its parent updated in the late update.
//!
//! # Double-buffered world output
//!
//! Frame `f` writes world buffer `f & 1`. A static object that changed in frame `f - 1` but not in
//! frame `f` has its row copied from the other buffer, so both buffers hold every change, and
//! each changed matrix is written once into each buffer. See [`crate::snapshot`] for the handoff
//! to the render worker.
//!
//! # Commands
//!
//! Structural changes arrive as 16-byte [`Command`] records, applied in one batch per frame by
//! [`SceneStorage::apply_commands`]. The operation word holds the operation number in its low
//! byte; for [`op::CREATE`] the next byte holds the object's [`flags`].
//!
//! | Operation | `a` | `b` |
//! | --- | --- | --- |
//! | [`op::CREATE`] (flags in bits 8 to 15 of `op`) | parent handle, or 0 | mesh id |
//! | [`op::DESTROY`] | unused | unused |
//! | [`op::SET_PARENT`] | parent handle, or 0 | unused |
//! | [`op::SET_MESH`] | mesh id | unused |
//! | [`op::SET_MATERIAL`] | material id | unused |
//! | [`op::SET_DYNAMIC`] | 1 for dynamic, 0 for static | unused |
//! | [`op::SET_VISIBLE`] | 1 for visible, 0 for hidden | unused |
//!
//! The handle is reserved with [`SceneStorage::reserve`] before its create command, so TypeScript
//! can write the object's position, rotation, scale and local radius straight away. Destroying an
//! object whose children live on makes them roots, keeping their local transforms.

use std::ops::Range;
use std::simd::prelude::*;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::arena::Pod;
use crate::bitset::Bitset;
use crate::error::{CoreError, Resource};
use crate::handle::{Handle, SlotAllocator};
use crate::jobs::JobSystem;
use crate::math::{self, Affine, IDENTITY_ROTATION};
use crate::shared::SharedMut;
use crate::world::{HIDDEN_RADIUS, WorldArrays, WorldPtrs};

/// Bits of an object's flags word.
pub mod flags {
    /// Recomputed every frame, with no dirty checks.
    pub const DYNAMIC: u32 = 1 << 0;
    /// Drawn and culled. An object is hidden when this bit is clear on it or on any ancestor.
    pub const VISIBLE: u32 = 1 << 1;
    /// Reserved: casts shadows.
    pub const CAST_SHADOWS: u32 = 1 << 2;
    /// Reserved: receives shadows.
    pub const RECEIVE_SHADOWS: u32 = 1 << 3;
}

/// Operation numbers of [`Command`] records (the low byte of [`Command::op`]).
pub mod op {
    /// Creates a reserved object. `a`: parent handle or 0. `b`: mesh id. Bits 8 to 15 of the
    /// operation word: the object's flags.
    pub const CREATE: u32 = 1;
    /// Destroys an object and frees its slot.
    pub const DESTROY: u32 = 2;
    /// Moves an object under a new parent. `a`: parent handle, or 0 for none.
    pub const SET_PARENT: u32 = 3;
    /// Sets the mesh id. `a`: mesh id. The object is recomputed, so write its new local bounding
    /// radius first.
    pub const SET_MESH: u32 = 4;
    /// Sets the material id. `a`: material id.
    pub const SET_MATERIAL: u32 = 5;
    /// Makes an object dynamic (`a` = 1) or static (`a` = 0).
    pub const SET_DYNAMIC: u32 = 6;
    /// Shows (`a` = 1) or hides (`a` = 0) an object and its descendants.
    pub const SET_VISIBLE: u32 = 7;
}

/// The parent value of an object with no parent.
pub const NO_PARENT: u32 = u32::MAX;
/// Levels with at least this many objects update as a parallel loop.
pub const PARALLEL_LEVEL_THRESHOLD: u32 = 256;
/// Objects per chunk when a level updates in parallel.
pub const LEVEL_CHUNK: u32 = 128;
/// Slots at or past this count build the changed bitset as a parallel loop.
const PARALLEL_BITS_THRESHOLD: u32 = 1 << 16;

/// A structural change: 16 bytes, written by TypeScript into a [`CommandRing`]. See the module
/// documentation for the meaning of each field.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Command {
    /// The operation number in the low byte; operation-specific bits above it.
    pub op: u32,
    /// The object's raw handle.
    pub handle: u32,
    /// The first argument.
    pub a: u32,
    /// The second argument.
    pub b: u32,
}

// SAFETY: four `u32` fields in a `repr(C)` struct have no padding, and any bits are valid.
unsafe impl Pod for Command {}

impl Command {
    /// Creates `handle` under `parent` ([`Handle::NONE`] for a root) with a mesh and flags.
    pub const fn create(handle: Handle, parent: Handle, mesh: u32, flags: u32) -> Command {
        Command {
            op: op::CREATE | ((flags & 0xFF) << 8),
            handle: handle.raw(),
            a: parent.raw(),
            b: mesh,
        }
    }

    /// Destroys `handle`.
    pub const fn destroy(handle: Handle) -> Command {
        Command {
            op: op::DESTROY,
            handle: handle.raw(),
            a: 0,
            b: 0,
        }
    }

    /// Moves `handle` under `parent` ([`Handle::NONE`] makes it a root).
    pub const fn set_parent(handle: Handle, parent: Handle) -> Command {
        Command {
            op: op::SET_PARENT,
            handle: handle.raw(),
            a: parent.raw(),
            b: 0,
        }
    }

    /// Sets the mesh id of `handle`.
    pub const fn set_mesh(handle: Handle, mesh: u32) -> Command {
        Command {
            op: op::SET_MESH,
            handle: handle.raw(),
            a: mesh,
            b: 0,
        }
    }

    /// Sets the material id of `handle`.
    pub const fn set_material(handle: Handle, material: u32) -> Command {
        Command {
            op: op::SET_MATERIAL,
            handle: handle.raw(),
            a: material,
            b: 0,
        }
    }

    /// Makes `handle` dynamic or static.
    pub const fn set_dynamic(handle: Handle, dynamic: bool) -> Command {
        Command {
            op: op::SET_DYNAMIC,
            handle: handle.raw(),
            a: dynamic as u32,
            b: 0,
        }
    }

    /// Shows or hides `handle` and its descendants.
    pub const fn set_visible(handle: Handle, visible: bool) -> Command {
        Command {
            op: op::SET_VISIBLE,
            handle: handle.raw(),
            a: visible as u32,
            b: 0,
        }
    }

    /// The operation number: the low byte of the operation word.
    pub const fn opcode(&self) -> u32 {
        self.op & 0xFF
    }
}

/// A command that failed: its position (in the slice, or the ring's sequence number) and the
/// error. The other commands of the batch are still applied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CommandError {
    /// The failing command's index in the slice, or its sequence number in the ring.
    pub index: u32,
    /// Why it failed.
    pub error: CoreError,
}

/// A fixed-capacity ring of [`Command`] records in shared memory.
///
/// TypeScript writes record `write % capacity`, then advances the write index with
/// `Atomics.store`. The ring is full when `write - read` equals the capacity (both indices wrap
/// around at 2^32). [`SceneStorage::apply_ring`] applies every pending record in order and
/// advances the read index.
#[derive(Debug)]
pub struct CommandRing {
    records: Vec<Command>,
    write: AtomicU32,
    read: AtomicU32,
}

impl CommandRing {
    /// A ring with room for `capacity` records, rounded up to a power of two.
    pub fn with_capacity(capacity: u32) -> Self {
        let size = capacity.clamp(1, 1 << 30).next_power_of_two();
        Self {
            records: vec![Command::default(); size as usize],
            write: AtomicU32::new(0),
            read: AtomicU32::new(0),
        }
    }

    /// The number of records the ring holds.
    pub fn capacity(&self) -> u32 {
        self.records.len() as u32
    }

    /// The record array, for TypeScript views. Its address never changes.
    pub fn records(&self) -> &[Command] {
        &self.records
    }

    /// The write index TypeScript advances.
    pub fn write_index(&self) -> &AtomicU32 {
        &self.write
    }

    /// The read index the core advances.
    pub fn read_index(&self) -> &AtomicU32 {
        &self.read
    }

    /// The number of records written but not applied.
    pub fn pending(&self) -> u32 {
        self.write
            .load(Ordering::Acquire)
            .wrapping_sub(self.read.load(Ordering::Acquire))
    }

    /// Appends a record, as TypeScript does. Fails with [`CoreError::CapacityExceeded`] when
    /// the ring is full.
    pub fn push(&mut self, command: Command) -> Result<(), CoreError> {
        if self.pending() >= self.capacity() {
            return Err(CoreError::CapacityExceeded {
                resource: Resource::Commands,
                capacity: self.capacity(),
            });
        }
        let write = self.write.load(Ordering::Relaxed);
        let mask = self.capacity() - 1;
        self.records[(write & mask) as usize] = command;
        self.write.store(write.wrapping_add(1), Ordering::Release);
        Ok(())
    }
}

/// One level of the hierarchy order: `order[start..end]`, dynamic objects in
/// `order[start..dynamic_end]`.
#[derive(Clone, Copy, Debug, Default)]
struct Level {
    start: u32,
    dynamic_end: u32,
    end: u32,
}

/// Scene objects, stored as one array per field and indexed by slot. See the module
/// documentation.
pub struct SceneStorage {
    slots: SlotAllocator,
    created: Bitset,
    positions: Vec<f32>,
    rotations: Vec<f32>,
    scales: Vec<f32>,
    local_radii: Vec<f32>,
    parents: Vec<u32>,
    flags: Vec<u32>,
    meshes: Vec<u32>,
    materials: Vec<u32>,
    cells: Vec<u32>,
    depths: Vec<u32>,
    dirty: Bitset,
    /// Objects with at least one child, rebuilt with the hierarchy order.
    branches: Bitset,
    /// Objects that the late update recomputes: the moved ones, then the ones below them.
    late: Bitset,
    world: [WorldArrays; 2],
    changed_frames: Vec<u32>,
    changed: Bitset,
    dead_pending: Bitset,
    dead_pending_any: bool,
    order: Vec<u32>,
    levels: Vec<Level>,
    level_count: usize,
    order_dirty: bool,
    /// True once a command other than a visibility change applied, until [`Self::take_structure_changed`].
    structure_changed: bool,
    child_offsets: Vec<u32>,
    child_list: Vec<u32>,
    frame: u32,
}

impl SceneStorage {
    /// Storage for up to `capacity` objects. Every array is allocated here, once.
    ///
    /// # Panics
    /// When `capacity` is over [`crate::handle::MAX_SLOTS`].
    pub fn with_capacity(capacity: u32) -> Self {
        let slots = SlotAllocator::with_capacity(capacity);
        let rows = capacity as usize + 1;
        let mut rotations = vec![0.0; rows * 4];
        for q in rotations.as_chunks_mut::<4>().0 {
            *q = IDENTITY_ROTATION;
        }
        Self {
            slots,
            created: Bitset::new(rows as u32),
            positions: vec![0.0; rows * 3],
            rotations,
            scales: vec![1.0; rows * 3],
            local_radii: vec![0.0; rows],
            parents: vec![NO_PARENT; rows],
            flags: vec![0; rows],
            meshes: vec![0; rows],
            materials: vec![0; rows],
            cells: vec![0; rows],
            depths: vec![0; rows],
            dirty: Bitset::new(rows as u32),
            branches: Bitset::new(rows as u32),
            late: Bitset::new(rows as u32),
            world: [WorldArrays::new(rows, false), WorldArrays::new(rows, false)],
            changed_frames: vec![0; rows],
            changed: Bitset::new(rows as u32),
            dead_pending: Bitset::new(rows as u32),
            dead_pending_any: false,
            order: vec![0; rows],
            levels: vec![Level::default(); rows + 1],
            level_count: 0,
            order_dirty: false,
            structure_changed: false,
            child_offsets: vec![0; rows],
            child_list: vec![0; rows],
            frame: 0,
        }
    }

    /// The number of objects the storage holds.
    pub fn capacity(&self) -> u32 {
        self.slots.capacity()
    }

    /// The slot allocator: liveness, generations and destroyed frames.
    pub fn slots(&self) -> &SlotAllocator {
        &self.slots
    }

    /// Reserves a slot for a new object. Write its position, rotation, scale and local radius,
    /// then queue its [`op::CREATE`] command.
    pub fn reserve(&mut self) -> Result<Handle, CoreError> {
        self.slots.reserve()
    }

    /// The slot of a live handle.
    pub fn resolve(&self, handle: Handle) -> Result<u32, CoreError> {
        self.slots.resolve(handle)
    }

    /// True when the object's create command has been applied and it was not destroyed since.
    pub fn is_created(&self, handle: Handle) -> bool {
        self.slots
            .resolve(handle)
            .is_ok_and(|slot| self.created.get(slot))
    }

    /// The current frame: the one the last [`SceneStorage::begin_frame`] started.
    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// The world buffer the current frame writes: `frame & 1`.
    pub fn parity(&self) -> usize {
        (self.frame & 1) as usize
    }

    /// Positions, 3 floats per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }

    /// Positions, for direct writes. Mark static objects dirty after writing.
    pub fn positions_mut(&mut self) -> &mut [f32] {
        &mut self.positions
    }

    /// Rotations as quaternions `(x, y, z, w)`, 4 floats per slot.
    pub fn rotations(&self) -> &[f32] {
        &self.rotations
    }

    /// Rotations, for direct writes. Mark static objects dirty after writing.
    pub fn rotations_mut(&mut self) -> &mut [f32] {
        &mut self.rotations
    }

    /// Scales, 3 floats per slot.
    pub fn scales(&self) -> &[f32] {
        &self.scales
    }

    /// Scales, for direct writes. Mark static objects dirty after writing.
    pub fn scales_mut(&mut self) -> &mut [f32] {
        &mut self.scales
    }

    /// Local bounding radii of each object's mesh, centred on its origin.
    pub fn local_radii(&self) -> &[f32] {
        &self.local_radii
    }

    /// Local bounding radii, for direct writes. Mark static objects dirty after writing.
    pub fn local_radii_mut(&mut self) -> &mut [f32] {
        &mut self.local_radii
    }

    /// Parent slots, [`NO_PARENT`] for roots.
    pub fn parents(&self) -> &[u32] {
        &self.parents
    }

    /// Flags words (see [`flags`]).
    pub fn flags(&self) -> &[u32] {
        &self.flags
    }

    /// Mesh ids.
    pub fn meshes(&self) -> &[u32] {
        &self.meshes
    }

    /// Material ids.
    pub fn materials(&self) -> &[u32] {
        &self.materials
    }

    /// Cell indices for large worlds. Always 0 (the origin cell) for now.
    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    /// Hierarchy depths: 0 for roots. Valid after an update.
    pub fn depths(&self) -> &[u32] {
        &self.depths
    }

    /// The dirty bitset. Setters set bits; TypeScript may set bits through a view; the update
    /// clears them.
    pub fn dirty(&self) -> &Bitset {
        &self.dirty
    }

    /// The dirty bitset, for setting bits directly.
    pub fn dirty_mut(&mut self) -> &mut Bitset {
        &mut self.dirty
    }

    /// The world output of frame parity `parity` (0 or 1).
    pub fn world(&self, parity: usize) -> &WorldArrays {
        &self.world[parity & 1]
    }

    /// The world output of the current frame.
    pub fn current_world(&self) -> &WorldArrays {
        &self.world[self.parity()]
    }

    /// The frame in which each slot's world matrix last changed.
    pub fn changed_frames(&self) -> &[u32] {
        &self.changed_frames
    }

    /// The slots whose world matrix changed in the last update, including objects destroyed in
    /// that frame. Its runs are the upload ranges.
    pub fn changed(&self) -> &Bitset {
        &self.changed
    }

    /// Writes a position and marks the object dirty.
    pub fn set_position(&mut self, handle: Handle, position: [f32; 3]) -> Result<(), CoreError> {
        let slot = self.slots.resolve(handle)? as usize;
        self.positions[slot * 3..slot * 3 + 3].copy_from_slice(&position);
        self.dirty.set(slot as u32);
        Ok(())
    }

    /// Writes a rotation quaternion `(x, y, z, w)` and marks the object dirty.
    pub fn set_rotation(&mut self, handle: Handle, rotation: [f32; 4]) -> Result<(), CoreError> {
        let slot = self.slots.resolve(handle)? as usize;
        self.rotations[slot * 4..slot * 4 + 4].copy_from_slice(&rotation);
        self.dirty.set(slot as u32);
        Ok(())
    }

    /// Writes a scale and marks the object dirty.
    pub fn set_scale(&mut self, handle: Handle, scale: [f32; 3]) -> Result<(), CoreError> {
        let slot = self.slots.resolve(handle)? as usize;
        self.scales[slot * 3..slot * 3 + 3].copy_from_slice(&scale);
        self.dirty.set(slot as u32);
        Ok(())
    }

    /// Writes the mesh's local bounding radius and marks the object dirty.
    pub fn set_local_radius(&mut self, handle: Handle, radius: f32) -> Result<(), CoreError> {
        let slot = self.slots.resolve(handle)?;
        self.local_radii[slot as usize] = radius;
        self.dirty.set(slot);
        Ok(())
    }

    /// Marks an object dirty, so a static object is recomputed in the next update.
    pub fn mark_dirty(&mut self, handle: Handle) -> Result<(), CoreError> {
        let slot = self.slots.resolve(handle)?;
        self.dirty.set(slot);
        Ok(())
    }

    /// The world matrix of an object in the current frame's buffer.
    pub fn world_matrix(&self, handle: Handle) -> Result<Affine, CoreError> {
        let slot = self.slots.resolve(handle)?;
        Ok(*self.current_world().matrix(slot as usize))
    }

    /// Starts frame `frame`. Frames must advance by one; after a gap, every object is recomputed
    /// in this frame. Calling it again for the same frame does nothing.
    pub fn begin_frame(&mut self, frame: u32) {
        if frame == self.frame {
            return;
        }
        let gap = frame != self.frame.wrapping_add(1);
        if gap {
            // The other buffer may have missed changes, so rebuild both from scratch.
            for (d, c) in self.dirty.words_mut().iter_mut().zip(self.created.words()) {
                *d |= c;
            }
        }
        self.frame = frame;
        // Rows destroyed last frame are hidden in this frame's buffer too. After a gap this
        // frame may reuse the buffer they were hidden in, so they stay pending for the next one.
        if self.dead_pending_any {
            let parity = self.parity();
            for slot in self.dead_pending.iter_ones() {
                self.world[parity].hide_row(slot as usize);
            }
            if !gap {
                self.dead_pending.clear_all();
                self.dead_pending_any = false;
            }
        }
    }

    /// Starts frame `frame` (see [`SceneStorage::begin_frame`]) and applies a batch of commands
    /// in order. A command that fails is skipped; the rest still apply, and the first failure is
    /// returned.
    pub fn apply_commands(&mut self, commands: &[Command], frame: u32) -> Result<(), CommandError> {
        self.apply_sequence(commands, frame, 0)
    }

    /// Starts frame `frame` and applies every pending record of `ring`, then advances its read
    /// index. Errors carry the failing record's sequence number.
    pub fn apply_ring(&mut self, ring: &CommandRing, frame: u32) -> Result<(), CommandError> {
        let read = ring.read.load(Ordering::Acquire);
        let pending = ring.pending().min(ring.capacity());
        let mask = ring.capacity() - 1;
        let first = (read & mask) as usize;
        let head = pending.min(ring.capacity() - first as u32) as usize;
        let tail = pending as usize - head;
        let a = self.apply_sequence(&ring.records[first..first + head], frame, read);
        let b = self.apply_sequence(&ring.records[..tail], frame, read.wrapping_add(head as u32));
        ring.read
            .store(read.wrapping_add(pending), Ordering::Release);
        a.and(b)
    }

    fn apply_sequence(
        &mut self,
        commands: &[Command],
        frame: u32,
        first_index: u32,
    ) -> Result<(), CommandError> {
        self.begin_frame(frame);
        let mut first_error = None;
        let mut orphans_possible = false;
        for (i, command) in commands.iter().enumerate() {
            // Showing or hiding an object keeps the scene's structure: the renderer updates the
            // object's draw membership without rebuilding its tables.
            if command.opcode() != op::SET_VISIBLE {
                self.structure_changed = true;
            }
            match self.apply_one(command, &mut orphans_possible) {
                Ok(()) => {}
                Err(error) => {
                    first_error.get_or_insert(CommandError {
                        index: first_index.wrapping_add(i as u32),
                        error,
                    });
                }
            }
        }
        if orphans_possible {
            // Children of destroyed objects become roots before any slot can be reused.
            for slot in self.created.iter_ones() {
                let parent = self.parents[slot as usize];
                if parent != NO_PARENT && !self.created.get(parent) {
                    self.parents[slot as usize] = NO_PARENT;
                    self.dirty.set(slot);
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    /// True when a command other than a visibility change applied since the last call. The
    /// renderer then rebuilds its tables.
    pub fn take_structure_changed(&mut self) -> bool {
        std::mem::take(&mut self.structure_changed)
    }

    /// The slot of a handle whose create command has been applied.
    fn created_slot(&self, raw: u32) -> Result<u32, CoreError> {
        let slot = self.slots.resolve(Handle::from_raw(raw))?;
        if self.created.get(slot) {
            Ok(slot)
        } else {
            Err(CoreError::NotCreated { slot })
        }
    }

    /// The parent slot named by a raw handle: [`NO_PARENT`] for 0, else a created object.
    fn parent_slot(&self, raw: u32) -> Result<u32, CoreError> {
        if raw == 0 {
            Ok(NO_PARENT)
        } else {
            self.created_slot(raw)
        }
    }

    fn apply_one(&mut self, command: &Command, orphans: &mut bool) -> Result<(), CoreError> {
        match command.opcode() {
            op::CREATE => {
                let slot = self.slots.resolve(Handle::from_raw(command.handle))?;
                if self.created.get(slot) {
                    return Err(CoreError::AlreadyCreated { slot });
                }
                let parent = self.parent_slot(command.a)?;
                let s = slot as usize;
                self.parents[s] = parent;
                self.meshes[s] = command.b;
                self.flags[s] = (command.op >> 8) & 0xFF;
                self.materials[s] = 0;
                self.cells[s] = 0;
                self.created.set(slot);
                self.dirty.set(slot);
                self.dead_pending.clear(slot);
                self.order_dirty = true;
            }
            op::DESTROY => {
                let handle = Handle::from_raw(command.handle);
                let slot = self.slots.resolve(handle)?;
                let s = slot as usize;
                if self.created.get(slot) {
                    self.created.clear(slot);
                    self.order_dirty = true;
                    *orphans = true;
                    let parity = self.parity();
                    self.world[parity].hide_row(s);
                    self.dead_pending.set(slot);
                    self.dead_pending_any = true;
                    self.changed_frames[s] = self.frame;
                }
                self.dirty.clear(slot);
                self.positions[s * 3..s * 3 + 3].fill(0.0);
                self.rotations[s * 4..s * 4 + 4].copy_from_slice(&IDENTITY_ROTATION);
                self.scales[s * 3..s * 3 + 3].fill(1.0);
                self.local_radii[s] = 0.0;
                self.parents[s] = NO_PARENT;
                self.flags[s] = 0;
                self.meshes[s] = 0;
                self.materials[s] = 0;
                self.cells[s] = 0;
                self.depths[s] = 0;
                self.slots.release(handle, self.frame)?;
            }
            op::SET_PARENT => {
                let slot = self.created_slot(command.handle)?;
                let parent = self.parent_slot(command.a)?;
                let mut ancestor = parent;
                while ancestor != NO_PARENT {
                    if ancestor == slot {
                        return Err(CoreError::HierarchyCycle { slot, parent });
                    }
                    ancestor = self.parents[ancestor as usize];
                }
                if self.parents[slot as usize] != parent {
                    self.parents[slot as usize] = parent;
                    self.order_dirty = true;
                    self.dirty.set(slot);
                }
            }
            op::SET_MESH => {
                let slot = self.created_slot(command.handle)?;
                self.meshes[slot as usize] = command.a;
                self.dirty.set(slot);
            }
            op::SET_MATERIAL => {
                let slot = self.created_slot(command.handle)?;
                self.materials[slot as usize] = command.a;
            }
            op::SET_DYNAMIC => {
                let slot = self.created_slot(command.handle)?;
                let before = self.flags[slot as usize];
                let after = if command.a != 0 {
                    before | flags::DYNAMIC
                } else {
                    before & !flags::DYNAMIC
                };
                if after != before {
                    self.flags[slot as usize] = after;
                    self.order_dirty = true;
                    self.dirty.set(slot);
                }
            }
            op::SET_VISIBLE => {
                let slot = self.created_slot(command.handle)?;
                let f = &mut self.flags[slot as usize];
                *f = if command.a != 0 {
                    *f | flags::VISIBLE
                } else {
                    *f & !flags::VISIBLE
                };
                self.dirty.set(slot);
            }
            other => return Err(CoreError::UnknownCommand { op: other }),
        }
        Ok(())
    }

    /// Rebuilds the hierarchy order: roots, then each depth level, dynamic objects first, and
    /// slots in increasing order within each group. Increasing slots keep each chunk of a level on
    /// its own cache lines of the per-slot arrays.
    fn rebuild_order(&mut self) {
        let high = self.slots.high_water() as usize;
        // Child lists: count children per parent, turn the counts into start offsets, then place
        // each child. Afterwards `child_offsets[p]` is the end of p's children and the start of
        // the next parent's.
        let offsets = &mut self.child_offsets[..high];
        offsets.fill(0);
        self.branches.clear_all();
        for slot in self.created.iter_ones() {
            let parent = self.parents[slot as usize];
            if parent != NO_PARENT {
                offsets[parent as usize] += 1;
                self.branches.set(parent);
            }
        }
        let mut running = 0;
        for o in offsets.iter_mut() {
            let count = *o;
            *o = running;
            running += count;
        }
        for slot in self.created.iter_ones() {
            let parent = self.parents[slot as usize];
            if parent != NO_PARENT {
                let at = &mut self.child_offsets[parent as usize];
                self.child_list[*at as usize] = slot;
                *at += 1;
            }
        }

        // Depths, breadth-first from the roots, with the order array as the queue.
        let mut len = 0;
        for slot in self.created.iter_ones() {
            if self.parents[slot as usize] == NO_PARENT {
                self.order[len] = slot;
                self.depths[slot as usize] = 0;
                len += 1;
            }
        }
        let mut level_count = usize::from(len > 0);
        let mut head = 0;
        while head < len {
            let parent = self.order[head] as usize;
            head += 1;
            let first = if parent == 0 {
                0
            } else {
                self.child_offsets[parent - 1]
            };
            let depth = self.depths[parent] + 1;
            for c in first..self.child_offsets[parent] {
                let child = self.child_list[c as usize];
                self.depths[child as usize] = depth;
                self.order[len] = child;
                len += 1;
            }
            if first < self.child_offsets[parent] {
                level_count = level_count.max(depth as usize + 1);
            }
        }
        debug_assert_eq!(len as u32, self.created.count_ones());

        // Counting sort by (depth, static) over slots in increasing order. The level records
        // hold the group sizes first, then the group bounds; the child arrays, free now, hold
        // each group's write cursor.
        for level in &mut self.levels[..level_count] {
            *level = Level::default();
        }
        for slot in self.created.iter_ones() {
            let level = &mut self.levels[self.depths[slot as usize] as usize];
            if self.flags[slot as usize] & flags::DYNAMIC != 0 {
                level.dynamic_end += 1;
            } else {
                level.end += 1;
            }
        }
        let mut running = 0;
        for (depth, level) in self.levels[..level_count].iter_mut().enumerate() {
            let (dynamic, fixed) = (level.dynamic_end, level.end);
            *level = Level {
                start: running,
                dynamic_end: running + dynamic,
                end: running + dynamic + fixed,
            };
            self.child_offsets[depth] = level.start;
            self.child_list[depth] = level.dynamic_end;
            running = level.end;
        }
        for slot in self.created.iter_ones() {
            let depth = self.depths[slot as usize] as usize;
            let cursor = if self.flags[slot as usize] & flags::DYNAMIC != 0 {
                &mut self.child_offsets[depth]
            } else {
                &mut self.child_list[depth]
            };
            self.order[*cursor as usize] = slot;
            *cursor += 1;
        }
        self.level_count = level_count;
        self.order_dirty = false;
    }

    /// Computes world matrices and world bounding spheres for the current frame, level by level,
    /// in parallel where a level is large. Dynamic objects always update; static objects update
    /// when dirty or when their parent changed this frame. Clears the dirty bits and fills
    /// [`SceneStorage::changed`]. Allocates nothing.
    ///
    /// # Panics
    /// When no frame has started: frames start at 1.
    pub fn update_transforms(&mut self, jobs: &JobSystem) {
        assert!(
            self.frame != 0,
            "start a frame (numbered from 1) with begin_frame or apply_commands first"
        );
        if self.order_dirty {
            self.rebuild_order();
        }
        let parity = self.parity();
        let previous = self.world[parity ^ 1].ptrs();
        let ctx = UpdateContext {
            frame: self.frame,
            order: &self.order,
            positions: &self.positions,
            rotations: &self.rotations,
            scales: &self.scales,
            local_radii: &self.local_radii,
            parents: &self.parents,
            flags: &self.flags,
            dirty: self.dirty.words(),
            changed_frames: SharedMut::new(&mut self.changed_frames),
            out: self.world[parity].ptrs(),
            previous,
        };
        for (index, level) in self.levels[..self.level_count].iter().enumerate() {
            let count = level.end - level.start;
            let root = index == 0;
            if count >= PARALLEL_LEVEL_THRESHOLD {
                jobs.parallel_for(count, LEVEL_CHUNK, &|range, _| {
                    ctx.update_range(level, root, range);
                });
            } else {
                ctx.update_range(level, root, 0..count);
            }
        }
        // Dirty bits only exist below the high-water slot.
        let used_words = self.slots.high_water().div_ceil(64) as usize;
        self.dirty.words_mut()[..used_words].fill(0);
        self.build_changed_bits(jobs);
    }

    /// Recomputes the objects moved since the frame's [`SceneStorage::update_transforms`], and
    /// every object below them, so culling and drawing see them where a late update put them.
    /// See "Late updates" in the module documentation. Clears the dirty bits, and adds the
    /// recomputed objects to [`SceneStorage::changed`]. Runs on the calling thread and allocates
    /// nothing.
    ///
    /// # Panics
    /// When no frame has started: frames start at 1.
    pub fn update_late_transforms(&mut self) {
        assert!(
            self.frame != 0,
            "start a frame (numbered from 1) with begin_frame or apply_commands first"
        );
        if self.order_dirty {
            self.rebuild_order();
        }
        // Dirty bits only exist below the high-water slot. An object that is reserved but not yet
        // created updates when its create command applies, which marks it dirty again.
        let used_words = self.slots.high_water().div_ceil(64) as usize;
        let mut moved = false;
        let mut branch_depth: Option<u32> = None;
        let words = self.late.words_mut()[..used_words].iter_mut();
        for (w, (late, dirty)) in words.zip(self.dirty.words_mut()).enumerate() {
            *late = std::mem::take(dirty) & self.created.words()[w];
            moved |= *late != 0;
            let mut branches = *late & self.branches.words()[w];
            while branches != 0 {
                let depth = self.depths[w * 64 + branches.trailing_zeros() as usize];
                branch_depth = Some(branch_depth.map_or(depth, |d| d.min(depth)));
                branches &= branches - 1;
            }
        }
        if !moved {
            return;
        }
        let parity = self.parity();
        let ctx = UpdateContext {
            frame: self.frame,
            order: &self.order,
            positions: &self.positions,
            rotations: &self.rotations,
            scales: &self.scales,
            local_radii: &self.local_radii,
            parents: &self.parents,
            flags: &self.flags,
            dirty: self.dirty.words(),
            changed_frames: SharedMut::new(&mut self.changed_frames),
            out: self.world[parity].ptrs(),
            previous: self.world[parity ^ 1].ptrs(),
        };
        // No moved object down to the shallowest moved branch has a moved ancestor, so each one
        // reads its parent's final matrix.
        for slot in self.late.iter_ones() {
            let depth = self.depths[slot as usize];
            if branch_depth.is_none_or(|d| depth <= d) {
                ctx.compute(slot, depth == 0);
            }
        }
        if let Some(depth) = branch_depth {
            // A branch has children, so the levels below it exist.
            for level in &self.levels[depth as usize + 1..self.level_count] {
                for &slot in &self.order[level.start as usize..level.end as usize] {
                    if self.late.get(slot) || self.late.get(self.parents[slot as usize]) {
                        ctx.compute(slot, false);
                        self.late.set(slot);
                    }
                }
            }
        }
        let changed = self.changed.words_mut()[..used_words].iter_mut();
        for (changed, late) in changed.zip(self.late.words()) {
            *changed |= late;
        }
    }

    /// Sets the changed bitset from this frame's stamps, 64 slots per word.
    fn build_changed_bits(&mut self, jobs: &JobSystem) {
        let frame = self.frame;
        let high = self.slots.high_water();
        let stamps = &self.changed_frames;
        let words = self.changed.words_mut();
        let used_words = high.div_ceil(64) as usize;
        let word_bits = |w: usize| {
            let base = w * 64;
            let stamps = &stamps[base..(base + 64).min(stamps.len())];
            let mut bits = 0u64;
            let (groups, rest) = stamps.as_chunks::<16>();
            for (g, group) in groups.iter().enumerate() {
                let hits = u32x16::from_array(*group).simd_eq(u32x16::splat(frame));
                bits |= hits.to_bitmask() << (g * 16);
            }
            for (k, &stamp) in rest.iter().enumerate() {
                bits |= u64::from(stamp == frame) << (groups.len() * 16 + k);
            }
            bits
        };
        if high >= PARALLEL_BITS_THRESHOLD {
            let shared = SharedMut::new(&mut words[..used_words]);
            jobs.parallel_for(used_words as u32, 256, &|range, _| {
                for w in range {
                    // SAFETY: each chunk writes only its own words.
                    unsafe { shared.write(w as usize, word_bits(w as usize)) };
                }
            });
        } else {
            for (w, word) in words[..used_words].iter_mut().enumerate() {
                *word = word_bits(w);
            }
        }
    }
}

/// Read-only inputs and raw outputs of one transform update, shared by the level loops.
struct UpdateContext<'a> {
    frame: u32,
    order: &'a [u32],
    positions: &'a [f32],
    rotations: &'a [f32],
    scales: &'a [f32],
    local_radii: &'a [f32],
    parents: &'a [u32],
    flags: &'a [u32],
    dirty: &'a [u64],
    changed_frames: SharedMut<u32>,
    out: WorldPtrs,
    previous: WorldPtrs,
}

impl UpdateContext<'_> {
    /// Updates the objects at `range` (relative to the level's start) of one level.
    #[inline]
    fn update_range(&self, level: &Level, root: bool, range: Range<u32>) {
        let dynamic_count = level.dynamic_end - level.start;
        let dynamic = range.start.min(dynamic_count)..range.end.min(dynamic_count);
        for i in dynamic {
            self.compute(self.order[(level.start + i) as usize], root);
        }
        let previous_frame = self.frame.wrapping_sub(1);
        for i in range.start.max(dynamic_count)..range.end.max(dynamic_count) {
            let slot = self.order[(level.start + i) as usize];
            let s = slot as usize;
            let dirty = self.dirty[s / 64] & (1 << (s % 64)) != 0;
            // SAFETY: a parent sits in an earlier level, which finished before this loop, and only
            // this chunk writes this slot's stamp, so no thread writes either stamp now.
            let (parent_stamp, own_stamp) = unsafe {
                let parent = if root {
                    0
                } else {
                    self.changed_frames.read(self.parents[s] as usize)
                };
                (parent, self.changed_frames.read(s))
            };
            if dirty || parent_stamp == self.frame {
                self.compute(slot, root);
            } else if own_stamp == previous_frame {
                // SAFETY: only this chunk touches row `s`, and the previous frame's buffer is
                // not written during this update.
                unsafe { self.out.copy_row(&self.previous, s) };
            }
        }
    }

    /// Recomputes one object's world matrix and sphere, and stamps it with this frame.
    #[inline(always)]
    fn compute(&self, slot: u32, root: bool) {
        let s = slot as usize;
        let local = math::compose(
            [
                self.positions[s * 3],
                self.positions[s * 3 + 1],
                self.positions[s * 3 + 2],
            ],
            [
                self.rotations[s * 4],
                self.rotations[s * 4 + 1],
                self.rotations[s * 4 + 2],
                self.rotations[s * 4 + 3],
            ],
            [
                self.scales[s * 3],
                self.scales[s * 3 + 1],
                self.scales[s * 3 + 2],
            ],
        );
        let (world, parent_visible) = if root {
            (local, true)
        } else {
            let parent = self.parents[s] as usize;
            // SAFETY: the parent sits in an earlier level, which finished before this loop, so no
            // thread writes its row now.
            let (matrix, radius) = unsafe { (self.out.matrix(parent), self.out.radius(parent)) };
            (math::mul(&matrix, &local), radius != HIDDEN_RADIUS)
        };
        let visible = parent_visible && self.flags[s] & flags::VISIBLE != 0;
        let mut sphere = math::world_sphere(&world, self.local_radii[s]);
        if !visible {
            sphere[3] = HIDDEN_RADIUS;
        }
        // SAFETY: each slot appears once in the order, so only this call writes row `s` and its
        // stamp.
        unsafe {
            self.out.write(s, &world, sphere);
            self.changed_frames.write(s, self.frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHOWN: u32 = flags::VISIBLE;
    const MOVING: u32 = flags::VISIBLE | flags::DYNAMIC;

    /// Reserves an object at `position` and returns its handle and create command.
    fn object(
        scene: &mut SceneStorage,
        position: [f32; 3],
        parent: Handle,
        flags: u32,
    ) -> (Handle, Command) {
        let h = scene.reserve().unwrap();
        scene.set_position(h, position).unwrap();
        scene.set_local_radius(h, 1.0).unwrap();
        (h, Command::create(h, parent, 7, flags))
    }

    fn translation(scene: &SceneStorage, h: Handle) -> [f32; 3] {
        let m = scene.world_matrix(h).unwrap();
        [m[3], m[7], m[11]]
    }

    #[test]
    fn command_records_are_16_bytes() {
        assert_eq!(size_of::<Command>(), 16);
        let c = Command::create(Handle::new(5, 1), Handle::new(2, 0), 9, MOVING);
        assert_eq!(c.opcode(), op::CREATE);
        assert_eq!(c.op >> 8, 3);
        assert_eq!((c.a, c.b), (2, 9));
    }

    #[test]
    fn children_compose_with_their_parents() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(16);
        let (root, c1) = object(&mut scene, [10.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let (child, c2) = object(&mut scene, [1.0, 2.0, 3.0], root, SHOWN);
        let (grandchild, c3) = object(&mut scene, [0.0, 0.0, 1.0], child, SHOWN);
        scene.set_scale(root, [2.0, 2.0, 2.0]).unwrap();
        scene.apply_commands(&[c1, c2, c3], 1).unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, root), [10.0, 0.0, 0.0]);
        assert_eq!(translation(&scene, child), [12.0, 4.0, 6.0]);
        assert_eq!(translation(&scene, grandchild), [12.0, 4.0, 8.0]);
        let slot = scene.resolve(grandchild).unwrap() as usize;
        assert_eq!(scene.depths()[slot], 2);
        // The sphere radius scales with the inherited scale.
        assert_eq!(scene.current_world().sphere(slot), [12.0, 4.0, 8.0, 2.0]);
        assert_eq!(scene.changed().count_ones(), 3);
    }

    #[test]
    fn static_objects_keep_their_matrix_until_dirty() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (h, c) = object(&mut scene, [1.0, 0.0, 0.0], Handle::NONE, SHOWN);
        scene.apply_commands(&[c], 1).unwrap();
        scene.update_transforms(&jobs);
        let slot = scene.resolve(h).unwrap() as usize;

        // A direct write without the dirty bit is not seen, in either buffer.
        for frame in 2..5 {
            scene.positions_mut()[slot * 3] = 50.0;
            scene.begin_frame(frame);
            scene.update_transforms(&jobs);
            assert_eq!(translation(&scene, h), [1.0, 0.0, 0.0], "frame {frame}");
            assert!(!scene.changed().get(slot as u32));
        }
        // Marking it dirty recomputes it once, and the next frame copies it to the other buffer.
        scene.mark_dirty(h).unwrap();
        scene.begin_frame(5);
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, h), [50.0, 0.0, 0.0]);
        assert!(scene.changed().get(slot as u32));
        scene.begin_frame(6);
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, h), [50.0, 0.0, 0.0]);
        assert!(!scene.changed().get(slot as u32));
        assert_eq!(scene.world(0).matrix(slot), scene.world(1).matrix(slot));
    }

    #[test]
    fn a_parent_change_reaches_static_children() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (parent, c1) = object(&mut scene, [0.0; 3], Handle::NONE, SHOWN);
        let (child, c2) = object(&mut scene, [1.0, 0.0, 0.0], parent, SHOWN);
        let (grandchild, c3) = object(&mut scene, [1.0, 0.0, 0.0], child, SHOWN);
        let (mover, c4) = object(&mut scene, [0.0; 3], Handle::NONE, MOVING);
        let (rider, c5) = object(&mut scene, [0.0, 1.0, 0.0], mover, SHOWN);
        scene.apply_commands(&[c1, c2, c3, c4, c5], 1).unwrap();
        scene.update_transforms(&jobs);

        scene.set_position(parent, [0.0, 0.0, 5.0]).unwrap();
        let rider_slot = scene.resolve(rider).unwrap();
        let mover_slot = scene.resolve(mover).unwrap() as usize;
        scene.positions_mut()[mover_slot * 3] = 3.0; // A direct write: the mover is dynamic.
        scene.begin_frame(2);
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, grandchild), [2.0, 0.0, 5.0]);
        assert_eq!(translation(&scene, rider), [3.0, 1.0, 0.0]);
        // The static rider follows its dynamic parent every frame.
        for frame in 3..6 {
            scene.positions_mut()[mover_slot * 3] = frame as f32;
            scene.begin_frame(frame);
            scene.update_transforms(&jobs);
            assert_eq!(translation(&scene, rider), [frame as f32, 1.0, 0.0]);
            assert!(scene.changed().get(rider_slot));
        }
        // With nothing dirty, the static chain is left alone.
        let grandchild_slot = scene.resolve(grandchild).unwrap();
        assert!(!scene.changed().get(grandchild_slot));
    }

    #[test]
    fn reparenting_moves_the_subtree() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (a, c1) = object(&mut scene, [10.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let (b, c2) = object(&mut scene, [0.0, 20.0, 0.0], Handle::NONE, SHOWN);
        let (child, c3) = object(&mut scene, [1.0, 0.0, 0.0], a, SHOWN);
        let (leaf, c4) = object(&mut scene, [0.0, 0.0, 1.0], child, SHOWN);
        scene.apply_commands(&[c1, c2, c3, c4], 1).unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, leaf), [11.0, 0.0, 1.0]);

        scene
            .apply_commands(&[Command::set_parent(child, b)], 2)
            .unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, child), [1.0, 20.0, 0.0]);
        assert_eq!(translation(&scene, leaf), [1.0, 20.0, 1.0]);

        // A cycle is refused and changes nothing.
        let err = scene
            .apply_commands(&[Command::set_parent(b, leaf)], 3)
            .unwrap_err();
        assert_eq!(err.index, 0);
        assert_eq!(err.error.code(), CoreError::HIERARCHY_CYCLE);
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, leaf), [1.0, 20.0, 1.0]);

        // Parent 0 makes a root.
        scene
            .apply_commands(&[Command::set_parent(child, Handle::NONE)], 4)
            .unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, leaf), [1.0, 0.0, 1.0]);
        assert_eq!(scene.depths()[scene.resolve(leaf).unwrap() as usize], 1);
    }

    #[test]
    fn destroying_a_parent_makes_its_children_roots() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (parent, c1) = object(&mut scene, [10.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let (child, c2) = object(&mut scene, [1.0, 0.0, 0.0], parent, SHOWN);
        scene.apply_commands(&[c1, c2], 1).unwrap();
        scene.update_transforms(&jobs);
        let parent_slot = scene.resolve(parent).unwrap();

        scene
            .apply_commands(&[Command::destroy(parent)], 2)
            .unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, child), [1.0, 0.0, 0.0]);
        let child_slot = scene.resolve(child).unwrap() as usize;
        assert_eq!(scene.parents()[child_slot], NO_PARENT);
        assert_eq!(
            scene.resolve(parent),
            Err(CoreError::StaleHandle {
                slot: parent_slot,
                destroyed_frame: 2
            })
        );
        // The destroyed row is hidden and listed as changed, then hidden in the other buffer.
        assert!(scene.changed().get(parent_slot));
        assert_eq!(scene.world(0).radii()[parent_slot as usize], HIDDEN_RADIUS);
        scene.begin_frame(3);
        scene.update_transforms(&jobs);
        assert_eq!(scene.world(1).radii()[parent_slot as usize], HIDDEN_RADIUS);
    }

    #[test]
    fn hidden_objects_and_their_descendants_are_culled() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (parent, c1) = object(&mut scene, [0.0; 3], Handle::NONE, SHOWN);
        let (child, c2) = object(&mut scene, [1.0, 0.0, 0.0], parent, SHOWN);
        let (hidden, c3) = object(&mut scene, [2.0, 0.0, 0.0], Handle::NONE, 0);
        scene.apply_commands(&[c1, c2, c3], 1).unwrap();
        scene.update_transforms(&jobs);
        let radius = |scene: &SceneStorage, h| {
            scene.current_world().radii()[scene.resolve(h).unwrap() as usize]
        };
        assert_eq!(radius(&scene, child), 1.0);
        assert_eq!(radius(&scene, hidden), HIDDEN_RADIUS);

        scene
            .apply_commands(&[Command::set_visible(parent, false)], 2)
            .unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(radius(&scene, parent), HIDDEN_RADIUS);
        assert_eq!(radius(&scene, child), HIDDEN_RADIUS);
        // The matrix is still computed.
        assert_eq!(translation(&scene, child), [1.0, 0.0, 0.0]);

        scene
            .apply_commands(&[Command::set_visible(parent, true)], 3)
            .unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(radius(&scene, child), 1.0);
    }

    #[test]
    fn failing_commands_are_reported_and_the_rest_apply() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (a, c1) = object(&mut scene, [1.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let reserved = scene.reserve().unwrap();
        let (b, c2) = object(&mut scene, [2.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let orphan = scene.reserve().unwrap();
        let batch = [
            c1,
            Command::set_mesh(reserved, 3),
            Command { op: 99, ..c1 },
            c1,
            c2,
            Command::set_material(b, 4),
            Command::create(orphan, reserved, 1, SHOWN),
        ];
        let err = scene.apply_commands(&batch, 1).unwrap_err();
        assert_eq!(err.index, 1);
        assert_eq!(err.error.code(), CoreError::NOT_CREATED);
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, b), [2.0, 0.0, 0.0]);
        assert_eq!(scene.materials()[scene.resolve(b).unwrap() as usize], 4);
        assert!(!scene.is_created(orphan));

        let errors: Vec<u32> = batch[2..4]
            .iter()
            .map(|c| scene.apply_commands(&[*c], 1).unwrap_err().error.code())
            .collect();
        assert_eq!(
            errors,
            [CoreError::UNKNOWN_COMMAND, CoreError::ALREADY_CREATED]
        );
        let stale = scene
            .apply_commands(&[Command::destroy(a), Command::destroy(a)], 2)
            .unwrap_err();
        assert_eq!(
            (stale.index, stale.error.code()),
            (1, CoreError::STALE_HANDLE)
        );
        let invalid = scene
            .apply_commands(&[Command::destroy(Handle::from_raw(0))], 2)
            .unwrap_err();
        assert_eq!(invalid.error.code(), CoreError::INVALID_HANDLE);
    }

    #[test]
    fn the_command_ring_wraps_around() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(64);
        let mut ring = CommandRing::with_capacity(6);
        assert_eq!(ring.capacity(), 8);
        let mut handles = Vec::new();
        for frame in 1..=5u32 {
            for _ in 0..5 {
                let (h, c) = object(&mut scene, [frame as f32, 0.0, 0.0], Handle::NONE, SHOWN);
                ring.push(c).unwrap();
                handles.push(h);
            }
            assert_eq!(ring.pending(), 5);
            scene.apply_ring(&ring, frame).unwrap();
            assert_eq!(ring.pending(), 0);
            scene.update_transforms(&jobs);
        }
        for (i, h) in handles.iter().enumerate() {
            assert_eq!(translation(&scene, *h)[0], (i / 5 + 1) as f32);
        }
        for _ in 0..8 {
            ring.push(Command::default()).unwrap();
        }
        assert_eq!(
            ring.push(Command::default()).unwrap_err().code(),
            CoreError::CAPACITY_EXCEEDED
        );
        // An unknown record reports its sequence number: 25 records came before it.
        let err = scene.apply_ring(&ring, 6).unwrap_err();
        assert_eq!(
            (err.index, err.error.code()),
            (25, CoreError::UNKNOWN_COMMAND)
        );
        assert_eq!(ring.pending(), 0);
    }

    #[test]
    fn levels_put_parents_first_and_dynamic_objects_first() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(32);
        let mut commands = Vec::new();
        let (root, c) = object(&mut scene, [0.0; 3], Handle::NONE, SHOWN);
        commands.push(c);
        let mut parents = vec![root];
        for depth in 1..4 {
            let mut next = Vec::new();
            for (i, &p) in parents.iter().enumerate() {
                for k in 0..2 {
                    let f = if (i + k) % 2 == 0 { MOVING } else { SHOWN };
                    let (h, c) = object(&mut scene, [0.0, depth as f32, 0.0], p, f);
                    commands.push(c);
                    next.push(h);
                }
            }
            parents = next;
        }
        scene.apply_commands(&commands, 1).unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(scene.level_count, 4);
        for level in &scene.levels[..scene.level_count] {
            let objects = &scene.order[level.start as usize..level.end as usize];
            let split = (level.dynamic_end - level.start) as usize;
            let dynamic = |s: &u32| scene.flags[*s as usize] & flags::DYNAMIC != 0;
            assert!(objects[..split].iter().all(dynamic));
            assert!(!objects[split..].iter().any(dynamic));
            assert!(objects[..split].is_sorted() && objects[split..].is_sorted());
            for &s in objects {
                let p = scene.parents[s as usize];
                if p != NO_PARENT {
                    assert_eq!(scene.depths[p as usize] + 1, scene.depths[s as usize]);
                }
            }
        }
        // Each leaf sits three levels down: the y translations add up to 1 + 2 + 3.
        for h in parents {
            assert_eq!(translation(&scene, h), [0.0, 6.0, 0.0]);
        }
    }

    #[test]
    fn a_frame_gap_recomputes_everything() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (h, c) = object(&mut scene, [1.0, 0.0, 0.0], Handle::NONE, SHOWN);
        scene.apply_commands(&[c], 1).unwrap();
        scene.update_transforms(&jobs);
        let slot = scene.resolve(h).unwrap();
        scene.begin_frame(5);
        scene.update_transforms(&jobs);
        assert!(scene.changed().get(slot));
        scene.begin_frame(6);
        scene.update_transforms(&jobs);
        assert!(!scene.changed().get(slot));
        let s = slot as usize;
        assert_eq!(scene.world(0).matrix(s), scene.world(1).matrix(s));
    }

    #[test]
    fn a_frame_gap_hides_destroyed_rows_in_both_buffers() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (h, c) = object(&mut scene, [1.0, 0.0, 0.0], Handle::NONE, SHOWN);
        scene.apply_commands(&[c], 1).unwrap();
        for frame in 1..=4 {
            scene.begin_frame(frame);
            scene.update_transforms(&jobs);
        }
        let slot = scene.resolve(h).unwrap() as usize;
        scene.apply_commands(&[Command::destroy(h)], 5).unwrap();
        scene.update_transforms(&jobs);
        // Frame 7 skips frame 6 and writes the same buffer as frame 5.
        scene.begin_frame(7);
        scene.update_transforms(&jobs);
        scene.begin_frame(8);
        scene.update_transforms(&jobs);
        assert_eq!(scene.world(0).radii()[slot], HIDDEN_RADIUS);
        assert_eq!(scene.world(1).radii()[slot], HIDDEN_RADIUS);
    }

    #[test]
    #[should_panic(expected = "start a frame")]
    fn updating_before_the_first_frame_panics() {
        SceneStorage::with_capacity(4).update_transforms(&JobSystem::new(0));
    }

    /// True when the object was recomputed in the current frame.
    fn recomputed(scene: &SceneStorage, h: Handle) -> bool {
        let slot = scene.resolve(h).unwrap();
        scene.changed_frames()[slot as usize] == scene.frame() && scene.changed().get(slot)
    }

    #[test]
    fn a_late_update_recomputes_moved_objects_without_children_alone() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(16);
        let (target, c1) = object(&mut scene, [0.0; 3], Handle::NONE, MOVING);
        let (rider, c2) = object(&mut scene, [0.0, 1.0, 0.0], target, SHOWN);
        let (camera, c3) = object(&mut scene, [0.0, 0.0, 10.0], Handle::NONE, MOVING);
        let (post, c4) = object(&mut scene, [5.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let (sign, c5) = object(&mut scene, [0.0, 2.0, 0.0], post, SHOWN);
        let (lamp, c6) = object(&mut scene, [-5.0, 0.0, 0.0], Handle::NONE, SHOWN);
        scene.apply_commands(&[c1, c2, c3, c4, c5, c6], 1).unwrap();
        scene.update_transforms(&jobs);

        scene.set_position(target, [3.0, 0.0, 0.0]).unwrap();
        scene.begin_frame(2);
        scene.update_transforms(&jobs);
        // The late update reads this frame's world positions, and moves objects to match them.
        assert_eq!(translation(&scene, rider), [3.0, 1.0, 0.0]);
        scene.set_position(camera, [3.0, 0.0, 10.0]).unwrap();
        scene.set_position(rider, [0.0, 4.0, 0.0]).unwrap();
        scene.set_position(lamp, [-5.0, 1.0, 0.0]).unwrap();
        scene.update_late_transforms();
        assert_eq!(translation(&scene, camera), [3.0, 0.0, 10.0]);
        assert_eq!(translation(&scene, rider), [3.0, 4.0, 0.0]);
        assert_eq!(translation(&scene, lamp), [-5.0, 1.0, 0.0]);
        for h in [camera, rider, lamp] {
            assert!(recomputed(&scene, h), "a moved object uploads this frame");
        }
        // The static post and its sign did not move, so neither update recomputed them.
        assert!(!recomputed(&scene, post) && !recomputed(&scene, sign));
        assert!(!scene.dirty().any());

        // The next frame copies the late matrices into the other buffer.
        scene.begin_frame(3);
        scene.update_transforms(&jobs);
        let lamp_slot = scene.resolve(lamp).unwrap() as usize;
        assert_eq!(
            scene.world(0).matrix(lamp_slot),
            scene.world(1).matrix(lamp_slot)
        );
    }

    #[test]
    fn a_late_update_recomputes_the_objects_below_a_moved_branch() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(16);
        let (rig, c1) = object(&mut scene, [0.0; 3], Handle::NONE, SHOWN);
        let (camera, c2) = object(&mut scene, [0.0, 2.0, 8.0], rig, SHOWN);
        let (flash, c3) = object(&mut scene, [0.0, 0.0, -1.0], camera, SHOWN);
        let (tower, c4) = object(&mut scene, [20.0, 0.0, 0.0], Handle::NONE, SHOWN);
        let (floor, c5) = object(&mut scene, [0.0, 10.0, 0.0], tower, SHOWN);
        let (flag, c6) = object(&mut scene, [0.0, 1.0, 0.0], floor, SHOWN);
        scene.apply_commands(&[c1, c2, c3, c4, c5, c6], 1).unwrap();
        scene.update_transforms(&jobs);

        scene.begin_frame(2);
        scene.update_transforms(&jobs);
        scene.set_position(rig, [1.0, 0.0, 0.0]).unwrap();
        // A moved object deeper than the rig, whose own parents did not move.
        scene.set_position(flag, [0.0, 3.0, 0.0]).unwrap();
        scene.update_late_transforms();
        assert_eq!(translation(&scene, camera), [1.0, 2.0, 8.0]);
        assert_eq!(translation(&scene, flash), [1.0, 2.0, 7.0]);
        assert_eq!(translation(&scene, flag), [20.0, 13.0, 0.0]);
        for h in [rig, camera, flash, flag] {
            assert!(recomputed(&scene, h));
        }
        assert!(!recomputed(&scene, tower) && !recomputed(&scene, floor));
    }

    #[test]
    fn a_late_update_skips_objects_that_are_not_created_yet() {
        let jobs = JobSystem::new(0);
        let mut scene = SceneStorage::with_capacity(8);
        let (h, c) = object(&mut scene, [1.0, 0.0, 0.0], Handle::NONE, SHOWN);
        scene.apply_commands(&[], 1).unwrap();
        scene.update_transforms(&jobs);
        // The object's position is written, but its create command waits for the next frame.
        scene.update_late_transforms();
        assert!(!scene.changed().any() && !scene.dirty().any());
        scene.apply_commands(&[c], 2).unwrap();
        scene.update_transforms(&jobs);
        assert_eq!(translation(&scene, h), [1.0, 0.0, 0.0]);
        // With nothing moved, the late update leaves the frame's changes as they are.
        scene.begin_frame(3);
        scene.update_transforms(&jobs);
        scene.update_late_transforms();
        assert!(!scene.changed().any());
    }

    #[test]
    #[should_panic(expected = "start a frame")]
    fn a_late_update_before_the_first_frame_panics() {
        SceneStorage::with_capacity(4).update_late_transforms();
    }
}
