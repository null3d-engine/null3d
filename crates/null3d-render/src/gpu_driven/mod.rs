//! The WebGPU frame builder: the GPU culls every object and instance itself, and the CPU replays
//! prerecorded render bundles. Each frame records a draw list that uploads what changed, then the
//! passes of the render graph: a culling dispatch for each view, then each view's bundle. The
//! render worker replays the list.
//!
//! # Sources and buckets
//!
//! Every scene slot and every row of every instance batch is a source: one world matrix in the
//! matrix buffer, at `base + row`, where scene slots come first and each batch follows at its
//! base. A bucket is one pipeline, mesh and material. Each drawable source belongs to one bucket;
//! the rest are hidden. A bucket owns a slice of each view's compacted instance buffer, as large as
//! the number of sources it has, and in each view one indexed indirect draw per part of its mesh.
//! A view's culling shader appends each visible source to its bucket's slice and counts it in each
//! of the bucket's draws, and the view's bundle draws every bucket with its slice bound at vertex
//! slot 1, so the draws' first instance stays 0.
//!
//! A pipeline is one shading and one vertex format, and the meshes of one vertex format share
//! mesh pages, so buckets sorted by pipeline and page draw with few changes of state.
//!
//! Buckets change only with the scene's structure: objects created or destroyed, meshes or
//! materials changed, batches created or destroyed. The caller says when that happened; the
//! builder then rebuilds the bucket tables, records each view's bundle again, and uploads every
//! matrix once. A bucket holds every object with its mesh and material, shown or hidden, and every
//! row of a batch, active or not. So showing or hiding an object, or changing a batch's active
//! count, only rewrites those sources' entries in the bucket table, where `HIDDEN` makes the
//! culling shader skip them.
//!
//! # Cells
//!
//! World matrices are relative to their grid cells' centers (see [`null3d_core::cells`]). A
//! source's entry in the bucket table holds its cell index above its bucket, so a source that
//! changes cells rewrites its entry, as a hidden one does. Each frame uploads, for each view, the
//! offset from the view's camera to each cell in use beside the view's culling planes, which are
//! relative to its camera. The culling shader adds a source's offset to its matrix as it copies
//! the matrix into the compacted instance buffer, so the vertex shader draws positions relative to
//! the camera. When only the cameras move, static matrices stay on the GPU and only the offsets
//! upload.
//!
//! # Layers
//!
//! A layer table beside the bucket table holds each source's layer mask (see
//! [`null3d_core::layers`]): a scene object's own, or its batch's for every row of a batch. Each
//! view's culling parameters hold the view's mask, and the culling shader skips a source whose
//! mask shares no bit with it. A new mask rewrites the source's entry in the layer table, or a
//! batch's rows, with no rebuild, as showing or hiding an object does.
//!
//! # Views and passes
//!
//! Every view (see [`crate::view`]) culls the same sources and bucket tables, into buffers of its
//! own: its culling parameters, compacted instances and indirect draws, its frame uniform, and its
//! bundle. Each pass has a module: `cull` records the culling passes and `opaque` the opaque
//! passes, and `layout` keeps the sources and buckets that every view reads, with their uploads.
//! The render graph ([`crate::frame_graph`]) orders the passes and begins their render passes.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. At the start of each frame the arena gets
//! room for the most that any frame can copy for the scene as it stands, and the layout keeps its
//! tables and scratch space between rebuilds. Only the first frames after the scene grows, with a
//! new batch, mesh, view, or mesh and material pair, allocate.

mod cull;
mod layout;
mod opaque;

use std::collections::TryReserveError;

use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{DrawList, Op, buffer_usage as usage, sizes};

use crate::cells::CellCulling;
use crate::frame::{
    FrameBuilder, FrameInput, MeshBuffers, ParityLists, RecordError, SceneSettings, UploadArena,
    floats_as_bytes,
};
use crate::frame_graph::{FrameGraph, Role};
use crate::graph::RenderGraph;
use crate::materials::{MAP_WORDS, MATERIAL_FLOATS};
use crate::meshes::{MeshStorage, Packing};
use crate::pipelines::PipelineCache;
use crate::textures::{TextureIds, TextureStore};
use crate::view::{ViewFrame, ViewId};
use cull::{CULL_PARAMS_BYTES, Culling, INDIRECT_BYTES};
use layout::Layout;

