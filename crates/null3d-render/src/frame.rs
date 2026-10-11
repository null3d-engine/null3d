//! What every frame builder shares: the frame's input, the scene settings (meshes, materials, the
//! views, the lights and the fog), and the draw lists and upload arenas kept per frame parity.
//!
//! # Frames in flight
//!
//! The sketch worker records frame `f + 1` while the render worker replays frame `f`. Everything a
//! frame's list reads from engine memory is therefore kept per frame parity: the list itself, and
//! an upload arena that holds copies of the small tables and new mesh data. World matrices come
//! straight from the core's world buffer of the frame's parity, which the core keeps the same way.

use std::collections::TryReserveError;
use std::ops::Range;

use null3d_core::alloc::reserve_keeping;
use null3d_core::animation::Animations;
use null3d_core::cells::{CellPosition, MAX_CELLS, ORIGIN_CELL};
use null3d_core::culling::{CULL_CHUNK, CullRun, ROW_CELLS};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::jobs::JobSystem;
use null3d_core::lights::{LightShadow, LightTable, LightView, SunShadow, VisibleLight};
use null3d_core::morph::MorphWeights;
use null3d_core::scene::SceneStorage;
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::{
    DrawList, DrawListError, Op, buffer_usage, permutation, state_flags, template, vertex,
};

use crate::ao::{self, Ao};
use crate::background::{Background, BackgroundSource};
use crate::bloom::{Bloom, ChainFrame};
use crate::camera::{Lens, Mat4};
use crate::debug_lines::DebugLines;
use crate::debug_view::{self, DebugView};
use crate::dof::{self, Dof, DofFrame};
use crate::effects::{Effect, EffectJoins, MAX_EFFECTS};
use crate::environment::{Environment, EnvironmentUniform};
use crate::fog::{self, Fog};
use crate::frame_data::{FrameUniform, normalized_direction};
use crate::grading::{Grading, Lut, Vignette};
use crate::graph::{GraphError, RenderScale};
use crate::materials::{
    MAP_SLOTS, MATERIAL_FLOATS, MATERIAL_TEXELS, MapSlot, MaterialTable, NO_UNIT, Shading,
    blend_state, feature,
};
use crate::meshes::{MAX_BUFFER_BYTES, MeshMoves, MeshStorage, Page};
use crate::outline::Outline;
use crate::output::{Antialias, Output, SceneColor, ToneMapping};
use crate::pipelines::{DepthBias, DrawKey, PipelineCache};
use crate::shadow_tiles::{MAX_TILES, TileSettings};
use crate::shadows::{
    CascadeDepth, CascadeSchedule, MovingCasters, ShadowFrame, ShadowQuality, ShadowSettings,
    fit_cascades,
};
use crate::sky_maps::SkyMaps;
use crate::textures::TextureStore;
use crate::textures::budget::NeedView;
use crate::view::{MAX_VIEWS, View, ViewFrame, ViewId, ViewNames};

/// Engine mesh ids count from 1; 0 marks an object with no mesh, such as a group or a camera.
pub const NO_MESH: u32 = 0;
/// Engine material ids count from 1 too: material table index plus one.
pub const NO_MATERIAL: u32 = 0;
/// The bucket of a source that draws nowhere.
pub const HIDDEN: u32 = u32::MAX;
/// Bytes of one cell's offset from the camera, as the shaders read it: a `vec4f`.
pub const CELL_OFFSET_BYTES: u32 = 16;

// The core's cell table and the shaders' tables of cell offsets agree.
const _: () = assert!(
    MAX_CELLS == null3d_gpu::drawlist::sizes::MAX_CELLS
        && null3d_core::cells::CELL_SHIFT == null3d_gpu::drawlist::sizes::CELL_SHIFT
);

/// The part of scene rows `start..start + count` from the first to the last row whose bucket is
/// not [`HIDDEN`], by each slot's bucket in `buckets`, or `None` when no row of it draws. A camera,
/// a light or an empty group moves without anything to upload.
pub(crate) fn drawn_rows(buckets: &[u32], start: u32, count: u32) -> Option<(u32, u32)> {
    let end = start.saturating_add(count).min(buckets.len() as u32);
    let draws = |slot: &u32| buckets[*slot as usize] != HIDDEN;
    let first = (start..end).find(draws)?;
    let last = (first..end).rev().find(draws)?;
    Some((first, last + 1 - first))
}

/// The most unchanged scene rows that one upload carries between two runs of changed rows. Each
/// write of a data texture on WebGL2 goes through a pixel unpack buffer, and many small writes in
/// a frame hold up the GPU far longer than the few kilobytes of rows that a merged write repeats.
/// On WebGPU, each buffer write is a call of its own on the render thread, which costs more than
/// the rows it repeats.
pub const MERGE_GAP_ROWS: u32 = 64;

/// Rows `start..start + count` joined to the upload `span` (a start and a count) when they begin
/// inside it or at most [`MERGE_GAP_ROWS`] rows past its end, or `None` when they lie apart. Both
/// world buffers hold every row's latest matrix, so rows between two runs upload unchanged.
pub(crate) fn joined_rows(span: (u32, u32), start: u32, count: u32) -> Option<(u32, u32)> {
    let end = span.0 + span.1;
    if start < span.0 || start > end.saturating_add(MERGE_GAP_ROWS) {
        return None;
    }
    Some((span.0, end.max(start + count) - span.0))
}

/// Where the rows of a run's positions lie: all in one cell, each in the cell of its entry in a
/// list of cells by position, or each in the cell of the row that a list of rows names.
#[derive(Clone, Copy, Debug)]
pub(crate) enum RunCells<'a> {
    One(u32),
    Rows(&'a [u32]),
    Listed { rows: &'a [u32], cells: &'a [u32] },
}

impl RunCells<'_> {
    /// The cell of every position in `range`, or [`ROW_CELLS`] when they lie in several.
    pub(crate) fn of(&self, range: Range<u32>) -> u32 {
        let (start, end) = (range.start as usize, range.end as usize);
        let same = |mut cells: std::slice::Iter<'_, u32>, cell: &dyn Fn(u32) -> u32| {
            let first = cells.next().map_or(ORIGIN_CELL, |&c| cell(c));
            if cells.all(|&c| cell(c) == first) {
                first
            } else {
                ROW_CELLS
            }
        };
        match *self {
            RunCells::One(cell) => cell,
            RunCells::Rows(cells) => same(cells[start..end].iter(), &|cell| cell),
            RunCells::Listed { rows, cells } => {
                same(rows[start..end].iter(), &|row| cells[row as usize])
            }
        }
    }
}

/// Splits positions `range` of a set into culling runs of at most one chunk each. A run whose rows
/// share a cell culls as that cell's run; the others look each row's cell up. The list grows only
/// when it has no room left for a run.
pub(crate) fn push_runs(
    runs: &mut Vec<CullRun>,
    set: u32,
    range: Range<u32>,
    bucket: u32,
    base: u32,
    cells: RunCells<'_>,
) -> Result<(), TryReserveError> {
    let mut start = range.start;
    while start < range.end {
        let end = (start + CULL_CHUNK).min(range.end);
        runs.try_reserve(1)?;
        runs.push(CullRun {
            set,
            start,
            end,
            bucket,
            base,
            cell: cells.of(start..end),
        });
        start = end;
    }
    Ok(())
}

/// Why a frame could not be recorded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordError {
    /// The frame's commands would take the draw list past its limit.
    DrawListFull {
        /// The most bytes the list holds, in whole mebibytes.
        megabytes: u32,
    },
    /// More sources than the builder can draw on this device.
    TooManySources {
        /// The most sources the builder can draw on this device.
        limit: u32,
    },
    /// The skinned vertices of the scene's skinned objects do not fit the skinned vertex buffers
    /// of the WebGPU skinning pass.
    SkinnedVerticesFull {
        /// The bytes those buffers hold on this device, in whole mebibytes.
        megabytes: u32,
    },
    /// Skinned meshes fill more mesh pages than the WebGPU skinning pass reads.
    SkinnedPagesFull {
        /// The most mesh pages of skinned meshes.
        limit: u32,
    },
    /// The frame's copies do not fit its upload arena, which the builder sizes for every frame.
    UploadsFull,
    /// Memory could not grow for the tables of a new layout.
    OutOfMemory {
        /// The bytes the tables needed, or `u32::MAX` for more than that.
        bytes: u32,
    },
    /// The render graph of the frame's passes did not compile.
    Graph(GraphError),
}

impl From<DrawListError> for RecordError {
    fn from(error: DrawListError) -> Self {
        let bytes = |words: usize| words as u64 * 4;
        match error {
            DrawListError::Full { limit } => RecordError::DrawListFull {
                megabytes: (bytes(limit) >> 20) as u32,
            },
            DrawListError::OutOfMemory { words } => RecordError::OutOfMemory {
                bytes: bytes(words).min(u64::from(u32::MAX)) as u32,
            },
        }
    }
}

/// What one frame of the scene looks like to a builder.
pub struct FrameInput<'a> {
    /// The frame number, counting from 1.
    pub frame: u32,
    pub scene: &'a SceneStorage,
    pub batches: &'a BatchTable,
    /// The frame's upload list.
    pub snapshot: &'a FrameSnapshot,
    /// The canvas size in device pixels.
    pub canvas: (u32, u32),
    /// The render scale: the part of the canvas's width and height that the scene draws at.
    pub render_scale: RenderScale,
    /// True when the scene's structure changed this frame: objects created or destroyed, meshes
    /// or materials changed, batches created or destroyed.
    pub structure_changed: bool,
    /// The job system, for work that runs on the job workers.
    pub jobs: &'a JobSystem,
    /// The lines that the sketch drew for the frame, which development builds draw over the
    /// camera's view. Release builds draw none.
    pub lines: DebugLines<'a>,
    /// The point and spot lights that the camera sees, with positions relative to it (see
    /// [`LightTable::visible`]).
    pub lights: &'a [VisibleLight],
    /// The point and spot lights that cast shadows (see [`LightTable::shadows`]).
    pub shadow_lights: &'a [LightShadow],
    /// The newest frame that the thread that draws drew with every pipeline built, or 0 before
    /// any.
    pub pipelines_built: u32,
    /// Skeletons, clips and animated instances, with the skinning matrices of the frame's
    /// animation step, once the scene has any.
    pub animations: Option<&'a Animations>,
    /// The morph weights of morphed objects, which the sketch writes.
    pub morphs: &'a MorphWeights,
}

impl FrameInput<'_> {
    /// The frame's parity: which of the double-buffered world arrays and lists it uses.
    pub fn parity(&self) -> usize {
        (self.frame & 1) as usize
    }
}

