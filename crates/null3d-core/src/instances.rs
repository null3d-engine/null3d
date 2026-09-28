//! Instance batches: one mesh and one material drawn for many rows, each row with its own
//! position, rotation, scale and optional colour.
//!
//! TypeScript writes the row arrays directly through typed-array views. A dynamic batch recomputes
//! every active row every frame, with no dirty checks. A static batch recomputes only the rows
//! marked with [`InstanceBatch::mark_dirty`]; the marks live in a row bitset, and the update
//! walks it 64 rows at a time, so a static batch at rest costs nothing.
//!
//! The world output (a 3 × 4 matrix, a bounding sphere and the colour of each row) is
//! double-buffered by frame parity like the scene's (see [`crate::scene`]): frame `f` writes
//! buffer `f & 1`, and a row that changed in frame `f - 1` but not in frame `f` is copied from the
//! other buffer. Each update records the changed rows as coalesced ranges for upload.
//!
//! Batches live in a [`BatchTable`], which gives them stable ids (handles, like scene objects)
//! and updates every batch in one parallel loop. Creating or destroying a batch allocates or
//! frees its arrays, so do it outside the frame loop's steady state, and call
//! [`BatchTable::note_memory_grew`] when WebAssembly memory grew so TypeScript rebuilds its views.

use std::collections::TryReserveError;
use std::ops::Range;
use std::simd::f32x4;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::alloc::filled;
use crate::bitset::Bitset;
use crate::error::{CoreError, Resource};
use crate::handle::{Handle, SlotAllocator};
use crate::jobs::JobSystem;
use crate::math::{self, IDENTITY_ROTATION, compose4, deinterleave3, max_axis_scale4, transpose4};
use crate::world::{COLOR_FLOATS, MATRIX_FLOATS, WorldArrays, WorldPtrs};

/// Rows per chunk of the parallel update: a whole number of 64-row bitset words.
pub const ROW_CHUNK: u32 = 1024;
/// The most changed-row ranges a batch records per frame. Past it, the last range grows to
/// cover the rest, so uploads may include unchanged rows but never miss a changed one.
pub const MAX_ROW_RANGES: usize = 1024;

const WORDS_PER_CHUNK: u32 = ROW_CHUNK / 64;

/// A range of rows: `start..start + count`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct RowRange {
    /// The first row.
    pub start: u32,
    /// The number of rows.
    pub count: u32,
}

/// One instance batch. See the module documentation.
pub struct InstanceBatch {
    capacity: u32,
    dynamic: bool,
    mesh: u32,
    material: u32,
    local_radius: f32,
    active: u32,
    positions: Vec<f32>,
    rotations: Vec<f32>,
    scales: Vec<f32>,
    colors: Vec<f32>,
    world: [WorldArrays; 2],
    dirty: Bitset,
    dirty_any: bool,
    changed: [Bitset; 2],
    changed_any: [bool; 2],
    ranges: Vec<RowRange>,
    frame: u32,
    frame_active: [u32; 2],
}

impl InstanceBatch {
    /// A batch of `capacity` rows, all active, at the origin with identity rotation and unit
    /// scale (and white, with colours). `local_radius` is the mesh's bounding radius around its
    /// origin. Every row starts dirty, so the first update computes them all.
    pub fn new(
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
    ) -> Self {
        let Ok(batch) = Self::try_new(capacity, dynamic, with_colors, mesh, material, local_radius)
        else {
            panic!("no memory for an instance batch")
        };
        batch
    }