/// The most sources the builder can draw, scene slots and instance rows together, on a device whose
/// largest storage binding is `binding_bytes`. One culling dispatch covers at most 65,535
/// workgroups, and the compacted instance buffer, which the culling shader binds as storage, must
/// fit the largest storage binding.
pub const fn max_sources(binding_bytes: u32) -> u32 {
    let by_dispatch = u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE;
    let by_binding = binding_bytes / sizes::INSTANCE_STRIDE;
    if by_dispatch < by_binding {
        by_dispatch
    } else {
        by_binding
    }
}

/// Engine memory the builder keeps for each source: its entries in the bucket table and the layer
/// table and its place in the cell order, and room for all three in both frames' upload arenas.
pub const BYTES_PER_SOURCE: u32 = 36;

/// The most sources on every WebGPU device: [`max_sources`] at WebGPU's default storage binding
/// limit. The WebGL2 path has its own limit, which follows the device's largest texture.
pub const PORTABLE_MAX_SOURCES: u32 = max_sources(sizes::PORTABLE_STORAGE_BINDING_BYTES);

/// The largest storage binding the builder can use: the instance buffer of the most sources one
/// dispatch covers. A device that offers more gains nothing from a larger binding.
pub const MAX_USEFUL_BINDING_BYTES: u32 =
    u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE * sizes::INSTANCE_STRIDE;

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own.
mod ids {
    use crate::view::{MAX_VIEWS, ViewId};

    pub const MATERIALS: u32 = 1;
    pub const MATRICES: u32 = 2;
    pub const INSTANCE_BUCKETS: u32 = 3;
    pub const BUCKETS: u32 = 4;
    pub const SOURCE_LAYERS: u32 = 5;
    /// Every drawn source's place, in cell order.
    pub const ORDER: u32 = 6;
    /// Each view's buffers: its frame uniform, culling parameters, compacted instances and
    /// indirect draws, four ids from `VIEW_BUFFERS + 4 * view`.
    const VIEW_BUFFERS: u32 = 7;

    pub const fn frame(view: ViewId) -> u32 {
        VIEW_BUFFERS + 4 * view.index() as u32
    }
    pub const fn cull_params(view: ViewId) -> u32 {
        frame(view) + 1
    }
    pub const fn visible(view: ViewId) -> u32 {
        frame(view) + 2
    }
    pub const fn indirect(view: ViewId) -> u32 {
        frame(view) + 3
    }

    /// The maps table, which names the layer of each material's map.
    pub const MAPS: u32 = VIEW_BUFFERS + 4 * MAX_VIEWS as u32;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = MAPS + 1;

    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = 1;
    /// The texture arrays of materials' maps, after every id the render graph can take.
    pub const TEXTURE_ARRAYS: u32 = TARGETS + 256;
    /// The samplers of materials' maps, the only samplers the builder makes.
    pub const SAMPLERS: u32 = 1;

    pub const CULL: u32 = 1;

    /// Each view's bind groups: the frame group of its render pipelines, then its culling group.
    pub const fn frame_group(view: ViewId) -> u32 {
        1 + 2 * view.index() as u32
    }
    pub const fn cull_group(view: ViewId) -> u32 {
        frame_group(view) + 1
    }
    /// The bind groups of materials' maps, after every view's groups.
    pub const TEXTURE_GROUPS: u32 = 1 + 2 * MAX_VIEWS as u32;

    pub const fn bundle(view: ViewId) -> u32 {
        1 + view.index() as u32
    }
}