/// Records frames for one GPU path. The engine holds one builder, chosen once for the device.
pub trait FrameBuilder {
    /// Meshes, materials, the camera and the lights.
    fn settings(&self) -> &SceneSettings;
    fn settings_mut(&mut self) -> &mut SceneSettings;
    /// The most sources, scene slots and instance rows together, that the builder can draw on
    /// this device.
    fn max_sources(&self) -> u32;
    /// Makes room for a layout of `sources` sources in the tables and upload space that grow with
    /// the scene, or fails when memory cannot grow for them. Called before the scene grows, so a
    /// later frame never runs out of memory while it records.
    fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError>;
    /// Finds the frame's visible objects, where the builder does that on the CPU. The frame's
    /// `record` then draws them, and culls itself if this did not run for the frame.
    fn cull(&mut self, _input: &FrameInput<'_>) -> Result<(), RecordError> {
        Ok(())
    }
    /// Records the frame's draw list into the list of its parity. Returns true when the frame
    /// rebuilt the draw tables.
    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError>;
    /// The entries of the index list that the frame draws, where the builder culls on the CPU: one
    /// per visible object or instance row, or per visible cluster of static rows. `None` where the
    /// GPU culls, as the CPU never learns the count there.
    fn visible_entries(&self, _frame: u32) -> Option<u32> {
        None
    }
    /// The sources inside the camera's frustum that software occlusion culling hid in a recorded
    /// frame, where the builder culls on the CPU. `None` where the GPU culls.
    fn occluded_entries(&self, _frame: u32) -> Option<u32> {
        None
    }
    /// Turns software occlusion culling on or off from the next frame on, where the builder culls
    /// on the CPU. Elsewhere it does nothing.
    fn set_software_occlusion(&mut self, _on: bool) {}
    /// Sets the pixels that software occlusion culling's buffer holds about, or 0 for the core's
    /// default, where the builder culls on the CPU. Elsewhere it does nothing.
    fn set_occlusion_buffer(&mut self, _pixels: u32) {}
    /// Gives mesh `mesh`, by its id that counts from 1, a blocker of its own for software
    /// occlusion culling, where the builder culls on the CPU. Elsewhere it does nothing. Fails
    /// only when memory cannot grow.
    fn set_mesh_blocker(
        &mut self,
        _mesh: u32,
        _blocker: null3d_core::occlusion::BlockerMesh,
    ) -> Result<(), TryReserveError> {
        Ok(())
    }
    /// True when point or spot lights cast shadows into the shadow atlas in the frame recorded
    /// last.
    fn casts_tile_shadows(&self) -> bool {
        false
    }
    /// Removes the live meshes among `ids`, which no object or batch names any more, packs the
    /// storage over their data, and makes the next frame upload the data that moved. The next
    /// frame rebuilds the draw tables, as after any structure change.
    fn remove_meshes(&mut self, ids: &[u32]) {
        let moves = self.settings_mut().meshes_mut().remove(ids);
        self.meshes_moved(ids, &moves);
    }
    /// Makes the GPU copies of the meshes follow a removal: the pages and the delta texels upload
    /// again from where `moves` says they changed, and the removed `ids` lose what the builder
    /// kept for them.
    fn meshes_moved(&mut self, ids: &[u32], moves: &MeshMoves);
    /// The GPU bytes of the meshes: the buffers of every page and the texture of morph deltas.
    fn mesh_gpu_bytes(&self) -> u64;
    /// Forgets every GPU object the draw lists created and every upload they made, so the next
    /// frame creates them all again and uploads the whole scene. The thread that draws asks for
    /// this after the browser took the GPU away and it made a new device.
    fn reset_gpu(&mut self);
    /// Draws the scene into a target of another format, or with another anti-aliasing mode, from
    /// the next frame on, as an effect that needs HDR color asks on the 8-bit path. The render
    /// graph makes its targets again, and every pipeline that draws into them changes, so the caller
    /// rebuilds the draw tables. The canvas keeps its transparency.
    fn set_canvas_output(&mut self, scene_color: SceneColor, antialias: Antialias);
    /// The list recorded for a frame's parity, as the render worker replays it.
    fn list(&self, frame: u32) -> &DrawList;
    /// Declares the render graph's passes for the views as they are now, and compiles the graph
    /// outside a frame, so a new pass fails at once when it does not fit. The next frame makes the
    /// plan's textures.
    fn check_graph(&mut self) -> Result<(), GraphError>;
    /// The render graph as Graphviz DOT text, compiled first.
    fn graph_dot(&mut self) -> String;
    /// A render graph error's message, with the passes and resources by name.
    fn graph_message(&self, error: GraphError) -> String;
}

/// The engine memory address of bytes, as the replay loop reads it: an offset into WebAssembly
/// memory. Native builds keep the low bits, which is enough for tests that compare addresses.
pub fn address(bytes: &[u8]) -> u32 {
    bytes.as_ptr() as usize as u32
}

/// Records the upload of whole rows of the material table, from row `first` on: a range of the
/// buffer on WebGPU, or rows of texels of the data texture on WebGL2.
fn write_table_rows(
    list: &mut DrawList,
    arena: &mut UploadArena,
    table: MaterialStorage,
    first: u32,
    floats: &[f32],
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(floats_as_bytes(floats))?;
    match table {
        MaterialStorage::Buffer { table: buffer, .. } => {
            let offset = first * MATERIAL_FLOATS as u32 * 4;
            list.push(Op::WriteBuffer, &[buffer, offset, at, bytes])?;
        }
        MaterialStorage::Texture(texture) => {
            let rows = (floats.len() / MATERIAL_FLOATS) as u32;
            let region = [texture, 0, 0, first, 0, MATERIAL_TEXELS, rows, 1, at, bytes];
            list.push(Op::WriteTexture, &region)?;
        }
    }
    Ok(())
}

pub(crate) fn floats_as_bytes(floats: &[f32]) -> &[u8] {
    // SAFETY: any `f32` is four initialized bytes, and `u8` has no alignment requirement.
    unsafe {
        std::slice::from_raw_parts(floats.as_ptr().cast::<u8>(), std::mem::size_of_val(floats))
    }
}

/// The offset from a view's camera to the center of each cell in use, by cell index, as the
/// shaders read them. Allocated once.
#[derive(Debug)]
pub(crate) struct CellOffsets {
    offsets: Vec<[f32; 4]>,
    len: usize,
}

impl Default for CellOffsets {
    fn default() -> Self {
        Self {
            offsets: vec![[0.0; 4]; MAX_CELLS as usize],
            len: 0,
        }
    }
}

impl CellOffsets {
    /// Computes the offsets of the scene's cells from a camera, in 64-bit floats.
    pub(crate) fn update(&mut self, scene: &SceneStorage, camera: &CellPosition) {
        self.len = scene.cell_table().write_offsets(camera, &mut self.offsets);
    }

    /// Copies another frame's offsets.
    pub(crate) fn copy_from(&mut self, other: &CellOffsets) {
        self.offsets[..other.len].copy_from_slice(other.as_slice());
        self.len = other.len;
    }

    /// The offsets, one `(x, y, z, 0)` per cell index up to the highest in use.
    pub(crate) fn as_slice(&self) -> &[[f32; 4]] {
        &self.offsets[..self.len]
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        floats_as_bytes(self.as_slice().as_flattened())
    }
}

pub(crate) fn words_as_bytes(words: &[u32]) -> &[u8] {
    // SAFETY: any `u32` is four initialized bytes, and `u8` has no alignment requirement.
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), std::mem::size_of_val(words)) }
}

pub(crate) fn indices_as_bytes(indices: &[u16]) -> &[u8] {
    // SAFETY: any `u16` is two initialized bytes, and `u8` has no alignment requirement.
    unsafe {
        std::slice::from_raw_parts(
            indices.as_ptr().cast::<u8>(),
            std::mem::size_of_val(indices),
        )
    }
}

/// Copies of data a frame's list uploads. Chunks never move once allocated, so addresses stay
/// valid until the arena is reset for the next frame of the same parity.
#[derive(Default)]
pub(crate) struct UploadArena {
    bytes: Vec<u8>,
    /// Bytes that a reserve ahead of a frame replaced, kept until the next reset: the list of the
    /// frame that last used the arena may still point into them.
    kept: Vec<Vec<u8>>,
}

impl UploadArena {
    /// Empties the arena and makes room for `total` bytes. The list of the frame that last used
    /// the arena has been replayed, so its copies may move.
    pub(crate) fn reset(&mut self, total: usize) {
        self.kept.clear();
        self.bytes.clear();
        self.bytes.reserve_exact(total);
    }

    /// Makes room for `total` bytes ahead of the frame that needs them, or fails when memory
    /// cannot grow. The bytes that the arena holds stay where they are until the next reset.
    pub(crate) fn try_reserve(&mut self, total: usize) -> Result<(), TryReserveError> {
        reserve_keeping(&mut self.bytes, total, &mut self.kept)
    }

    /// Copies bytes into the arena, padded to four bytes, and returns their address and padded
    /// length. The arena never grows during a frame, as that would move the copies whose addresses
    /// the list already holds.
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<(u32, u32), RecordError> {
        let padded = bytes.len().next_multiple_of(4);
        let start = self.bytes.len();
        if self.bytes.capacity() - start < padded {
            return Err(RecordError::UploadsFull);
        }
        self.bytes.extend_from_slice(bytes);
        self.bytes.resize(start + padded, 0);
        Ok((address(&self.bytes[start..]), padded as u32))
    }

    /// The bytes that the frame copied so far.
    #[cfg(test)]
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Adds `len` zero bytes, padded to four bytes, for the caller to fill in place, and returns
    /// their address and the bytes. Like [`UploadArena::push`], it never grows the arena.
    pub(crate) fn push_zeroed(&mut self, len: usize) -> Result<(u32, &mut [u8]), RecordError> {
        let padded = len.next_multiple_of(4);
        let start = self.bytes.len();
        if self.bytes.capacity() - start < padded {
            return Err(RecordError::UploadsFull);
        }
        self.bytes.resize(start + padded, 0);
        let bytes = &mut self.bytes[start..];
        Ok((address(bytes), bytes))
    }
}

/// Binds a view's frame group `group` at index 0, at the dynamic offsets `offsets`, as the view's
/// opaque pass binds it. The passes that draw inside that pass's render pass bind it the same way.
pub(crate) fn bind_frame_group(
    list: &mut DrawList,
    group: u32,
    offsets: &[u32],
) -> Result<(), RecordError> {
    let mut words = [0; 5];
    let len = 3 + offsets.len();
    words[1] = group;
    words[2] = offsets.len() as u32;
    words[3..len].copy_from_slice(offsets);
    list.push(Op::SetBindGroup, &words[..len])?;
    Ok(())
}

/// Writes `value` into four bytes, in the byte order the engine's memory uses.
pub(crate) fn put_u32(bytes: &mut [u8], word: usize, value: u32) {
    bytes[word * 4..word * 4 + 4].copy_from_slice(&value.to_ne_bytes());
}

/// The draw list and the upload arena of each frame parity, and the frames' all-or-nothing rule.
///
/// A frame that fails publishes an empty list, so the thread that draws replays nothing and the
/// canvas keeps the last frame that recorded whole. A failure before the frame recorded any
/// command changed nothing on the GPU, and the next frame tries again. A failure after it recorded
/// commands leaves the builder believing that the GPU holds what the dropped commands would have
/// made, so every later frame fails with the same error until a new GPU device starts afresh.
pub(crate) struct ParityLists {
    lists: [DrawList; 2],
    arenas: [UploadArena; 2],
    /// The error of a frame that failed after it recorded commands.
    halted: Option<RecordError>,
}

