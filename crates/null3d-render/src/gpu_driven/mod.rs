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
//! bundle. Each pass has a module: `cull` records the culling passes, `opaque` the opaque passes
//! and `shadow` the shadow passes, and `layout` keeps the sources and buckets that every view
//! reads, with their uploads.
//!
//! # Shadows
//!
//! While the main directional light casts shadows, each cascade of its shadows (see
//! [`crate::shadows`]) is a view too. The cascades cull a second layout, of the objects that cast
//! shadows, grouped by mesh, and draw their depth with depth-only pipelines into their layers of
//! the shadow map. The scene's objects that receive shadows draw with pipelines that read the map.
//! Turning shadows on or off rebuilds both layouts. Every camera view's frame group binds the
//! shadow map, which is one texel of one layer while no light casts shadows.
//! The debug lines pass, which both builders share, is [`crate::debug_lines`], and the background
//! texture that the camera's opaque pass draws before its bundle is [`crate::background`]. The
//! render graph ([`crate::frame_graph`]) orders the passes and begins their render passes.
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
mod shadow;

use std::collections::TryReserveError;

use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{
    DrawList, Op, buffer_usage as usage, format, sizes, texture_usage, view,
};

use crate::background::BackgroundPass;
use crate::cells::CellCulling;
use crate::debug_lines::LinesPass;
use crate::dfg;
use crate::final_pass::FinalIds;
use crate::frame::{
    CanvasOutput, FrameBuilder, FrameInput, MaterialStorage, MeshBuffers, ParityLists, RecordError,
    SceneSettings, UploadArena,
};
use crate::frame_graph::{FrameGraph, GraphIds, Role, ShadowPasses};
use crate::graph::RenderGraph;
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MeshStorage, Packing};
use crate::pipelines::PipelineCache;
use crate::shadows::{self, MAX_CASCADES};
use crate::textures::{TextureIds, TextureStore};
use crate::view::{ViewFrame, ViewId};
use cull::{CULL_PARAMS_BYTES, Culling, INDIRECT_BYTES};
use layout::{Drawn, Layout};

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

/// Bytes of each source in the builder's tables: its entries in the bucket table, the layer table
/// and the casters' bucket table, and its place in the cell order.
const TABLE_BYTES_PER_SOURCE: u32 = 16;

/// Engine memory the builder keeps for each source: its entries in the tables, and room for them
/// in both frames' upload arenas.
pub const BYTES_PER_SOURCE: u32 = 3 * TABLE_BYTES_PER_SOURCE;

/// The most sources on every WebGPU device: [`max_sources`] at WebGPU's default storage binding
/// limit. The WebGL2 path has its own limit, which follows the device's largest texture.
pub const PORTABLE_MAX_SOURCES: u32 = max_sources(sizes::PORTABLE_STORAGE_BINDING_BYTES);

/// The largest storage binding the builder can use: the instance buffer of the most sources one
/// dispatch covers. A device that offers more gains nothing from a larger binding.
pub const MAX_USEFUL_BINDING_BYTES: u32 =
    u16::MAX as u32 * sizes::CULL_WORKGROUP_SIZE * sizes::INSTANCE_STRIDE;

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own, the
/// shadow cascades' views after the camera views.
mod ids {
    use crate::view::{MAX_VIEW_IDS, ViewId};

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

    /// The vertices of the debug lines.
    pub const LINES: u32 = VIEW_BUFFERS + 4 * MAX_VIEW_IDS as u32;
    /// The casters' bucket table and bucket records, which the shadow cascades' culling reads.
    pub const CASTER_BUCKETS: u32 = LINES + 1;
    pub const CASTER_RECORDS: u32 = LINES + 2;
    /// The cascades' uniform block, which receivers read beside the shadow map.
    pub const SHADOWS: u32 = LINES + 3;
    /// The final pass's output settings.
    pub const FINAL_SETTINGS: u32 = LINES + 4;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = FINAL_SETTINGS + 1;

    /// three.js's table of the split-sum terms of specular light.
    pub const DFG: u32 = 1;
    /// The custom values of materials: one row of texels per material.
    pub const CUSTOM_VALUES: u32 = DFG + 1;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = CUSTOM_VALUES + 1;
    /// The texture arrays of materials' maps, after every id the render graph can take.
    pub const TEXTURE_ARRAYS: u32 = TARGETS + 256;
    /// The comparison sampler of the shadow map.
    pub const SHADOW_SAMPLER: u32 = 1;
    /// The samplers of materials' maps.
    pub const SAMPLERS: u32 = 2;

    pub const CULL: u32 = 1;