    /// As [`InstanceBatch::new`], or an error when memory cannot grow for the batch's arrays.
    pub fn try_new(
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
    ) -> Result<Self, TryReserveError> {
        let rows = capacity as usize;
        let mut rotations = filled(rows * 4, 0.0)?;
        for q in rotations.as_chunks_mut::<4>().0 {
            *q = IDENTITY_ROTATION;
        }
        let mut dirty = Bitset::try_new(capacity)?;
        dirty.set_range(0, capacity);
        Ok(Self {
            capacity,
            dynamic,
            mesh,
            material,
            local_radius,
            active: capacity,
            positions: filled(rows * 3, 0.0)?,
            rotations,
            scales: filled(rows * 3, 1.0)?,
            colors: filled(if with_colors { rows * 4 } else { 0 }, 1.0)?,
            world: [
                WorldArrays::try_new(rows, with_colors)?,
                WorldArrays::try_new(rows, with_colors)?,
            ],
            dirty,
            dirty_any: true,
            changed: [Bitset::try_new(capacity)?, Bitset::try_new(capacity)?],
            changed_any: [false; 2],
            ranges: Vec::with_capacity(MAX_ROW_RANGES),
            frame: 0,
            frame_active: [0; 2],
        })
    }

    /// The number of rows the batch holds.
    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// Engine memory that one row takes: its input arrays, and the world arrays of both frames.
    pub const fn row_bytes(with_colors: bool) -> u64 {
        let colors = if with_colors { COLOR_FLOATS } else { 0 };
        let inputs = 3 + 4 + 3 + colors;
        let world = MATRIX_FLOATS + 4 + colors;
        ((inputs + 2 * world) * 4) as u64
    }

    /// True for a batch that recomputes every active row every frame.
    pub fn is_dynamic(&self) -> bool {
        self.dynamic
    }

    /// True when rows have colours.
    pub fn has_colors(&self) -> bool {
        !self.colors.is_empty()
    }

    /// The mesh id.
    pub fn mesh(&self) -> u32 {
        self.mesh
    }

    /// The material id.
    pub fn material(&self) -> u32 {
        self.material
    }

    /// The mesh's local bounding radius.
    pub fn local_radius(&self) -> f32 {
        self.local_radius
    }

    /// The number of rows drawn: rows `0..active_count()`.
    pub fn active_count(&self) -> u32 {
        self.active
    }

    /// Sets how many rows are drawn. Rows that become active are marked dirty. Fails with
    /// [`CoreError::OutOfRange`] past the capacity.
    pub fn set_active_count(&mut self, count: u32) -> Result<(), CoreError> {
        if count > self.capacity {
            return Err(CoreError::OutOfRange {
                value: count,
                limit: self.capacity,
            });
        }
        if count > self.active {
            self.dirty.set_range(self.active, count - self.active);
            self.dirty_any = true;
        }
        self.active = count;
        Ok(())
    }

    /// Marks rows `start..start + count` as changed, so a static batch recomputes and uploads
    /// them. Fails with [`CoreError::OutOfRange`] when the rows go past the capacity.
    pub fn mark_dirty(&mut self, start: u32, count: u32) -> Result<(), CoreError> {
        let end = start.checked_add(count).filter(|&end| end <= self.capacity);
        if end.is_none() {
            return Err(CoreError::OutOfRange {
                value: start.saturating_add(count),
                limit: self.capacity,
            });
        }
        self.dirty.set_range(start, count);
        self.dirty_any |= count > 0;
        Ok(())
    }

    /// Positions, 3 floats per row.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }

    /// Positions, for direct writes.
    pub fn positions_mut(&mut self) -> &mut [f32] {
        &mut self.positions
    }

    /// Rotations as quaternions `(x, y, z, w)`, 4 floats per row.
    pub fn rotations(&self) -> &[f32] {
        &self.rotations
    }

    /// Rotations, for direct writes.
    pub fn rotations_mut(&mut self) -> &mut [f32] {
        &mut self.rotations
    }

    /// Scales, 3 floats per row.
    pub fn scales(&self) -> &[f32] {
        &self.scales
    }

    /// Scales, for direct writes.
    pub fn scales_mut(&mut self) -> &mut [f32] {
        &mut self.scales
    }

    /// Colours `(r, g, b, a)`, 4 floats per row, or an empty slice without colours.
    pub fn colors(&self) -> &[f32] {
        &self.colors
    }