impl ParityLists {
    /// Lists with room for `words` words, which grow up to `limit` words.
    pub(crate) fn new(words: usize, limit: usize) -> Self {
        Self {
            lists: [
                DrawList::with_limit(words, limit),
                DrawList::with_limit(words, limit),
            ],
            arenas: [UploadArena::default(), UploadArena::default()],
            halted: None,
        }
    }

    pub(crate) fn list(&self, frame: u32) -> &DrawList {
        &self.lists[(frame & 1) as usize]
    }

    pub(crate) fn arenas_mut(&mut self) -> &mut [UploadArena; 2] {
        &mut self.arenas
    }

    /// Empties the frame parity's list and takes it and its arena out, so the builder can record
    /// with its own state borrowed. [`ParityLists::restore`] puts them back. Fails with the error
    /// that halted the builder, which then records nothing.
    pub(crate) fn take(&mut self, frame: u32) -> Result<(DrawList, UploadArena), RecordError> {
        let parity = (frame & 1) as usize;
        self.lists[parity].clear();
        if let Some(error) = self.halted {
            return Err(error);
        }
        let list = std::mem::replace(&mut self.lists[parity], DrawList::with_capacity(0));
        Ok((list, std::mem::take(&mut self.arenas[parity])))
    }

    /// Puts back the list and the arena that [`ParityLists::take`] took, with the frame's
    /// `result`, which it returns. A failed frame's list goes back empty.
    pub(crate) fn restore(
        &mut self,
        frame: u32,
        mut list: DrawList,
        arena: UploadArena,
        result: Result<bool, RecordError>,
    ) -> Result<bool, RecordError> {
        if let Err(error) = result {
            if !list.is_empty() {
                self.halted = Some(error);
            }
            list.clear();
        }
        let parity = (frame & 1) as usize;
        self.lists[parity] = list;
        self.arenas[parity] = arena;
        result
    }

    /// Lets frames record again on a new GPU device, which the builder fills from the start.
    pub(crate) fn reset_gpu(&mut self) {
        self.halted = None;
    }
}

/// Where a frame builder keeps the material table on the GPU.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MaterialStorage {
    /// A storage buffer of rows, and a data texture of the custom values with one row of texels
    /// per material, by their ids: the WebGPU path.
    Buffer { table: u32, values: u32 },
    /// A data texture with one row of texels per material, then one per material's custom
    /// values, by texture id: the WebGL2 path.
    Texture(u32),
}

/// The lights, the background and the fog.
#[derive(Clone, Copy, Debug)]
struct Lighting {
    sun_direction: [f32; 4],
    sun_color: [f32; 4],
    ambient: [f32; 4],
    /// The light that the hemisphere lights add along each world axis, as the frame's uniform
    /// holds it.
    hemisphere: [[f32; 4]; 3],
    /// The main directional light's shadows, or `None` when it casts none.
    sun_shadow: Option<SunShadow>,
    shadow_quality: ShadowQuality,
    /// Linear background color, or `None` before the sketch sets one.
    background: Option<[f32; 3]>,
    fog: Option<Fog>,
}

/// How frames reach the canvas, fixed when the builder starts: the target that scene passes draw
/// into, the anti-aliasing mode, and whether the canvas is transparent.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CanvasOutput {
    pub scene_color: SceneColor,
    /// How the scene's edges are smoothed, which sets the samples of its color and depth targets.
    pub antialias: Antialias,
    /// True when the canvas shows the page behind it where nothing draws: it holds premultiplied
    /// alpha, and it stays clear until the sketch sets a background.
    pub transparent: bool,
}

/// What the sketch sets and changes rarely: meshes, materials, textures, the views, the lights, the
/// fog and the output settings.
pub struct SceneSettings {
    meshes: MeshStorage,
    materials: MaterialTable,
    textures: TextureStore,
    /// The bind group of each material's maps, by material id, for the standard materials with a
    /// live map and the custom materials with textures, and 0 for the others.
    map_groups: Vec<u32>,
    /// The units that a standard material's maps share, or 0 where each map slot has a binding
    /// of its own (see [`SceneSettings::share_map_units`]).
    shared_map_units: usize,
    /// Scratch marks of the material ids that objects and batches use, for the release of
    /// destroyed materials' ids.
    used_materials: Vec<bool>,
    /// What the camera's view draws behind every object, over the background color.
    background: Option<Background>,
    /// The views, the camera's first.
    views: Vec<View>,
    /// The names that each view gives the render graph, by view.
    view_names: Vec<ViewNames>,
    lighting: Lighting,
    /// Which shadow cascades draw in each frame, and what the shadow map's layers hold.
    shadow_schedule: CascadeSchedule,
    /// How the cascades' shadow map stores depth.
    cascade_depth: CascadeDepth,
    /// The casters that move in every frame, which keep far cascades drawing.
    moving_casters: MovingCasters,
    canvas: CanvasOutput,
    output: Output,
    /// Bloom's settings while the sketch turns it on.
    bloom: Option<Bloom>,
    /// The size of bloom's base, which the quality settings set, and the governor's halvings of it.
    bloom_chain: ChainFrame,
    /// The most morph weights of each object that a builder whose vertex shaders morph keeps.
    morph_cap: u32,
    /// Ambient occlusion's settings while the sketch turns it on.
    ao: Option<Ao>,
    /// The size of ambient occlusion's targets, as a share of the render size each way, which the
    /// quality settings set: 0 draws none.
    ao_scale: f32,
    /// Depth of field's settings while the sketch turns it on.
    dof: Option<Dof>,
    /// The taps of depth of field's gather, which the quality settings set.
    dof_taps: u32,
    /// The color grading table while the sketch sets one.
    lut: Option<Lut>,
    /// The vignette while the sketch turns it on.
    vignette: Option<Vignette>,
    /// The scene's environment while the sketch sets one.
    environment: Option<Environment>,
    /// The environment maps of the scene's sky.
    sky_maps: SkyMaps,
    /// The outline's settings while the sketch turns it on.
    outline: Option<Outline>,
    /// The sketch's custom effects, in the order they run.
    effects: Vec<Effect>,
    /// How the sketch joins its effects into groups and folds them into the final pass.
    effect_joins: EffectJoins,
    /// The first template of the sketch's custom tone curve, while it sets one.
    tone_curve: Option<u32>,
    /// The sketch time in seconds, the seconds since the frame before, and the frame's number as
    /// the bits of a `u32`, as the frame uniform holds them.
    clock: [f32; 4],
    /// True when the render scale may drop below the whole canvas.
    render_scaling: bool,
    /// Device pixels per CSS pixel, which size sprites given in pixels of the screen.
    pixel_ratio: f32,
    /// How the point and spot lights' shadow atlas is set up.
    tiles: TileSettings,
    /// The materials' shading, or a debug view in its place.
    debug_view: DebugView,
    /// The camera object and lens that fit the main directional light's cascades in place of the
    /// camera's view, for the debug API's shadow camera.
    shadow_camera: Option<(Handle, Lens)>,
    /// How many times the targets of mirror views without a size of their own halve the render
    /// size, which the quality settings set.
    mirror_halvings: u8,
}

impl SceneSettings {
    /// Settings with no scene content yet, whose cascades' shadow map stores `cascade_depth`.
    pub fn new(
        meshes: MeshStorage,
        max_materials: u32,
        textures: TextureStore,
        canvas: CanvasOutput,
        cascade_depth: CascadeDepth,
    ) -> Self {
        Self {
            meshes,
            materials: MaterialTable::with_capacity(max_materials),
            textures,
            map_groups: Vec::new(),
            shared_map_units: 0,
            used_materials: Vec::new(),
            background: None,
            views: vec![View::default()],
            view_names: vec![ViewNames::default()],
            lighting: Lighting {
                sun_direction: [0.0, -1.0, 0.0, 0.0],
                sun_color: [0.0; 4],
                ambient: [0.0; 4],
                hemisphere: [[0.0; 4]; 3],
                sun_shadow: None,
                shadow_quality: ShadowQuality::default(),
                background: None,
                fog: None,
            },
            shadow_schedule: CascadeSchedule::default(),
            cascade_depth,
            moving_casters: MovingCasters::default(),
            canvas,
            output: Output::default(),
            bloom: None,
            bloom_chain: ChainFrame::default(),
            morph_cap: u32::MAX,
            ao: None,
            ao_scale: ao::MAX_SCALE,
            dof: None,
            dof_taps: dof::TAP_COUNTS[1],
            lut: None,
            vignette: None,
            environment: None,
            sky_maps: SkyMaps::default(),
            outline: None,
            effects: Vec::with_capacity(MAX_EFFECTS),
            effect_joins: EffectJoins::default(),
            tone_curve: None,
            clock: [0.0; 4],
            render_scaling: false,
            pixel_ratio: 1.0,
            tiles: TileSettings::default(),
            debug_view: DebugView::Lit,
            shadow_camera: None,
            mirror_halvings: 1,
        }
    }

    /// Makes the standard material's maps share the first `units` bindings of their bind group,
    /// as WebGL2's standard material samples them: maps whose textures share an array and a
    /// sampler share a unit, and each map's layer in its material's row names its unit.
    pub fn share_map_units(&mut self, units: usize) {
        self.shared_map_units = units;
    }

    /// The frame's clock: the sketch time and the seconds since the frame before, in seconds,
    /// and the frame's number.
    pub fn set_clock(&mut self, time: f32, delta: f32, frame: u32) {
        self.clock = [time, delta, f32::from_bits(frame), 0.0];
    }

    /// How frames reach the canvas.
    pub fn canvas(&self) -> CanvasOutput {
        self.canvas
    }

    /// Takes a new scene color and anti-aliasing mode, with the canvas's transparency, and returns
    /// how frames reach the canvas now.
    pub(crate) fn switch_canvas(
        &mut self,
        scene_color: SceneColor,
        antialias: Antialias,
    ) -> CanvasOutput {
        self.canvas = CanvasOutput {
            scene_color,
            antialias,
            ..self.canvas
        };
        self.canvas
    }

    /// The exposure and the tone mapping.
    pub fn output(&self) -> Output {
        self.output
    }

    /// The exposure and the tone mapping that frames draw with: none in a debug view, whose
    /// colors reach the canvas as its shader writes them.
    pub fn drawn_output(&self) -> Output {
        if self.debug_view.is_debug() {
            Output {
                tone_mapping: ToneMapping::None,
                exposure: 1.0,
            }
        } else {
            self.output
        }
    }

    /// The materials' shading, or the debug view that draws in its place.
    pub fn debug_view(&self) -> DebugView {
        self.debug_view
    }

    /// Draws the scene with a debug view, or with its materials with `DebugView::Lit`, from the
    /// next rebuild of the draw tables on. The wireframe view draws each mesh part's edge list,
    /// which the meshes keep from the first time it is asked for. Returns true when the view
    /// changed, so the caller rebuilds the draw tables.
    pub fn set_debug_view(&mut self, view: DebugView) -> bool {
        if view == self.debug_view {
            return false;
        }
        self.debug_view = view;
        self.meshes.draw_edges(view == DebugView::Wireframe);
        true
    }

