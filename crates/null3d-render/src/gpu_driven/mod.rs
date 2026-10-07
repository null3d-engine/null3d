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
//! and `transparent` the transparent passes, `shadow` the shadow passes, and `layout` keeps the
//! sources and buckets that every view reads, with their uploads.
//!
//! # Blended sources
//!
//! A source whose material blends draws back to front, so it leaves the buckets that the GPU culls
//! and joins the transparent pass's sources (see [`crate::sorted`]). Its entry in the bucket table
//! is `HIDDEN`, and the job workers cull and sort it each frame for each camera view. It still
//! casts shadows through the casters' layout.
//!
//! # Shadows
//!
//! While the main directional light casts shadows, each cascade of its shadows (see
//! [`crate::shadows`]) is a view too. The cascades cull a second layout, of the objects that cast
//! shadows, grouped by mesh, and draw their depth with depth-only pipelines into their layers of
//! the shadow map. The scene's objects that receive shadows draw with pipelines that read the map.
//! Turning shadows on or off rebuilds both layouts. Every camera view's frame group binds the
//! shadow map, which is one texel of one layer while no light casts shadows.
//!
//! Point and spot lights cast shadows into the tiles of the shadow atlas (see
//! [`crate::shadow_tiles`]). Each tile is a view too, which culls and draws the casters' layout as
//! a cascade does, but only in the frames in which the tile must draw again. Every camera view's
//! frame group binds the atlas and the tiles' uniform block.
//!
//! # Lights
//!
//! The camera's point and spot lights reach the fragment shaders through its light grid (see
//! [`crate::light_grid`]). The CPU uploads the light list, and a compute pass before the culling
//! passes lists each cluster's lights in the grid.
//!
//! # Occlusion culling
//!
//! With two-phase occlusion culling, each camera view culls twice (see [`cull`] and [`pyramid`]).
//! The first phase keeps the objects in view that drew in the view's last frame, and the occluders'
//! pass draws their depth alone, into a depth target of its own, with the depth prepass's
//! pipelines and bundle. A compute pass then builds the view's depth pyramid from that depth, and
//! the second phase tests every object in view against it. The opaque pass draws the visible ones,
//! as it does without occlusion culling. Every object that the depth test would show is visible to
//! the second phase, so the image matches culling without the pyramid. Shadow views cull in one
//! phase.
//!
//! # Depth prepass
//!
//! With the depth prepass, each camera view also replays a bundle of its opaque buckets' depth
//! before its opaque bundle (see [`crate::pipelines`] and [`opaque`]).
//!
//! # Outlines
//!
//! While the sketch turns outlines on, a third layout holds the objects that it outlines, grouped
//! by mesh (see [`crate::outline`]). The outline view culls it with the camera's frustum and layers
//! into buffers of its own, and its bundle draws them into the outline mask. Outlining an object,
//! or turning outlines on or off, rebuilds the layouts, as casting shadows does.
//!
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
mod lights;
mod opaque;
mod pyramid;
mod shadow;
mod skin;
mod transparent;

use std::collections::TryReserveError;

use null3d_gpu::caps::{BUDGET, Limit, MAX_WORKGROUPS_PER_DIMENSION};
use null3d_gpu::drawlist::{
    DrawList, MAX_WORDS, Op, buffer_usage as usage, format, sizes, texture_usage, view,
};

use crate::ao::{self, AoIds};
use crate::background::BackgroundPass;
use crate::bloom::BloomIds;
use crate::cells::CellCulling;
use crate::debug_lines::LinesPass;
use crate::dfg;
use crate::environment;
use crate::final_pass::FinalIds;
use crate::frame::{
    CanvasOutput, FrameBuilder, FrameInput, MaterialStorage, MeshBuffers, ParityLists, RecordError,
    SceneSettings, UploadArena,
};
use crate::frame_graph::{FrameGraph, GraphIds, Role, ShadowPasses, TilePasses};
use crate::graph::RenderGraph;
use crate::light_grid::{CameraLights, LightGrid, LightLimits};
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MAX_BUFFER_BYTES, MeshMoves, MeshStorage, Packing};
use crate::output::{Antialias, SceneColor};
use crate::pipelines::{PipelineCache, Prepass};
use crate::shadow_tiles::{self, MAX_TILES, ShadowTiles};
use crate::shadows::{self, CascadeDepth, CasterPasses, MAX_CASCADES, ShadowUniform};
use crate::sorted::SortedLayout;
use crate::textures::{TextureIds, TextureStore};
use crate::view::{ViewFrame, ViewId};
use cull::{CULL_PARAMS_BYTES, Culling, INDIRECT_BYTES, Phase};
use layout::{Drawn, Layout};
use lights::LightClusters;
use opaque::Bundle;
use pyramid::Pyramids;
use skin::Skinning;
use transparent::Transparent;

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

/// Bytes of each source in the builder's tables: its entries in the bucket table, the layer table,
/// the casters' and the outlined objects' bucket tables, and its place in the cell order.
const TABLE_BYTES_PER_SOURCE: u32 = 20;

/// Engine memory the builder keeps for each source: its entries in the tables, and room for them
/// in both frames' upload arenas.
pub const BYTES_PER_SOURCE: u32 = 3 * TABLE_BYTES_PER_SOURCE;

/// The most sources on every WebGPU device: [`max_sources`] at WebGPU's default storage binding
/// limit. The WebGL2 path has its own limit, which follows the device's largest texture.
pub const PORTABLE_MAX_SOURCES: u32 = max_sources(sizes::PORTABLE_STORAGE_BINDING_BYTES);

/// The largest storage binding the builder can use: the instance buffer of the most sources one
/// dispatch covers. A device that offers more gains nothing from a larger binding.
pub const MAX_USEFUL_BINDING_BYTES: u32 =
    MAX_WORKGROUPS_PER_DIMENSION * sizes::CULL_WORKGROUP_SIZE * sizes::INSTANCE_STRIDE;

