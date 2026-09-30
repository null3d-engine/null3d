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

use null3d_core::cells::{CellPosition, MAX_CELLS};
use null3d_core::handle::Handle;
use null3d_core::instances::{BatchTable, InstanceBatch};
use null3d_core::jobs::JobSystem;
use null3d_core::lights::{LightTable, LightView};
use null3d_core::scene::SceneStorage;
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::drawlist::{
    DrawList, DrawListError, Op, buffer_usage, permutation, state_flags, vertex,
};

use crate::camera::Lens;
use crate::debug_lines::DebugLines;
use crate::fog::Fog;
use crate::frame_data::{FrameUniform, normalized_direction};
use crate::graph::GraphError;
use crate::materials::{
    MATERIAL_FLOATS, MATERIAL_TEXELS, MapSlot, MaterialTable, Shading, feature,
};
use crate::meshes::{MAX_BUFFER_BYTES, MeshStorage, Page};
use crate::pipelines::DrawKey;
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
    /// True when the scene's structure changed this frame: objects created or destroyed, meshes
    /// or materials changed, batches created or destroyed.
    pub structure_changed: bool,
    /// The job system, for work that runs on the job workers.
    pub jobs: &'a JobSystem,
    /// The lines that the sketch drew for the frame, which development builds draw over the
    /// camera's view. Release builds draw none.
    pub lines: DebugLines<'a>,
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
    /// Forgets every GPU object the draw lists created and every upload they made, so the next
    /// frame creates them all again and uploads the whole scene. The thread that draws asks for
    /// this after the browser took the GPU away and it made a new device.
    fn reset_gpu(&mut self);
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
    /// Linear background color.
    background: [f32; 3],
    fog: Fog,
}

/// What the sketch sets and changes rarely: meshes, materials, textures, the views, the lights
/// and the fog.
pub struct SceneSettings {
    meshes: MeshStorage,
    materials: MaterialTable,
    textures: TextureStore,
    /// The views, the camera's first.
    views: Vec<View>,
    lighting: Lighting,
}