    /// Colours, for direct writes.
    pub fn colors_mut(&mut self) -> &mut [f32] {
        &mut self.colors
    }

    /// The dirty rows of a static batch, waiting for the next update.
    pub fn dirty(&self) -> &Bitset {
        &self.dirty
    }

    /// The world output of frame parity `parity` (0 or 1).
    pub fn world(&self, parity: usize) -> &WorldArrays {
        &self.world[parity & 1]
    }

    /// The world output of the last updated frame.
    pub fn current_world(&self) -> &WorldArrays {
        &self.world[(self.frame & 1) as usize]
    }

    /// The last frame this batch was updated for.
    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// The active row count the frame with parity `parity` used, for the render worker.
    pub fn frame_active_count(&self, parity: usize) -> u32 {
        self.frame_active[parity & 1]
    }

    /// The rows the last update wrote, as coalesced ranges in increasing order.
    pub fn changed_ranges(&self) -> &[RowRange] {
        &self.ranges
    }

    /// Recomputes the rows that need it for frame `frame`, in parallel chunks, and records the
    /// changed ranges. Allocates nothing.
    ///
    /// # Panics
    /// When `frame` is 0: frames start at 1.
    pub fn update(&mut self, jobs: &JobSystem, frame: u32) {
        if let Some(kernel) = self.prepare(frame) {
            let words = kernel.words();
            jobs.parallel_for(words, WORDS_PER_CHUNK, &|range, _| {
                // SAFETY: chunks cover disjoint word ranges, hence disjoint rows.
                unsafe { kernel.run(range) };
            });
        }
        self.finish();
    }

    /// Starts frame `frame` and returns the kernel for the rows that need work, if any.
    fn prepare(&mut self, frame: u32) -> Option<RowKernel> {
        assert!(frame != 0, "frames start at 1");
        let parity = (frame & 1) as usize;
        if frame != self.frame {
            if frame != self.frame.wrapping_add(1) {
                // After a gap the other buffer may be stale: recompute every active row.
                self.dirty.set_range(0, self.active);
                self.dirty_any = true;
            }
            // The bits of this parity belong to two frames ago; they are clear when that frame
            // changed nothing.
            if self.changed_any[parity] {
                self.changed[parity].clear_all();
                self.changed_any[parity] = false;
            }
            self.frame = frame;
        }
        let mirror = self.changed_any[parity ^ 1] && !self.dynamic;
        if self.active == 0 || !(self.dynamic || self.dirty_any || mirror) {
            return None;
        }
        let previous = self.world[parity ^ 1].ptrs();
        let (previous_changed, changed) = if parity == 0 {
            let (a, b) = self.changed.split_at_mut(1);
            (b[0].words().as_ptr(), a[0].words_mut().as_mut_ptr())
        } else {
            let (a, b) = self.changed.split_at_mut(1);
            (a[0].words().as_ptr(), b[0].words_mut().as_mut_ptr())
        };
        Some(RowKernel {
            positions: self.positions.as_ptr(),
            rotations: self.rotations.as_ptr(),
            scales: self.scales.as_ptr(),
            colors: if self.colors.is_empty() {
                std::ptr::null()
            } else {
                self.colors.as_ptr()
            },
            local_radius: self.local_radius,
            out: self.world[parity].ptrs(),
            previous,
            dirty: self.dirty.words().as_ptr(),
            previous_changed,
            changed,
            active: self.active,
            dynamic: self.dynamic,
            mirror,
        })
    }

    /// Ends the frame's update: clears the dirty rows and records the changed ranges.
    fn finish(&mut self) {
        let parity = (self.frame & 1) as usize;
        self.ranges.clear();
        if self.dynamic {
            if self.active > 0 {
                self.ranges.push(RowRange {
                    start: 0,
                    count: self.active,
                });
            }
        } else {
            for (start, count) in self.changed[parity].runs() {
                push_range(&mut self.ranges, start, count);
            }
        }
        if self.dirty_any {
            self.dirty.clear_all();
            self.dirty_any = false;
        }
        self.changed_any[parity] = !self.ranges.is_empty() && !self.dynamic;
        self.frame_active[parity] = self.active;
    }
}