/// The error of a table that memory could not grow for.
fn out_of_memory(_: std::collections::TryReserveError) -> RecordError {
    RecordError::OutOfMemory { bytes: u32::MAX }
}

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own, the
/// shadow cascades' views after the camera views.
mod ids {
    use crate::ao::STEPS as AO_STEPS;
    use crate::bloom::STEPS;
    use crate::view::{MAX_VIEW_IDS, MAX_VIEWS, ViewId};

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
    /// The uniform block of the shadow atlas's tiles, which receivers read beside the atlas.
    pub const SHADOW_TILES: u32 = FINAL_SETTINGS + 1;
    /// Each camera view's sorted instances of the transparent pass, one buffer per view from here.
    const SORTED: u32 = SHADOW_TILES + 1;

    pub const fn sorted(view: ViewId) -> u32 {
        SORTED + view.index() as u32
    }

    /// The light grid of the camera's view: a word per cluster, then the light index list.
    pub const LIGHT_GRID: u32 = SORTED + MAX_VIEWS as u32;
    /// The records of the lights that the light grid lists.
    pub const LIGHTS: u32 = LIGHT_GRID + 1;
    /// The parameters of the light clustering pass, which fills the light grid.
    pub const LIGHT_PARAMS: u32 = LIGHTS + 1;
    /// The uniform buffer of bloom's steps and of the final pass's bloom build.
    pub const BLOOM: u32 = LIGHT_PARAMS + 1;
    /// The skinned vertex buffers that the skinning pass writes and the passes that draw skinned
    /// meshes read, one id each from here.
    const SKINNED: u32 = BLOOM + 1;

    pub const fn skinned(buffer: u32) -> u32 {
        SKINNED + buffer
    }
    /// The skinning pass's table of formats and parts, one segment per dispatch.
    pub const SKIN_TABLE: u32 = SKINNED + super::skin::MAX_SKINNED_BUFFERS;
    /// The uniform buffer of ambient occlusion's steps.
    pub const AO: u32 = SKIN_TABLE + 1;
    /// The outlined objects' bucket table and bucket records, which the outline view's culling
    /// reads.
    pub const OUTLINE_BUCKETS: u32 = AO + 1;
    pub const OUTLINE_RECORDS: u32 = OUTLINE_BUCKETS + 1;
    /// Each camera view's buffers of occlusion culling: its depth pyramid and the pyramid's level
    /// parameters, two ids from `OCCLUSION + 2 * view`.
    const OCCLUSION: u32 = OUTLINE_RECORDS + 1;

    pub const fn pyramid(view: ViewId) -> u32 {
        OCCLUSION + 2 * view.index() as u32
    }
    pub const fn pyramid_params(view: ViewId) -> u32 {
        pyramid(view) + 1
    }

    /// The placeholder that views without a depth pyramid bind in its place.
    pub const NO_PYRAMID: u32 = OCCLUSION + 2 * MAX_VIEWS as u32;

    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = NO_PYRAMID + 1;

    /// three.js's table of the split-sum terms of specular light.
    pub const DFG: u32 = 1;
    /// The custom values of materials: one row of texels per material.
    pub const CUSTOM_VALUES: u32 = DFG + 1;
    /// The final pass's blank color grading table, which it binds while the sketch sets none.
    pub const BLANK_LUT: u32 = CUSTOM_VALUES + 1;
    /// The blank cube that the frame's groups bind while the scene has no environment.
    pub const BLANK_ENVIRONMENT: u32 = BLANK_LUT + 1;
    /// Every animated instance's skinning matrices (see [`crate::skinning`]).
    pub const JOINTS: u32 = BLANK_ENVIRONMENT + 1;
    /// Every morphed mesh's deltas, in half floats (see [`crate::morph`]).
    pub const MORPHS: u32 = JOINTS + 1;
    /// Every morphed object's weights (see [`crate::morph`]).
    pub const MORPH_WEIGHTS: u32 = MORPHS + 1;
    /// The texture that frame groups bind in place of ambient occlusion's while it draws none.
    pub const BLANK_AO: u32 = MORPH_WEIGHTS + 1;
    /// The final pass's blank outline texture, which it binds while no outline draws.
    pub const BLANK_OUTLINE: u32 = BLANK_AO + 1;
    /// The offset from each view's camera to each grid cell, which the culling pass reads: one row
    /// per view (see [`super::cull`]).
    pub const CELL_OFFSETS: u32 = BLANK_OUTLINE + 1;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = CELL_OFFSETS + 1;
    /// The texture arrays of materials' maps, after every id the render graph can take.
    pub const TEXTURE_ARRAYS: u32 = TARGETS + 256;
    /// The comparison sampler of the shadow atlas.
    pub const SHADOW_SAMPLER: u32 = 1;
    /// The linear sampler of bloom's steps and of the final pass's bloom build.
    pub const BLOOM_SAMPLER: u32 = 2;
    /// The linear sampler of the final pass's color grading table.
    pub const LUT_SAMPLER: u32 = 3;
    /// The sampler of the environment's cube texture.
    pub const ENVIRONMENT_SAMPLER: u32 = 4;
    /// The sampler that reads four texels of the shadow map at once.
    pub const SHADOW_TEXEL_SAMPLER: u32 = 5;
    /// The samplers of materials' maps.
    pub const SAMPLERS: u32 = 6;

    pub const CULL: u32 = 1;
    /// The light clustering pass's pipelines, in the order it dispatches them.
    pub const LIGHT_COUNT: u32 = 2;
    pub const LIGHT_PLACE: u32 = 3;
    pub const LIGHT_WRITE: u32 = 4;
    /// The skinning pass's pipelines: for vertex formats without a tangent, and with one, then
    /// the same for formats whose color the pass morphs.
    pub const SKIN: u32 = 5;
    pub const SKIN_TANGENT: u32 = 6;
    pub const SKIN_COLOR: u32 = 7;
    pub const SKIN_TANGENT_COLOR: u32 = 8;
    /// The pipelines of occlusion culling: its two phases and the depth pyramid's.
    pub const OCCLUSION_EARLY: u32 = 9;
    pub const OCCLUSION_LATE: u32 = 10;
    pub const PYRAMID: u32 = 11;