/// Sizes the builder allocates once.
#[derive(Clone, Copy, Debug)]
pub struct RendererConfig {
    /// MSAA samples of the color and depth targets.
    pub samples: u32,
    pub max_materials: u32,
    /// Words of each frame's draw list.
    pub draw_list_words: usize,
    /// The device's largest storage binding, at most [`MAX_USEFUL_BINDING_BYTES`]. It caps the
    /// builder's buffers and the sources it can draw.
    pub storage_binding_bytes: u32,
    /// True to cull only the sources of grid cells in view; false to cull every source, as a
    /// benchmark of cell culling compares.
    pub cell_culling: bool,
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            samples: 4,
            max_materials: sizes::MAX_MATERIALS,
            draw_list_words: 16 * 1024,
            storage_binding_bytes: sizes::PORTABLE_STORAGE_BINDING_BYTES,
            cell_culling: true,
        }
    }
}

/// Records one draw list per frame for the GPU-driven WebGPU path.
pub struct GpuDrivenRenderer {
    config: RendererConfig,
    settings: SceneSettings,
    /// The mesh pages' vertex and index buffers.
    meshes: MeshBuffers,
    pipelines: PipelineCache,
    lists: ParityLists,
    graph: FrameGraph,
    layout: Layout,
    /// Grid-cell culling: the scene's still objects in cell order, and each cell's box.
    cells: CellCulling,
    culling: Culling,
    /// Each view's values in the frame being recorded, or `None` for a view with no camera.
    frames: Vec<Option<ViewFrame>>,
    created: bool,
}

impl GpuDrivenRenderer {
    pub fn new(config: RendererConfig) -> Self {
        let textures = TextureStore::new(
            TextureIds {
                first_texture: ids::TEXTURE_ARRAYS,
                first_sampler: ids::SAMPLERS,
                first_group: ids::TEXTURE_GROUPS,
            },
            BUDGET[Limit::TextureDimension2D as usize],
        );
        Self {
            config,
            settings: SceneSettings::new(
                MeshStorage::new(Packing::SharedBuffers),
                config.max_materials,
                textures,
            ),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            lists: ParityLists::new(config.draw_list_words),
            graph: FrameGraph::new(config.samples, true, ids::TARGETS),
            layout: Layout::default(),
            cells: CellCulling::new(config.cell_culling, false),
            culling: Culling::default(),
            frames: Vec::new(),
            created: false,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// A view's values in the last recorded frame, or `None` when the view had no camera. Its
    /// frustum is the one that the view's culling pass tested against.
    pub fn view_frame(&self, view: ViewId) -> Option<&ViewFrame> {
        self.frames.get(view.index())?.as_ref()
    }

    /// The sources that a view's culling pass tests in the last recorded frame, in the order its
    /// threads take them: the sources in the runs of the cell order that it culls, or every
    /// source in place when it culls without cells. For tests; it allocates the list.
    pub fn culled_sources(&self, view: ViewId) -> Vec<u32> {
        match self.culling.ranges(view) {
            Some(ranges) => {
                let order = self.layout.order();
                ranges
                    .flat_map(|(start, end)| order[start as usize..end as usize].iter().copied())
                    .collect()
            }
            None => (0..self.layout.sources).collect(),
        }
    }

    /// Records a frame into its parity's list and arena: the objects the GPU lacks, the uploads,
    /// then the passes of the render graph. Returns true when the frame rebuilt the draw tables.
    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        let parity = input.parity();
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph.sync_views(self.settings.views());
        self.graph.prepare(list, input.canvas)?;
        let views = self.settings.views().len();
        let first_new = self.culling.views();
        for index in first_new..views {
            opaque::create_view(list, ViewId::from_index(index))?;
        }
        self.culling.add_views(list, views)?;

        let upload_everything = input.structure_changed || !self.layout.built;
        if upload_everything {
            let limit = max_sources(self.config.storage_binding_bytes);
            self.layout.rebuild(
                &self.settings,
                &mut self.pipelines,
                self.graph.scene_targets(),
                input.scene,
                input.batches,
                parity,
                limit,
            )?;
            let layout = &self.layout;
            self.cells
                .classify(input.scene, &|slot| layout.draws(slot))
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: (input.scene.capacity() + 1).saturating_mul(16),
                })?;
        }
        self.cells.update(input);
        arena.reset(self.upload_bound());
        let pages_remade = self
            .meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        self.pipelines.create_new(list)?;
        if self.settings.materials_mut().take_changed() {
            let parameters = self.settings.materials().parameters();
            let (at, bytes) = arena.push(floats_as_bytes(parameters))?;
            list.push(Op::WriteBuffer, &[ids::MATERIALS, 0, at, bytes])?;
        }
        let groups_remade = self
            .settings
            .record_textures(list, arena, ids::MAPS, input.frame)?;
        let binding_bytes = self.config.storage_binding_bytes;
        let shared_recreated = if upload_everything {
            self.layout.apply(list, arena, binding_bytes)?
        } else {
            self.layout.update_membership(list, arena, input, parity)?;
            false
        };
        // A view's bundle names the buffers, the bind groups and the layout it draws, so each new
        // view, and every view after a new layout, new mesh buffers or new map groups, records its
        // bundle.
        let first_to_apply = if upload_everything || pages_remade || groups_remade {
            0
        } else {
            first_new
        };
        for index in first_to_apply..views {
            let view = ViewId::from_index(index);
            self.culling
                .apply(list, view, &self.layout, shared_recreated, binding_bytes)?;
            opaque::record_bundle(list, view, &self.layout, &self.meshes, self.config.samples)?;
        }
        self.layout
            .upload_matrices(list, input, parity, upload_everything)?;
        self.layout.update_order(list, arena, &self.cells, input)?;