    /// Sets the exposure and the tone mapping, from the next recorded frame on.
    pub fn set_output(&mut self, output: Output) {
        self.output = output;
    }

    /// Bloom's settings while it is on, and `None` while it is off or a debug view draws, whose
    /// colors reach the canvas as its shader writes them.
    pub fn bloom(&self) -> Option<Bloom> {
        self.bloom.filter(|_| !self.debug_view.is_debug())
    }

    /// Turns bloom on with its settings, or off with `None`, from the next recorded frame on.
    pub fn set_bloom(&mut self, bloom: Option<Bloom>) {
        self.bloom = bloom;
    }

    /// The custom effects that run, in order, and none while a debug view draws, whose colors
    /// reach the canvas as its shader writes them.
    pub fn effects(&self) -> &[Effect] {
        if self.debug_view.is_debug() {
            return &[];
        }
        &self.effects
    }

    /// Sets the custom effect at place `index` in the order they run, from the next recorded frame
    /// on: a new effect at the end, or a new template or new uniforms at a place that has one.
    /// `None` removes the effect at `index` and every one after it. Places past the end, and past
    /// [`MAX_EFFECTS`], change nothing.
    pub fn set_effect(&mut self, index: usize, effect: Option<Effect>) {
        match effect {
            Some(effect) if index < self.effects.len() => self.effects[index] = effect,
            Some(effect) if index == self.effects.len() && index < MAX_EFFECTS => {
                self.effects.push(effect);
            }
            Some(_) => {}
            None => self.effects.truncate(index),
        }
    }

    /// How the sketch joins its effects.
    pub(crate) fn effect_joins(&self) -> &EffectJoins {
        &self.effect_joins
    }

    /// Makes the `length` effects from place `place` on draw as one group with the joined shader
    /// of template `template`, from the next recorded frame on, once its pipeline is built. A
    /// template of 0 ends the group that starts there. Places past [`MAX_EFFECTS`] change nothing.
    pub fn set_effect_group(&mut self, place: usize, length: usize, template: u32) {
        if let Some(group) = self.effect_joins.groups.get_mut(place) {
            *group = if template == 0 {
                (0, 0)
            } else {
                (length.min(MAX_EFFECTS) as u8, template)
            };
        }
    }

    /// Folds the effects from place `first` on into the final pass, with the final pass's fold
    /// build of template `template`, from the next recorded frame on, while nothing reads the image
    /// between them and the pass. A template of 0 folds none.
    pub fn set_effect_fold(&mut self, first: usize, template: u32) {
        self.effect_joins.fold =
            (template != 0 && first < MAX_EFFECTS).then_some((first as u8, template));
    }

    /// The first template of the custom tone curve, while the sketch sets one and no debug view
    /// draws.
    pub(crate) fn tone_curve(&self) -> Option<u32> {
        self.tone_curve.filter(|_| !self.debug_view.is_debug())
    }

    /// Makes the final pass map HDR color with the custom tone curve whose builds take the
    /// templates from `template` on, or with the built-in curves with `None`, from the next
    /// recorded frame on.
    pub fn set_tone_curve(&mut self, template: Option<u32>) {
        self.tone_curve = template;
    }

    /// True when a custom effect, a group of joined effects, the fold into the final pass or the
    /// custom tone curve draws with pipelines of `template`.
    fn post_uses_template(&self, template: u32) -> bool {
        let joins = &self.effect_joins;
        self.effects
            .iter()
            .any(|effect| effect.template == template)
            || joins.groups.iter().any(|&(_, group)| group == template)
            || joins.fold.is_some_and(|(_, fold)| fold == template)
            || self
                .tone_curve
                .is_some_and(|curve| (curve..curve + 2).contains(&template))
    }

    /// The sketch time and the seconds since the frame before.
    pub(crate) fn clock_seconds(&self) -> [f32; 2] {
        [self.clock[0], self.clock[1]]
    }

    /// The size of bloom's base and the governor's halvings of it.
    pub(crate) fn bloom_chain(&self) -> ChainFrame {
        self.bloom_chain
    }

    /// Gives bloom's chain a base of `size` texels on the canvas's short side, a power of two from
    /// [`crate::bloom::MIN_SIZE`] to [`crate::bloom::MAX_SIZE`], halved `halvings` times during
    /// play, from the next recorded frame on. A new size makes the chain's targets again; the
    /// halvings make no GPU object. Either way the glow keeps its size.
    pub fn set_bloom_chain(&mut self, size: u32, halvings: u32) {
        let size = size.clamp(crate::bloom::MIN_SIZE, crate::bloom::MAX_SIZE);
        self.bloom_chain = ChainFrame {
            size: 1 << size.ilog2(),
            halvings: halvings.min(crate::bloom::LEVELS as u32 - 1),
        };
    }

    /// The most morph weights of each object that a builder whose vertex shaders morph keeps.
    pub fn morph_cap(&self) -> u32 {
        self.morph_cap
    }

    /// Keeps the `cap` largest morph weights of each object where vertex shaders morph, from the
    /// next recorded frame on, and drops the others' targets (see [`crate::morph::cap_weights`]).
    pub fn set_morph_cap(&mut self, cap: u32) {
        self.morph_cap = cap;
    }

    /// Ambient occlusion's settings while it draws: while the sketch turns it on, its scale is
    /// above 0, and no debug view draws.
    pub fn ao(&self) -> Option<Ao> {
        self.ao
            .filter(|_| self.ao_scale > 0.0 && !self.debug_view.is_debug())
    }

    /// Turns ambient occlusion on with its settings, or off with `None`, from the next recorded
    /// frame on.
    pub fn set_ao(&mut self, ao: Option<Ao>) {
        self.ao = ao;
    }

    /// The size of ambient occlusion's targets, as a share of the render size each way.
    pub fn ao_scale(&self) -> f32 {
        self.ao_scale
    }

    /// Sets the size of ambient occlusion's targets, from 0, which draws none, to
    /// [`ao::MAX_SCALE`], from the next recorded frame on. A scale above 0 draws a corner of the
    /// same targets, so it makes no GPU object.
    pub fn set_ao_scale(&mut self, scale: f32) {
        self.ao_scale = scale.clamp(0.0, ao::MAX_SCALE);
    }

    /// Depth of field's settings while it draws: while the sketch turns it on, its gather has taps,
    /// and no debug view draws.
    pub fn dof(&self) -> Option<Dof> {
        self.dof
            .filter(|_| self.dof_taps > 0 && !self.debug_view.is_debug())
    }

    /// Turns depth of field on with its settings, or off with `None`, from the next recorded frame
    /// on.
    pub fn set_dof(&mut self, dof: Option<Dof>) {
        self.dof = dof;
    }

    /// Sets the taps of depth of field's gather, one of [`dof::TAP_COUNTS`] or 0, which draws none,
    /// from the next recorded frame on. A count above 0 changes only the gather's block, so it
    /// makes no GPU object.
    pub fn set_dof_taps(&mut self, taps: u32) {
        self.dof_taps = taps;
    }

    /// What depth of field draws with in a frame of `scene`'s positions of `parity`, for the
    /// camera's view of a canvas of `canvas` pixels, or `None` while it is off or without a camera.
    /// With a focus point, the focus is the point's distance along the camera's view in this frame,
    /// so the focus follows the camera and the point. Without a focal length, the lens takes the
    /// camera's field of view on a full-frame sensor, or 50 mm for an orthographic camera.
    pub(crate) fn dof_frame(
        &self,
        scene: &SceneStorage,
        parity: usize,
        canvas: (u32, u32),
    ) -> Option<DofFrame> {
        let settings = self.dof()?;
        let view = self.views.first()?;
        let (_, lens) = view.camera()?;
        let (_, inverse_projection) = self.camera_projection(canvas)?;
        let aspect = canvas.0 as f32 / canvas.1.max(1) as f32;
        let camera = view.transform(scene, parity, aspect)?;
        let focus = match settings.focus_point {
            Some(point) => {
                let at = camera.cell.absolute();
                let row = camera.depth.row;
                (0..3).fold(row[3], |sum, k| sum + row[k] * (point[k] - at[k]) as f32)
            }
            None => settings.focus_distance,
        };
        let focal_length = match (settings.focal_length, lens) {
            (mm, _) if mm > 0.0 => mm,
            (_, Lens::Perspective(lens)) => dof::focal_length_of_fov(lens.fov_degrees),
            (_, Lens::Orthographic(_)) => 50.0,
        };
        Some(DofFrame {
            dof: settings,
            lens: dof::Lens::new(focal_length, settings.aperture, focus),
            near: camera.depth.near,
            far: camera.depth.far,
            inverse_projection,
            taps: self.dof_taps,
        })
    }

    /// The camera's projection for a canvas of `canvas` pixels, and its inverse, or `None` without
    /// a camera.
    pub(crate) fn camera_projection(&self, canvas: (u32, u32)) -> Option<(Mat4, Mat4)> {
        let (_, lens) = self.views.first()?.camera()?;
        let aspect = canvas.0 as f32 / canvas.1.max(1) as f32;
        let projection = lens.projection(aspect);
        Some((projection, crate::camera::invert(&projection)?))
    }

    /// Grades the canvas color with a color grading table, or with none with `None`, from the next
    /// recorded frame on. A table that is not live, or whose texels are not on the GPU yet, grades
    /// nothing.
    pub fn set_lut(&mut self, lut: Option<Lut>) {
        self.lut = lut;
    }

    /// Turns the vignette on with its settings, or off with `None`, from the next recorded frame
    /// on.
    pub fn set_vignette(&mut self, vignette: Option<Vignette>) {
        self.vignette = vignette;
    }

    /// Lights the scene with an environment, or with none, from the next recorded frame on.
    pub fn set_environment(&mut self, environment: Option<Environment>) {
        self.environment = environment;
    }

    /// The environment maps of the scene's sky.
    pub fn sky_maps(&self) -> &SkyMaps {
        &self.sky_maps
    }

    pub fn sky_maps_mut(&mut self) -> &mut SkyMaps {
        &mut self.sky_maps
    }

    /// The GPU id of the environment's cube texture, once its texels are on the GPU, or `blank`
    /// while the scene has no environment to draw, with the environment's part of the frame
    /// uniform, whose intensity takes the frame's exposure. A frame builder asks after the frame's
    /// uploads, so a held frame, which uploads everything, draws with the environment.
    pub(crate) fn environment_map(&self, blank: u32) -> (u32, EnvironmentUniform) {
        let ready = self.environment.and_then(|environment| {
            Some((environment, self.textures.ready_cube(environment.texture)?))
        });
        match ready {
            Some((mut environment, (map, levels))) => {
                if let Some(sh) = self.sky_maps.sh(environment.texture) {
                    environment.sh = sh;
                }
                (
                    map,
                    environment.uniform(levels, self.drawn_output().exposure),
                )
            }
            None => (blank, EnvironmentUniform::default()),
        }
    }

    /// The outline's settings while it is on, with its width in pixels of the canvas, and `None`
    /// while it is off or a debug view draws, whose colors reach the canvas as its shader writes
    /// them.
    pub fn outline(&self) -> Option<Outline> {
        self.outline
            .filter(|_| !self.debug_view.is_debug())
            .map(|outline| outline.on_canvas(self.pixel_ratio))
    }

