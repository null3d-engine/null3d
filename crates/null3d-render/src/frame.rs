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

use null3d_core::animation::Animations;
use null3d_core::cells::{CellPosition, MAX_CELLS, ORIGIN_CELL};
use null3d_core::culling::{CULL_CHUNK, CullRun, ROW_CELLS};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::jobs::JobSystem;
use null3d_core::lights::{LightShadow, LightTable, LightView, SunShadow, VisibleLight};
use null3d_core::scene::SceneStorage;
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::{
    DrawList, DrawListError, Op, buffer_usage, permutation, state_flags, template, vertex,
};

use crate::bloom::{self, Bloom};
use crate::camera::Lens;
use crate::debug_lines::DebugLines;
use crate::debug_view::{self, DebugView};
use crate::fog::Fog;
use crate::frame_data::{FrameUniform, normalized_direction};
use crate::grading::{Grading, Lut, Vignette};
use crate::graph::{GraphError, RenderScale, Size};
use crate::materials::{
    MATERIAL_FLOATS, MATERIAL_TEXELS, MapSlot, MaterialTable, Shading, blend_state, feature,
};
use crate::meshes::{MAX_BUFFER_BYTES, MeshStorage, Page};
use crate::output::{Antialias, Output, SceneColor, ToneMapping};
use crate::pipelines::{DepthBias, DrawKey, PipelineCache};
use crate::shadow_tiles::{MAX_TILES, TileSettings};
use crate::shadows::{
    CascadeSchedule, MovingCasters, ShadowFrame, ShadowQuality, ShadowSettings, fit_cascades,
};
use crate::textures::TextureStore;
use crate::view::{MAX_VIEWS, View, ViewFrame, ViewId};

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
    /// The frame's commands do not fit the draw list.
    DrawListFull,
    /// More sources than the builder can draw on this device.
    TooManySources {
        /// The most sources the builder can draw on this device.
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
    fn from(_: DrawListError) -> Self {
        RecordError::DrawListFull
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
    /// True when point or spot lights cast shadows into the shadow atlas in the frame recorded
    /// last.
    fn casts_tile_shadows(&self) -> bool {
        false
    }
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
}

impl UploadArena {
    /// Empties the arena and makes room for `total` bytes. The list of the frame that last used
    /// the arena has been replayed, so its copies may move.
    pub(crate) fn reset(&mut self, total: usize) {
        self.bytes.clear();
        self.bytes.reserve_exact(total);
    }

    /// Makes room for `total` bytes ahead of the frame that needs them, or fails when memory
    /// cannot grow.
    pub(crate) fn try_reserve(&mut self, total: usize) -> Result<(), TryReserveError> {
        self.bytes
            .try_reserve(total.saturating_sub(self.bytes.len()))
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

/// The draw list and the upload arena of each frame parity.
pub(crate) struct ParityLists {
    lists: [DrawList; 2],
    arenas: [UploadArena; 2],
}

impl ParityLists {
    pub(crate) fn new(words: usize) -> Self {
        Self {
            lists: [
                DrawList::with_capacity(words),
                DrawList::with_capacity(words),
            ],
            arenas: [UploadArena::default(), UploadArena::default()],
        }
    }

    pub(crate) fn list(&self, frame: u32) -> &DrawList {
        &self.lists[(frame & 1) as usize]
    }

    pub(crate) fn arenas_mut(&mut self) -> &mut [UploadArena; 2] {
        &mut self.arenas
    }

    /// Takes the frame parity's list, emptied, and its arena out, so the builder can record with
    /// its own state borrowed. [`ParityLists::restore`] puts them back.
    pub(crate) fn take(&mut self, frame: u32) -> (DrawList, UploadArena) {
        let parity = (frame & 1) as usize;
        let mut list = std::mem::replace(&mut self.lists[parity], DrawList::with_capacity(0));
        list.clear();
        (list, std::mem::take(&mut self.arenas[parity]))
    }

    pub(crate) fn restore(&mut self, frame: u32, list: DrawList, arena: UploadArena) {
        let parity = (frame & 1) as usize;
        self.lists[parity] = list;
        self.arenas[parity] = arena;
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
    /// The main directional light's shadows, or `None` when it casts none.
    sun_shadow: Option<SunShadow>,
    shadow_quality: ShadowQuality,
    /// Linear background color, or `None` before the sketch sets one.
    background: Option<[f32; 3]>,
    fog: Fog,
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
    /// Scratch marks of the material ids that objects and batches use, for the release of
    /// destroyed materials' ids.
    used_materials: Vec<bool>,
    /// The texture that the camera's view draws behind every object, or `Handle::NONE`.
    background_texture: Handle,
    /// The views, the camera's first.
    views: Vec<View>,
    lighting: Lighting,
    /// Which shadow cascades draw in each frame, and what the shadow map's layers hold.
    shadow_schedule: CascadeSchedule,
    /// The casters that move in every frame, which keep far cascades drawing.
    moving_casters: MovingCasters,
    canvas: CanvasOutput,
    output: Output,
    /// Bloom's settings while the sketch turns it on.
    bloom: Option<Bloom>,
    /// How many times fewer taps than three.js's each of bloom's blurs reads, which the quality
    /// settings raise.
    bloom_divisor: u32,
    /// The color grading table while the sketch sets one.
    lut: Option<Lut>,
    /// The vignette while the sketch turns it on.
    vignette: Option<Vignette>,
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
}

impl SceneSettings {
    pub fn new(
        meshes: MeshStorage,
        max_materials: u32,
        textures: TextureStore,
        canvas: CanvasOutput,
    ) -> Self {
        Self {
            meshes,
            materials: MaterialTable::with_capacity(max_materials),
            textures,
            map_groups: Vec::new(),
            used_materials: Vec::new(),
            background_texture: Handle::NONE,
            views: vec![View::default()],
            lighting: Lighting {
                sun_direction: [0.0, -1.0, 0.0, 0.0],
                sun_color: [0.0; 4],
                ambient: [0.0; 4],
                sun_shadow: None,
                shadow_quality: ShadowQuality::default(),
                background: None,
                fog: Fog::None,
            },
            shadow_schedule: CascadeSchedule::default(),
            moving_casters: MovingCasters::default(),
            canvas,
            output: Output::default(),
            bloom: None,
            bloom_divisor: 1,
            lut: None,
            vignette: None,
            clock: [0.0; 4],
            render_scaling: false,
            pixel_ratio: 1.0,
            tiles: TileSettings::default(),
            debug_view: DebugView::Lit,
            shadow_camera: None,
        }
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

    /// How many times fewer taps than three.js's each of bloom's blurs reads.
    pub fn bloom_divisor(&self) -> u32 {
        self.bloom_divisor
    }

    /// Makes each of bloom's blurs read `divisor` times fewer taps than three.js's, rounded up,
    /// from 1 to [`bloom::MAX_SAMPLE_DIVISOR`], from the next recorded frame on. Fewer taps read
    /// the same kernel more coarsely, so the glow keeps its size.
    pub fn set_bloom_divisor(&mut self, divisor: u32) {
        self.bloom_divisor = divisor.clamp(1, bloom::MAX_SAMPLE_DIVISOR);
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

    /// The texture that the camera's view draws behind every object, or `Handle::NONE` for the
    /// background color alone, as in every debug view.
    pub fn background_texture(&self) -> Handle {
        if self.debug_view.is_debug() {
            Handle::NONE
        } else {
            self.background_texture
        }
    }

    /// Draws `texture` behind every object in the camera's view, or only the background color
    /// with `Handle::NONE`.
    pub fn set_background_texture(&mut self, texture: Handle) {
        self.background_texture = texture;
    }

    /// Records the frame's texture work, writes each map's layer into its material's row when a
    /// map changed, or a texture's layer became ready or stopped drawing, then uploads the rows
    /// that changed into `table`. Returns true when a map's bind group was made again, which
    /// render bundles that bind it must see.
    pub(crate) fn record_materials(
        &mut self,
        list: &mut DrawList,
        arena: &mut UploadArena,
        table: MaterialStorage,
        frame: u32,
    ) -> Result<bool, RecordError> {
        let remade = self.textures.record(list, frame)?;
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
            let materials = &self.materials;
            pipelines.release(|template| materials.custom_template_unused(template));
        }
        self.map_groups.resize(count as usize, 0);
        for id in 0..count {
            let samples = match self.materials.shading(id) {
                Ok(Shading::Lit) => self.has_live_map(id),
                Ok(Shading::Custom(custom)) => custom.textures > 0,
                _ => false,
            };
            self.map_groups[id as usize] = if samples {
                let maps = self.materials.maps(id);
                self.textures.map_set_group(&maps).unwrap_or(0)
            } else {
                0
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

    /// Adds a view that draws the scene into color and depth targets of its own, or returns
    /// `None` when the builder already draws [`MAX_VIEWS`] views.
    pub fn add_view(&mut self, view: View) -> Option<ViewId> {
        if self.views.len() >= MAX_VIEWS {
            return None;
        }
        self.views.push(view);
        Some(ViewId::from_index(self.views.len() - 1))
    }

    /// The views, the camera's first.
    pub fn views(&self) -> &[View] {
        &self.views
    }

    /// The directional light: the direction its light travels, and its linear color times its
    /// intensity.
    pub fn set_sun(&mut self, direction: [f32; 3], color: [f32; 3]) {
        self.lighting.sun_direction = normalized_direction(direction);
        self.lighting.sun_color = [color[0], color[1], color[2], 0.0];
    }

    /// The ambient light's linear color times its intensity.
    pub fn set_ambient(&mut self, color: [f32; 3]) {
        self.lighting.ambient = [color[0], color[1], color[2], 0.0];
    }

    /// Gathers the lights of the frame whose world output is `parity`'s for the camera's view
    /// (see [`LightTable::gather`]), after the transform update and before the frame records. The
    /// main directional light and the ambient lights become the light the shaders read, and the
    /// light table's visible list holds the point and spot lights the camera sees.
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
        let lit = lights.gather(scene, parity, view.as_ref());
        self.set_sun(lit.sun_direction, lit.sun_color);
        self.set_ambient(lit.ambient);
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

    /// The shadow filter and the far cascades' update interval.
    pub fn shadow_quality(&self) -> ShadowQuality {
        self.lighting.shadow_quality
    }

    /// The shadow filter and the far cascades' update interval, from the next frame on.
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
        };
        let [x, y, z, _] = self.lighting.sun_direction;
        let position = scene.cell_position(slot, parity);
        let absolute = position.absolute();
        let fitted = scene.cell_position(fitter, parity).absolute();
        let mut cascades = fit_cascades(world, fitted, &lens, aspect, [x, y, z], &settings);
        if fitter != slot {
            cascades.seen_from(fitted, absolute, shadow.map_size);
        }
        self.moving_casters.update(scene, input.structure_changed);
        let moving = &self.moving_casters;
        let drawn = self.shadow_schedule.plan(
            &mut cascades,
            absolute,
            shadow.map_size,
            quality.far_interval,
            |bounds| moving.touch(scene, parity, shadow.layers, bounds),
        );
        Some(ShadowFrame {
            cascades,
            settings,
            camera: position,
            layers: shadow.layers,
            drawn,
        })
    }

    /// Where the camera's view stands in the frame whose world output is `parity`'s: its cell, and
    /// its position in the cell. `None` when the view has no camera.
    pub fn camera_position(&self, scene: &SceneStorage, parity: usize) -> Option<CellPosition> {
        let (camera, _) = self.views[ViewId::CAMERA.index()].camera()?;
        let slot = scene.resolve(camera).ok()?;
        Some(scene.cell_position(slot, parity))
    }

    /// The pipeline that draws the depth of a shadow caster whose mesh and material draw with
    /// `pipeline`: only its back faces, as three.js draws them with its filtered shadow maps,
    /// moved toward the light by part of a texel, or both faces of a double-sided material, where
    /// they stay. The material's depth bias moves what the camera sees, so the caster draws
    /// without it.
    pub fn caster_of(&self, pipeline: DrawKey) -> DrawKey {
        let (faces, permutation) = if pipeline.state & state_flags::CULL_NONE != 0 {
            (state_flags::CULL_NONE, 0)
        } else {
            (state_flags::CULL_FRONT, permutation::CASTER_OFFSET)
        };
        DrawKey {
            template: template::SHADOW_DEPTH,
            permutation,
            vertex_format: pipeline.vertex_format,
            state: faces,
            bias: DepthBias::NONE,
        }
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
    /// the objects.
    pub fn set_background(&mut self, color: [f32; 3]) {
        self.lighting.background = Some(color);
    }

    /// The fog that every view's objects take, apart from materials that opt out. The background
    /// takes none.
    pub fn set_fog(&mut self, fog: Fog) {
        self.lighting.fog = fog;
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
    /// draws with the shader variant that discards fragments, and a double-sided material culls no
    /// faces. The material's depth options and depth bias set the pipeline's depth state, and a
    /// blended material's blending sets its blend state, which draws it in the transparent pass.
    /// A debug view replaces the key with its own (see [`DebugView::draw_key`]).
    pub fn pipeline_of(&self, mesh: u32, material: u32) -> Option<DrawKey> {
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
        let masked = has(feature::ALPHA_MASK) && !has(feature::BLEND);
        let tangents = shading == Shading::StandardMaps
            && live(MapSlot::Normal)
            && format & vertex::TANGENT != 0;
        let bit = |on: bool, bit: u32| if on { bit } else { 0 };
        let key = ((format & needs) == needs).then_some(DrawKey {
            template: shading.template(),
            permutation: bit(base_color && vertex_colors, permutation::VERTEX_COLOR)
                | bit(base_color && masked, permutation::ALPHA_MASK)
                | bit(tangents, permutation::VERTEX_TANGENT),
            vertex_format: format,
            state: bit(has(feature::DOUBLE_SIDED), state_flags::CULL_NONE)
                | bit(has(feature::NO_DEPTH_WRITE), state_flags::NO_DEPTH_WRITE)
                | bit(has(feature::NO_DEPTH_TEST), state_flags::NO_DEPTH_TEST)
                | blend_state(features),
            bias: self.materials.depth_bias(id),
        });
        key.map(|key| self.debug_view.draw_key(key))
    }

    /// A view's values for a frame on a canvas of `canvas` device pixels that the scene draws at
    /// render scale `scale`, or `None` when the view has no camera to draw from. The projection
    /// takes the canvas's shape, and the target size is the render size, which fragment positions
    /// count in. Shaders work in positions relative to the camera, so the constants put a
    /// perspective camera at the origin, and an orthographic camera at infinity behind its view.
    pub fn view_frame(
        &self,
        view: ViewId,
        scene: &SceneStorage,
        parity: usize,
        canvas: (u32, u32),
        scale: RenderScale,
    ) -> Option<ViewFrame> {
        let aspect = canvas.0 as f32 / canvas.1.max(1) as f32;
        let view = self.views.get(view.index())?;
        let camera = view.transform(scene, parity, aspect)?;
        let [x, y, z] = camera.cell.absolute().map(|v| v as f32);
        let (width, height) = Size::Full.viewport(canvas, scale);
        let (width, height) = (width as f32, height as f32);
        let uniform = FrameUniform {
            view_proj: camera.view_proj,
            camera_position: camera.eye,
            sun_direction: self.lighting.sun_direction,
            sun_color: self.lighting.sun_color,
            ambient: self.lighting.ambient,
            output: self.drawn_output().uniform(),
            fog: self.lighting.fog.uniform(camera.forward),
            clock: self.clock,
            camera_world: [x, y, z, 0.0],
            target_size: [width, height, 1.0 / width, 1.0 / height],
            camera_range: [
                camera.depth.near,
                camera.depth.far,
                2.0 * self.pixel_ratio / canvas.0.max(1) as f32,
                2.0 * self.pixel_ratio / canvas.1.max(1) as f32,
            ],
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
                // The skinning pass reads skinned meshes' vertices as storage.
                let read = if crate::skinning::has_joints(page.format) {
                    buffer_usage::STORAGE
                } else {
                    0
                };
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

    /// Forgets every buffer, after the thread that draws replaced the GPU, so the next upload
    /// makes each page's buffers again and fills them whole.
    pub(crate) fn forget(&mut self) {
        self.pages.clear();
    }
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