    /// Each view's bind groups: the frame group of its render pipelines, then its culling group.
    pub const fn frame_group(view: ViewId) -> u32 {
        1 + 2 * view.index() as u32
    }
    pub const fn cull_group(view: ViewId) -> u32 {
        frame_group(view) + 1
    }
    /// The final pass's group, after every view's.
    pub const FINAL_GROUP: u32 = 1 + 2 * MAX_VIEW_IDS as u32;
    /// The light clustering pass's group.
    pub const LIGHT_GROUP: u32 = FINAL_GROUP + 1;
    /// Each camera view's group of its depth prepass, after the light clustering pass's group.
    pub const fn prepass_group(view: ViewId) -> u32 {
        LIGHT_GROUP + 1 + view.index() as u32
    }
    /// The bind group of each step of bloom, after the groups of the depth prepass.
    pub const BLOOM_GROUPS: u32 = LIGHT_GROUP + 1 + MAX_VIEWS as u32;
    /// The skinning pass's bind group for each of its segments, by their order, after bloom's.
    pub const SKIN_GROUPS: u32 = BLOOM_GROUPS + STEPS as u32;
    /// The joint texture's bind group, which pipelines that skin in the vertex shader read.
    pub const JOINTS_GROUP: u32 = SKIN_GROUPS + super::skin::MAX_SEGMENTS;
    /// The bind group of each step of ambient occlusion, after the joint texture's.
    pub const AO_GROUPS: u32 = JOINTS_GROUP + 1;
    /// Each camera view's group of its depth pyramid, after ambient occlusion's.
    pub const fn pyramid_group(view: ViewId) -> u32 {
        AO_GROUPS + AO_STEPS as u32 + view.index() as u32
    }
    /// The bind groups of materials' maps, after the depth pyramids'.
    pub const TEXTURE_GROUPS: u32 = AO_GROUPS + AO_STEPS as u32 + MAX_VIEWS as u32;