    /// Turns outlines on with their settings, or off with `None`, from the next recorded frame on.
    /// They draw around the objects whose outlined flag is set.
    pub fn set_outline(&mut self, outline: Option<Outline>) {
        self.outline = outline;
    }

    /// True while the sketch sets a color grading table or the vignette, outside a debug view,
    /// whose colors reach the canvas as its shader writes them. The final pass then runs on every
    /// path.
    pub(crate) fn grades(&self) -> bool {
        (self.lut.is_some() || self.vignette.is_some()) && !self.debug_view.is_debug()
    }

    /// What the final pass grades the frame with: the table once its texels are on the GPU, and
    /// the vignette. Nothing in a debug view.
    pub(crate) fn grading(&self) -> Grading {
        if self.debug_view.is_debug() {
            return Grading::default();
        }
        let lut = self.lut.and_then(|lut| {
            let (texture, size) = self.textures.ready_volume(lut.texture)?;
            let (scale, offset) = lut.placement(size);
            Some((texture, scale, offset))
        });
        Grading {
            lut,
            vignette: self.vignette,
        }
    }

    /// True when the render scale may drop below the whole canvas.
    pub fn render_scaling(&self) -> bool {
        self.render_scaling
    }

    /// Says whether the render scale may drop below the whole canvas. Where the scene color holds
    /// 8-bit display color, a scale below it needs the final pass, which then replaces the
    /// resolve into the canvas. Frames at a lower scale while this is off draw the whole canvas.
    pub fn set_render_scaling(&mut self, scaling: bool) {
        self.render_scaling = scaling;
    }

    /// Sets the device pixels per CSS pixel that the canvas draws with. A ratio that is not a
    /// positive number counts as 1.
    pub fn set_pixel_ratio(&mut self, ratio: f32) {
        self.pixel_ratio = if ratio > 0.0 && ratio.is_finite() {
            ratio
        } else {
            1.0
        };
    }

    /// How the point and spot lights' shadow atlas is set up.
    pub fn tile_settings(&self) -> TileSettings {
        self.tiles
    }

    /// Sets up the point and spot lights' shadow atlas, from the next recorded frame on. A new
    /// setting makes the atlas again, so every tile draws again.
    pub fn set_tile_settings(&mut self, tiles: TileSettings) {
        self.tiles = TileSettings {
            tiles: tiles.tiles.min(MAX_TILES as u32),
            ..tiles
        };
    }

    pub fn meshes(&self) -> &MeshStorage {
        &self.meshes
    }

    /// Mesh storage; a new mesh's engine id is its storage id plus one.
    pub fn meshes_mut(&mut self) -> &mut MeshStorage {
        &mut self.meshes
    }

    pub fn materials(&self) -> &MaterialTable {
        &self.materials
    }

    /// The material table; a material's engine id is its table id plus one.
    pub fn materials_mut(&mut self) -> &mut MaterialTable {
        &mut self.materials
    }

    pub fn textures(&self) -> &TextureStore {
        &self.textures
    }

    pub fn textures_mut(&mut self) -> &mut TextureStore {
        &mut self.textures
    }

    /// What the camera's view draws behind every object, or none for the background color alone,
    /// as in every debug view.
    pub fn background(&self) -> Option<Background> {
        self.background.filter(|_| !self.debug_view.is_debug())
    }

    /// Draws `background` behind every object in the camera's view, or only the background color
    /// with none.
    pub fn set_background_source(&mut self, background: Option<Background>) {
        if let Some(Background {
            source: BackgroundSource::Sky(sky),
            ..
        }) = background
        {
            self.sky_maps.set_sky(sky);
        }
        self.background = background;
    }

    /// Records the frame's texture work, writes each map's layer into its material's row when a
    /// map changed, or a texture's layer became ready or stopped drawing, then uploads the rows
    /// that changed into `table`. While the textures near their memory budget, it also reads part
    /// of the scene for the budget's estimate of what each texture needs. Returns true when a map's
    /// bind group was made again, which render bundles that bind it must see.
    pub(crate) fn record_materials(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
        table: MaterialStorage,
    ) -> Result<bool, RecordError> {
        let frame = input.frame;
        if self.textures.needs_estimate()
            && let Some(view) = self.need_view(input)
        {
            self.textures
                .estimate_needs(input.scene, input.batches, &self.materials, &view);
        }
        let remade = self.textures.record(list, frame)?;
        self.sky_maps.record(&self.textures, list)?;
        let layers_changed = self.textures.take_layers_changed();
        let textures = &self.textures;
        self.materials.update_map_layers(
            layers_changed,
            |map| textures.ready_layer(map),
            |map| textures.premultiplied(map),
        );
        if let Some(ids) = self.materials.take_changed() {
            let rows = self.materials.rows(ids.clone());
            write_table_rows(list, arena, table, ids.start, rows)?;
        }
        if let Some(ids) = self.materials.take_values_changed() {
            let values = self.materials.values(ids.clone());
            let (texture, first) = match table {
                MaterialStorage::Buffer { values, .. } => (values, ids.start),
                MaterialStorage::Texture(texture) => {
                    (texture, self.materials.capacity() + ids.start)
                }
            };
            write_table_rows(
                list,
                arena,
                MaterialStorage::Texture(texture),
                first,
                values,
            )?;
        }
        Ok(remade)
    }

    /// What the texture budget's estimate of need reads of the camera's view, or `None` when the
    /// view has no camera.
    fn need_view(&self, input: &FrameInput<'_>) -> Option<NeedView> {
        let (_, lens) = self.views[ViewId::CAMERA.index()].camera()?;
        let parity = input.parity();
        let view = self.view_frame(
            ViewId::CAMERA,
            input.scene,
            parity,
            input.canvas,
            input.render_scale,
        )?;
        Some(NeedView {
            camera: view.camera,
            frustum: view.frustum,
            lens,
            height: input.canvas.1 as f32,
            frame: input.frame,
            parity,
            // Only a 2D background takes a layer that the budget may drop; cube textures keep
            // their levels.
            background: match self.background.map(|b| b.source) {
                Some(BackgroundSource::Texture(texture)) => texture,
                _ => Handle::NONE,
            },
        })
    }

    /// The bind group of the maps that a material draws with through `pipeline`, as
    /// [`SceneSettings::pipeline_of`] chose it, or 0 when that pipeline reads no map.
    pub fn texture_group(&self, material: u32, pipeline: DrawKey) -> u32 {
        match pipeline.template {
            template::INSTANCED_UNLIT_MAP | template::SPRITE_MAP => {
                let map = self.materials.map(material - 1, MapSlot::BaseColor);
                self.textures.group_id(map).unwrap_or(0)
            }
            maps if maps == template::INSTANCED_STANDARD_MAPS || maps >= template::CUSTOM_FIRST => {
                self.map_groups
                    .get(material as usize - 1)
                    .copied()
                    .unwrap_or(0)
            }
            _ => 0,
        }
    }

    /// True when a material has a map in any slot whose texture lives.
    fn has_live_map(&self, id: u32) -> bool {
        self.materials
            .maps(id)
            .iter()
            .any(|&map| self.textures.is_live(map))
    }

    /// Gets the materials ready for a rebuild of the draw tables. Destroyed materials that no
    /// object or batch names give their ids back, and the pipelines of custom templates that no
    /// live material draws with are released. Then each material that samples maps finds its bind
    /// group: a standard material with a live map, and a custom material with textures, whose
    /// slots without a texture bind a white texel. A texture that moves to another array changes
    /// its material's group, and such a move comes with a rebuild.
    pub(crate) fn prepare_rebuild(
        &mut self,
        scene: &SceneStorage,
        batches: &BatchTable,
        pipelines: &mut PipelineCache,
    ) {
        let count = self.materials.len();
        if self.materials.has_destroyed() {
            let used = &mut self.used_materials;
            used.clear();
            used.resize(count as usize, false);
            let named = scene
                .materials()
                .iter()
                .copied()
                .chain(batches.iter().map(|(_, batch)| batch.material()));
            for material in named {
                if let Some(mark) = material
                    .checked_sub(1)
                    .and_then(|id| used.get_mut(id as usize))
                {
                    *mark = true;
                }
            }
            self.materials
                .release_unused(|id| used.get(id as usize).copied().unwrap_or(false));
            let (materials, post) = (&self.materials, &*self);
            // Effects, their joined shaders and the tone curve take templates of the same range
            // as custom materials, so a template that they use stays.
            pipelines.release(|template| {
                materials.custom_template_unused(template) && !post.post_uses_template(template)
            });
        }
        self.map_groups.resize(count as usize, 0);
        for id in 0..count {
            let shading = self.materials.shading(id);
            let samples = match shading {
                Ok(Shading::Lit) => self.has_live_map(id),
                Ok(Shading::Custom(custom)) => custom.textures > 0,
                _ => false,
            };
            let maps = self.materials.maps(id);
            self.map_groups[id as usize] = if !samples {
                0
            } else if matches!(shading, Ok(Shading::Lit)) && self.shared_map_units > 0 {
                let (group, units) = self
                    .textures
                    .shared_map_group(&maps, self.shared_map_units)
                    .unwrap_or((0, [None; MAP_SLOTS]));
                self.materials
                    .set_map_units(id, units.map(|unit| unit.unwrap_or(NO_UNIT)));
                group
            } else {
                self.textures.map_set_group(&maps).unwrap_or(0)
            };
        }
    }

    /// The camera the canvas shows the scene from: a scene object, and its lens.
    pub fn set_camera(&mut self, camera: Handle, lens: impl Into<Lens>) {
        self.views[ViewId::CAMERA.index()].set_camera(camera, lens.into());
    }

    /// Fits the main directional light's cascades to `camera`, a camera object with its lens, in
    /// place of the camera's view, or to the camera's view again with `None`. The camera's view
    /// still draws the frame, so it can watch the cascades from elsewhere. A camera object that
    /// no longer exists leaves the cascades to the camera's view.
    pub fn set_shadow_camera(&mut self, camera: Option<(Handle, Lens)>) {
        self.shadow_camera = camera;
    }

    /// Sets the layers of the objects a view draws. A change needs no rebuild of the draw
    /// tables: culling tests the view's mask every frame.
    pub fn set_layers(&mut self, view: ViewId, mask: u32) {
        if let Some(view) = self.views.get_mut(view.index()) {
            view.set_layers(mask);
        }
    }

    /// Adds a view that draws the scene into a target of its own, with the engine's names, or
    /// returns `None` when the builder already draws [`MAX_VIEWS`] views.
    pub fn add_view(&mut self, view: View) -> Option<ViewId> {
        self.add_named_view(view, ViewNames::default())
    }

    /// Adds a view that draws the scene into a target of its own, with `names` in the render
    /// graph, in the place of the first removed view or after the last. Returns `None` when the
    /// builder already draws [`MAX_VIEWS`] views.
    pub fn add_named_view(&mut self, view: View, names: ViewNames) -> Option<ViewId> {
        let place = match self.views.iter().skip(1).position(View::is_removed) {
            Some(place) => place + 1,
            None if self.views.len() < MAX_VIEWS => {
                self.views.push(View::removed());
                self.view_names.push(ViewNames::default());
                self.views.len() - 1
            }
            None => return None,
        };
        self.views[place] = view;
        self.view_names[place] = names;
        self.link_view_reads();
        Some(ViewId::from_index(place))
    }