    /// Each view's bind groups: the frame group of its render pipelines, then its culling group.
    pub const fn frame_group(view: ViewId) -> u32 {
        1 + 2 * view.index() as u32
    }
    pub const fn cull_group(view: ViewId) -> u32 {
        frame_group(view) + 1
    }
    /// The final pass's group, after every view's.
    pub const FINAL_GROUP: u32 = 1 + 2 * MAX_VIEW_IDS as u32;
    /// The bind groups of materials' maps, after the final pass's group.
    pub const TEXTURE_GROUPS: u32 = FINAL_GROUP + 1;

    pub const fn bundle(view: ViewId) -> u32 {
        1 + view.index() as u32
    }
}

/// Sizes the builder allocates once, what the device offers, and how its frames reach the canvas.
#[derive(Clone, Copy, Debug)]
pub struct RendererConfig {
    /// The scene color's target, the anti-aliasing mode and the canvas's transparency.
    pub canvas: CanvasOutput,
    /// True when the device has transient attachments, render targets that may stay in tile
    /// memory (`Capabilities::TRANSIENT_ATTACHMENTS`).
    pub transient_attachments: bool,
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
            canvas: CanvasOutput::default(),
            transient_attachments: false,
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
    /// The scene's layout, which the camera views draw.
    layout: Layout,
    /// The shadow casters' layout, which the shadow cascades draw.
    casters: Layout,
    /// True when the layouts were built for a frame with shadows.
    layouts_shadowed: bool,
    /// Grid-cell culling: the scene's still objects in cell order, and each cell's box.
    cells: CellCulling,
    culling: Culling,
    lines: LinesPass,
    background: BackgroundPass,
    /// Each camera view's values in the frame being recorded, or `None` for a view with no camera.
    frames: Vec<Option<ViewFrame>>,
    /// Each shadow cascade's values in the frame being recorded, or `None` for a cascade that the
    /// frame does not draw.
    cascade_frames: [Option<ViewFrame>; MAX_CASCADES],
    /// The camera views and the cascades whose GPU objects exist.
    views_made: usize,
    cascades_made: usize,
    created: bool,
    /// True from the creation of three.js's table of specular terms until a frame uploads it.
    dfg_pending: bool,
}

/// The builder's scene settings: meshes in shared buffers, `max_materials` materials, textures
/// with the builder's ids, as large as every WebGPU device allows, and frames that reach the canvas
/// as `canvas` says.
fn scene_settings(max_materials: u32, canvas: CanvasOutput) -> SceneSettings {
    let textures = TextureStore::new(
        TextureIds {
            first_texture: ids::TEXTURE_ARRAYS,
            first_sampler: ids::SAMPLERS,
            first_group: ids::TEXTURE_GROUPS,
        },
        BUDGET[Limit::TextureDimension2D as usize],
    );
    SceneSettings::new(
        MeshStorage::new(Packing::SharedBuffers),
        max_materials,
        textures,
        canvas,
    )
}