/// Appends a range, growing the last one to cover the rest once the list is full.
fn push_range(ranges: &mut Vec<RowRange>, start: u32, count: u32) {
    if ranges.len() < MAX_ROW_RANGES {
        ranges.push(RowRange { start, count });
    } else if let Some(last) = ranges.last_mut() {
        last.count = start + count - last.start;
    }
}

/// Raw pointers into one batch, for the chunks of a parallel update. Chunks own disjoint
/// 64-row words, so they write disjoint rows and disjoint changed-bitset words.
#[derive(Clone, Copy)]
struct RowKernel {
    positions: *const f32,
    rotations: *const f32,
    scales: *const f32,
    colors: *const f32,
    local_radius: f32,
    out: WorldPtrs,
    previous: WorldPtrs,
    dirty: *const u64,
    previous_changed: *const u64,
    changed: *mut u64,
    active: u32,
    dynamic: bool,
    mirror: bool,
}

// SAFETY: the pointers stay valid while the batch is borrowed by its update, and chunks access
// disjoint rows and words, as `RowKernel::run` requires.
unsafe impl Send for RowKernel {}
// SAFETY: as above.
unsafe impl Sync for RowKernel {}

impl RowKernel {
    /// The number of 64-row words that cover the active rows.
    fn words(&self) -> u32 {
        self.active.div_ceil(64)
    }

    /// Updates the rows in bitset words `words`.
    ///
    /// # Safety
    /// No other thread runs an overlapping word range of the same batch at the same time, and
    /// the batch is not otherwise accessed during the call.
    unsafe fn run(&self, words: Range<u32>) {
        for w in words {
            let first = w * 64;
            let rows = (self.active - first).min(64);
            let active_mask = if rows == 64 { !0 } else { (1u64 << rows) - 1 };
            if self.dynamic {
                let (first, end) = (first as usize, (first + rows) as usize);
                let blocks_end = first + (end - first) / 4 * 4;
                // SAFETY: every row below is active and in this chunk's words.
                unsafe {
                    for row in (first..blocks_end).step_by(4) {
                        self.compute4(row);
                    }
                    for row in blocks_end..end {
                        self.compute(row);
                    }
                }
                continue;
            }
            // SAFETY: word `w` is inside the bitsets, which cover the capacity; only this chunk
            // writes changed word `w`.
            unsafe {
                let dirty = *self.dirty.add(w as usize) & active_mask;
                let copy = if self.mirror {
                    *self.previous_changed.add(w as usize) & !dirty & active_mask
                } else {
                    0
                };
                // Four dirty rows in a block of four take the four-lane path.
                let mut bits = dirty;
                while bits != 0 {
                    let block = bits.trailing_zeros() & !3;
                    let nibble = (bits >> block) & 0xF;
                    let row = (first + block) as usize;
                    if nibble == 0xF {
                        self.compute4(row);
                    } else {
                        let mut lanes = nibble;
                        while lanes != 0 {
                            self.compute(row + lanes.trailing_zeros() as usize);
                            lanes &= lanes - 1;
                        }
                    }
                    bits &= !(0xF << block);
                }
                let mut bits = copy;
                while bits != 0 {
                    let row = (first + bits.trailing_zeros()) as usize;
                    self.out.copy_row(&self.previous, row);
                    bits &= bits - 1;
                }
                *self.changed.add(w as usize) |= dirty;
            }
        }
    }

