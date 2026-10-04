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
//!
//! # Parts
//!
//! A batch can draw one part of a model: a mesh placed by a fixed `part` matrix in the model's
//! space, which each row's transform then places in the world. The parts of one model share rows:
//! the first part owns the row arrays, and each other part reads them, follows their dirty marks
//! and active count, and computes its own world output. One write to the first part's rows thus
//! moves every part.
//!
//! # Sprites
//!
//! A sprite batch owns positions like any batch, and sizes, rotations, colours and atlas frames in
//! place of rotations as quaternions and scales. Its update packs each row's sprite into the row's
//! world matrix (see [`crate::sprites`]), so the rest of the engine draws, culls and sorts its rows
//! as it does any batch's.
//!
//! # Cells
//!
//! Each row takes the grid cell that holds its position (see [`crate::cells`]), and its world
//! matrix and sphere are relative to that cell's center. While every active row shares one cell,
//! the batch's common cell, the update only checks that each row stays inside it, four rows at a
//! time. A row that leaves its cell is marked in the loop, and moved in the cell table after it,
//! on one thread. [`InstanceBatch::cell_changes`] then covers the rows whose cell changed.

use std::collections::TryReserveError;
use std::ops::Range;
use std::simd::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use crate::alloc::filled;
use crate::bitset::Bitset;
use crate::cells::{self, CellCoords, CellTable, HALF_CELL, ORIGIN_CELL};
use crate::error::{CoreError, Resource};
use crate::handle::{Handle, SlotAllocator};
use crate::jobs::JobSystem;
use crate::layers::DEFAULT_LAYERS;
use crate::math::{
    self, Affine, IDENTITY_ROTATION, compose4, deinterleave3, max_axis_scale4, mul4, transpose4,
};
use crate::sprites::{self, SpriteLook};
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

/// The rows of a sprite batch besides their positions, and the look its sprites share.
struct SpriteRows {
    look: SpriteLook,
    /// Width and height, 2 floats per row.
    sizes: Vec<f32>,
    /// The rotation in radians, 1 float per row.
    rotations: Vec<f32>,
    /// Linear colour `(r, g, b, a)`, 4 floats per row.
    colors: Vec<f32>,
    /// The atlas frame, 1 per row.
    frames: Vec<u32>,
}

/// Floats of a sprite's own rows besides its position: size, rotation, colour and frame.
const SPRITE_INPUTS: usize = 2 + 1 + 4 + 1;