    /// Removes a view other than the camera's. Its place draws nothing until the next view added
    /// takes it, so the places of the other views stay.
    pub fn remove_view(&mut self, view: ViewId) {
        if view == ViewId::CAMERA || view.index() >= self.views.len() {
            return;
        }
        self.views[view.index()] = View::removed();
        self.view_names[view.index()] = ViewNames::default();
        self.link_view_reads();
    }

    /// Finds the views whose targets each view reads, by the names of their targets. A name that
    /// no view's target has reaches the render graph, which fails to compile on it.
    fn link_view_reads(&mut self) {
        for index in 0..self.views.len() {
            let reads = self.view_names[index]
                .reads
                .iter()
                .filter_map(|name| {
                    self.view_names
                        .iter()
                        .zip(&self.views)
                        .position(|(other, view)| !view.is_removed() && other.target == *name)
                })
                .fold(0, |mask, place| mask | (1 << place));
            self.views[index].target_mut().reads = reads;
        }
    }

    /// Sets the camera object and the lens that a view draws from.
    pub fn set_view_camera(&mut self, view: ViewId, camera: Handle, lens: impl Into<Lens>) {
        if let Some(view) = self.views.get_mut(view.index()) {
            view.set_camera(camera, lens.into());
        }
    }

    /// Sets how many times the targets of mirror views without a size of their own halve the
    /// render size, from the next frame on.
    pub fn set_mirror_halvings(&mut self, halvings: u8) {
        self.mirror_halvings = halvings;
    }

    /// Moves the views on to the next frame: each mirror view takes the camera's layers unless it
    /// has its own, and the preset's size unless it has its own, and each view that draws once in
    /// several frames moves its turn on. A builder calls it once per frame, before it syncs its
    /// graph with the views.
    pub(crate) fn pace_views(&mut self) {
        let camera_layers = self.views[ViewId::CAMERA.index()].layers();
        let halvings = self.mirror_halvings;
        for view in self.views.iter_mut().skip(1) {
            view.follow_camera(halvings, camera_layers);
            view.target_mut().pace();
        }
    }

    /// True when a view draws the scene's background behind its objects: the camera's view, and
    /// each mirror view, whose image shows the sky as a mirror does.
    pub(crate) fn draws_background(&self, view: ViewId) -> bool {
        view == ViewId::CAMERA
            || self
                .views
                .get(view.index())
                .is_some_and(|view| view.mirrored().is_some())
    }

    /// Switches a view other than the camera's on or off. A view switched off keeps the last
    /// image it drew.
    pub fn set_view_enabled(&mut self, view: ViewId, enabled: bool) {
        if let Some(view) = self.views.get_mut(view.index()) {
            view.target_mut().enabled = enabled;
        }
    }

    /// Marks each view's target shown while a live texture shows it, so the camera's passes read
    /// it. A builder calls it before it syncs its graph with the views.
    pub(crate) fn mark_shown_views(&mut self) {
        let shown = self.textures.shown_views();
        for (index, view) in self.views.iter_mut().enumerate().skip(1) {
            view.target_mut().shown = shown & (1 << index) != 0;
        }
    }

    /// Gives the textures that show views' targets the GPU id of each target, by `target_of`, once
    /// the frame's graph made its textures. With `remade`, the graph made its textures again.
    pub(crate) fn set_view_targets(
        &mut self,
        target_of: impl Fn(ViewId) -> Option<u32>,
        remade: bool,
    ) {
        for index in 1..self.views.len() {
            let view = ViewId::from_index(index);
            self.textures
                .set_pass_target(index as u32, target_of(view), remade);
        }
    }

    /// True when a view may draw in the next frame: the camera's view, and any other view that is
    /// switched on while a texture shows its target or another view reads it. The render graph
    /// culls the rest, so a builder need not cull them.
    pub fn view_draws(&self, view: ViewId) -> bool {
        if view == ViewId::CAMERA {
            return true;
        }
        let Some(drawn) = self.views.get(view.index()) else {
            return false;
        };
        let bit = 1 << view.index();
        let read = self
            .views
            .iter()
            .any(|other| !other.is_removed() && other.target().reads & bit != 0);
        !drawn.is_removed()
            && drawn.target().draws()
            && (self.textures.shown_views() & bit != 0 || read)
    }

    /// The views whose targets each view may not show, as a mask of view places, by view: for a
    /// view other than the camera's, every view whose target it does not read, itself included.
    /// The camera's view may show every target.
    pub fn hidden_targets(&self, view: ViewId) -> u32 {
        match self.views.get(view.index()) {
            Some(other) if view != ViewId::CAMERA && view.is_camera() => !other.target().reads,
            _ => 0,
        }
    }

    /// The views, the camera's first.
    pub fn views(&self) -> &[View] {
        &self.views
    }

    /// The names that each view gives the render graph, by view.
    pub fn view_names(&self) -> &[ViewNames] {
        &self.view_names
    }

    /// The directional light: the direction its light travels, and its exposed color: its linear
    /// color times its intensity and the exposure.
    pub fn set_sun(&mut self, direction: [f32; 3], color: [f32; 3]) {
        self.lighting.sun_direction = normalized_direction(direction);
        self.lighting.sun_color = [color[0], color[1], color[2], 0.0];
    }

    /// The ambient light's exposed color: its linear color times its intensity and the exposure.
    pub fn set_ambient(&mut self, color: [f32; 3]) {
        self.lighting.ambient = [color[0], color[1], color[2], 0.0];
    }

    /// The exposed light that the hemisphere lights add along each world axis, x, y and z (see
    /// [`null3d_core::lights::FrameLights::hemisphere`]). Their part that every direction gets
    /// belongs in the ambient light.
    pub fn set_hemisphere(&mut self, axes: [[f32; 3]; 3]) {
        self.lighting.hemisphere = axes.map(|[r, g, b]| [r, g, b, 0.0]);
    }

    /// Gathers the lights of the frame whose world output is `parity`'s for the camera's view
    /// (see [`LightTable::gather`]), after the transform update and before the frame records. The
    /// main directional light, the ambient lights and the hemisphere lights become the light the
    /// shaders read, and the light table's visible list holds the point and spot lights the camera
    /// sees. Every light's color takes the exposure that frames draw with.
    pub fn gather_lights(
        &mut self,
        lights: &mut LightTable,
        scene: &SceneStorage,
        parity: usize,
        canvas: (u32, u32),
    ) {
        let view = self
            .view_frame(ViewId::CAMERA, scene, parity, canvas, RenderScale::FULL)
            .map(|frame| LightView {
                camera: frame.camera,
                frustum: frame.frustum,
                layers: frame.layers,
            });
        let lit = lights.gather(scene, parity, view.as_ref(), self.drawn_output().exposure);
        self.set_sun(lit.sun_direction, lit.sun_color);
        self.set_ambient(lit.ambient);
        self.set_hemisphere(lit.hemisphere);
        self.set_sun_shadow(lit.sun_shadow);
    }

    /// The main directional light's shadows, or `None` when it casts none.
    pub fn set_sun_shadow(&mut self, shadow: Option<SunShadow>) {
        self.lighting.sun_shadow = shadow;
    }

    /// The shadow cascades of the main directional light in the last gathered frame, or 0 when it
    /// casts no shadows.
    pub fn sun_shadow_cascades(&self) -> u32 {
        self.lighting.sun_shadow.map_or(0, |shadow| shadow.cascades)
    }

    /// How the cascades' shadow map stores depth.
    pub fn cascade_depth(&self) -> CascadeDepth {
        self.cascade_depth
    }

    /// The shadow filter and how the far cascades update.
    pub fn shadow_quality(&self) -> ShadowQuality {
        self.lighting.shadow_quality
    }

    /// The shadow filter and how the far cascades update, from the next frame on.
    pub fn set_shadow_quality(&mut self, quality: ShadowQuality) {
        self.lighting.shadow_quality = quality;
    }

    /// Forgets what the shadow map's layers hold, so every cascade draws in the next frame with
    /// shadows. A builder calls it when it makes its GPU objects again.
    pub fn forget_shadow_maps(&mut self) {
        self.shadow_schedule.reset();
    }

    /// The main directional light's shadows in the next frame, whose targets have the canvas's
    /// size: its cascades, fitted to the camera's view, with the cascades that draw in this frame,
    /// or `None` when the light casts no shadows or the camera has nothing to draw from. Call it
    /// once per frame, as it moves the cascades' update schedule on.
    pub fn shadow_frame(&mut self, input: &FrameInput<'_>) -> Option<ShadowFrame> {
        let frame = self.fit_shadows(input);
        if frame.is_none() {
            self.shadow_schedule.reset();
            self.moving_casters.forget();
        }
        frame
    }

    fn fit_shadows(&mut self, input: &FrameInput<'_>) -> Option<ShadowFrame> {
        let (scene, parity, canvas) = (input.scene, input.parity(), input.canvas);
        let shadow = self.lighting.sun_shadow?;
        let (camera, lens) = self.views[ViewId::CAMERA.index()].camera()?;
        let slot = scene.resolve(camera).ok()?;
        let (fitter, lens) = self
            .shadow_camera
            .and_then(|(camera, lens)| Some((scene.resolve(camera).ok()?, lens)))
            .unwrap_or((slot, lens));
        let world = scene.world(parity).matrix(fitter as usize);
        let aspect = canvas.0 as f32 / canvas.1.max(1) as f32;
        let quality = self.lighting.shadow_quality;
        let settings = ShadowSettings {
            cascades: shadow.cascades,
            map_size: shadow.map_size,
            bias: shadow.bias,
            normal_bias: shadow.normal_bias,
            distance: shadow.distance,
            filter: quality.filter,
            blend: quality.blend,
        };
        let [x, y, z, _] = self.lighting.sun_direction;
        let position = scene.cell_position(slot, parity);
        let absolute = position.absolute();
        let fitted = scene.cell_position(fitter, parity).absolute();
        let mut cascades = fit_cascades(world, fitted, &lens, aspect, [x, y, z], &settings);
        if fitter != slot {
            cascades.seen_from(fitted, absolute, shadow.map_size);
        }
        let materials = &self.materials;
        self.moving_casters
            .update(scene, input.batches, input.structure_changed, |material| {
                sways(materials, material)
            });
        let moving = &self.moving_casters;
        let drawn = self.shadow_schedule.plan(
            &mut cascades,
            absolute,
            shadow.map_size,
            quality.far_interval,
            |bounds| {
                quality.follow_movers
                    && moving.touch(scene, input.batches, parity, shadow.layers, bounds)
            },
        );
        Some(ShadowFrame {
            cascades,
            settings,
            camera: position,
            layers: shadow.layers,
            drawn,
            depth: self.cascade_depth,
            clock: self.clock,
        })
    }