    /// Recomputes rows `row..row + 4`, one SIMD lane per row. The results match
    /// [`RowKernel::compute`] bit for bit.
    ///
    /// # Safety
    /// The four rows are active and belong to the calling chunk.
    #[inline(always)]
    unsafe fn compute4(&self, row: usize) {
        let load = |p: *const f32| {
            // SAFETY: the reads below stay inside the four active rows.
            f32x4::from_array(unsafe { p.cast::<[f32; 4]>().read_unaligned() })
        };
        // SAFETY: the four rows are below the active count, so every offset is in bounds, and
        // only this chunk writes the rows.
        unsafe {
            let p = self.positions.add(row * 3);
            let position = deinterleave3(load(p), load(p.add(4)), load(p.add(8)));
            let s = self.scales.add(row * 3);
            let scale = deinterleave3(load(s), load(s.add(4)), load(s.add(8)));
            let q = self.rotations.add(row * 4);
            let rotation = transpose4([load(q), load(q.add(4)), load(q.add(8)), load(q.add(12))]);
            let matrices = compose4(position, rotation, scale);
            let radii = f32x4::splat(self.local_radius) * max_axis_scale4(&matrices);
            self.out.write4(row, &matrices, radii);
            if !self.colors.is_null() {
                self.out.write_colors4(row, self.colors.add(row * 4));
            }
        }
    }

    /// Recomputes one row.
    ///
    /// # Safety
    /// The row is active and belongs to the calling chunk.
    #[inline(always)]
    unsafe fn compute(&self, row: usize) {
        // SAFETY: the row is below the active count, so every input read is in bounds, and only
        // this chunk writes the row.
        unsafe {
            let p = self
                .positions
                .add(row * 3)
                .cast::<[f32; 3]>()
                .read_unaligned();
            let q = self
                .rotations
                .add(row * 4)
                .cast::<[f32; 4]>()
                .read_unaligned();
            let s = self.scales.add(row * 3).cast::<[f32; 3]>().read_unaligned();
            let matrix = math::compose(p, q, s);
            self.out
                .write(row, &matrix, math::world_sphere(&matrix, self.local_radius));
            if !self.colors.is_null() {
                let color = self.colors.add(row * 4).cast::<[f32; 4]>().read_unaligned();
                self.out.write_color(row, color);
            }
        }
    }
}

/// One unit of the table's parallel update: some words of one batch.
#[derive(Clone, Copy, Debug, Default)]
struct WorkItem {
    batch: u32,
    words: (u32, u32),
}

/// Instance batches with stable ids and a fixed capacity, plus the memory epoch counter.
pub struct BatchTable {
    ids: SlotAllocator,
    batches: Vec<Option<InstanceBatch>>,
    kernels: Vec<Option<RowKernel>>,
    work: Vec<WorkItem>,
    work_needed: usize,
    epoch: AtomicU32,
}

impl BatchTable {
    /// A table for up to `max_batches` batches.
    pub fn with_capacity(max_batches: u32) -> Self {
        let slots = max_batches as usize + 1;
        Self {
            ids: SlotAllocator::with_capacity(max_batches),
            batches: (0..slots).map(|_| None).collect(),
            kernels: vec![None; slots],
            work: Vec::new(),
            work_needed: 0,
            epoch: AtomicU32::new(0),
        }
    }

    /// The number of batches the table holds.
    pub fn capacity(&self) -> u32 {
        self.ids.capacity()
    }

    /// The number of live batches.
    pub fn len(&self) -> u32 {
        self.ids.live_count()
    }