impl GpuDrivenRenderer {
    pub fn new(config: RendererConfig) -> Self {
        Self {
            config,
            settings: scene_settings(config.max_materials, config.canvas),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            lists: ParityLists::new(config.draw_list_words),
            graph: {
                let mut graph = FrameGraph::new(
                    true,
                    config.canvas,
                    config.transient_attachments,
                    GraphIds {
                        first_texture: ids::TARGETS,
                        final_pass: FinalIds {
                            settings: ids::FINAL_SETTINGS,
                            group: ids::FINAL_GROUP,
                        },
                    },
                );
                graph.bind_shadow_map();
                graph
            },
            layout: Layout::new(Drawn::Scene),
            casters: Layout::new(Drawn::Casters),
            layouts_shadowed: false,
            cells: CellCulling::new(config.cell_culling, false),
            culling: Culling::default(),
            lines: LinesPass::new(ids::LINES),
            background: BackgroundPass::default(),
            frames: Vec::new(),
            cascade_frames: [None; MAX_CASCADES],
            views_made: 0,
            cascades_made: 0,
            created: false,
            dfg_pending: false,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// A view's values in the last recorded frame, or `None` when the view had no camera, or a
    /// cascade was not drawn. Its frustum is the one that the view's culling pass tested against.
    pub fn view_frame(&self, view: ViewId) -> Option<&ViewFrame> {
        match view.cascade_index() {
            Some(cascade) => self.cascade_frames.get(cascade)?.as_ref(),
            None => self.frames.get(view.index())?.as_ref(),
        }
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

    /// Records a frame into its parity's list and arena: the pipelines the GPU lacks, then the
    /// other objects it lacks, the uploads, and the passes of the render graph. Returns true when
    /// the frame rebuilt the draw tables.
    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        let parity = input.parity();
        let shadow = self
            .settings
            .shadow_frame(input.scene, parity, input.canvas);
        let upload_everything = input.structure_changed
            || !self.layout.built
            || shadow.is_some() != self.layouts_shadowed;
        if upload_everything {
            let limit = max_sources(self.config.storage_binding_bytes);
            let shadows = shadow.is_some();
            self.settings.update_map_groups();
            self.layout.rebuild(
                &self.settings,
                &mut self.pipelines,
                self.graph.scene_targets(),
                input.scene,
                input.batches,
                parity,
                limit,
                shadows,
            )?;
            // The casters' layout holds buckets only while the light casts shadows.
            if shadows {
                self.casters.rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    shadows::TARGETS,
                    input.scene,
                    input.batches,
                    parity,
                    limit,
                    shadows,
                )?;
            } else {
                self.casters.clear();
            }
            self.layouts_shadowed = shadows;
            let layout = &self.layout;
            self.cells
                .classify(input.scene, &|slot| layout.draws(slot))
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: (input.scene.capacity() + 1).saturating_mul(16),
                })?;
        }
        // The list starts with the pipelines it creates, so the thread that draws can start to
        // build them before it replays the rest (see `null3d_gpu::drawlist`).
        if !self.created {
            cull::create_pipeline(list)?;
        }
        self.lines.request_pipeline(
            &input.lines,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        self.graph.request_pipelines(&mut self.pipelines);
        self.background.request_pipeline(
            &self.settings,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        self.pipelines.create_new(list)?;
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph
            .set_shadows(shadow.as_ref().map(|s| ShadowPasses {
                cascades: s.cascades.count as u32,
                map_size: s.settings.map_size,
                layers: s.layers,
            }));
        self.graph.sync_views(self.settings.views());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.prepare(list, input.canvas)?;
        let shadow_map = self
            .graph
            .shadow_map()
            .expect("the builder's graph binds a shadow map");
        let views = self.settings.views().len();
        let first_new = self.views_made;
        for index in 0..views {
            let view = ViewId::from_index(index);
            if index >= first_new {
                opaque::create_frame_buffer(list, view)?;
                self.culling.add_view(list, view)?;
            }
            if index >= first_new || self.graph.textures_made() {
                opaque::bind_frame(list, view, shadow_map)?;
            }
        }
        self.views_made = self.views_made.max(views);
        let cascades = shadow.as_ref().map_or(0, |s| s.cascades.count);
        let first_new_cascade = self.cascades_made;
        for cascade in first_new_cascade..cascades {
            let view = ViewId::cascade(cascade);
            shadow::create_view(list, view)?;
            self.culling.add_view(list, view)?;
        }
        self.cascades_made = self.cascades_made.max(cascades);

        self.cells.update(input);
        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        self.graph.upload(list, arena, self.settings.output())?;
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::DFG)?;
        }
        let pages_remade = self
            .meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        let table = MaterialStorage::Buffer {
            table: ids::MATERIALS,
            values: ids::CUSTOM_VALUES,
        };
        let groups_remade = self
            .settings
            .record_materials(list, arena, table, input.frame)?;
        self.background.prepare(&self.settings);
        let binding_bytes = self.config.storage_binding_bytes;
        let shadows = shadow.is_some();
        let (shared_recreated, casters_recreated) = if upload_everything {
            let shared = self.layout.apply(list, arena, binding_bytes)?;
            let casters = shadows && self.casters.apply(list, arena, binding_bytes)?;
            (shared, casters)
        } else {
            self.layout.update_membership(list, arena, input, parity)?;
            if shadows {
                self.casters.update_membership(list, arena, input, parity)?;
            }
            (false, false)
        };
        // A view's bundle names the buffers, the bind groups and the layout it draws, so each new
        // view, and every view after a new layout, new mesh buffers or new map groups, records its
        // bundle.
        let first_to_apply = if upload_everything || pages_remade || groups_remade {
            0
        } else {
            first_new
        };
        let scene_targets = self.graph.scene_targets();
        for index in first_to_apply..views {
            let view = ViewId::from_index(index);
            self.culling
                .apply(list, view, &self.layout, shared_recreated, binding_bytes)?;
            opaque::record_bundle(list, view, &self.layout, &self.meshes, scene_targets)?;
        }
        let first_cascade_to_apply = if upload_everything || pages_remade {
            0
        } else {
            first_new_cascade
        };
        for cascade in first_cascade_to_apply..cascades {
            let view = ViewId::cascade(cascade);
            let recreated = shared_recreated || casters_recreated;
            self.culling
                .apply(list, view, &self.casters, recreated, binding_bytes)?;
            opaque::record_bundle(list, view, &self.casters, &self.meshes, shadows::TARGETS)?;
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
                self.culling.upload(
                    list,
                    arena,
                    view,
                    frame,
                    layout,
                    layout,
                    input.scene,
                    cells,
                )?;
            }
            self.frames.push(frame);
        }
        self.cascade_frames = [None; MAX_CASCADES];
        if let Some(shadow) = &shadow {
            shadows::upload(list, arena, ids::SHADOWS, shadow)?;
            for cascade in 0..cascades {
                let view = ViewId::cascade(cascade);
                let frame = shadow.view_frame(cascade);
                opaque::upload(list, arena, view, &frame)?;
                let (layout, casters, cells) = (&self.layout, &self.casters, &self.cells);
                self.culling.upload(
                    list,
                    arena,
                    view,
                    &frame,
                    layout,
                    casters,
                    input.scene,
                    cells,
                )?;
                self.cascade_frames[cascade] = Some(frame);
            }
        }
        let camera = self.frames[ViewId::CAMERA.index()].as_ref();
        self.lines
            .upload(list, arena, &input.lines, camera.map(|frame| &frame.camera))?;

        let (layout, casters, culling, lines) =
            (&self.layout, &self.casters, &self.culling, &self.lines);
        let (frames, cascade_frames) = (&self.frames, &self.cascade_frames);
        let background = &self.background;
        let drawn = |view: ViewId| match view.cascade_index() {
            Some(cascade) => cascade_frames[cascade].is_some(),
            None => frames[view.index()].is_some(),
        };
        let layout_of = |view: ViewId| match view.cascade_index() {
            Some(_) => casters,
            None => layout,
        };
        self.graph
            .record(list, self.settings.clear_color(), |list, role| match role {
                Role::Cull(view) if drawn(view) => culling.record(list, view, layout_of(view)),
                Role::Opaque(view) | Role::Shadow(view) if drawn(view) => {
                    if view == ViewId::CAMERA {
                        background.record(list, ids::frame_group(view), &[])?;
                    }
                    opaque::record(list, view)
                }
                Role::DebugLines => lines.record(list, ids::frame_group(ViewId::CAMERA), &[]),
                _ => Ok(()),
            })?;
        Ok(upload_everything)
    }

    /// Records the creation of the material table, the data texture of materials' custom values,
    /// and three.js's table of specular terms, whose sizes never change, and of the shadows'
    /// uniform block and sampler.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        shadows::create_objects(list, ids::SHADOWS, ids::SHADOW_SAMPLER)?;
        let materials = self.config.max_materials.max(1);
        list.push(
            Op::CreateBuffer,
            &[
                ids::MATERIALS,
                materials * MATERIAL_FLOATS as u32 * 4,
                usage::STORAGE | usage::COPY_DST,
            ],
        )?;
        list.push(
            Op::CreateTexture,
            &[
                ids::CUSTOM_VALUES,
                MATERIAL_TEXELS,
                materials,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        dfg::create(list, ids::DFG)?;
        self.dfg_pending = true;
        self.created = true;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the whole material table, three.js's table of specular terms, both layouts'
    /// tables, each view's and each cascade's frame uniform, culling parameters and indirect
    /// draws, the cascades' uniform, and the final pass's settings.
    fn upload_bound(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials =
            self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 * 2 + dfg::BYTES;
        let per_view = |layout: &Layout| {
            (sizes::FRAME_UNIFORM_BYTES + CULL_PARAMS_BYTES) as usize
                + layout.draws.len() * INDIRECT_BYTES as usize
        };
        let views = self.settings.views().len() * per_view(&self.layout);
        let cascades = MAX_CASCADES * per_view(&self.casters);
        let tables = self.layout.upload_bound() + self.casters.upload_bound();
        let shadows = sizes::SHADOW_UNIFORM_BYTES as usize;
        meshes + materials + tables + views + cascades + shadows + self.graph.upload_bound()
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
        self.casters.reserve(sources)?;
        let added = sources.saturating_sub(self.layout.sources);
        let bound = self.upload_bound() + (added * TABLE_BYTES_PER_SOURCE) as usize;
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
        self.casters.forget_gpu();
        self.culling.forget_gpu();
        self.views_made = 0;
        self.cascades_made = 0;
        self.lines.forget_gpu();
        self.meshes.forget();
        self.pipelines.forget();
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }
}