    /// The pipeline that draws the depth of a shadow caster whose mesh and material draw with
    /// `pipeline`, and the bind group of the map that it reads, or 0 for none: only its back faces,
    /// as three.js draws them with its filtered shadow maps, moved toward the light by part of a
    /// texel, or both faces of a double-sided material, where they stay. The material's depth bias
    /// moves what the camera sees, so the caster draws without it. A masked material of the
    /// engine's mesh templates cuts the holes of its mask, alpha to coverage or alpha hash into its
    /// shadow, with the alpha of its vertex colors and its base color map where it has them. A
    /// custom material's alpha comes from its own WGSL, so it casts its mesh's whole shape. A
    /// custom material with a vertex offset casts with its own template's caster builds
    /// ([`permutation::CASTER`]), which move each vertex by the offset, read the rows' values where
    /// the pair reads them, and bind the material's textures.
    pub fn caster_of(&self, pipeline: DrawKey, material: u32) -> (DrawKey, u32) {
        let (faces, mut permutation) = if pipeline.state & state_flags::CULL_NONE != 0 {
            (state_flags::CULL_NONE, 0)
        } else {
            (state_flags::CULL_FRONT, permutation::CASTER_OFFSET)
        };
        if self.sways(material) && pipeline.template >= template::CUSTOM_FIRST {
            let key = DrawKey {
                template: pipeline.template,
                permutation: permutation
                    | permutation::CASTER
                    | (pipeline.permutation & permutation::ROW_VALUES),
                vertex_format: pipeline.vertex_format,
                state: faces,
                bias: DepthBias::NONE,
            };
            return (key, self.texture_group(material, pipeline));
        }
        let mut template = template::SHADOW_DEPTH;
        let mut group = 0;
        let masked = pipeline.permutation & permutation::ALPHA_MASK != 0;
        if masked && cuts_shadows(pipeline.template) {
            permutation |= permutation::ALPHA_MASK
                | (pipeline.permutation & (permutation::VERTEX_COLOR | permutation::ALPHA_HASH));
            template = template::SHADOW_CUTOUT;
            let map = self.materials.map(material - 1, MapSlot::BaseColor);
            let mapped = pipeline.vertex_format & vertex::UV0 != 0 && self.textures.is_live(map);
            if let Some(id) = self.textures.group_id(map).filter(|_| mapped) {
                template = template::SHADOW_CUTOUT_MAP;
                group = id;
            }
        }
        let key = DrawKey {
            template,
            permutation,
            vertex_format: pipeline.vertex_format,
            state: faces,
            bias: DepthBias::NONE,
        };
        (key, group)
    }

    /// True when the material, by engine id, moves its vertices by a vertex offset of its own WGSL,
    /// which its shadows follow: its casters draw again whenever their shadow maps draw, as moving
    /// casters do.
    pub fn sways(&self, material: u32) -> bool {
        sways(&self.materials, material)
    }

    /// The pipeline that draws an object with `pipeline` where it receives shadows: the same one,
    /// reading the shadow maps where its shading reflects the lights, or shows the shadows in the
    /// shadows debug view. Custom materials light their surfaces as the standard material does, so
    /// they receive shadows too.
    pub fn receiving(&self, pipeline: DrawKey) -> DrawKey {
        if pipeline.template == template::DEBUG_VIEW {
            debug_view::receiving(pipeline)
        } else if debug_view::shades_with_lights(pipeline.template) {
            DrawKey {
                permutation: pipeline.permutation | permutation::RECEIVE_SHADOWS,
                ..pipeline
            }
        } else {
            pipeline
        }
    }

    /// The linear color behind every object. Exposure and tone mapping change it as they change
    /// the objects: the clear color takes the exposure of each frame.
    pub fn set_background(&mut self, color: [f32; 3]) {
        self.lighting.background = Some(color);
    }

    /// The fog that every view's objects take, apart from materials that opt out, or none. The
    /// background takes none.
    pub fn set_fog(&mut self, fog: Option<Fog>) {
        self.lighting.fog = fog;
    }

    /// The color that a view's target clears to: its own color for a view other than the
    /// camera's that has one, else the camera's.
    pub(crate) fn clear_color_of(&self, view: ViewId) -> [f32; 4] {
        match self.views.get(view.index()).and_then(|v| v.target().clear) {
            Some([r, g, b, a]) if view != ViewId::CAMERA => {
                let [r, g, b, _] = self.canvas.scene_color.clear_color(
                    Some([r, g, b]),
                    false,
                    self.drawn_output(),
                );
                [r * a, g * a, b * a, a]
            }
            _ => self.clear_color(),
        }
    }

    /// The color that clears the color targets, as the scene's render passes hold it: black in a
    /// debug view.
    pub(crate) fn clear_color(&self) -> [f32; 4] {
        let background = if self.debug_view.is_debug() {
            Some([0.0; 3])
        } else {
            self.lighting.background
        };
        self.canvas.scene_color.clear_color(
            background,
            self.canvas.transparent,
            self.drawn_output(),
        )
    }

    /// What a mesh and material pair, by engine ids, asks of the pipeline that draws it, or `None`
    /// when the pair draws nowhere: no mesh, no material, an id that names nothing, or a mesh
    /// without the vertex attributes that the material's shading reads. A material whose map is
    /// gone, or whose mesh has no texture coordinates for it, draws with its color alone. A
    /// standard material with a live map draws with the maps template, whose normal map takes its
    /// frame from the mesh's tangents where the mesh has them. A
    /// material with vertex colors reads them only from a mesh that has them, a masked material
    /// draws with the shader variant that discards fragments, with alpha to coverage where the
    /// material asks for it, and a double-sided material culls no faces. The material's depth options and depth bias set the pipeline's depth state, and a
    /// blended material's blending sets its blend state, which draws it in the transparent pass.
    /// A material that lets light through draws with the shader variant that samples the copy of
    /// the opaque objects behind it, in the transparent pass too, where its shading has one.
    /// A debug view replaces the key with its own (see [`DebugView::draw_key`]).
    pub fn pipeline_of(&self, mesh: u32, material: u32) -> Option<DrawKey> {
        self.rows_pipeline_of(mesh, material, false)
    }

    /// What the pair of an instance batch asks of the pipeline that draws its rows: as
    /// [`Self::pipeline_of`] for its mesh and material, with the builds that read each row's color
    /// and values ([`permutation::ROW_VALUES`]) where its rows have them and the shading has such
    /// builds. Those builds test a mask against its cutoff, with neither alpha to coverage nor the
    /// alpha hash, and a pair that lets light through draws its rows without their values.
    pub fn batch_pipeline_of(&self, batch: &InstanceBatch) -> Option<DrawKey> {
        self.rows_pipeline_of(batch.mesh(), batch.material(), batch.has_row_values())
    }

    /// As [`Self::pipeline_of`], with the builds that read row values when `row_values` is set.
    fn rows_pipeline_of(&self, mesh: u32, material: u32, row_values: bool) -> Option<DrawKey> {
        if mesh == NO_MESH || material == NO_MATERIAL {
            return None;
        }
        let format = self.meshes.mesh(mesh - 1)?.format;
        let id = material - 1;
        let mut shading = self.materials.shading(id).ok()?;
        let uv0 = format & vertex::UV0 != 0;
        let live = |slot: MapSlot| self.textures.is_live(self.materials.map(id, slot));
        if shading == Shading::UnlitMap && !(uv0 && live(MapSlot::BaseColor)) {
            shading = Shading::Unlit;
        }
        if shading == Shading::Sprite && live(MapSlot::BaseColor) {
            shading = Shading::SpriteMap;
        }
        if shading == Shading::Lit && uv0 && self.has_live_map(id) {
            shading = Shading::StandardMaps;
        }
        let needs = shading.attributes();
        let features = self.materials.features(id);
        let has = |bit: u32| features & bit != 0;
        let base_color = shading.reads_base_color();
        let vertex_colors = has(feature::VERTEX_COLORS) && format & vertex::COLOR != 0;
        let masked = base_color && feature::masks(features);
        let transmits = has(feature::TRANSMISSION) && shading.transmits();
        let rows = row_values && shading.reads_row_values() && !transmits;
        let own_way = masked && tests_alpha_its_way(shading) && !rows;
        let hashed = own_way && has(feature::ALPHA_HASH);
        let covers = own_way && has(feature::ALPHA_TO_COVERAGE) && !hashed;
        let tangents = shading == Shading::StandardMaps
            && live(MapSlot::Normal)
            && format & vertex::TANGENT != 0;
        let bit = |on: bool, bit: u32| if on { bit } else { 0 };
        let key = ((format & needs) == needs).then_some(DrawKey {
            template: shading.template(),
            permutation: bit(base_color && vertex_colors, permutation::VERTEX_COLOR)
                | bit(masked, permutation::ALPHA_MASK)
                | bit(hashed, permutation::ALPHA_HASH)
                | bit(tangents, permutation::VERTEX_TANGENT)
                | bit(transmits, permutation::TRANSMISSION)
                | bit(rows, permutation::ROW_VALUES),
            vertex_format: format,
            state: bit(has(feature::DOUBLE_SIDED), state_flags::CULL_NONE)
                | bit(has(feature::NO_DEPTH_WRITE), state_flags::NO_DEPTH_WRITE)
                | bit(has(feature::NO_DEPTH_TEST), state_flags::NO_DEPTH_TEST)
                | bit(covers, state_flags::ALPHA_TO_COVERAGE)
                | blend_state(features),
            bias: self.materials.depth_bias(id),
        });
        key.map(|key| self.debug_view.draw_key(key))
    }

    /// A view's values for a frame on a canvas of `canvas` device pixels that the scene draws at
    /// render scale `scale`, or `None` when the view has no camera to draw from. The projection
    /// takes the shape of the view's target, and the target size is the size the view draws at,
    /// which fragment positions count in: the render size for the camera's view. A view with a
    /// target of its own counts a texel as a pixel. Shaders work in positions relative to the
    /// camera, so the constants put a perspective camera at the origin, and an orthographic camera
    /// at infinity behind its view.
    pub fn view_frame(
        &self,
        view: ViewId,
        scene: &SceneStorage,
        parity: usize,
        canvas: (u32, u32),
        scale: RenderScale,
    ) -> Option<ViewFrame> {
        let view_id = view;
        let view = self.views.get(view.index())?;
        let own_target = view_id != ViewId::CAMERA;
        let (width, height) = view.draw_size(canvas, scale);
        let (pixels, pixel_ratio) = match view.target().size {
            Some(size) if own_target => (size, 1.0),
            _ => (canvas, self.pixel_ratio),
        };
        let aspect = pixels.0 as f32 / pixels.1.max(1) as f32;
        let camera = match view.mirrored() {
            Some(mirror) => {
                let (camera, lens) = self.views[ViewId::CAMERA.index()].camera()?;
                mirror.transform(scene, parity, camera, &lens, aspect)?
            }
            None => view.transform(scene, parity, aspect)?,
        };
        let [x, y, z] = camera.cell.absolute().map(|v| v as f32);
        let (width, height) = (width as f32, height as f32);
        let output = self.drawn_output();
        let uniform = FrameUniform {
            view_proj: camera.view_proj,
            camera_position: camera.eye,
            sun_direction: self.lighting.sun_direction,
            sun_color: self.lighting.sun_color,
            ambient: self.lighting.ambient,
            hemisphere: self.lighting.hemisphere,
            output: output.uniform(),
            fog: fog::uniform_of(self.lighting.fog.as_ref(), y, output.exposure),
            clock: self.clock,
            camera_world: [x, y, z, 0.0],
            target_size: [width, height, 1.0 / width, 1.0 / height],
            camera_range: [
                camera.depth.near,
                camera.depth.far,
                2.0 * pixel_ratio / pixels.0.max(1) as f32,
                2.0 * pixel_ratio / pixels.1.max(1) as f32,
            ],
            occlusion: match self.ao() {
                Some(ao) if view_id == ViewId::CAMERA => {
                    ao::frame_values(ao, canvas, scale, self.ao_scale)
                }
                _ => [0.0; 4],
            },
            ..FrameUniform::default()
        };
        Some(ViewFrame::new(
            uniform,
            camera.cell,
            camera.depth,
            view.layers(),
        ))
    }
}