impl SceneSettings {
    pub fn new(meshes: MeshStorage, max_materials: u32, textures: TextureStore) -> Self {
        Self {
            meshes,
            materials: MaterialTable::with_capacity(max_materials),
            textures,
            views: vec![View::default()],
            lighting: Lighting {
                sun_direction: [0.0, -1.0, 0.0, 0.0],
                sun_color: [0.0; 4],
                ambient: [0.0; 4],
                background: [0.0; 3],
                fog: Fog::None,
            },
        }
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
        self.materials
            .update_map_layers(layers_changed, |map| textures.ready_layer(map));
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

    /// The bind group of the map that a material draws with through `pipeline`, as
    /// [`SceneSettings::pipeline_of`] chose it, or 0 when that pipeline reads no map.
    pub fn texture_group(&self, material: u32, pipeline: DrawKey) -> u32 {
        if pipeline.template != Shading::UnlitMap.template() {
            return 0;
        }
        let map = self.materials.map(material - 1, MapSlot::BaseColor);
        self.textures.group_id(map).unwrap_or(0)
    }

    /// The camera the canvas shows the scene from: a scene object, and its lens.
    pub fn set_camera(&mut self, camera: Handle, lens: impl Into<Lens>) {
        self.views[ViewId::CAMERA.index()].set_camera(camera, lens.into());
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
            .view_frame(ViewId::CAMERA, scene, parity, canvas)
            .map(|frame| LightView {
                camera: frame.camera,
                frustum: frame.frustum,
                layers: frame.layers,
            });
        let lit = lights.gather(scene, parity, view.as_ref());
        self.set_sun(lit.sun_direction, lit.sun_color);
        self.set_ambient(lit.ambient);
    }

    /// The linear color behind every object.
    pub fn set_background(&mut self, color: [f32; 3]) {
        self.lighting.background = color;
    }

    /// The fog that every view's objects take, apart from materials that opt out. The background
    /// takes none.
    pub fn set_fog(&mut self, fog: Fog) {
        self.lighting.fog = fog;
    }

    /// The color that clears the color targets, as the scene's render passes hold it: the
    /// background, encoded as sRGB as the shaders write their colors, and opaque.
    pub(crate) fn clear_color(&self) -> [f32; 4] {
        let [r, g, b] = self.lighting.background.map(linear_to_srgb);
        [r, g, b, 1.0]
    }

    /// What a mesh and material pair, by engine ids, asks of the pipeline that draws it, or `None`
    /// when the pair draws nowhere: no mesh, no material, an id that names nothing, or a mesh
    /// without the vertex attributes that the material's shading reads. A material whose map is
    /// gone, or whose mesh has no texture coordinates for it, draws with its color alone. A
    /// material with vertex colors reads them only from a mesh that has them, a masked material
    /// draws with the shader variant that discards fragments, and a double-sided material culls no
    /// faces. The material's depth options and depth bias set the pipeline's depth state.
    pub fn pipeline_of(&self, mesh: u32, material: u32) -> Option<DrawKey> {
        if mesh == NO_MESH || material == NO_MATERIAL {
            return None;
        }
        let format = self.meshes.mesh(mesh - 1)?.format;
        let mut shading = self.materials.shading(material - 1).ok()?;
        let needs = shading.attributes();
        if shading == Shading::UnlitMap
            && ((format & needs) != needs
                || !self
                    .textures
                    .is_live(self.materials.map(material - 1, MapSlot::BaseColor)))
        {
            shading = Shading::Unlit;
        }
        let needs = shading.attributes();
        let features = self.materials.features(material - 1);
        let has = |bit: u32| features & bit != 0;
        let base_color = shading.reads_base_color();
        let vertex_colors = has(feature::VERTEX_COLORS) && format & vertex::COLOR != 0;
        let bit = |on: bool, bit: u32| if on { bit } else { 0 };
        ((format & needs) == needs).then_some(DrawKey {
            template: shading.template(),
            permutation: bit(base_color && vertex_colors, permutation::VERTEX_COLOR)
                | bit(
                    base_color && has(feature::ALPHA_MASK),
                    permutation::ALPHA_MASK,
                ),
            vertex_format: format,
            state: bit(has(feature::DOUBLE_SIDED), state_flags::CULL_NONE)
                | bit(has(feature::NO_DEPTH_WRITE), state_flags::NO_DEPTH_WRITE)
                | bit(has(feature::NO_DEPTH_TEST), state_flags::NO_DEPTH_TEST),
            bias: self.materials.depth_bias(material - 1),
        })
    }

    /// A view's values for a frame whose targets have the canvas's size, or `None` when the view
    /// has no camera to draw from. Shaders work in positions relative to the camera, so the
    /// constants put a perspective camera at the origin, and an orthographic camera at infinity
    /// behind its view.
    pub fn view_frame(
        &self,
        view: ViewId,
        scene: &SceneStorage,
        parity: usize,
        canvas: (u32, u32),
    ) -> Option<ViewFrame> {
        let aspect = canvas.0 as f32 / canvas.1.max(1) as f32;
        let view = self.views.get(view.index())?;
        let (view_proj, eye, forward, camera) = view.transform(scene, parity, aspect)?;
        let uniform = FrameUniform {
            view_proj,
            camera_position: eye,
            sun_direction: self.lighting.sun_direction,
            sun_color: self.lighting.sun_color,
            ambient: self.lighting.ambient,
            fog: self.lighting.fog.uniform(forward),
        };
        Some(ViewFrame::new(uniform, camera, view.layers()))
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
    vertex_floats: usize,
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
        (page.vertices.len() - held.vertex_floats) * 4
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
                list.push(
                    Op::CreateBuffer,
                    &[
                        vertex_id,
                        buffers.vertex_bytes,
                        buffer_usage::VERTEX | copied,
                    ],
                )?;
                list.push(
                    Op::CreateBuffer,
                    &[index_id, buffers.index_bytes, buffer_usage::INDEX | copied],
                )?;
                remade = true;
            }
            let new_vertices = &page.vertices[buffers.vertex_floats..];
            if !new_vertices.is_empty() {
                let offset = (buffers.vertex_floats * 4) as u32;
                let (at, bytes) = arena.push(floats_as_bytes(new_vertices))?;
                list.push(Op::WriteBuffer, &[vertex_id, offset, at, bytes])?;
                buffers.vertex_floats = page.vertices.len();
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
}