        self.frames.clear();
        for index in 0..views {
            let view = ViewId::from_index(index);
            let frame = self
                .settings
                .view_frame(view, input.scene, parity, input.canvas);
            if let Some(frame) = &frame {
                opaque::upload(list, arena, view, frame)?;
                let (layout, cells) = (&self.layout, &self.cells);
                self.culling
                    .upload(list, arena, view, frame, layout, input.scene, cells)?;
            }
            self.frames.push(frame);
        }

        let (frames, layout, culling) = (&self.frames, &self.layout, &self.culling);
        let drawn = |view: ViewId| frames[view.index()].is_some();
        self.graph
            .record(list, self.settings.clear_color(), |list, role| match role {
                Role::Cull(view) if drawn(view) => culling.record(list, view, layout),
                Role::Opaque(view) if drawn(view) => opaque::record(list, view),
                _ => Ok(()),
            })?;
        Ok(upload_everything)
    }

    /// Records the creation of the culling pipeline and of the material and maps tables, whose
    /// sizes never change.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        cull::create_pipeline(list)?;
        let materials = self.config.max_materials.max(1);
        for (id, words) in [(ids::MATERIALS, MATERIAL_FLOATS), (ids::MAPS, MAP_WORDS)] {
            list.push(
                Op::CreateBuffer,
                &[
                    id,
                    materials * words as u32 * 4,
                    usage::STORAGE | usage::COPY_DST,
                ],
            )?;
        }
        self.created = true;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the whole material and maps tables, the layout's tables, and each view's
    /// frame uniform, culling parameters and indirect draws.
    fn upload_bound(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials =
            self.settings.materials().capacity() as usize * (MATERIAL_FLOATS + MAP_WORDS) * 4;
        let per_view = (sizes::FRAME_UNIFORM_BYTES + CULL_PARAMS_BYTES) as usize
            + self.layout.draws.len() * INDIRECT_BYTES as usize;
        meshes + materials + self.layout.upload_bound() + self.settings.views().len() * per_view
    }
}

impl FrameBuilder for GpuDrivenRenderer {
    fn settings(&self) -> &SceneSettings {
        &self.settings
    }

    fn settings_mut(&mut self) -> &mut SceneSettings {
        &mut self.settings
    }

    fn max_sources(&self) -> u32 {
        max_sources(self.config.storage_binding_bytes)
    }

    fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError> {
        self.layout.reserve(sources)?;
        let bound = self.upload_bound() + sources.saturating_sub(self.layout.sources) as usize * 4;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound)?;
        }
        Ok(())
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame);
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena);
        result
    }

    fn reset_gpu(&mut self) {
        self.created = false;
        self.graph.reset_gpu();
        self.layout.forget_gpu();
        self.culling.forget_gpu();
        self.meshes.forget();
        self.pipelines.forget();
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }
}