/// True when the material of `materials` with engine id `material` moves its vertices by a vertex
/// offset of its own WGSL, which its shadows follow.
fn sways(materials: &MaterialTable, material: u32) -> bool {
    material != NO_MATERIAL
        && materials
            .shading(material - 1)
            .is_ok_and(Shading::casts_its_own_way)
}

/// Collects the bucket key of every scene slot, shown or hidden, with a count of one, and of every
/// batch, with its row capacity. Sorted, equal keys merge into one entry per bucket, in key order.
/// A slot or batch without a key draws nowhere. Reuses `out`, which grows only with the scene.
pub(crate) fn collect_bucket_keys<K: Ord + Copy>(
    out: &mut Vec<(K, u32)>,
    scene: &SceneStorage,
    batches: &BatchTable,
    scene_key: impl Fn(usize) -> Option<K>,
    batch_key: impl Fn(usize, &InstanceBatch) -> Option<K>,
) {
    let scene_rows = (scene.capacity() + 1) as usize;
    out.clear();
    out.reserve(scene_rows + batches.len() as usize);
    for slot in 0..scene_rows {
        if let Some(key) = scene_key(slot) {
            out.push((key, 1));
        }
    }
    for (index, (_, batch)) in batches.iter().enumerate() {
        if let Some(key) = batch_key(index, batch) {
            out.push((key, batch.capacity()));
        }
    }
    out.sort_unstable_by_key(|&(key, _)| key);
    out.dedup_by(|next, kept| {
        let same = next.0 == kept.0;
        if same {
            kept.1 += next.1;
        }
        same
    });
}

/// The bucket of a key in a table that [`collect_bucket_keys`] made, or `None` for no key.
pub(crate) fn bucket_of<K: Ord + Copy>(table: &[(K, u32)], key: Option<K>) -> Option<u32> {
    let key = key?;
    table
        .binary_search_by_key(&key, |&(k, _)| k)
        .ok()
        .map(|bucket| bucket as u32)
}

/// How large one mesh page's GPU vertex and index buffers are, and how much of the page they hold.
#[derive(Clone, Copy, Debug, Default)]
struct PageBuffers {
    vertex_bytes: u32,
    index_bytes: u32,
    /// The page's vertex bytes that the buffers hold.
    vertices: usize,
    indices: usize,
}

impl PageBuffers {
    /// True when the page outgrew its buffers, so they must be made again and filled whole.
    fn outgrown(&self, page: &Page) -> bool {
        let (vertex_bytes, index_bytes) = page.buffer_bytes();
        vertex_bytes > u64::from(self.vertex_bytes) || index_bytes > u64::from(self.index_bytes)
    }

    /// The bytes that the next upload copies into the arena: the page's data added since the last
    /// one, or the whole page when it outgrew its buffers.
    fn pending_bytes(&self, page: &Page) -> usize {
        let held = if self.outgrown(page) {
            PageBuffers::default()
        } else {
            *self
        };
        (page.vertices.len() - held.vertices)
            + ((page.indices.len() - (held.indices & !1)) * 2).next_multiple_of(4)
    }
}

/// The GPU buffers of the mesh pages: page `p` keeps its vertices in buffer `first_id + 2p` and
/// its indices in the buffer after it. Buffers grow with their pages, with room to spare.
#[derive(Debug)]
pub(crate) struct MeshBuffers {
    first_id: u32,
    pages: Vec<PageBuffers>,
}

impl MeshBuffers {
    pub(crate) fn new(first_id: u32) -> Self {
        Self {
            first_id,
            pages: Vec::new(),
        }
    }

    /// The vertex and index buffer ids of a page.
    pub(crate) fn ids(&self, page: u32) -> (u32, u32) {
        let vertices = self.first_id + 2 * page;
        (vertices, vertices + 1)
    }

    /// The bytes of a page's vertex buffer on the GPU, or 0 before it exists.
    pub(crate) fn vertex_bytes(&self, page: u32) -> u32 {
        self.pages
            .get(page as usize)
            .map_or(0, |buffers| buffers.vertex_bytes)
    }

    /// The most that the next [`MeshBuffers::upload`] copies into the arena.
    pub(crate) fn pending_bytes(&self, pages: &[Page]) -> usize {
        pages
            .iter()
            .enumerate()
            .map(|(p, page)| {
                let buffers = self.pages.get(p).copied().unwrap_or_default();
                buffers.pending_bytes(page)
            })
            .sum()
    }

    /// Uploads the pages' data added since the last upload, from copies in the frame's arena. A
    /// page whose buffers are too small gets new ones, with room to grow, and uploads again whole.
    /// Returns true when it made a buffer again, which a recorded bundle that draws from it must
    /// see. Writes land on four-byte boundaries, so index uploads start at an even index; the index
    /// before the new ones is uploaded again when the last upload ended on an odd one.
    pub(crate) fn upload(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        pages: &[Page],
    ) -> Result<bool, RecordError> {
        let mut remade = false;
        for (p, page) in pages.iter().enumerate() {
            if self.pages.len() <= p {
                self.pages.push(PageBuffers::default());
            }
            let (vertex_id, index_id) = self.ids(p as u32);
            let buffers = &mut self.pages[p];
            if buffers.outgrown(page) {
                let limit = MAX_BUFFER_BYTES as u32;
                let (vertex_bytes, index_bytes) = page.buffer_bytes();
                *buffers = PageBuffers {
                    vertex_bytes: grown_size(vertex_bytes as u32, limit),
                    index_bytes: grown_size(index_bytes as u32, limit),
                    ..PageBuffers::default()
                };
                let copied = buffer_usage::COPY_DST;
                // The skinning pass reads skinned and morphed meshes' vertices as storage.
                let posed = crate::skinning::has_joints(page.format)
                    || crate::morph::has_targets(page.format);
                let read = if posed { buffer_usage::STORAGE } else { 0 };
                list.push(
                    Op::CreateBuffer,
                    &[
                        vertex_id,
                        buffers.vertex_bytes,
                        buffer_usage::VERTEX | copied | read,
                    ],
                )?;
                list.push(
                    Op::CreateBuffer,
                    &[index_id, buffers.index_bytes, buffer_usage::INDEX | copied],
                )?;
                remade = true;
            }
            let new_vertices = &page.vertices[buffers.vertices..];
            if !new_vertices.is_empty() {
                let offset = buffers.vertices as u32;
                let (at, bytes) = arena.push(new_vertices)?;
                list.push(Op::WriteBuffer, &[vertex_id, offset, at, bytes])?;
                buffers.vertices = page.vertices.len();
            }
            if buffers.indices < page.indices.len() {
                let first = buffers.indices & !1;
                let offset = (first * 2) as u32;
                let (at, bytes) = arena.push(indices_as_bytes(&page.indices[first..]))?;
                list.push(Op::WriteBuffer, &[index_id, offset, at, bytes])?;
                buffers.indices = page.indices.len();
            }
        }
        Ok(remade)
    }

    /// Makes the next upload send each page's data again from where a removal of meshes changed
    /// it.
    pub(crate) fn moved(&mut self, moves: &MeshMoves) {
        for &(page, vertices, indices) in &moves.pages {
            if let Some(buffers) = self.pages.get_mut(page as usize) {
                buffers.vertices = buffers.vertices.min(vertices);
                buffers.indices = buffers.indices.min(indices);
            }
        }
    }

    /// The bytes of every page's buffers on the GPU.
    pub(crate) fn gpu_bytes(&self) -> u64 {
        self.pages
            .iter()
            .map(|buffers| u64::from(buffers.vertex_bytes) + u64::from(buffers.index_bytes))
            .sum()
    }

    /// Forgets every buffer, after the thread that draws replaced the GPU, so the next upload
    /// makes each page's buffers again and fills them whole.
    pub(crate) fn forget(&mut self) {
        self.pages.clear();
    }
}

/// True for the templates whose masked casters cut holes in their shadows: the engine's mesh
/// templates, whose alpha the cutout templates compute alike.
const fn cuts_shadows(template: u32) -> bool {
    matches!(
        template,
        template::INSTANCED_LIT
            | template::INSTANCED_STANDARD_MAPS
            | template::INSTANCED_UNLIT
            | template::INSTANCED_UNLIT_MAP
    )
}

/// True for the shadings whose masked builds test alpha by alpha to coverage's fade or by the
/// alpha hash: the engine's mesh and sprite templates. Custom materials have no such builds, and
/// test their alpha against the cutoff.
pub const fn tests_alpha_its_way(shading: Shading) -> bool {
    !matches!(
        shading,
        Shading::Custom(_) | Shading::TexCoords | Shading::Line | Shading::LineLit
    )
}

/// The size to create a buffer at when it must hold `needed` bytes: room to grow, so a slowly
/// growing scene rarely recreates it, but never past `limit`.
pub fn grown_size(needed: u32, limit: u32) -> u32 {
    needed
        .saturating_add(needed / 2)
        .next_multiple_of(256)
        .min(limit)
        .max(needed)
}

/// Encodes a linear color channel as sRGB.
pub fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawn_rows_trim_the_rows_that_draw_nowhere() {
        let buckets = [HIDDEN, 3, HIDDEN, 4, HIDDEN, HIDDEN];
        assert_eq!(drawn_rows(&buckets, 0, 6), Some((1, 3)));
        assert_eq!(drawn_rows(&buckets, 2, 2), Some((3, 1)));
        assert_eq!(drawn_rows(&buckets, 4, 2), None);
        assert_eq!(drawn_rows(&buckets, 5, 9), None);
        assert_eq!(drawn_rows(&buckets, 1, 0), None);
    }

    #[test]
    fn joined_rows_merge_runs_that_lie_close_together() {
        assert_eq!(joined_rows((10, 5), 15, 3), Some((10, 8)));
        assert_eq!(joined_rows((10, 5), 12, 1), Some((10, 5)));
        assert_eq!(
            joined_rows((10, 5), 15 + MERGE_GAP_ROWS, 2),
            Some((10, 7 + MERGE_GAP_ROWS))
        );
        assert_eq!(joined_rows((10, 5), 16 + MERGE_GAP_ROWS, 2), None);
        assert_eq!(joined_rows((10, 5), 9, 3), None);
    }
}