    pub const fn bundle(view: ViewId) -> u32 {
        1 + view.index() as u32
    }
    /// Each camera view's bundle of its depth prepass, after every view's bundle.
    pub const fn prepass_bundle(view: ViewId) -> u32 {
        1 + MAX_VIEW_IDS as u32 + view.index() as u32
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
    /// Words of room in each frame's draw list at the start. A list grows when a frame needs more.
    pub draw_list_words: usize,
    /// The most words that a frame's draw list grows to. A frame that needs more fails.
    pub draw_list_limit: usize,
    /// The device's largest storage binding, at most [`MAX_USEFUL_BINDING_BYTES`]. It caps the
    /// builder's buffers and the sources it can draw.
    pub storage_binding_bytes: u32,
    /// True to cull only the sources of grid cells in view; false to cull every source, as a
    /// benchmark of cell culling compares.
    pub cell_culling: bool,
    /// The most point and spot lights that the camera's light grid lists.
    pub light_limits: LightLimits,
    /// True to draw each camera view's opaque objects' depth in a depth prepass, before the opaque
    /// pass shades them.
    pub depth_prepass: bool,
    /// True to skin skinned meshes in the vertex shader of each pass that draws them, false to
    /// skin each once per frame in the skinning pass.
    pub vertex_skinning: bool,
    /// True to cull each camera view in two phases against a depth pyramid of what it drew, so
    /// objects that others hide do not draw. The depth prepass turns it off.
    pub gpu_occlusion: bool,
    /// How the shadow cascades store depth.
    pub cascade_depth: CascadeDepth,
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            canvas: CanvasOutput::default(),
            transient_attachments: false,
            max_materials: sizes::MAX_MATERIALS,
            draw_list_words: 16 * 1024,
            draw_list_limit: MAX_WORDS,
            storage_binding_bytes: sizes::PORTABLE_STORAGE_BINDING_BYTES,
            cell_culling: true,
            light_limits: LightLimits::default(),
            depth_prepass: false,
            vertex_skinning: false,
            gpu_occlusion: false,
            cascade_depth: CascadeDepth::default(),
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
    /// The outlined objects' layout, which the outline view draws.
    outlined: Layout,
    /// The shadow passes of the frame that the layouts were built for.
    layouts_shadowed: CasterPasses,
    /// True when the layouts were built while outlines are on.
    layouts_outlined: bool,
    /// True once the outline view's GPU objects exist.
    outline_made: bool,
    /// True when the scene's layout was built with the depth prepass's pipelines.
    layout_prepass: bool,
    /// The views whose depth prepass has its bind group.
    prepass_views: usize,
    /// Grid-cell culling: the scene's still objects in cell order, and each cell's box.
    cells: CellCulling,
    culling: Culling,
    /// Each camera view's depth pyramid, with occlusion culling.
    pyramids: Pyramids,
    lines: LinesPass,
    /// The sources of the transparent pass, and each camera view's sorted rows.
    sorted: SortedLayout,
    transparent: Transparent,
    background: BackgroundPass,
    /// The point and spot lights of the camera's view.
    lights: CameraLights,
    /// The pass that lists the lights of each cluster of the camera's light grid.
    light_clusters: LightClusters,
    /// The pass that skins the skinned meshes that some view draws.
    skinning: Skinning,
    /// Each camera view's values in the frame being recorded, or `None` for a view with no camera.
    frames: Vec<Option<ViewFrame>>,
    /// Each shadow cascade's values in the frame being recorded, or `None` for a cascade that the
    /// frame does not draw.
    cascade_frames: [Option<ViewFrame>; MAX_CASCADES],
    /// The tiles of the point and spot lights' shadow atlas.
    tiles: ShadowTiles,
    /// The camera views, the cascades and the tiles whose GPU objects exist.
    views_made: usize,
    cascades_made: usize,
    tiles_made: usize,
    /// True when the cascades' uniform block holds cascades, which receivers then read.
    cascades_held: bool,
    created: bool,
    /// True from the creation of three.js's table of specular terms until a frame uploads it.
    dfg_pending: bool,
    /// The cube texture that the camera views' frame groups bind: the environment's, or the
    /// blank one.
    bound_environment: u32,
}

/// The builder's scene settings from `config`: meshes in shared buffers, each page within one
/// storage binding, which the skinning pass reads it through, `max_materials` materials, textures
/// with the builder's ids, as large as every WebGPU device allows, and frames that reach the canvas
/// as `canvas` says.
fn scene_settings(config: &RendererConfig) -> SceneSettings {
    let textures = TextureStore::new(
        TextureIds {
            first_texture: ids::TEXTURE_ARRAYS,
            first_sampler: ids::SAMPLERS,
            first_group: ids::TEXTURE_GROUPS,
        },
        BUDGET[Limit::TextureDimension2D as usize],
    );
    SceneSettings::new(
        MeshStorage::with_page_limit(
            Packing::SharedBuffers,
            MAX_BUFFER_BYTES.min(u64::from(config.storage_binding_bytes)),
        ),
        config.max_materials,
        textures,
        config.canvas,
        config.cascade_depth,
    )
}

impl GpuDrivenRenderer {
    pub fn new(config: RendererConfig) -> Self {
        Self {
            config,
            settings: scene_settings(&config),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            lists: ParityLists::new(config.draw_list_words, config.draw_list_limit),
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
                            blank_lut: ids::BLANK_LUT,
                            lut_sampler: ids::LUT_SAMPLER,
                            blank_outline: ids::BLANK_OUTLINE,
                        },
                        bloom: BloomIds {
                            buffer: ids::BLOOM,
                            sampler: ids::BLOOM_SAMPLER,
                            first_group: ids::BLOOM_GROUPS,
                        },
                        ao: AoIds {
                            buffer: ids::AO,
                            first_group: ids::AO_GROUPS,
                        },
                    },
                );
                graph.bind_shadow_map(config.cascade_depth);
                graph.set_depth_prepass(config.depth_prepass);
                graph.set_occlusion(config.gpu_occlusion);
                graph
            },
            layout: Layout::new(Drawn::Scene),
            casters: Layout::new(Drawn::Casters),
            outlined: Layout::new(Drawn::Outlined),
            layouts_shadowed: CasterPasses::default(),
            layouts_outlined: false,
            outline_made: false,
            layout_prepass: false,
            prepass_views: 0,
            cells: CellCulling::new(config.cell_culling, false),
            culling: Culling::default(),
            pyramids: Pyramids::default(),
            lines: LinesPass::new(ids::LINES),
            sorted: SortedLayout::default(),
            transparent: Transparent::default(),
            background: BackgroundPass::default(),
            lights: CameraLights::on_gpu(config.light_limits),
            light_clusters: LightClusters::default(),
            skinning: Skinning::new(config.vertex_skinning),
            frames: Vec::new(),
            cascade_frames: [None; MAX_CASCADES],
            tiles: ShadowTiles::new(),
            views_made: 0,
            cascades_made: 0,
            tiles_made: 0,
            cascades_held: false,
            created: false,
            dfg_pending: false,
            bound_environment: ids::BLANK_ENVIRONMENT,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// A view's values in the last recorded frame, or `None` when the view had no camera, or a
    /// cascade or a tile was not drawn. Its frustum is the one that the view's culling pass tested
    /// against.
    pub fn view_frame(&self, view: ViewId) -> Option<&ViewFrame> {
        if let Some(tile) = view.tile_index() {
            return self.tiles.frame(tile);
        }
        match view.cascade_index() {
            Some(cascade) => self.cascade_frames.get(cascade)?.as_ref(),
            None => self.frames.get(view.index())?.as_ref(),
        }
    }

    /// The light grid of the camera's view in the frame recorded last, with the records that the
    /// shaders read.
    pub fn light_grid(&self) -> &LightGrid {
        self.lights.grid()
    }

    /// The tiles of the point and spot lights' shadow atlas in the last recorded frame.
    pub fn shadow_tiles(&self) -> &ShadowTiles {
        &self.tiles
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
        let shadow = self.settings.shadow_frame(input);
        let camera = self.settings.view_frame(
            ViewId::CAMERA,
            input.scene,
            parity,
            input.canvas,
            input.render_scale,
        );
        let tile_settings = self.settings.tile_settings();
        let filter = self.settings.shadow_quality().filter;
        self.tiles
            .plan(input, tile_settings, filter, camera.as_ref());
        // Receivers read the shadow maps while the sun or a point or spot light casts shadows, and
        // casters draw into the passes of each.
        let passes = CasterPasses {
            cascades: shadow
                .is_some()
                .then(|| self.settings.cascade_depth().targets()),
            tiles: self
                .tiles
                .shape()
                .is_some()
                .then_some(shadow_tiles::TARGETS),
        };
        let shadows = passes.any();
        let outlines = self.settings.outline().is_some();
        // Ambient occlusion reads the depth prepass's depth, so turning it on or off can switch
        // the prepass, whose pipelines the layout holds.
        let ao = self
            .settings
            .ao()
            .zip(self.settings.camera_projection(input.canvas));
        self.graph.set_ao(ao, self.settings.ao_scale());
        let waiting = (self.layout.waiting().iter())
            .chain(self.casters.waiting())
            .chain(self.sorted.waiting())
            .copied();
        let skinned_appear =
            self.skinning
                .open_when_built(&self.pipelines, waiting, input.pipelines_built);
        let upload_everything = input.structure_changed
            || !self.layout.built
            || passes != self.layouts_shadowed
            || outlines != self.layouts_outlined
            || self.graph.depth_prepass() != self.layout_prepass
            || skinned_appear;
        if upload_everything {
            let limit = max_sources(self.config.storage_binding_bytes);
            self.settings
                .prepare_rebuild(input.scene, input.batches, &mut self.pipelines);
            self.skinning.rebuild(
                input.scene,
                input.animations,
                input.morphs,
                self.settings.meshes(),
                self.config.storage_binding_bytes,
            )?;
            self.skinning.open_before_first_frame(input.pipelines_built);
            let targets = self.graph.scene_targets();
            self.layout.rebuild(
                &self.settings,
                &mut self.pipelines,
                targets,
                input.scene,
                input.batches,
                parity,
                limit,
                passes,
                self.graph.depth_pass(Prepass::DepthTemplate),
                &self.skinning,
            )?;
            self.layout_prepass = self.graph.depth_prepass();
            let skinning = &self.skinning;
            self.sorted
                .rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    targets,
                    input.scene,
                    input.batches,
                    |_, _| (0, 0),
                    0,
                    shadows,
                    |slot, key| skinning.sorted_pipeline(slot as u32, key),
                )
                .map_err(out_of_memory)?;
            // The casters' layout holds buckets only while a light casts shadows.
            if shadows {
                self.casters.rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    targets,
                    input.scene,
                    input.batches,
                    parity,
                    limit,
                    passes,
                    Prepass::Off,
                    &self.skinning,
                )?;
            } else {
                self.casters.clear();
            }
            self.skinning.asked();
            self.layouts_shadowed = passes;
            // The outlined layout holds buckets only while outlines are on.
            if outlines {
                self.outlined.rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    self.graph.outline_targets(),
                    input.scene,
                    input.batches,
                    parity,
                    limit,
                    passes,
                    Prepass::Off,
                    &self.skinning,
                )?;
            } else {
                self.outlined.clear();
            }
            self.layouts_outlined = outlines;
            // The cell order holds every object that a view or a cascade culls: blended casters
            // have no bucket in the scene's layout, as the transparent pass draws them, but cast
            // all the same. Blended objects can be outlined too.
            let (layout, casters, outlined) = (&self.layout, &self.casters, &self.outlined);
            self.cells
                .classify(input.scene, &|slot| {
                    layout.draws(slot)
                        || (shadows && casters.draws(slot))
                        || (outlines && outlined.draws(slot))
                })
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: (input.scene.capacity() + 1).saturating_mul(16),
                })?;
        }
        let views = self.settings.views().len();
        self.transparent
            .reserve(&self.sorted, views)
            .map_err(out_of_memory)?;
        // The list starts with the pipelines it creates, so the thread that draws can start to
        // build them before it replays the rest (see `null3d_gpu::drawlist`).
        let mut created_pipelines = !self.created;
        let occlusion = self.graph.occlusion();
        if !self.created {
            cull::create_pipeline(list)?;
            lights::create_pipelines(list)?;
        }
        self.lines.request_pipeline(
            &input.lines,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        self.graph
            .set_bloom(self.settings.bloom(), self.settings.bloom_chain());
        self.graph.set_grading(self.settings.grades());
        self.graph
            .set_outline(self.settings.outline(), !self.outlined.buckets.is_empty());
        self.graph
            .request_pipelines(&mut self.pipelines, input.pipelines_built);
        self.background.request_pipeline(
            &self.settings,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        created_pipelines |= self.skinning.create_pipeline(list, input.frame)?;
        // Occlusion culling's shaders load on first use: its pipelines wait for the scene's first
        // marked occluder.
        if occlusion && self.layout.occluders() > 0 {
            created_pipelines |= self.pyramids.create_pipelines(list, input.frame)?;
        }
        created_pipelines |= self.pipelines.create_new(list, input.frame)? > 0;
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph
            .set_shadows(shadow.as_ref().map(ShadowPasses::of));
        self.graph.set_tiles(self.tiles.shape().map(|s| TilePasses {
            tiles: s.layers,
            size: s.size,
        }));
        self.graph.set_skinning(self.skinning.dispatches());
        self.graph.sync_views(self.settings.views());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.set_transparent(!self.sorted.is_empty());
        self.graph.set_scaling(self.settings.render_scaling());
        self.graph.prepare(list, input.canvas, input.render_scale)?;
        let shadow_map = self
            .graph
            .shadow_map()
            .expect("the builder's graph binds a shadow map");
        let atlas = self
            .graph
            .shadow_atlas()
            .expect("the builder's graph binds a shadow atlas");
        let first_new = self.views_made;
        let depth_pass = self.graph.depth_pass(Prepass::DepthTemplate);
        let ao_texture = self.graph.ao_texture().unwrap_or(ids::BLANK_AO);
        for index in 0..views {
            let view = ViewId::from_index(index);
            if index >= first_new {
                opaque::create_frame_buffer(list, view)?;
                self.culling.add_view(list, view)?;
            }
            // Ambient occlusion can switch the prepass on after a view first drew, and
            // occlusion culling's occluders' pass draws into the same depth.
            if depth_pass != Prepass::Off && index >= self.prepass_views {
                shadow::bind_depth(list, ids::prepass_group(view), view)?;
            }
            if index >= first_new || self.graph.textures_made() {
                opaque::bind_frame(
                    list,
                    view,
                    shadow_map,
                    atlas,
                    ao_texture,
                    self.bound_environment,
                )?;
            }
        }
        self.views_made = self.views_made.max(views);
        if depth_pass != Prepass::Off {
            self.prepass_views = self.prepass_views.max(views);
        }
        // Each camera view's depth pyramid, whose new buffer its culling group binds again.
        let mut pyramids_made = 0u32;
        if occlusion {
            for index in 0..views {
                let view = ViewId::from_index(index);
                let depth = self
                    .graph
                    .depth_texture(view)
                    .expect("a view that culls in two phases samples its depth");
                if self.pyramids.prepare(list, view, input.canvas, depth)? {
                    pyramids_made |= 1 << index;
                }
            }
        }
        let cascades = shadow.as_ref().map_or(0, |s| s.cascades.count);
        let first_new_cascade = self.cascades_made;
        for cascade in first_new_cascade..cascades {
            let view = ViewId::cascade(cascade);
            shadow::create_view(list, view)?;
            self.culling.add_view(list, view)?;
        }
        self.cascades_made = self.cascades_made.max(cascades);
        let tiles = self.tiles.shape().map_or(0, |s| s.layers as usize);
        let first_new_tile = self.tiles_made;
        for tile in first_new_tile..tiles {
            let view = ViewId::tile(tile);
            shadow::create_view(list, view)?;
            self.culling.add_view(list, view)?;
        }
        self.tiles_made = self.tiles_made.max(tiles);
        let outline_drawn = self.graph.outline_draws();
        let new_outline = outline_drawn && !self.outline_made;
        if new_outline {
            shadow::create_view(list, ViewId::OUTLINE)?;
            self.culling.add_view(list, ViewId::OUTLINE)?;
            self.outline_made = true;
        }

        self.cells.update(input);
        // Each view's values first: the camera's light grid sets how much its upload takes.
        self.frames.clear();
        for index in 0..views {
            let view = ViewId::from_index(index);
            let mut frame = self.settings.view_frame(
                view,
                input.scene,
                parity,
                input.canvas,
                input.render_scale,
            );
            if let (Some(frame), ViewId::CAMERA) = (&mut frame, view) {
                self.lights.assign(input.jobs, frame, input.lights);
                self.lights.mark_shadows(&self.tiles, input.shadow_lights);
            }
            self.frames.push(frame);
        }

        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::DFG)?;
        }
        let pages_remade = self
            .meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        let skinned_remade = self.skinning.apply(
            list,
            input.animations,
            self.settings.meshes(),
            &self.meshes,
            pages_remade,
            self.config.storage_binding_bytes,
        )?;
        let buffers_remade = pages_remade || skinned_remade;
        let table = MaterialStorage::Buffer {
            table: ids::MATERIALS,
            values: ids::CUSTOM_VALUES,
        };
        let groups_remade = self
            .settings
            .record_materials(list, arena, table, input.frame)?;
        // The environment's map may have finished its upload, or gone, with this frame's texture
        // work, so the views read it from here on.
        let (environment, lit) = self.settings.environment_map(ids::BLANK_ENVIRONMENT);
        if environment != self.bound_environment {
            self.bound_environment = environment;
            for index in 0..views {
                let view = ViewId::from_index(index);
                opaque::bind_frame(list, view, shadow_map, atlas, ao_texture, environment)?;
            }
        }
        for frame in self.frames.iter_mut().flatten() {
            frame.uniform.environment = lit;
        }
        self.graph.upload(
            list,
            arena,
            self.settings.drawn_output(),
            self.settings.grading(),
        )?;
        self.background.prepare(&self.settings);
        let binding_bytes = self.config.storage_binding_bytes;
        let (shared_recreated, casters_recreated) = if upload_everything {
            let shared = self.layout.apply(list, arena, binding_bytes)?;
            let casters = shadows && self.casters.apply(list, arena, binding_bytes)?;
            if outlines {
                self.outlined.apply(list, arena, binding_bytes)?;
            }
            (shared, casters)
        } else {
            self.layout.update_membership(list, arena, input, parity)?;
            if shadows {
                self.casters.update_membership(list, arena, input, parity)?;
            }
            if outlines {
                self.outlined
                    .update_membership(list, arena, input, parity)?;
            }
            (false, false)
        };
        // A view's bundle names the buffers, the bind groups and the layout it draws, so each new
        // view, and every view after a new layout, new mesh buffers or new map groups, records its
        // bundle.
        let first_to_apply = if upload_everything || buffers_remade || groups_remade {
            0
        } else {
            first_new
        };
        let scene_targets = self.graph.scene_targets();
        for index in 0..views {
            let view = ViewId::from_index(index);
            let pyramid_made = pyramids_made & (1 << index) != 0;
            let records = index >= first_to_apply;
            if !records && !pyramid_made {
                continue;
            }
            let recreated = shared_recreated || pyramid_made;
            let (layout, meshes) = (&self.layout, &self.meshes);
            self.culling
                .apply(list, view, layout, recreated, binding_bytes, occlusion)?;
            if !records {
                continue;
            }
            // With occlusion culling, the opaque pass draws the second set of indirect draws, and
            // the occluders' pass the first, into its depth target alone.
            let (first_draw, depth_targets) = if occlusion {
                (layout.draws.len() as u32, scene_targets.occluder_depth())
            } else {
                (0, scene_targets)
            };
            let kind = Bundle::Opaque;
            opaque::record_bundle(list, view, layout, meshes, scene_targets, kind, first_draw)?;
            if depth_pass != Prepass::Off {
                let depth = Bundle::Prepass;
                opaque::record_bundle(list, view, layout, meshes, depth_targets, depth, 0)?;
            }
        }
        if outline_drawn && (upload_everything || buffers_remade || new_outline) {
            let view = ViewId::OUTLINE;
            // The outlined layout's tables are new whenever the layouts are.
            let recreated = shared_recreated || upload_everything;
            self.culling
                .apply(list, view, &self.outlined, recreated, binding_bytes, false)?;
            let targets = self.graph.outline_targets();
            let (outlined, meshes) = (&self.outlined, &self.meshes);
            opaque::record_bundle(list, view, outlined, meshes, targets, Bundle::Outline, 0)?;
        }
        let first_cascade_to_apply = if upload_everything || buffers_remade {
            0
        } else {
            first_new_cascade
        };
        let first_tile_to_apply = if upload_everything || buffers_remade {
            0
        } else {
            first_new_tile
        };
        let shadow_views = (first_cascade_to_apply..cascades)
            .map(ViewId::cascade)
            .chain((first_tile_to_apply..tiles).map(ViewId::tile));
        for view in shadow_views {
            let recreated = shared_recreated || casters_recreated;
            self.culling
                .apply(list, view, &self.casters, recreated, binding_bytes, false)?;
            let (casters, meshes) = (&self.casters, &self.meshes);
            let (targets, kind) = if view.tile_index().is_some() {
                (shadow_tiles::TARGETS, Bundle::Tile)
            } else {
                (self.settings.cascade_depth().targets(), Bundle::Opaque)
            };
            opaque::record_bundle(list, view, casters, meshes, targets, kind, 0)?;
        }
        self.layout
            .upload_matrices(list, input, parity, upload_everything)?;
        self.layout.update_skinned(list, arena, input.scene)?;
        if shadows {
            self.casters.update_skinned(list, arena, input.scene)?;
        }
        if outlines {
            self.outlined.update_skinned(list, arena, input.scene)?;
        }
        self.skinning.begin_frame();
        self.layout.update_order(list, arena, &self.cells, input)?;
        self.light_clusters.upload(list, arena, &mut self.lights)?;
        self.transparent.size(list, &self.sorted, views)?;

        let render_size = self.graph.render_size();
        for (index, frame) in self.frames.iter().enumerate() {
            let view = ViewId::from_index(index);
            if let Some(frame) = frame {
                opaque::upload(list, arena, view, frame)?;
                let levels = if occlusion {
                    Some(*self.pyramids.upload(list, arena, view, render_size)?)
                } else {
                    None
                };
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
                    levels.as_ref(),
                )?;
                let offsets = self.culling.offsets();
                self.skinning
                    .see(frame, offsets, input.scene, parity, false);
            }
        }
        if let (true, Some(frame)) = (outline_drawn, self.frames[ViewId::CAMERA.index()]) {
            let view = ViewId::OUTLINE;
            opaque::upload(list, arena, view, &frame)?;
            let (layout, outlined, cells) = (&self.layout, &self.outlined, &self.cells);
            self.culling.upload(
                list,
                arena,
                view,
                &frame,
                layout,
                outlined,
                input.scene,
                cells,
                None,
            )?;
        }
        self.cascade_frames = [None; MAX_CASCADES];
        if shadow.is_none() && self.cascades_held && shadows {
            // Receivers of point and spot light shadows read the cascades too: none now.
            let (at, bytes) = arena.push(ShadowUniform::default().as_bytes())?;
            list.push(Op::WriteBuffer, &[ids::SHADOWS, 0, at, bytes])?;
        }
        self.cascades_held = shadow.is_some() || (self.cascades_held && !shadows);
        self.tiles.upload(list, arena, ids::SHADOW_TILES)?;
        for tile in 0..tiles {
            let view = ViewId::tile(tile);
            let Some(frame) = self.tiles.frame(tile).copied() else {
                continue;
            };
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
                None,
            )?;
            let offsets = self.culling.offsets();
            self.skinning
                .see(&frame, offsets, input.scene, parity, true);
        }
        if let Some(shadow) = &shadow {
            shadows::upload(list, arena, ids::SHADOWS, shadow)?;
            for cascade in (0..cascades).filter(|&cascade| shadow.draws(cascade)) {
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
                    None,
                )?;
                let offsets = self.culling.offsets();
                self.skinning
                    .see(&frame, offsets, input.scene, parity, true);
                self.cascade_frames[cascade] = Some(frame);
            }
        }
        let storage = self.settings.meshes();
        self.skinning
            .upload(list, arena, input.animations, input.morphs, storage)?;
        let (scene, batches) = (input.scene, input.batches);
        self.sorted
            .gather(scene, batches, parity)
            .map_err(out_of_memory)?;
        self.transparent.sort(
            input.jobs,
            &self.sorted,
            &self.frames,
            scene,
            batches,
            parity,
        );
        for index in 0..views {
            let view = ViewId::from_index(index);
            self.transparent.upload(
                list,
                arena,
                view,
                &self.sorted,
                &self.skinning,
                input.jobs,
                scene,
                batches,
                parity,
            )?;
        }
        let camera = self.frames[ViewId::CAMERA.index()].as_ref();
        self.lines
            .upload(list, arena, &input.lines, camera.map(|frame| &frame.camera))?;

        let (layout, casters, culling, lines) =
            (&self.layout, &self.casters, &self.culling, &self.lines);
        let pyramids = &self.pyramids;
        // Without marked occluders, or until occlusion culling's pipelines are built, the frame
        // draws no occluders' depth and builds no pyramid: each camera view culls once, as without
        // occlusion culling, into the draws its opaque pass reads.
        let occluding =
            occlusion && self.layout.occluders() > 0 && self.pyramids.built(input.pipelines_built);
        let outlined = &self.outlined;
        let (frames, cascade_frames, tiles) = (&self.frames, &self.cascade_frames, &self.tiles);
        let (background, light_clusters) = (&self.background, &self.light_clusters);
        let skinning = &self.skinning;
        let drawn = |view: ViewId| match (view.cascade_index(), view.tile_index()) {
            (Some(cascade), _) => cascade_frames[cascade].is_some(),
            (_, Some(tile)) => tiles.frame(tile).is_some(),
            _ if view == ViewId::OUTLINE => outline_drawn && frames[0].is_some(),
            _ => frames[view.index()].is_some(),
        };
        let layout_of = |view: ViewId| match view {
            ViewId::OUTLINE => outlined,
            view if view.is_camera() => layout,
            _ => casters,
        };
        // A cascade or a tile that does not draw keeps its depth: its render pass is left out.
        let skips = |role: Role| match role {
            Role::Shadow(view) => !drawn(view),
            Role::Occluders(_) => !occluding,
            _ => false,
        };
        let (sorted, transparent) = (&self.sorted, &self.transparent);
        let (settings, meshes) = (&self.settings, &self.meshes);
        self.graph.record(
            list,
            self.settings.clear_color(),
            skips,
            |list, role| match role {
                Role::LightClusters => light_clusters.record(list),
                Role::Skin => skinning.record(list),
                Role::Cull(view) if drawn(view) => {
                    let phase = if occluding && culling.occludes(view) {
                        Phase::Early
                    } else {
                        Phase::Once
                    };
                    culling.record(list, view, layout_of(view), phase)
                }
                Role::Prepass(view) | Role::Occluders(view) if drawn(view) => {
                    opaque::record(list, view, Bundle::Prepass)
                }
                Role::Opaque(view) | Role::Shadow(view) if drawn(view) => {
                    if view == ViewId::CAMERA {
                        background.record(list, ids::frame_group(view), &[])?;
                    }
                    opaque::record(list, view, Bundle::Opaque)
                }
                Role::Pyramid(view) if drawn(view) && occluding => pyramids.record(list, view),
                Role::LateCull(view) if drawn(view) && occluding => {
                    culling.record(list, view, layout, Phase::Late)
                }
                Role::OutlineMask if drawn(ViewId::OUTLINE) => {
                    opaque::record(list, ViewId::OUTLINE, Bundle::Outline)
                }
                Role::DebugLines => lines.record(list, ids::frame_group(ViewId::CAMERA), &[]),
                Role::Transparent(view) => {
                    transparent.record(list, view, sorted, skinning, settings, meshes)
                }
                _ => Ok(()),
            },
        )?;
        self.tiles
            .finish(input.frame, created_pipelines, input.pipelines_built);
        Ok(upload_everything)
    }

    /// Records the creation of the material table, the data texture of materials' custom values,
    /// and three.js's table of specular terms, whose sizes never change, and of the shadows'
    /// uniform block and sampler.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        shadows::create_objects(
            list,
            ids::SHADOWS,
            ids::SHADOW_SAMPLER,
            Some(ids::SHADOW_TEXEL_SAMPLER),
        )?;
        ShadowTiles::create_objects(list, ids::SHADOW_TILES)?;
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
        environment::create_objects(list, ids::BLANK_ENVIRONMENT, ids::ENVIRONMENT_SAMPLER)?;
        ao::create_blank(list, ids::BLANK_AO)?;
        lights::create(list, &self.lights)?;
        self.dfg_pending = true;
        self.created = true;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the whole material table, three.js's table of specular terms, both layouts'
    /// tables, the light grid, each view's, each cascade's and each tile's frame uniform, culling
    /// parameters and indirect draws, the cascades' and the tiles' uniforms, and the final pass's
    /// settings.
    fn upload_bound(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials =
            self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 * 2 + dfg::BYTES;
        let per_view = |layout: &Layout| {
            (sizes::FRAME_UNIFORM_BYTES + CULL_PARAMS_BYTES) as usize
                + layout.draws.len() * INDIRECT_BYTES as usize
        };
        let camera_views = self.settings.views().len();
        let pyramids = if self.graph.occlusion() {
            Pyramids::UPLOAD_BYTES
        } else {
            0
        };
        let views = camera_views * (per_view(&self.layout) + pyramids) + per_view(&self.outlined);
        let tiles = self.settings.tile_settings().tiles as usize;
        let cascades = (MAX_CASCADES + tiles.min(MAX_TILES)) * per_view(&self.casters);
        let tables =
            self.layout.upload_bound() + self.casters.upload_bound() + self.outlined.upload_bound();
        let lights = self.lights.upload_room();
        let shadows = (sizes::SHADOW_UNIFORM_BYTES + sizes::SHADOW_TILES_UNIFORM_BYTES) as usize;
        let sorted = Transparent::upload_bound(&self.sorted, camera_views);
        let skinning = self.skinning.upload_bound(self.settings.meshes());
        meshes
            + skinning
            + materials
            + tables
            + lights
            + views
            + cascades
            + shadows
            + sorted
            + self.graph.upload_bound()
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
        self.outlined.reserve(sources)?;
        let added = sources.saturating_sub(self.layout.sources);
        let bound = self.upload_bound() + (added * TABLE_BYTES_PER_SOURCE) as usize;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound)?;
        }
        Ok(())
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame)?;
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena, result)
    }

    fn casts_tile_shadows(&self) -> bool {
        self.tiles.shape().is_some()
    }

    fn meshes_moved(&mut self, _ids: &[u32], moves: &MeshMoves) {
        self.meshes.moved(moves);
        if let Some(first) = moves.morph_texels {
            self.skinning.morph_mut().deltas_moved(first);
        }
    }

    fn mesh_gpu_bytes(&self) -> u64 {
        self.meshes.gpu_bytes() + self.skinning.morph().delta_bytes()
    }

    fn reset_gpu(&mut self) {
        self.lists.reset_gpu();
        self.created = false;
        self.bound_environment = ids::BLANK_ENVIRONMENT;
        self.graph.reset_gpu();
        self.settings.forget_shadow_maps();
        self.layout.forget_gpu();
        self.casters.forget_gpu();
        self.outlined.forget_gpu();
        self.outline_made = false;
        self.culling.forget_gpu();
        self.pyramids.forget_gpu();
        self.views_made = 0;
        self.prepass_views = 0;
        self.cascades_made = 0;
        self.tiles_made = 0;
        self.cascades_held = false;
        self.tiles.forget_gpu();
        self.lines.forget_gpu();
        self.lights.forget_gpu();
        self.skinning.forget_gpu();
        self.transparent.forget_gpu();
        self.meshes.forget();
        self.pipelines.forget();
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }

    fn set_canvas_output(&mut self, scene_color: SceneColor, antialias: Antialias) {
        let canvas = self.settings.switch_canvas(scene_color, antialias);
        self.graph.set_canvas(canvas);
    }
}