/// One instance batch. See the module documentation.
pub struct InstanceBatch {
    capacity: u32,
    dynamic: bool,
    mesh: u32,
    material: u32,
    local_radius: f32,
    active: u32,
    /// The layer mask of every row (see [`crate::layers`]).
    layers: u32,
    with_colors: bool,
    /// The batch whose rows this one reads, for a part that owns no rows.
    source: Option<Handle>,
    /// The matrix that places the mesh in the space of each row, applied before the row's own.
    part: Option<Affine>,
    /// The sprites' own rows, for a sprite batch.
    sprite: Option<SpriteRows>,
    /// Empty for a part that reads another batch's rows, as are the other row arrays.
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
    /// Each row's cell, as an index into the scene's cell table.
    cells: Vec<u32>,
    /// The cell of every active row while `mixed` is false.
    common: u32,
    /// True when active rows may lie in different cells.
    mixed: bool,
    /// True when the next update ends by checking whether the active rows share one cell.
    check_common: bool,
    /// Rows the update found in a new cell, which its end moves in the cell table.
    moved: Bitset,
    moved_any: AtomicBool,
    cell_changes: RowRange,
    /// Counts the updates that wrote rows of the world output.
    version: u32,
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
        Self::try_new_part(
            capacity,
            dynamic,
            with_colors,
            mesh,
            material,
            local_radius,
            None,
            None,
        )
    }

    /// A sprite batch (see the module documentation) of `capacity` rows of a quad mesh whose
    /// bounding radius around its anchor is `local_radius`: every sprite one unit wide and high,
    /// unturned, white, showing frame 0, at the origin. Fails when memory cannot grow for its
    /// arrays.
    pub fn try_new_sprites(
        capacity: u32,
        dynamic: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
        look: SpriteLook,
    ) -> Result<Self, TryReserveError> {
        let rows = capacity as usize;
        let sprite = SpriteRows {
            look,
            sizes: filled(rows * 2, 1.0)?,
            rotations: filled(rows, 0.0)?,
            colors: filled(rows * 4, 1.0)?,
            frames: filled(rows, 0)?,
        };
        let mut batch = Self::try_new_rows(
            capacity,
            dynamic,
            false,
            mesh,
            material,
            local_radius,
            None,
            None,
            false,
        )?;
        batch.sprite = Some(sprite);
        Ok(batch)
    }

    /// As [`InstanceBatch::try_new`], for one part of a model (see the module documentation):
    /// `part` places the mesh in the space of each row, and with a `source`, the batch reads that
    /// batch's rows and owns none.
    #[allow(clippy::too_many_arguments)]
    pub fn try_new_part(
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
        source: Option<Handle>,
        part: Option<Affine>,
    ) -> Result<Self, TryReserveError> {
        Self::try_new_rows(
            capacity,
            dynamic,
            with_colors,
            mesh,
            material,
            local_radius,
            source,
            part,
            true,
        )
    }

    /// As [`InstanceBatch::try_new_part`]. With `transforms` false, the batch has no rotations
    /// and scales, as a sprite batch keeps rows of its own in their place.
    #[allow(clippy::too_many_arguments)]
    fn try_new_rows(
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
        source: Option<Handle>,
        part: Option<Affine>,
        transforms: bool,
    ) -> Result<Self, TryReserveError> {
        let rows = capacity as usize;
        let owned = if source.is_some() { 0 } else { rows };
        let inputs = if transforms { owned } else { 0 };
        let mut rotations = filled(inputs * 4, 0.0)?;
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
            layers: DEFAULT_LAYERS,
            with_colors,
            source,
            part,
            sprite: None,
            positions: filled(owned * 3, 0.0)?,
            rotations,
            scales: filled(inputs * 3, 1.0)?,
            colors: filled(if with_colors { inputs * 4 } else { 0 }, 1.0)?,
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
            cells: filled(rows, ORIGIN_CELL)?,
            common: ORIGIN_CELL,
            mixed: false,
            check_common: false,
            moved: Bitset::try_new(capacity)?,
            moved_any: AtomicBool::new(false),
            cell_changes: RowRange::default(),
            version: 0,
        })
    }

    /// The number of rows the batch holds.
    pub fn capacity(&self) -> u32 {
        self.capacity
    }

    /// Engine memory that one row takes: its input arrays, its cell, and the world arrays of both
    /// frames.
    pub const fn row_bytes(with_colors: bool) -> u64 {
        let colors = if with_colors { COLOR_FLOATS } else { 0 };
        let inputs = 3 + 4 + 3 + colors;
        let world = MATRIX_FLOATS + 4 + colors;
        ((inputs + 1 + 2 * world) * 4) as u64
    }

    /// Engine memory that one row of a sprite batch takes, as [`InstanceBatch::row_bytes`] counts
    /// it.
    pub const fn sprite_row_bytes() -> u64 {
        let world = MATRIX_FLOATS + 4;
        ((3 + SPRITE_INPUTS + 1 + 2 * world) * 4) as u64
    }

    /// The look of a sprite batch's sprites, or `None` for a batch of meshes.
    pub fn sprite_look(&self) -> Option<SpriteLook> {
        self.sprite.as_ref().map(|s| s.look)
    }

    /// True for a batch whose rows culling must never reject: sprites sized in pixels of the
    /// screen, whose size in the world changes with their distance.
    pub fn unculled(&self) -> bool {
        self.sprite_look().is_some_and(|look| look.screen_size)
    }

    /// A sprite batch's sizes, 2 floats per row, its rotations in radians, 1 float per row, its
    /// colours, 4 floats per row, and its atlas frames, 1 per row; empty for a batch of meshes.
    pub fn sprite_rows(&self) -> (&[f32], &[f32], &[f32], &[u32]) {
        match &self.sprite {
            Some(s) => (&s.sizes, &s.rotations, &s.colors, &s.frames),
            None => (&[], &[], &[], &[]),
        }
    }

    /// A sprite batch's rows for direct writes, as [`InstanceBatch::sprite_rows`] gives them.
    pub fn sprite_rows_mut(&mut self) -> (&mut [f32], &mut [f32], &mut [f32], &mut [u32]) {
        match &mut self.sprite {
            Some(s) => (&mut s.sizes, &mut s.rotations, &mut s.colors, &mut s.frames),
            None => (&mut [], &mut [], &mut [], &mut []),
        }
    }

    /// True for a batch that recomputes every active row every frame.
    pub fn is_dynamic(&self) -> bool {
        self.dynamic
    }

    /// True when rows have colours.
    pub fn has_colors(&self) -> bool {
        self.with_colors
    }

    /// The batch whose rows this part reads, or `None` for a batch that owns its rows.
    pub fn source(&self) -> Option<Handle> {
        self.source
    }

    /// The matrix that places the mesh in the space of each row, if any.
    pub fn part(&self) -> Option<&Affine> {
        self.part.as_ref()
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

    /// The layer mask of every row (see [`crate::layers`]).
    pub fn layers(&self) -> u32 {
        self.layers
    }

    /// Sets the layer mask of every row. The renderer reads it when it culls, so a change needs
    /// no rebuild and no update of the rows.
    pub fn set_layers(&mut self, mask: u32) {
        self.layers = mask;
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
            // Rows that come back keep the cell they had; one outside the common cell makes the
            // next update check each row's own cell.
            let returning = &self.cells[self.active as usize..count as usize];
            if !self.mixed && returning.iter().any(|&cell| cell != self.common) {
                self.mixed = true;
                self.check_common = true;
            }
        } else if self.mixed {
            // Fewer rows may share one cell.
            self.check_common = true;
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

    /// A number that changes with each update that writes rows of the world output, so readers can
    /// tell whether the rows moved since they last read them.
    pub fn version(&self) -> u32 {
        self.version
    }

    /// The active row count the frame with parity `parity` used, for the render worker.
    pub fn frame_active_count(&self, parity: usize) -> u32 {
        self.frame_active[parity & 1]
    }

    /// The rows the last update wrote, as coalesced ranges in increasing order.
    pub fn changed_ranges(&self) -> &[RowRange] {
        &self.ranges
    }

    /// Each row's cell, as an index into the scene's cell table. Valid after an update.
    pub fn cells(&self) -> &[u32] {
        &self.cells
    }

    /// The cell every active row lies in, or `None` when they may lie in different cells.
    pub fn common_cell(&self) -> Option<u32> {
        (!self.mixed).then_some(self.common)
    }

    /// One range that covers every row whose cell the last update changed; empty when none did.
    pub fn cell_changes(&self) -> RowRange {
        self.cell_changes
    }

    /// Recomputes the rows that need it for frame `frame`, in parallel chunks, and records the
    /// changed ranges. Rows that change cells move in `cells`, the scene's cell table. Allocates
    /// nothing.
    ///
    /// # Panics
    /// When `frame` is 0: frames start at 1.
    pub fn update(&mut self, jobs: &JobSystem, frame: u32, cells: &mut CellTable) {
        let rows = RowSource::of(self);
        if let Some(kernel) = self.prepare(frame, cells, &rows) {
            let words = kernel.words();
            jobs.parallel_for(words, WORDS_PER_CHUNK, &|range, _| {
                // SAFETY: chunks cover disjoint word ranges, hence disjoint rows.
                unsafe { kernel.run(range) };
            });
        }
        // SAFETY: the batch owns the rows that `rows` points at, and nothing writes them.
        unsafe { self.finish(cells, &rows) };
    }

    /// Gives back every row's place in `cells`, the scene's cell table, before the batch goes.
    pub fn release_cells(&mut self, cells: &mut CellTable) {
        for run in self.cells.chunk_by(|a, b| a == b) {
            cells.release_many(run[0], run.len() as u32);
        }
        self.cells.fill(ORIGIN_CELL);
        self.common = ORIGIN_CELL;
        self.mixed = false;
    }

    /// Starts frame `frame` and returns the kernel for the rows that need work, if any. `rows`
    /// holds the row arrays: the batch's own, or its source's for a part that reads another
    /// batch's rows, whose active count and dirty marks it then follows.
    fn prepare(&mut self, frame: u32, cells: &CellTable, rows: &RowSource) -> Option<RowKernel> {
        assert!(frame != 0, "frames start at 1");
        if self.source.is_some() {
            if rows.active != self.active {
                // A source has this part's capacity, and a part without one has no rows.
                let _ = self.set_active_count(rows.active);
            }
            if rows.dirty_any {
                // SAFETY: the source's bitset is live and covers this part's capacity.
                let source = unsafe { std::slice::from_raw_parts(rows.dirty, rows.dirty_words) };
                for (word, &theirs) in self.dirty.words_mut().iter_mut().zip(source) {
                    *word |= theirs;
                }
                self.dirty_any = true;
            }
        }
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
        let common = cells.coords(self.common);
        Some(RowKernel {
            cells: self.cells.as_ptr(),
            cell_coords: cells.all_coords().as_ptr(),
            common,
            common_center: cells::cell_center(common),
            mixed: self.mixed,
            moved: self.moved.words_mut().as_mut_ptr(),
            moved_any: &self.moved_any,
            positions: rows.positions,
            rotations: rows.rotations,
            scales: rows.scales,
            colors: if self.with_colors {
                rows.colors
            } else {
                std::ptr::null()
            },
            part: self.part.unwrap_or(math::IDENTITY),
            has_part: self.part.is_some(),
            sprite: rows.sprite,
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

    /// Ends the frame's update: moves the rows found in a new cell, clears the dirty rows and
    /// records the changed ranges.
    ///
    /// # Safety
    /// `rows` points at live row arrays of this batch's capacity, or holds no rows, and nothing
    /// writes them during the call.
    unsafe fn finish(&mut self, cells: &mut CellTable, rows: &RowSource) {
        let parity = (self.frame & 1) as usize;
        // SAFETY: as the caller guarantees.
        let positions = unsafe { rows.positions() };
        self.move_cells(cells, parity, positions);
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
        if !self.ranges.is_empty() {
            self.version = self.version.wrapping_add(1);
        }
        self.frame_active[parity] = self.active;
    }

    /// Moves each row that the update found in a new cell into the cell that holds its position,
    /// or into the origin cell when the table has no room (see [`cells::enter_cell`]), and records
    /// the range of rows that moved. Then, when rows moved or came back, checks whether the active
    /// rows share a cell.
    fn move_cells(&mut self, cells: &mut CellTable, parity: usize, positions: &[f32]) {
        self.cell_changes = RowRange::default();
        if std::mem::take(self.moved_any.get_mut()) {
            let (mut first, mut end) = (u32::MAX, 0);
            for row in self.moved.iter_ones() {
                let r = row as usize;
                let position = [positions[r * 3], positions[r * 3 + 1], positions[r * 3 + 2]];
                let world = &mut self.world[parity];
                self.cells[r] = cells::enter_cell(cells, world, r, position, self.cells[r]);
                (first, end) = (first.min(row), end.max(row + 1));
            }
            self.moved.clear_all();
            self.cell_changes = RowRange {
                start: first,
                count: end - first,
            };
            self.check_common = true;
        }
        if std::mem::take(&mut self.check_common) {
            let active = &self.cells[..self.active as usize];
            match active.first() {
                Some(&first) if active.iter().any(|&cell| cell != first) => self.mixed = true,
                Some(&first) => (self.common, self.mixed) = (first, false),
                None => self.mixed = false,
            }
        }
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

/// The row arrays that a batch's update reads: its own, or those of the batch it is a part of,
/// with that batch's active count and dirty marks.
#[derive(Clone, Copy)]
struct RowSource {
    positions: *const f32,
    rotations: *const f32,
    scales: *const f32,
    colors: *const f32,
    dirty: *const u64,
    dirty_words: usize,
    dirty_any: bool,
    active: u32,
    /// The rows that the arrays hold.
    rows: u32,
    /// A sprite batch's own rows.
    sprite: Option<SpriteKernel>,
}

/// Raw pointers into a sprite batch's own rows, for the chunks of a parallel update.
#[derive(Clone, Copy)]
struct SpriteKernel {
    look: SpriteLook,
    sizes: *const f32,
    rotations: *const f32,
    colors: *const f32,
    frames: *const u32,
}

impl RowSource {
    /// The rows that `batch` owns: none for a part that reads another batch's rows.
    fn of(batch: &InstanceBatch) -> Self {
        Self {
            positions: batch.positions.as_ptr(),
            rotations: batch.rotations.as_ptr(),
            scales: batch.scales.as_ptr(),
            colors: batch.colors.as_ptr(),
            dirty: batch.dirty.words().as_ptr(),
            dirty_words: batch.dirty.words().len(),
            dirty_any: batch.dirty_any,
            active: batch.active,
            rows: (batch.positions.len() / 3) as u32,
            sprite: batch.sprite.as_ref().map(|s| SpriteKernel {
                look: s.look,
                sizes: s.sizes.as_ptr(),
                rotations: s.rotations.as_ptr(),
                colors: s.colors.as_ptr(),
                frames: s.frames.as_ptr(),
            }),
        }
    }

    /// No rows, for a part whose source batch is gone.
    fn none() -> Self {
        let empty = std::ptr::NonNull::<f32>::dangling().as_ptr().cast_const();
        Self {
            positions: empty,
            rotations: empty,
            scales: empty,
            colors: empty,
            dirty: std::ptr::NonNull::<u64>::dangling().as_ptr().cast_const(),
            dirty_words: 0,
            dirty_any: false,
            active: 0,
            rows: 0,
            sprite: None,
        }
    }

    /// The positions, 3 floats per row.
    ///
    /// # Safety
    /// The arrays are live, and nothing writes them while the slice lives.
    unsafe fn positions(&self) -> &[f32] {
        // SAFETY: as the caller guarantees.
        unsafe { std::slice::from_raw_parts(self.positions, self.rows as usize * 3) }
    }
}

/// Raw pointers into one batch, for the chunks of a parallel update. Chunks own disjoint
/// 64-row words, so they write disjoint rows and disjoint changed-bitset and moved-bitset words.
/// The cell table does not change while the chunks read it.
#[derive(Clone, Copy)]
struct RowKernel {
    cells: *const u32,
    cell_coords: *const CellCoords,
    common: CellCoords,
    common_center: [f32; 3],
    mixed: bool,
    moved: *mut u64,
    moved_any: *const AtomicBool,
    positions: *const f32,
    rotations: *const f32,
    scales: *const f32,
    colors: *const f32,
    /// The part matrix, applied before each row's transform when `has_part` is set.
    part: Affine,
    has_part: bool,
    /// A sprite batch's own rows, which each row packs into its matrix in place of a transform.
    sprite: Option<SpriteKernel>,
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
        if let Some(sprite) = &self.sprite {
            for lane in row..row + 4 {
                // SAFETY: as the caller guarantees for the four rows.
                unsafe { self.compute_sprite(sprite, lane) };
            }
            return;
        }
        let load = |p: *const f32| {
            // SAFETY: the reads below stay inside the four active rows.
            f32x4::from_array(unsafe { p.cast::<[f32; 4]>().read_unaligned() })
        };
        // SAFETY: the four rows are below the active count, so every offset is in bounds, and
        // only this chunk writes the rows.
        unsafe {
            let p = self.positions.add(row * 3);
            let position =
                self.localize4(row, deinterleave3(load(p), load(p.add(4)), load(p.add(8))));
            let s = self.scales.add(row * 3);
            let scale = deinterleave3(load(s), load(s.add(4)), load(s.add(8)));
            let q = self.rotations.add(row * 4);
            let rotation = transpose4([load(q), load(q.add(4)), load(q.add(8)), load(q.add(12))]);
            let mut matrices = compose4(position, rotation, scale);
            if self.has_part {
                matrices = mul4(&matrices, &self.part);
            }
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
        if let Some(sprite) = &self.sprite {
            // SAFETY: as the caller guarantees.
            unsafe { self.compute_sprite(sprite, row) };
            return;
        }
        // SAFETY: the row is below the active count, so every input read is in bounds, and only
        // this chunk writes the row.
        unsafe {
            let p = self.localize(
                row,
                self.positions
                    .add(row * 3)
                    .cast::<[f32; 3]>()
                    .read_unaligned(),
            );
            let q = self
                .rotations
                .add(row * 4)
                .cast::<[f32; 4]>()
                .read_unaligned();
            let s = self.scales.add(row * 3).cast::<[f32; 3]>().read_unaligned();
            let mut matrix = math::compose(p, q, s);
            if self.has_part {
                matrix = math::mul(&matrix, &self.part);
            }
            self.out
                .write(row, &matrix, math::world_sphere(&matrix, self.local_radius));
            if !self.colors.is_null() {
                let color = self.colors.add(row * 4).cast::<[f32; 4]>().read_unaligned();
                self.out.write_color(row, color);
            }
        }
    }

    /// Packs one sprite into its row's world matrix (see [`crate::sprites`]).
    ///
    /// # Safety
    /// As for [`RowKernel::compute`], with `sprite` pointing at the batch's sprite rows.
    #[inline(always)]
    unsafe fn compute_sprite(&self, sprite: &SpriteKernel, row: usize) {
        // SAFETY: the row is below the active count, so every input read is in bounds, and only
        // this chunk writes the row.
        unsafe {
            let position = self
                .positions
                .add(row * 3)
                .cast::<[f32; 3]>()
                .read_unaligned();
            let local = self.localize(row, position);
            let size = sprite
                .sizes
                .add(row * 2)
                .cast::<[f32; 2]>()
                .read_unaligned();
            let color = sprite
                .colors
                .add(row * 4)
                .cast::<[f32; 4]>()
                .read_unaligned();
            let bits = sprite.look.frame_bits(*sprite.frames.add(row));
            let matrix = sprites::pack(local, size, *sprite.rotations.add(row), color, bits);
            self.out.write(
                row,
                &matrix,
                sprites::sphere(&matrix, self.local_radius, bits),
            );
        }
    }

    /// The positions of rows `row..row + 4` relative to their cells' centers, one row per lane,
    /// with rows that left their cell marked as moved. While the rows share a common cell, rows
    /// inside it keep it with one test; any other row takes the rare path of
    /// [`RowKernel::relocate4`]. The results match [`RowKernel::localize`] bit for bit.
    ///
    /// # Safety
    /// As for [`RowKernel::compute4`].
    #[inline(always)]
    unsafe fn localize4(&self, row: usize, position: [f32x4; 3]) -> [f32x4; 3] {
        if !self.mixed {
            let (local, kept) = self.in_common4(position);
            if kept.all() {
                return local;
            }
        }
        // SAFETY: as the caller guarantees.
        unsafe { self.relocate4(row, position) }
    }

    /// Rows `row..row + 4` relative to the common cell's center, and which of them lie inside it:
    /// less than half a cell from the center along every axis.
    #[inline(always)]
    fn in_common4(&self, position: [f32x4; 3]) -> ([f32x4; 3], mask32x4) {
        let center = self.common_center.map(f32x4::splat);
        let local = [
            position[0] - center[0],
            position[1] - center[1],
            position[2] - center[2],
        ];
        let reach = local[0]
            .abs()
            .simd_max(local[1].abs())
            .simd_max(local[2].abs());
        (local, reach.simd_lt(f32x4::splat(HALF_CELL)))
    }

    /// [`RowKernel::localize4`] for rows that may lie in different cells: each row that is not
    /// inside the common cell takes the cell that holds it, and is marked as moved when that is
    /// not its cell now.
    ///
    /// # Safety
    /// As for [`RowKernel::compute4`].
    #[inline(never)]
    unsafe fn relocate4(&self, row: usize, position: [f32x4; 3]) -> [f32x4; 3] {
        let (in_common, kept) = if self.mixed {
            ([f32x4::splat(0.0); 3], mask32x4::splat(false))
        } else {
            self.in_common4(position)
        };
        let (cells, local) = cells::split4(position);
        let mut moved = 0;
        for lane in 0..4 {
            let cell = [
                cells[0].to_array()[lane],
                cells[1].to_array()[lane],
                cells[2].to_array()[lane],
            ];
            // SAFETY: the row is active, as the caller guarantees.
            if !kept.test(lane) && cell != unsafe { self.current_cell(row + lane) } {
                moved |= 1 << lane;
            }
        }
        // SAFETY: as the caller guarantees.
        unsafe { self.mark_moved(row, moved) };
        [0, 1, 2].map(|k| kept.select(in_common[k], local[k]))
    }

    /// The position of `row` relative to its cell's center, with the row marked as moved when it
    /// left its cell. While the rows share a common cell, a row within half a cell of its center,
    /// on every axis, stays in it.
    ///
    /// # Safety
    /// As for [`RowKernel::compute`].
    #[inline(always)]
    unsafe fn localize(&self, row: usize, position: [f32; 3]) -> [f32; 3] {
        if !self.mixed {
            let c = self.common_center;
            let local = [position[0] - c[0], position[1] - c[1], position[2] - c[2]];
            if local[0].abs().max(local[1].abs()).max(local[2].abs()) < HALF_CELL {
                return local;
            }
        }
        // SAFETY: as the caller guarantees.
        unsafe { self.relocate(row, position) }
    }

    /// [`RowKernel::localize`] for a row outside the common cell, or in a batch without one.
    ///
    /// # Safety
    /// As for [`RowKernel::compute`].
    #[inline(never)]
    unsafe fn relocate(&self, row: usize, position: [f32; 3]) -> [f32; 3] {
        let (cell, local) = cells::split(position);
        // SAFETY: as the caller guarantees.
        unsafe {
            if cell != self.current_cell(row) {
                self.mark_moved(row, 1);
            }
        }
        local
    }

    /// The coordinates of the cell `row` lies in now.
    ///
    /// # Safety
    /// The row is inside the batch, and the cell table does not change during the call.
    #[inline(always)]
    unsafe fn current_cell(&self, row: usize) -> CellCoords {
        if self.mixed {
            // SAFETY: as the caller guarantees; a row's cell is always an index in the table.
            unsafe { *self.cell_coords.add(*self.cells.add(row) as usize) }
        } else {
            self.common
        }
    }

    /// Marks the rows `row + k` for each bit `k` of `lanes` as moved.
    ///
    /// # Safety
    /// The rows lie in one 64-row word that belongs to the calling chunk.
    #[inline(always)]
    unsafe fn mark_moved(&self, row: usize, lanes: u64) {
        if lanes != 0 {
            // SAFETY: as the caller guarantees.
            unsafe {
                *self.moved.add(row / 64) |= lanes << (row % 64);
                (*self.moved_any).store(true, Ordering::Relaxed);
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
        let bytes = InstanceBatch::row_bytes(with_colors);
        self.insert(capacity, bytes, || {
            InstanceBatch::try_new(capacity, dynamic, with_colors, mesh, material, local_radius)
        })
    }

    /// Creates a sprite batch (see [`InstanceBatch::try_new_sprites`]) and returns its id. Fails
    /// as [`BatchTable::create`] does.
    pub fn create_sprites(
        &mut self,
        capacity: u32,
        dynamic: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
        look: SpriteLook,
    ) -> Result<Handle, CoreError> {
        let bytes = InstanceBatch::sprite_row_bytes();
        self.insert(capacity, bytes, || {
            InstanceBatch::try_new_sprites(capacity, dynamic, mesh, material, local_radius, look)
        })
    }

    /// Makes room for a batch of `capacity` rows in the work list, makes it with `make`, and gives
    /// it an id.
    fn insert(
        &mut self,
        capacity: u32,
        row_bytes: u64,
        make: impl FnOnce() -> Result<InstanceBatch, TryReserveError>,
    ) -> Result<Handle, CoreError> {
        let out_of_memory = |_| CoreError::OutOfMemory {
            bytes: u32::try_from(u64::from(capacity) * row_bytes).unwrap_or(u32::MAX),
        };
        // Room for every batch's work items at once, so updates never grow the list.
        let work_needed = self.work_needed + capacity.div_ceil(ROW_CHUNK) as usize;
        self.work
            .try_reserve(work_needed.saturating_sub(self.work.len()))
            .map_err(out_of_memory)?;
        let batch = make().map_err(out_of_memory)?;
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

    /// Creates one part of a model (see the module documentation) and returns its id. `part`
    /// places the mesh in the space of each row. Without a `source`, the batch owns `capacity`
    /// rows; with one, it reads that batch's rows, and takes its capacity, its dynamic flag and
    /// whether rows have colours. Fails as [`BatchTable::create`] does, and with
    /// [`CoreError::InvalidHandle`] or [`CoreError::StaleHandle`] for a source that is no batch
    /// that owns rows.
    #[allow(clippy::too_many_arguments)]
    pub fn create_part(
        &mut self,
        source: Option<Handle>,
        capacity: u32,
        dynamic: bool,
        with_colors: bool,
        mesh: u32,
        material: u32,
        local_radius: f32,
        part: Affine,
    ) -> Result<Handle, CoreError> {
        let (capacity, dynamic, with_colors) = match source {
            Some(id) => {
                let owner = self.get(id)?;
                if owner.source.is_some() {
                    return Err(CoreError::InvalidHandle { raw: id.raw() });
                }
                (owner.capacity, owner.dynamic, owner.with_colors)
            }
            None => (capacity, dynamic, with_colors),
        };
        self.insert(capacity, InstanceBatch::row_bytes(with_colors), || {
            InstanceBatch::try_new_part(
                capacity,
                dynamic,
                with_colors,
                mesh,
                material,
                local_radius,
                source,
                Some(part),
            )
        })
    }

    /// Destroys a batch, gives its rows' places back to `cells`, the scene's cell table, and frees
    /// its arrays. `frame` is recorded for stale-id errors.
    pub fn destroy(
        &mut self,
        id: Handle,
        frame: u32,
        cells: &mut CellTable,
    ) -> Result<(), CoreError> {
        self.ids.release(id, frame)?;
        if let Some(mut batch) = self.batches[id.slot() as usize].take() {
            batch.release_cells(cells);
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

    /// Updates every batch for frame `frame` in one parallel loop over chunks of all batches. Rows
    /// that change cells move in `cells`, the scene's cell table. Allocates nothing.
    pub fn update(&mut self, jobs: &JobSystem, frame: u32, cells: &mut CellTable) {
        self.work.clear();
        for slot in self.ids.live().iter_ones() {
            let rows = self.rows_of(slot);
            let batch = self.batches[slot as usize].as_mut().expect("live");
            let kernel = batch.prepare(frame, cells, &rows);
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
            let rows = self.rows_of(slot);
            let batch = self.batches[slot as usize].as_mut().expect("live");
            // SAFETY: `rows` points at the arrays of a live batch, which the loop does not write:
            // `finish` writes only the batch it runs on, and a source's rows belong to another.
            unsafe { batch.finish(cells, &rows) };
        }
    }

    /// The row arrays that the batch in `slot` reads: its own, its source's, or none when its
    /// source is gone.
    fn rows_of(&self, slot: u32) -> RowSource {
        let batch = self.batches[slot as usize].as_ref().expect("live");
        match batch.source {
            None => RowSource::of(batch),
            Some(id) => self
                .get(id)
                .map_or_else(|_| RowSource::none(), RowSource::of),
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
        let mut cells = CellTable::new();
        let mut batch = InstanceBatch::new(5, false, true, 3, 4, 0.5);
        batch.positions_mut()[3..6].copy_from_slice(&[1.0, 2.0, 3.0]);
        batch.scales_mut()[3..6].copy_from_slice(&[2.0, 4.0, 1.0]);
        batch.colors_mut()[4..8].copy_from_slice(&[0.1, 0.2, 0.3, 0.4]);
        batch.update(&jobs, 1, &mut cells);
        let m = math::compose([1.0, 2.0, 3.0], IDENTITY_ROTATION, [2.0, 4.0, 1.0]);
        assert_eq!(batch.world(1).matrix(1), &m);
        assert_eq!(batch.world(1).sphere(1), [1.0, 2.0, 3.0, 2.0]);
        assert_eq!(&batch.world(1).colors()[4..8], &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(batch.changed_ranges(), &[RowRange { start: 0, count: 5 }]);
        assert_eq!(batch.frame_active_count(1), 5);
    }

    #[test]
    fn sprite_rows_pack_into_their_matrices_and_take_their_cells() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let look = SpriteLook::new(2, 2, false);
        // Nine rows, so both the four-row blocks and the single rows run, static and dynamic.
        for dynamic in [false, true] {
            let mut batch = InstanceBatch::try_new_sprites(9, dynamic, 3, 4, 0.75, look).unwrap();
            assert!(batch.rotations().is_empty() && batch.scales().is_empty());
            write_row(&mut batch, 2, 100_000.5);
            {
                let (sizes, rotations, colors, frames) = batch.sprite_rows_mut();
                sizes[4..6].copy_from_slice(&[2.0, 0.5]);
                rotations[2] = 0.25;
                colors[8..12].copy_from_slice(&[0.5, 0.25, 0.125, 0.75]);
                frames[2] = 3;
            }
            batch.update(&jobs, 1, &mut cells);
            let far = cells.find([98, 0, 0]).unwrap();
            assert_eq!(batch.cells()[1..3], [0, far]);
            let bits = look.frame_bits(3);
            let packed = sprites::pack(
                [-351.5, 0.0, 0.0],
                [2.0, 0.5],
                0.25,
                [0.5, 0.25, 0.125, 0.75],
                bits,
            );
            assert_eq!(batch.world(1).matrix(2), &packed);
            assert_eq!(
                batch.world(1).sphere(2),
                sprites::sphere(&packed, 0.75, bits)
            );
            // An untouched sprite: one unit wide and high, white, frame 0, at its cell's center.
            let plain = sprites::pack([0.0; 3], [1.0, 1.0], 0.0, [1.0; 4], look.frame_bits(0));
            assert_eq!(batch.world(1).matrix(8), &plain);
            assert!(!batch.unculled());
            batch.release_cells(&mut cells);
        }
        let screen = SpriteLook::new(1, 1, true);
        let mut batch = InstanceBatch::try_new_sprites(1, false, 3, 4, 0.75, screen).unwrap();
        batch.update(&jobs, 1, &mut cells);
        assert!(batch.unculled());
        assert_eq!(batch.world(1).sphere(0)[3], crate::world::UNBOUNDED_RADIUS);
    }

    #[test]
    fn dirty_ranges_are_exactly_the_marked_rows_coalesced() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut batch = InstanceBatch::new(300, false, false, 0, 0, 1.0);
        batch.update(&jobs, 1, &mut cells);
        for row in 0..300 {
            write_row(&mut batch, row, 7.0);
        }
        batch.mark_dirty(10, 5).unwrap();
        batch.mark_dirty(15, 3).unwrap();
        batch.mark_dirty(100, 1).unwrap();
        batch.mark_dirty(0, 2).unwrap();
        batch.mark_dirty(63, 2).unwrap();
        batch.mark_dirty(299, 1).unwrap();
        batch.update(&jobs, 2, &mut cells);
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
        batch.update(&jobs, 3, &mut cells);
        assert!(batch.changed_ranges().is_empty());
        for row in 0..300 {
            assert_eq!(x_of(&batch, 1, row), x_of(&batch, 0, row), "row {row}");
        }
        // A batch at rest does no work.
        batch.update(&jobs, 4, &mut cells);
        assert!(batch.changed_ranges().is_empty());
    }

    #[test]
    fn a_dynamic_batch_updates_everything() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut batch = InstanceBatch::new(130, true, false, 0, 0, 1.0);
        for frame in 1..4 {
            for row in 0..130 {
                write_row(&mut batch, row, frame as f32);
            }
            batch.update(&jobs, frame, &mut cells);
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
        let mut cells = CellTable::new();
        let mut batch = InstanceBatch::new(100, false, false, 0, 0, 1.0);
        batch.set_active_count(10).unwrap();
        batch.update(&jobs, 1, &mut cells);
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
        batch.update(&jobs, 2, &mut cells);
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
        let mut cells = CellTable::new();
        let rows = (MAX_ROW_RANGES as u32 + 10) * 2;
        let mut batch = InstanceBatch::new(rows, false, false, 0, 0, 1.0);
        batch.update(&jobs, 1, &mut cells);
        for row in (0..rows).step_by(2) {
            batch.mark_dirty(row, 1).unwrap();
        }
        batch.update(&jobs, 2, &mut cells);
        let ranges = batch.changed_ranges();
        assert_eq!(ranges.len(), MAX_ROW_RANGES);
        let last = ranges[MAX_ROW_RANGES - 1];
        assert_eq!(last.start + last.count, rows - 1);
    }

    #[test]
    fn the_table_gives_stable_ids_and_updates_every_batch() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
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
        table.update(&jobs, 1, &mut cells);
        assert_eq!(table.get(b).unwrap().world(1).matrix(1500)[3], 9.0);
        assert_eq!(table.get(a).unwrap().changed_ranges().len(), 1);
        let ids: Vec<Handle> = table.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, [a, b]);

        table.destroy(a, 5, &mut cells).unwrap();
        assert_eq!(
            table.get(a).err(),
            Some(CoreError::StaleHandle {
                slot: a.slot(),
                destroyed_frame: 5
            })
        );
        let c = table.create(4, false, false, 0, 0, 1.0).unwrap();
        assert_ne!(c, a);
        table.update(&jobs, 2, &mut cells);
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

    #[test]
    fn rows_take_the_cell_of_their_position() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        // Nine rows: two blocks of four, which update four at a time, and one more.
        for dynamic in [false, true] {
            let mut batch = InstanceBatch::new(9, dynamic, false, 0, 0, 1.0);
            batch.update(&jobs, 1, &mut cells);
            assert_eq!(batch.common_cell(), Some(ORIGIN_CELL));
            assert_eq!(batch.cell_changes().count, 0);

            // Rows 2 and 8 move 100 km out; the others stay near the origin.
            for row in [2, 8] {
                write_row(&mut batch, row, 100_000.5);
            }
            batch.mark_dirty(0, 9).unwrap();
            batch.update(&jobs, 2, &mut cells);
            let far = cells.find([98, 0, 0]).unwrap();
            assert_eq!(batch.cells()[..9], [0, 0, far, 0, 0, 0, 0, 0, far]);
            assert_eq!(batch.cell_changes(), RowRange { start: 2, count: 7 });
            assert_eq!(batch.common_cell(), None);
            assert_eq!(cells.count(far), 2);
            // Matrices are relative to their cell's center: 100,000.5 m less 98 cells.
            assert_eq!(x_of(&batch, 0, 2), -351.5);
            assert_eq!(x_of(&batch, 0, 3), 0.0);

            // Nothing moves, so no row changes cells.
            batch.mark_dirty(0, 9).unwrap();
            batch.update(&jobs, 3, &mut cells);
            assert_eq!(batch.cell_changes().count, 0);

            // With every row out there, the batch has a common cell again.
            for row in 0..9 {
                write_row(&mut batch, row, 100_000.5);
            }
            batch.mark_dirty(0, 9).unwrap();
            batch.update(&jobs, 4, &mut cells);
            assert_eq!(batch.common_cell(), Some(far));
            assert_eq!(cells.count(far), 9);
            assert_eq!(x_of(&batch, 0, 0), -351.5);
            batch.release_cells(&mut cells);
            assert!(cells.origin_only());
        }
    }

    #[test]
    fn rows_that_come_back_are_checked_against_the_common_cell() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut batch = InstanceBatch::new(8, false, false, 0, 0, 1.0);
        batch.update(&jobs, 1, &mut cells);
        // Row 7 goes far out, then leaves the drawn rows.
        write_row(&mut batch, 7, -5_000.0);
        batch.mark_dirty(7, 1).unwrap();
        batch.update(&jobs, 2, &mut cells);
        batch.set_active_count(4).unwrap();
        batch.update(&jobs, 3, &mut cells);
        assert_eq!(batch.common_cell(), Some(ORIGIN_CELL));
        // It comes back where it was, in its own cell, so the rows share no cell.
        batch.set_active_count(8).unwrap();
        assert_eq!(batch.common_cell(), None);
        batch.update(&jobs, 4, &mut cells);
        assert_eq!(batch.common_cell(), None);
        assert_eq!(cells.coords(batch.cells()[7]), [-5, 0, 0]);
        // Back at the origin, the rows share the origin cell again.
        write_row(&mut batch, 7, 0.0);
        batch.mark_dirty(7, 1).unwrap();
        batch.update(&jobs, 5, &mut cells);
        assert_eq!(batch.common_cell(), Some(ORIGIN_CELL));
        assert!(cells.origin_only());
    }

    /// A part matrix that turns a quarter about Y, scales by 2 and moves by (1, 2, 3).
    const PART: Affine = [
        0.0, 0.0, 2.0, 1.0, //
        0.0, 2.0, 0.0, 2.0, //
        -2.0, 0.0, 0.0, 3.0,
    ];

    #[test]
    fn parts_place_their_mesh_before_each_row_and_share_the_first_parts_rows() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut table = BatchTable::with_capacity(3);
        let first = table
            .create_part(None, 9, true, false, 1, 2, 0.5, math::IDENTITY)
            .unwrap();
        let second = table
            .create_part(Some(first), 0, false, true, 3, 4, 0.25, PART)
            .unwrap();
        let other = table.get(second).unwrap();
        assert_eq!((other.capacity(), other.is_dynamic()), (9, true));
        assert!(!other.has_colors());
        assert_eq!(other.source(), Some(first));
        assert!(other.positions().is_empty());
        assert_eq!(
            table.create_part(Some(second), 0, false, false, 1, 2, 1.0, PART),
            Err(CoreError::InvalidHandle { raw: second.raw() })
        );
        let rows = table.get_mut(first).unwrap();
        for row in 0..9 {
            rows.positions_mut()[row * 3..row * 3 + 3].copy_from_slice(&[row as f32, 0.0, 1.0]);
            rows.scales_mut()[row * 3..row * 3 + 3].copy_from_slice(&[1.0, 3.0, 1.0]);
        }
        table.update(&jobs, 1, &mut cells);
        for row in 0..9 {
            let m = math::compose([row as f32, 0.0, 1.0], IDENTITY_ROTATION, [1.0, 3.0, 1.0]);
            let placed = math::mul(&m, &PART);
            let part = table.get(second).unwrap().world(1);
            assert_eq!(part.matrix(row), &placed, "row {row}");
            assert_eq!(part.sphere(row), math::world_sphere(&placed, 0.25));
            assert_eq!(table.get(first).unwrap().world(1).matrix(row), &m);
        }
    }

    #[test]
    fn a_part_follows_the_dirty_rows_and_active_count_of_its_source() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut table = BatchTable::with_capacity(2);
        let first = table
            .create_part(None, 200, false, false, 1, 2, 1.0, math::IDENTITY)
            .unwrap();
        let second = table
            .create_part(Some(first), 0, false, false, 3, 4, 1.0, PART)
            .unwrap();
        table.update(&jobs, 1, &mut cells);
        assert_eq!(
            table.get(second).unwrap().changed_ranges(),
            &[RowRange {
                start: 0,
                count: 200
            }]
        );
        table.update(&jobs, 2, &mut cells);
        table.update(&jobs, 3, &mut cells);
        assert!(table.get(second).unwrap().changed_ranges().is_empty());

        let rows = table.get_mut(first).unwrap();
        rows.positions_mut()[70 * 3] = 5.0;
        rows.mark_dirty(70, 1).unwrap();
        rows.set_active_count(100).unwrap();
        table.update(&jobs, 4, &mut cells);
        let part = table.get(second).unwrap();
        assert_eq!(
            part.changed_ranges(),
            &[RowRange {
                start: 70,
                count: 1
            }]
        );
        assert_eq!(part.active_count(), 100);
        assert_eq!(part.world(0).matrix(70)[3], 5.0 + PART[3]);

        table.get_mut(first).unwrap().set_active_count(150).unwrap();
        table.update(&jobs, 5, &mut cells);
        assert_eq!(
            table.get(second).unwrap().changed_ranges(),
            &[RowRange {
                start: 100,
                count: 50
            }]
        );

        table.destroy(first, 6, &mut cells).unwrap();
        table.update(&jobs, 6, &mut cells);
        assert_eq!(table.get(second).unwrap().active_count(), 0);
    }

    #[test]
    fn four_lane_parts_match_one_row_at_a_time_bit_for_bit() {
        let jobs = JobSystem::new(0);
        let mut cells = CellTable::new();
        let mut table = BatchTable::with_capacity(2);
        let first = table
            .create_part(None, 64, false, false, 1, 2, 1.0, math::IDENTITY)
            .unwrap();
        let second = table
            .create_part(Some(first), 0, false, false, 3, 4, 0.7, PART)
            .unwrap();
        let rows = table.get_mut(first).unwrap();
        for row in 0..64 {
            let t = row as f32 * 0.37;
            rows.positions_mut()[row * 3..row * 3 + 3].copy_from_slice(&[t, -t, 0.5 * t]);
            let (s, c) = (t * 0.5).sin_cos();
            rows.rotations_mut()[row * 4..row * 4 + 4].copy_from_slice(&[0.0, s, 0.0, c]);
        }
        table.update(&jobs, 1, &mut cells);
        // Rows 0 to 63 take the four-lane path; one row marked alone takes the other.
        table.get_mut(first).unwrap().mark_dirty(13, 1).unwrap();
        let before = *table.get(second).unwrap().world(1).matrix(13);
        table.update(&jobs, 2, &mut cells);
        table.get_mut(first).unwrap().mark_dirty(13, 1).unwrap();
        table.update(&jobs, 3, &mut cells);
        assert_eq!(table.get(second).unwrap().world(1).matrix(13), &before);
    }
}