    /// True when the table holds no batch.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Creates a batch (see [`InstanceBatch::new`]) and returns its id. This allocates the
    /// batch's arrays. Fails with [`CoreError::CapacityExceeded`] when the table is full, and with
    /// [`CoreError::OutOfMemory`] when memory cannot grow for the arrays.
    pub fn create(
        &mut self,
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
    ) -> Result<Handle, CoreError> {
        let out_of_memory = |_| CoreError::OutOfMemory {
            bytes: u32::try_from(u64::from(capacity) * InstanceBatch::row_bytes(with_colors))
                .unwrap_or(u32::MAX),
        };
        // Room for every batch's work items at once, so updates never grow the list.
        let work_needed = self.work_needed + capacity.div_ceil(ROW_CHUNK) as usize;
        self.work
            .try_reserve(work_needed.saturating_sub(self.work.len()))
            .map_err(out_of_memory)?;
        let batch =
            InstanceBatch::try_new(capacity, dynamic, with_colors, mesh, material, local_radius)
                .map_err(out_of_memory)?;
        let id = self.ids.reserve().map_err(|e| match e {
            CoreError::CapacityExceeded { capacity, .. } => CoreError::CapacityExceeded {
                resource: Resource::Batches,
                capacity,
            },
            other => other,
        })?;
        self.batches[id.slot() as usize] = Some(batch);
        self.work_needed = work_needed;
        Ok(id)
    }

    /// Destroys a batch and frees its arrays. `frame` is recorded for stale-id errors.
    pub fn destroy(&mut self, id: Handle, frame: u32) -> Result<(), CoreError> {
        self.ids.release(id, frame)?;
        if let Some(batch) = self.batches[id.slot() as usize].take() {
            self.work_needed -= batch.capacity().div_ceil(ROW_CHUNK) as usize;
        }
        Ok(())
    }

    /// The batch with id `id`.
    pub fn get(&self, id: Handle) -> Result<&InstanceBatch, CoreError> {
        let slot = self.ids.resolve(id)?;
        Ok(self.batches[slot as usize]
            .as_ref()
            .expect("a live id has a batch"))
    }

    /// The batch with id `id`, for writes.
    pub fn get_mut(&mut self, id: Handle) -> Result<&mut InstanceBatch, CoreError> {
        let slot = self.ids.resolve(id)?;
        Ok(self.batches[slot as usize]
            .as_mut()
            .expect("a live id has a batch"))
    }

    /// Every live batch with its id, in slot order.
    pub fn iter(&self) -> impl Iterator<Item = (Handle, &InstanceBatch)> {
        self.ids.live().iter_ones().map(|slot| {
            let id = Handle::new(slot, u32::from(self.ids.generations()[slot as usize]));
            (id, self.batches[slot as usize].as_ref().expect("live"))
        })
    }

    /// Updates every batch for frame `frame` in one parallel loop over chunks of all batches.
    /// Allocates nothing.
    pub fn update(&mut self, jobs: &JobSystem, frame: u32) {
        self.work.clear();
        for slot in self.ids.live().iter_ones() {
            let batch = self.batches[slot as usize].as_mut().expect("live");
            let kernel = batch.prepare(frame);
            if let Some(k) = &kernel {
                let words = k.words();
                let mut w = 0;
                while w < words {
                    let end = (w + WORDS_PER_CHUNK).min(words);
                    self.work.push(WorkItem {
                        batch: slot,
                        words: (w, end),
                    });
                    w = end;
                }
            }
            self.kernels[slot as usize] = kernel;
        }
        let (work, kernels) = (&self.work, &self.kernels);
        jobs.parallel_for(work.len() as u32, 1, &|range, _| {
            for item in &work[range.start as usize..range.end as usize] {
                let kernel = kernels[item.batch as usize].as_ref().expect("prepared");
                // SAFETY: work items of one batch cover disjoint word ranges.
                unsafe { kernel.run(item.words.0..item.words.1) };
            }
        });
        for slot in self.ids.live().iter_ones() {
            self.kernels[slot as usize] = None;
            self.batches[slot as usize].as_mut().expect("live").finish();
        }
    }

    /// The memory epoch: it increases each time WebAssembly memory grows, and TypeScript
    /// rebuilds its typed-array views when it changes.
    pub fn memory_epoch(&self) -> u32 {
        self.epoch.load(Ordering::Acquire)
    }

    /// The epoch counter itself, for TypeScript to read with `Atomics.load`.
    pub fn memory_epoch_word(&self) -> &AtomicU32 {
        &self.epoch
    }

    /// Records that WebAssembly memory grew, which bumps the memory epoch.
    pub fn note_memory_grew(&self) {
        self.epoch.fetch_add(1, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::HIDDEN_RADIUS;

    fn write_row(batch: &mut InstanceBatch, row: usize, x: f32) {
        batch.positions_mut()[row * 3..row * 3 + 3].copy_from_slice(&[x, 0.0, 0.0]);
    }

    fn x_of(batch: &InstanceBatch, parity: usize, row: usize) -> f32 {
        batch.world(parity).matrix(row)[3]
    }

    #[test]
    fn rows_compose_like_the_math_module() {
        let jobs = JobSystem::new(0);
        let mut batch = InstanceBatch::new(5, false, true, 3, 4, 0.5);
        batch.positions_mut()[3..6].copy_from_slice(&[1.0, 2.0, 3.0]);
        batch.scales_mut()[3..6].copy_from_slice(&[2.0, 4.0, 1.0]);
        batch.colors_mut()[4..8].copy_from_slice(&[0.1, 0.2, 0.3, 0.4]);
        batch.update(&jobs, 1);
        let m = math::compose([1.0, 2.0, 3.0], IDENTITY_ROTATION, [2.0, 4.0, 1.0]);
        assert_eq!(batch.world(1).matrix(1), &m);
        assert_eq!(batch.world(1).sphere(1), [1.0, 2.0, 3.0, 2.0]);
        assert_eq!(&batch.world(1).colors()[4..8], &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(batch.changed_ranges(), &[RowRange { start: 0, count: 5 }]);
        assert_eq!(batch.frame_active_count(1), 5);
    }

    #[test]
    fn dirty_ranges_are_exactly_the_marked_rows_coalesced() {
        let jobs = JobSystem::new(0);
        let mut batch = InstanceBatch::new(300, false, false, 0, 0, 1.0);
        batch.update(&jobs, 1);
        for row in 0..300 {
            write_row(&mut batch, row, 7.0);
        }
        batch.mark_dirty(10, 5).unwrap();
        batch.mark_dirty(15, 3).unwrap();
        batch.mark_dirty(100, 1).unwrap();
        batch.mark_dirty(0, 2).unwrap();
        batch.mark_dirty(63, 2).unwrap();
        batch.mark_dirty(299, 1).unwrap();
        batch.update(&jobs, 2);
        let expected = [(0, 2), (10, 8), (63, 2), (100, 1), (299, 1)]
            .map(|(start, count)| RowRange { start, count });
        assert_eq!(batch.changed_ranges(), &expected);
        // Only the marked rows moved.
        for row in 0..300 {
            let marked = expected
                .iter()
                .any(|r| (r.start..r.start + r.count).contains(&(row as u32)));
            assert_eq!(
                x_of(&batch, 0, row),
                if marked { 7.0 } else { 0.0 },
                "row {row}"
            );
        }
        // The next frame copies the marked rows into the other buffer and uploads nothing.
        batch.update(&jobs, 3);
        assert!(batch.changed_ranges().is_empty());
        for row in 0..300 {
            assert_eq!(x_of(&batch, 1, row), x_of(&batch, 0, row), "row {row}");
        }
        // A batch at rest does no work.
        batch.update(&jobs, 4);
        assert!(batch.changed_ranges().is_empty());
    }

    #[test]
    fn a_dynamic_batch_updates_everything() {
        let jobs = JobSystem::new(0);
        let mut batch = InstanceBatch::new(130, true, false, 0, 0, 1.0);
        for frame in 1..4 {
            for row in 0..130 {
                write_row(&mut batch, row, frame as f32);
            }
            batch.update(&jobs, frame);
            let parity = (frame & 1) as usize;
            assert!((0..130).all(|row| x_of(&batch, parity, row) == frame as f32));
            assert_eq!(
                batch.changed_ranges(),
                &[RowRange {
                    start: 0,
                    count: 130
                }]
            );
        }
    }

    #[test]
    fn active_count_limits_the_rows() {
        let jobs = JobSystem::new(0);
        let mut batch = InstanceBatch::new(100, false, false, 0, 0, 1.0);
        batch.set_active_count(10).unwrap();
        batch.update(&jobs, 1);
        assert_eq!(
            batch.changed_ranges(),
            &[RowRange {
                start: 0,
                count: 10
            }]
        );
        assert_eq!(batch.world(1).radii()[50], HIDDEN_RADIUS);
        // Growing marks the new rows dirty.
        batch.set_active_count(40).unwrap();
        batch.update(&jobs, 2);
        assert_eq!(
            batch.changed_ranges(),
            &[RowRange {
                start: 10,
                count: 30
            }]
        );
        assert_eq!(batch.frame_active_count(0), 40);
        assert_eq!(batch.frame_active_count(1), 10);
        assert_eq!(
            batch.set_active_count(101),
            Err(CoreError::OutOfRange {
                value: 101,
                limit: 100
            })
        );
        assert_eq!(
            batch.mark_dirty(99, 2).unwrap_err().code(),
            CoreError::OUT_OF_RANGE
        );
        assert_eq!(
            batch.mark_dirty(u32::MAX, 2).unwrap_err().code(),
            CoreError::OUT_OF_RANGE
        );
    }

    #[test]
    fn too_many_ranges_grow_the_last_one() {
        let jobs = JobSystem::new(0);
        let rows = (MAX_ROW_RANGES as u32 + 10) * 2;
        let mut batch = InstanceBatch::new(rows, false, false, 0, 0, 1.0);
        batch.update(&jobs, 1);
        for row in (0..rows).step_by(2) {
            batch.mark_dirty(row, 1).unwrap();
        }
        batch.update(&jobs, 2);
        let ranges = batch.changed_ranges();
        assert_eq!(ranges.len(), MAX_ROW_RANGES);
        let last = ranges[MAX_ROW_RANGES - 1];
        assert_eq!(last.start + last.count, rows - 1);
    }

    #[test]
    fn the_table_gives_stable_ids_and_updates_every_batch() {
        let jobs = JobSystem::new(0);
        let mut table = BatchTable::with_capacity(2);
        let a = table.create(10, true, false, 1, 2, 1.0).unwrap();
        let b = table.create(2000, false, true, 3, 4, 1.0).unwrap();
        assert_eq!(
            table.create(1, false, false, 0, 0, 1.0),
            Err(CoreError::CapacityExceeded {
                resource: Resource::Batches,
                capacity: 2
            })
        );
        assert_eq!(table.len(), 2);
        table.get_mut(b).unwrap().positions_mut()[1500 * 3] = 9.0;
        table.update(&jobs, 1);
        assert_eq!(table.get(b).unwrap().world(1).matrix(1500)[3], 9.0);
        assert_eq!(table.get(a).unwrap().changed_ranges().len(), 1);
        let ids: Vec<Handle> = table.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, [a, b]);

        table.destroy(a, 5).unwrap();
        assert_eq!(
            table.get(a).err(),
            Some(CoreError::StaleHandle {
                slot: a.slot(),
                destroyed_frame: 5
            })
        );
        let c = table.create(4, false, false, 0, 0, 1.0).unwrap();
        assert_ne!(c, a);
        table.update(&jobs, 2);
        assert_eq!(
            table.get(c).unwrap().changed_ranges(),
            &[RowRange { start: 0, count: 4 }]
        );
    }

    #[test]
    fn the_memory_epoch_counts_growth() {
        let table = BatchTable::with_capacity(1);
        assert_eq!(table.memory_epoch(), 0);
        table.note_memory_grew();
        table.note_memory_grew();
        assert_eq!(table.memory_epoch(), 2);
        assert_eq!(table.memory_epoch_word().load(Ordering::Relaxed), 2);
    }
}
