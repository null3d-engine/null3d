//! The WebGL2 frame builder. WebGL2 has no compute shaders, so the job workers cull every object
//! and instance on the CPU, view by view. Each view's frame lists its visible objects, bucket by
//! bucket, in an index list, and the view's opaque pass draws each bucket's slice of the list with
//! instanced draws: many draws in one call where the device has `WEBGL_multi_draw`, one call per
//! draw elsewhere.
//!
//! # Sources and data textures
//!
//! Every scene slot and every row of every instance batch is a source, and each source's world
//! matrix is three texels of a float data texture. The resident texture holds the scene's slots
//! and the rows of static batches, and each frame writes only the rows that changed. The streamed
//! texture holds the rows of dynamic batches, which change every frame, so each frame writes them
//! whole into the next of three textures, never into one the GPU may still read for an earlier
//! frame. Every view reads these textures, and has its own ring of three index list textures.
//!
//! # Buckets and passes
//!
//! A bucket is one pipeline, mesh, material and data texture, and culling lists its visible
//! sources in its slice of the index list. A pipeline is one shading and one vertex format. A
//! bucket has one draw per part of its mesh, and every draw of a bucket draws the bucket's slice.
//! Buckets change only with the scene's structure, as on WebGPU. Showing or hiding an object, or
//! changing a batch's active count, needs no rebuild: culling skips hidden objects and stops at
//! each batch's active count.
//!
//! Each part has a module: `layout` keeps the sources, buckets and clusters, `data` the data
//! textures and their rings, `cull` culls each view on the job workers, and `opaque` records the
//! opaque passes. The debug lines pass, which both builders share, is [`crate::debug_lines`], and
//! the background texture that the camera's opaque pass draws before its buckets is
//! [`crate::background`]. The render graph ([`crate::frame_graph`]) orders the passes and begins
//! their render passes.
//!
//! # Cells
//!
//! World matrices are relative to their grid cells' centers (see [`null3d_core::cells`]). Each
//! index list entry holds its row, or its cluster, with the row's cell index above it. Each frame
//! uploads, for each view, the offset from the view's camera to each cell in use beside the view's
//! frame constants, and the vertex shader adds an instance's offset to its matrix, so it draws
//! positions relative to the camera. When only the cameras move, static matrices stay in the
//! resident texture, and each view uploads its constants, its offsets and, when it changed, its
//! index list.
//!
//! # Shadows
//!
//! While the main directional light casts shadows, each cascade of its shadows (see
//! [`crate::shadows`]) is a view too. The job workers cull a second layout for the cascades, of
//! the scene objects that cast shadows, grouped by mesh, into an index list per cascade. Each
//! cascade's shadow pass draws their depth with depth-only programs into its layer of the shadow
//! map, a depth texture array that the receivers sample with a comparison sampler. The scene's
//! objects that receive shadows draw with programs that read the map. Turning shadows on or off
//! rebuilds both layouts. Every camera view's frame group binds the shadow map, which is one texel
//! of one layer while no light casts shadows.
//!
//! Point and spot lights cast shadows into the tiles of the shadow atlas (see
//! [`crate::shadow_tiles`]). Each tile is a view too, which the job workers cull against the
//! casters' layout into an index list of its own, but only in the frames in which the tile must
//! draw again. Every camera view's frame groups bind the atlas and the tiles' uniform block.
//!
//! # Outlines
//!
//! While the sketch turns outlines on, a third layout holds the scene objects that it outlines,
//! grouped by mesh (see [`crate::outline`]). The job workers cull it for the outline view with the
//! camera's frustum and layers, into an index list of its own, and the mask pass draws each of its
//! buckets twice into the outline mask. Outlining an object, or turning outlines on or off,
//! rebuilds the layouts, as casting shadows does.
//!
//! # Depth prepass
//!
//! With the depth prepass, each camera view first draws its opaque draws' depth, from the same
//! index list and draw records, with each draw's own vertex shader and a fragment shader that
//! writes nothing ([`Prepass::OwnVertexShader`], [`opaque`]). The opaque pass then shades only
//! where its depth equals the prepass's.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. Each frame parity keeps its own culling
//! output, because the render worker replays a frame's list while the next frame culls, and the
//! list uploads the index list straight from that output. Only the first frames after the scene
//! grows, or gains a view, allocate.

mod cull;
mod data;
mod layout;
mod lights;
mod opaque;
mod skin;
mod transparent;

use std::collections::TryReserveError;

use null3d_core::cells::CELL_SHIFT;
use null3d_core::culling::{BucketedCull, NO_BUCKET};
use null3d_core::handle::Handle;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{
    DrawList, MAX_WORDS, Op, format, permutation, sizes, texture_usage, view,
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
    SceneSettings, UploadArena, drawn_rows, joined_rows,
};
use crate::frame_graph::{FrameGraph, GraphIds, Role, ShadowPasses, TilePasses};
use crate::graph::RenderGraph;
use crate::light_grid::{CameraLights, LightGrid, LightLimits};
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MeshStorage, Packing};
use crate::occlusion::Occluders;
use crate::output::{Antialias, SceneColor};
use crate::pipelines::{PassTargets, PipelineCache, Prepass};
use crate::shadow_tiles::{MAX_TILES, ShadowTiles};
use crate::shadows::{self, MAX_CASCADES, ShadowFrame, ShadowUniform};
use crate::sorted::SortedLayout;
use crate::textures::{TextureIds, TextureStore};
use crate::view::{ViewFrame, ViewId};
use cull::Culling;
use data::{RingSlot, SharedTextures, matrices_of, write_matrices};
use layout::{Clusters, Drawn, Layout, RESIDENT, STREAMED};
use lights::LightTextures;
use opaque::{LitTextures, OFFSETS_BYTES, Opaque, Shading, ViewUpload};
use skin::Skins;
use transparent::Transparent;

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own, the
/// shadow cascades' views after the camera views.
mod ids {
    use super::data::RING;
    use crate::ao::STEPS as AO_STEPS;
    use crate::bloom::STEPS;
    use crate::view::{MAX_VIEW_IDS, ViewId};

    /// Each view's buffers: its ring of frame uniforms, then its draw records, from
    /// `VIEW_BUFFERS + 2 * view`.
    const VIEW_BUFFERS: u32 = 1;

    pub const fn frame(view: ViewId) -> u32 {
        VIEW_BUFFERS + 2 * view.index() as u32
    }
    pub const fn draws(view: ViewId) -> u32 {
        frame(view) + 1
    }
    /// The vertices of the debug lines.
    pub const LINES: u32 = VIEW_BUFFERS + 2 * MAX_VIEW_IDS as u32;
    /// The cascades' uniform block, which receivers read beside the shadow map.
    pub const SHADOWS: u32 = LINES + 1;
    /// The final pass's settings.
    pub const FINAL_SETTINGS: u32 = SHADOWS + 1;
    /// The uniform block of the shadow atlas's tiles, which receivers read beside the atlas.
    pub const SHADOW_TILES: u32 = FINAL_SETTINGS + 1;
    /// The uniform buffer of bloom's steps and of the final pass's bloom build.
    pub const BLOOM: u32 = SHADOW_TILES + 1;
    /// The uniform buffer of ambient occlusion's steps.
    pub const AO: u32 = BLOOM + 1;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = AO + 1;

    pub const RESIDENT: u32 = 1;
    /// The ring of streamed textures, one per ring slot.
    pub const STREAMED: u32 = 2;
    /// The rows of static batches in cluster order.
    pub const CLUSTERS: u32 = STREAMED + RING;
    /// Each view's ring of index list textures, one per ring slot, from
    /// `VIEW_TEXTURES + RING * view`.
    const VIEW_TEXTURES: u32 = CLUSTERS + 1;

    pub const fn visible(view: ViewId) -> u32 {
        VIEW_TEXTURES + RING * view.index() as u32
    }

    /// The material table: one row of texels per material.
    pub const MATERIALS: u32 = VIEW_TEXTURES + RING * MAX_VIEW_IDS as u32;
    /// three.js's table of the split-sum terms of specular light.
    pub const DFG: u32 = MATERIALS + 1;
    /// The ring of light grid textures of the camera's view, one per ring slot.
    pub const LIGHT_GRID: u32 = DFG + 1;
    /// The ring of textures of the records of the lights that the light grid lists.
    pub const LIGHTS: u32 = LIGHT_GRID + RING;
    /// The final pass's blank color grading table, which it binds while the sketch sets none.
    pub const BLANK_LUT: u32 = LIGHTS + RING;
    /// The blank cube that the frame's groups bind while the scene has no environment.
    pub const BLANK_ENVIRONMENT: u32 = BLANK_LUT + 1;
    /// The final pass's blank outline texture, which it binds while no outline draws.
    pub const BLANK_OUTLINE: u32 = BLANK_ENVIRONMENT + 1;
    /// Every animated instance's skinning matrices (see [`crate::skinning`]).
    pub const JOINTS: u32 = BLANK_OUTLINE + 1;
    /// The first joint of the instance that skins each source row, then the first texel of the
    /// morph weights of each source row.
    pub const FIRST_JOINTS: u32 = JOINTS + 1;
    /// Every morphed mesh's deltas, in half floats (see [`crate::morph`]).
    pub const MORPHS: u32 = FIRST_JOINTS + 1;
    /// Every morphed object's weights (see [`crate::morph`]).
    pub const MORPH_WEIGHTS: u32 = MORPHS + 1;
    /// The texture that frame groups bind in place of ambient occlusion's while it draws none.
    pub const BLANK_AO: u32 = MORPH_WEIGHTS + 1;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = BLANK_AO + 1;
    /// The texture arrays of materials' maps, after every id the render graph can take.
    pub const TEXTURE_ARRAYS: u32 = TARGETS + 256;
    /// The comparison sampler of the shadow atlas. The shadow map reads its texels without one.
    pub const SHADOW_SAMPLER: u32 = 1;
    /// The linear sampler of bloom's steps and of the final pass's bloom build.
    pub const BLOOM_SAMPLER: u32 = 2;
    /// The linear sampler of the final pass's color grading table.
    pub const LUT_SAMPLER: u32 = 3;
    /// The sampler of the environment's cube texture.
    pub const ENVIRONMENT_SAMPLER: u32 = 4;
    /// The samplers of materials' maps.
    pub const SAMPLERS: u32 = 5;

    /// Each view's bind groups: a frame group per slot of the light textures' ring, the draw
    /// record group, then the groups of its instance textures, one per pair of ring slots.
    const GROUPS_PER_VIEW: u32 = RING + 1 + RING * RING;
    /// The final pass's group, after every view's.
    pub const FINAL_GROUP: u32 = 1 + GROUPS_PER_VIEW * MAX_VIEW_IDS as u32;

    /// The frame group of the light textures' first ring slot: slot `s` has the group `s` after
    /// it.
    pub const fn frame_group(view: ViewId) -> u32 {
        1 + GROUPS_PER_VIEW * view.index() as u32
    }
    pub const fn draws_group(view: ViewId) -> u32 {
        frame_group(view) + RING
    }
    /// The textures of each pair of ring slots: the streamed texture's and the view's index
    /// list's, at `instances_group(view) + streamed * RING + listed`.
    pub const fn instances_group(view: ViewId) -> u32 {
        draws_group(view) + 1
    }
    /// The bind group of each step of bloom, after the final pass's group.
    pub const BLOOM_GROUPS: u32 = FINAL_GROUP + 1;
    /// The bind group of each step of ambient occlusion, after bloom's.
    pub const AO_GROUPS: u32 = BLOOM_GROUPS + STEPS as u32;
    /// The bind groups of materials' maps, after ambient occlusion's.
    pub const TEXTURE_GROUPS: u32 = AO_GROUPS + AO_STEPS as u32;
}

/// Sizes the builder allocates once, what the device offers, and how frames reach the canvas.
#[derive(Clone, Copy, Debug)]
pub struct CpuCulledConfig {
    /// The scene color's target, the anti-aliasing mode and the canvas's transparency.
    pub canvas: CanvasOutput,
    /// Materials the table holds, at most [`sizes::MAX_MATERIALS`].
    pub max_materials: u32,
    /// Words of room in each frame's draw list at the start. A list grows when a frame needs more.
    pub draw_list_words: usize,
    /// The most words that a frame's draw list grows to. A frame that needs more fails.
    pub draw_list_limit: usize,
    /// The device's largest texture width and height; WebGL2 allows at least 2,048.
    pub max_texture_size: u32,
    /// True when the device has `WEBGL_multi_draw`.
    pub multi_draw: bool,
    /// True to skip every still object of a grid cell out of view before testing objects; false
    /// to test every object, as a benchmark of cell culling compares.
    pub cell_culling: bool,
    /// The most point and spot lights that the camera's light grid lists.
    pub light_limits: LightLimits,
    /// True to draw each camera view's opaque objects' depth in a depth prepass, before the opaque
    /// pass shades them.
    pub depth_prepass: bool,
}

impl Default for CpuCulledConfig {
    fn default() -> Self {
        Self {
            canvas: CanvasOutput::default(),
            max_materials: sizes::MAX_MATERIALS,
            draw_list_words: 64 * 1024,
            draw_list_limit: MAX_WORDS,
            max_texture_size: 2048,
            multi_draw: false,
            cell_culling: true,
            light_limits: LightLimits::default(),
            depth_prepass: false,
        }
    }
}

/// The most sources the builder can draw on a device whose textures reach `max_texture_size`:
/// each texture group, and the index list, must fit one texture, and an index list entry holds a
/// source below its cell index, in [`MAX_SOURCE_BITS`] bits.
pub const fn max_sources(max_texture_size: u32) -> u32 {
    let by_texture = sizes::MATRICES_PER_TEXTURE_ROW.saturating_mul(max_texture_size);
    if by_texture < 1 << MAX_SOURCE_BITS {
        by_texture
    } else {
        1 << MAX_SOURCE_BITS
    }
}

/// Bits of a source in an index list entry: those below the cell index.
pub const MAX_SOURCE_BITS: u32 = CELL_SHIFT;

/// Records one draw list per frame for the WebGL2 path.
pub struct CpuCulledRenderer {
    config: CpuCulledConfig,
    settings: SceneSettings,
    lists: ParityLists,
    graph: FrameGraph,
    /// The scene's layout, which the camera views draw.
    layout: Layout,
    /// The shadow casters' layout, which the shadow cascades draw.
    casters: Layout,
    /// The outlined objects' layout, which the outline view draws.
    outlined: Layout,
    /// True when the layouts were built for a frame with shadows.
    layouts_shadowed: bool,
    /// True when the layouts were built while outlines are on.
    layouts_outlined: bool,
    /// True when the scene's layout was built with the depth prepass's pipelines.
    layout_prepass: bool,
    clusters: Clusters,
    /// Grid-cell culling: the still scene objects in cell order, and each cell's box.
    cells: CellCulling,
    culling: Culling,
    /// The camera's blockers for software occlusion culling.
    occluders: Occluders,
    opaque: Opaque,
    /// The shadow cascades' culling output and draws.
    cascade_culling: Culling,
    cascade_draws: Opaque,
    /// The main directional light's shadows in the frame that culled last, or `None` without them.
    shadow: Option<ShadowFrame>,
    /// The tiles of the point and spot lights' shadow atlas, as the frame that culled last planned
    /// them, and the culling output and draws of the tiles that draw.
    tiles: ShadowTiles,
    tile_culling: Culling,
    tile_draws: Opaque,
    /// The outline view's culling output and draws.
    outline_culling: Culling,
    outline_draws: Opaque,
    /// True when the cascades' uniform block holds cascades, which receivers then read.
    cascades_held: bool,
    lines: LinesPass,
    /// The sources of the transparent pass, and each view's draws of it.
    sorted: SortedLayout,
    transparent: Transparent,
    background: BackgroundPass,
    /// The vertex pages' vertex and index buffers.
    meshes: MeshBuffers,
    pipelines: PipelineCache,
    textures: SharedTextures,
    /// The slot of the streamed textures, which every view reads.
    streamed_slot: RingSlot,
    /// The point and spot lights of the camera's view, and the textures that hold them.
    lights: CameraLights,
    light_textures: LightTextures,
    /// The skinned scene objects, and the textures that their vertex shaders read.
    skins: Skins,
    created: bool,
    /// True from the creation of three.js's table of specular terms until a frame uploads it.
    dfg_pending: bool,
    /// The cube texture that the camera views' frame groups bind: the environment's, or the
    /// blank one.
    bound_environment: u32,
}

impl CpuCulledRenderer {
    pub fn new(config: CpuCulledConfig) -> Self {
        assert!(
            config.max_materials <= sizes::MAX_MATERIALS,
            "the material texture holds {} materials",
            sizes::MAX_MATERIALS
        );
        let textures = TextureStore::new(
            TextureIds {
                first_texture: ids::TEXTURE_ARRAYS,
                first_sampler: ids::SAMPLERS,
                first_group: ids::TEXTURE_GROUPS,
            },
            config
                .max_texture_size
                .min(BUDGET[Limit::TextureDimension2D as usize]),
        );
        Self {
            config,
            settings: SceneSettings::new(
                MeshStorage::new(Packing::Pages),
                config.max_materials,
                textures,
                config.canvas,
            ),
            lists: ParityLists::new(config.draw_list_words, config.draw_list_limit),
            // WebGL2 has no transient attachments: the backend discards what a pass does not store
            // with `invalidateFramebuffer` instead.
            graph: {
                let mut graph = FrameGraph::new(
                    false,
                    config.canvas,
                    false,
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
                graph.bind_shadow_map();
                graph.set_depth_prepass(config.depth_prepass);
                graph
            },
            layout: Layout::new(Drawn::Scene),
            casters: Layout::new(Drawn::Casters),
            outlined: Layout::new(Drawn::Outlined),
            layouts_shadowed: false,
            layouts_outlined: false,
            layout_prepass: false,
            clusters: Clusters::default(),
            cells: CellCulling::new(config.cell_culling, true),
            culling: Culling::new(ViewId::CAMERA),
            occluders: Occluders::default(),
            opaque: Opaque::new(ViewId::CAMERA, config.multi_draw),
            cascade_culling: Culling::new(ViewId::cascade(0)),
            cascade_draws: Opaque::new(ViewId::cascade(0), config.multi_draw),
            shadow: None,
            tiles: ShadowTiles::new(),
            tile_culling: Culling::new(ViewId::tile(0)),
            tile_draws: Opaque::new(ViewId::tile(0), config.multi_draw),
            outline_culling: Culling::new(ViewId::OUTLINE),
            outline_draws: Opaque::new(ViewId::OUTLINE, config.multi_draw),
            cascades_held: false,
            lines: LinesPass::new(ids::LINES),
            sorted: SortedLayout::default(),
            transparent: Transparent::new(config.multi_draw),
            background: BackgroundPass::default(),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            textures: SharedTextures::default(),
            streamed_slot: RingSlot::default(),
            lights: CameraLights::new(config.light_limits),
            light_textures: LightTextures::default(),
            skins: Skins::default(),
            created: false,
            dfg_pending: false,
            bound_environment: ids::BLANK_ENVIRONMENT,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// The light grid of the camera's view in the frame recorded last, with the records that the
    /// shaders read.
    pub fn light_grid(&self) -> &LightGrid {
        self.lights.grid()
    }

    /// The tiles of the point and spot lights' shadow atlas, as the frame that culled last planned
    /// them.
    pub fn shadow_tiles(&self) -> &ShadowTiles {
        &self.tiles
    }

    /// The culling output of a frame's parity for a view or a shadow cascade: its visible sources,
    /// bucket by bucket.
    pub fn culled(&self, frame: u32, view: ViewId) -> &BucketedCull {
        self.culling_of(view).culled(frame, view)
    }

    /// A view's or a shadow cascade's values in the frame that culled last, or `None` when the
    /// view had no camera, or the frame drew no such cascade.
    pub fn view_frame(&self, view: ViewId) -> Option<&ViewFrame> {
        self.culling_of(view).frame(view)
    }

    /// The objects, instance rows and clusters that a view's or a shadow cascade's culling tested
    /// in the frame that culled last. For tests of what grid-cell culling skips.
    pub fn tested(&self, view: ViewId) -> u32 {
        self.culling_of(view).tested(view)
    }

    /// A static batch's rows in cluster order, while its clusters are current: each cluster holds
    /// 64 entries, and a cell's last cluster ends with `u32::MAX`. For tests.
    pub fn cluster_order(&self, batch: Handle) -> Option<&[u32]> {
        let slot = self.layout.batch(batch.raw())?;
        self.clusters.current_order(slot)
    }

    /// The culling of the views of `view`'s kind: the cameras', the shadow cascades', the shadow
    /// tiles' or the outline view's.
    fn culling_of(&self, view: ViewId) -> &Culling {
        match (view.cascade_index(), view.tile_index()) {
            (Some(_), _) => &self.cascade_culling,
            (_, Some(_)) => &self.tile_culling,
            _ if view == ViewId::OUTLINE => &self.outline_culling,
            _ => &self.culling,
        }
    }

    /// The outline views that the frame culls: one while outlines are on.
    fn outline_views(&self) -> usize {
        usize::from(self.layouts_outlined)
    }

    /// What a pass that draws into `targets` draws with, in the shader variant that reads the
    /// draw's index where the device has multi-draw.
    fn with_draw_index(&self, targets: PassTargets) -> PassTargets {
        let draw_index = if self.config.multi_draw {
            permutation::DRAW_INDEX
        } else {
            0
        };
        PassTargets {
            permutation: targets.permutation | draw_index,
            ..targets
        }
    }

    /// The shadow cascades that the frame that culled last draws.
    fn cascades(&self) -> usize {
        self.shadow.as_ref().map_or(0, |s| s.cascades.count)
    }

    /// The tiles of the shadow atlas in the frame that culled last.
    fn tile_count(&self) -> usize {
        self.tiles.shape().map_or(0, |s| s.layers as usize)
    }

    /// Assigns every source to a data texture and a bucket, then makes room for the new layout:
    /// the clusters, the culling runs and every view's output, and the upload arenas. With
    /// `shadows`, the casters' layout holds the casters, and the receivers read the shadow map.
    /// With `outlines`, the outlined layout holds the outlined objects.
    fn rebuild_layout(
        &mut self,
        input: &FrameInput<'_>,
        shadows: bool,
        outlines: bool,
    ) -> Result<(), RecordError> {
        self.settings
            .prepare_rebuild(input.scene, input.batches, &mut self.pipelines);
        let rows = input.scene.capacity().saturating_add(1);
        self.skins
            .rebuild(
                input.scene,
                input.animations,
                input.morphs,
                self.settings.meshes(),
            )
            .map_err(|_| RecordError::OutOfMemory {
                bytes: rows.saturating_mul(4),
            })?;
        let limit = FrameBuilder::max_sources(self);
        let multi_draw = self.config.multi_draw;
        let targets = self.with_draw_index(self.graph.scene_targets());
        self.layout_prepass = self.graph.depth_prepass();
        let prepass = Prepass::OwnVertexShader.if_on(self.layout_prepass);
        let (settings, pipelines, skins) = (&self.settings, &mut self.pipelines, &self.skins);
        self.layout.rebuild(
            settings, pipelines, skins, targets, input, limit, multi_draw, shadows, prepass,
        )?;
        // The casters' layout holds buckets only while the light casts shadows.
        if shadows {
            let targets = self.with_draw_index(shadows::TARGETS);
            let (settings, pipelines, skins) = (&self.settings, &mut self.pipelines, &self.skins);
            self.casters.rebuild(
                settings,
                pipelines,
                skins,
                targets,
                input,
                limit,
                multi_draw,
                shadows,
                Prepass::Off,
            )?;
        } else {
            self.casters.clear();
        }
        self.layouts_shadowed = shadows;
        if outlines {
            let targets = self.with_draw_index(self.graph.outline_targets());
            let (settings, pipelines, skins) = (&self.settings, &mut self.pipelines, &self.skins);
            self.outlined.rebuild(
                settings,
                pipelines,
                skins,
                targets,
                input,
                limit,
                multi_draw,
                shadows,
                Prepass::Off,
            )?;
        } else {
            self.outlined.clear();
        }
        self.layouts_outlined = outlines;
        let room = self.layout.room;
        let out_of_memory = |_: TryReserveError| RecordError::OutOfMemory {
            bytes: room.rows.saturating_mul(8),
        };
        let slots = &self.layout.batches;
        let place = |index: usize, _: &_| {
            let slot = slots[index];
            (slot.base, if slot.dynamic { STREAMED } else { RESIDENT })
        };
        let skins = &self.skins;
        self.sorted
            .rebuild(
                &self.settings,
                &mut self.pipelines,
                targets,
                input.scene,
                input.batches,
                place,
                RESIDENT,
                shadows,
                |slot, key| skins.key(slot, key),
            )
            .map_err(out_of_memory)?;
        let records = Transparent::records_bound(&self.sorted, self.config.multi_draw);
        self.layout.add_sorted(records, self.sorted.scene_slots());
        self.clusters
            .prepare(input.batches, &self.layout)
            .map_err(out_of_memory)?;
        // The cell order holds every object that a view or a cascade culls: blended casters have
        // no bucket in the scene's layout, as the transparent pass draws them, but cast all the
        // same, and blended objects can be outlined. Each culling skips the rows that have no bucket
        // in its own layout.
        let (scene_buckets, casters) = (&self.layout.scene_buckets, &self.casters.scene_buckets);
        let outlined = &self.outlined.scene_buckets;
        let in_layout = |buckets: &[u32], slot: usize| {
            buckets.get(slot).is_some_and(|&bucket| bucket != NO_BUCKET)
        };
        let culled = |slot: usize| {
            scene_buckets[slot] != NO_BUCKET
                || in_layout(casters, slot)
                || in_layout(outlined, slot)
        };
        self.cells
            .classify(input.scene, &culled)
            .map_err(out_of_memory)?;
        let views = self.settings.views().len();
        self.culling.reserve(room, views).map_err(out_of_memory)?;
        self.culling
            .reserve_sorted(&self.sorted)
            .map_err(out_of_memory)?;
        self.transparent
            .reserve(&self.sorted, views)
            .map_err(out_of_memory)?;
        let cascades = self.cascades();
        self.cascade_culling
            .reserve(self.casters.room, cascades)
            .map_err(out_of_memory)?;
        let tiles = self.tile_count();
        self.tile_culling
            .reserve(self.casters.room, tiles)
            .map_err(out_of_memory)?;
        self.outline_culling
            .reserve(self.outlined.room, self.outline_views())
            .map_err(out_of_memory)?;
        // Room for every static batch's cluster order, so a batch coming to rest later uploads
        // its clusters without growing the arena.
        let bound = self.upload_bound_without_clusters() + self.layout.cluster_rows as usize * 4;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound).map_err(out_of_memory)?;
        }
        self.layout.built = true;
        self.layout.built_in = input.frame;
        Ok(())
    }

    /// Gives each view and each shadow cascade that has none yet its culling output, with room for
    /// its layout. A view added after the frame culled draws nothing until the next frame culls it.
    fn add_culled_views(&mut self) -> Result<(), RecordError> {
        let views = self.settings.views().len();
        let new_views = self.culling.views() < views;
        let cascades = self.cascades();
        let tiles = self.tile_count();
        let outlines = self.outline_views();
        for (culling, layout, count) in [
            (&mut self.culling, &self.layout, views),
            (&mut self.cascade_culling, &self.casters, cascades),
            (&mut self.tile_culling, &self.casters, tiles),
            (&mut self.outline_culling, &self.outlined, outlines),
        ] {
            if culling.views() < count {
                let room = layout.room;
                culling
                    .add_views(room, count)
                    .map_err(|_| RecordError::OutOfMemory {
                        bytes: room.rows.saturating_mul(8),
                    })?;
            }
        }
        // The camera views' transparent pass needs room for the sorted rows of the new views.
        if new_views {
            let out_of_memory = |_| RecordError::OutOfMemory {
                bytes: self.layout.room.rows.saturating_mul(8),
            };
            self.culling
                .reserve_sorted(&self.sorted)
                .map_err(out_of_memory)?;
            self.transparent
                .reserve(&self.sorted, views)
                .map_err(out_of_memory)?;
        }
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the material table, three.js's table of specular terms, the light grid, each
    /// view's, each shadow cascade's and each shadow tile's frame uniform, draw records and
    /// multi-draw arrays, the cascades' and the tiles' uniform blocks, the final pass's settings,
    /// the skinned objects' first joints after a change, and the cluster orders not uploaded yet.
    fn upload_bound(&self) -> usize {
        self.upload_bound_without_clusters() + self.clusters.pending_bytes(&self.layout)
    }

    /// [`Self::upload_bound`] without the cluster orders.
    fn upload_bound_without_clusters(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials =
            self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 * 2 + dfg::BYTES;
        let per_view = |layout: &Layout| {
            (sizes::FRAME_UNIFORM_BYTES + OFFSETS_BYTES) as usize
                + layout.draws_slot_bytes as usize
                + layout.draws.len() * 12
        };
        let views = self.settings.views().len();
        let tiles = (self.settings.tile_settings().tiles as usize).min(MAX_TILES);
        let cascades = (MAX_CASCADES + tiles) * per_view(&self.casters);
        let outline = per_view(&self.outlined);
        let shadows = (sizes::SHADOW_UNIFORM_BYTES + sizes::SHADOW_TILES_UNIFORM_BYTES) as usize;
        meshes
            + materials
            + self.lights.upload_room()
            + views * per_view(&self.layout)
            + Transparent::upload_bound(&self.sorted, views, self.config.multi_draw)
            + cascades
            + outline
            + shadows
            + self.skins.upload_bound(self.settings.meshes())
            + self.graph.upload_bound()
    }

    /// Records the creation of the material table, a data texture with one row of texels for each
    /// material it holds and one for each material's custom values, of three.js's table of
    /// specular terms, and of the shadows' uniform block and comparison sampler.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        shadows::create_objects(list, ids::SHADOWS, ids::SHADOW_SAMPLER, None)?;
        ShadowTiles::create_objects(list, ids::SHADOW_TILES)?;
        list.push(
            Op::CreateTexture,
            &[
                ids::MATERIALS,
                MATERIAL_TEXELS,
                self.config.max_materials.max(1) * 2,
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
        self.dfg_pending = true;
        self.created = true;
        Ok(())
    }

    /// Makes the data textures, and each view's, each shadow cascade's and each shadow tile's index
    /// list textures and draw records, big enough for their layouts, with room to grow. Binds each
    /// view's textures again when one is new: every view after a new layout, else only the new
    /// ones, from `first_new` for the views, the cascades and the tiles in turn. Returns true when
    /// the resident texture is new, so it needs every row again.
    fn size_resources(
        &mut self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        first_new: [usize; 4],
        rebuilt: bool,
    ) -> Result<bool, RecordError> {
        let limit = self.config.max_texture_size;
        let remade = if rebuilt {
            let mut remade = self.textures.size(list, &self.layout, limit)?;
            let meshes = self.settings.meshes();
            remade.any |= self.skins.size(list, input.animations, meshes, limit)?;
            remade
        } else {
            Default::default()
        };
        let skins = self.skins.textures();
        let views = self.settings.views().len();
        let cascades = self.cascades();
        let tiles = self.tile_count();
        let outlines = self.outline_views();
        let [
            first_new,
            first_new_cascade,
            first_new_tile,
            first_new_outline,
        ] = first_new;
        for (culling, draws, layout, count, first_new) in [
            (
                &mut self.culling,
                &mut self.opaque,
                &self.layout,
                views,
                first_new,
            ),
            (
                &mut self.cascade_culling,
                &mut self.cascade_draws,
                &self.casters,
                cascades,
                first_new_cascade,
            ),
            (
                &mut self.tile_culling,
                &mut self.tile_draws,
                &self.casters,
                tiles,
                first_new_tile,
            ),
            (
                &mut self.outline_culling,
                &mut self.outline_draws,
                &self.outlined,
                outlines,
                first_new_outline,
            ),
        ] {
            let first = if rebuilt { 0 } else { first_new };
            for k in first..count {
                let view = culling.view(k);
                let listed = culling.size(list, view, layout, limit)?;
                let new_view = k >= first_new;
                draws.size(list, view, layout, skins, remade.any || listed || new_view)?;
            }
        }
        Ok(remade.resident)
    }

    /// Uploads changed world matrices of the scene and of static batches into the resident
    /// texture, straight from the core's world buffers of this parity, or every one of them after
    /// the layout changed.
    fn upload_resident(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        everything: bool,
    ) -> Result<(), RecordError> {
        let parity = input.parity();
        let layout = &self.layout;
        let upload = |list: &mut DrawList, base: u32, matrices: &[f32], start: u32, count: u32| {
            write_matrices(
                list,
                ids::RESIDENT,
                base + start,
                matrices_of(matrices, start, count),
            )
        };
        if everything || input.snapshot.overflowed() {
            // Slots past the highest one ever used, and rows past a batch's active count, draw
            // nothing; they upload when they change.
            let scene = input.scene.world(parity).matrices();
            upload(list, 0, scene, 0, input.scene.slots().high_water())?;
            for slot in layout.batches.iter().filter(|slot| !slot.dynamic) {
                let batch = input
                    .batches
                    .get(slot.id)
                    .expect("the layout names live batches");
                upload(
                    list,
                    slot.base,
                    batch.world(parity).matrices(),
                    0,
                    batch.frame_active_count(parity),
                )?;
            }
            return Ok(());
        }
        // Scene rows that changed close together upload in one write, as a span that grows until
        // the next run lies too far from it.
        let scene = input.scene.world(parity).matrices();
        let mut span: Option<(u32, u32)> = None;
        for range in input.snapshot.uploads() {
            if range.target == SCENE_TARGET {
                let Some((start, count)) =
                    drawn_rows(&layout.drawn_slots, range.start, range.count)
                else {
                    continue;
                };
                span = match span.and_then(|span| joined_rows(span, start, count)) {
                    Some(joined) => Some(joined),
                    None => {
                        if let Some((first, rows)) = span {
                            upload(list, 0, scene, first, rows)?;
                        }
                        Some((start, count))
                    }
                };
                continue;
            }
            let Some(slot) = layout.batch(range.target).filter(|slot| !slot.dynamic) else {
                continue;
            };
            let Ok(batch) = input.batches.get(slot.id) else {
                continue;
            };
            upload(
                list,
                slot.base,
                batch.world(parity).matrices(),
                range.start,
                range.count,
            )?;
        }
        if let Some((first, rows)) = span {
            upload(list, 0, scene, first, rows)?;
        }
        Ok(())
    }

    /// True when a dynamic batch has active rows this frame, which it writes into a new slot of
    /// the streamed ring.
    fn has_moving_rows(&self, input: &FrameInput<'_>) -> bool {
        let parity = input.parity();
        self.layout.batches.iter().any(|slot| {
            slot.dynamic
                && input
                    .batches
                    .get(slot.id)
                    .is_ok_and(|batch| batch.frame_active_count(parity) > 0)
        })
    }

    /// Writes the active rows of every dynamic batch into the streamed texture of slot `streamed`.
    fn upload_streamed(
        &self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        streamed: u32,
    ) -> Result<(), RecordError> {
        let parity = input.parity();
        for slot in self.layout.batches.iter().filter(|slot| slot.dynamic) {
            let Ok(batch) = input.batches.get(slot.id) else {
                continue;
            };
            let active = batch.frame_active_count(parity);
            let matrices = matrices_of(batch.world(parity).matrices(), 0, active);
            write_matrices(list, ids::STREAMED + streamed, slot.base, matrices)?;
        }
        Ok(())
    }

    /// Records a frame into its parity's list and arena: the objects the GPU lacks, the uploads,
    /// then the passes of the render graph. Returns true when the frame rebuilt the draw tables.
    fn record_into(
        &mut self,
        input: &FrameInput<'_>,
        list: &mut DrawList,
        arena: &mut UploadArena,
    ) -> Result<bool, RecordError> {
        if self.culling.culled_frame() != input.frame {
            self.cull(input)?;
        }
        self.add_culled_views()?;
        let views = self.settings.views().len();
        // The list starts with the pipelines it creates, so the thread that draws can start to
        // build them before it replays the rest (see `null3d_gpu::drawlist`).
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
        self.graph.request_pipelines(&mut self.pipelines);
        self.background.request_pipeline(
            &self.settings,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        let created_pipelines = self.pipelines.create_new(list)? > 0;
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph
            .set_shadows(self.shadow.as_ref().map(ShadowPasses::of));
        self.graph.set_tiles(self.tiles.shape().map(|s| TilePasses {
            tiles: s.layers,
            size: s.size,
        }));
        self.graph.sync_views(self.settings.views());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.set_transparent(!self.sorted.is_empty());
        self.graph.set_scaling(self.settings.render_scaling());
        self.graph.prepare(list, input.canvas, input.render_scale)?;
        let (shadow_map, atlas) = self
            .graph
            .shadow_map()
            .zip(self.graph.shadow_atlas())
            .expect("the builder's graph binds a shadow map and a shadow atlas");
        let mut lit = LitTextures {
            shadow_map,
            atlas,
            occlusion: self.graph.ao_texture().unwrap_or(ids::BLANK_AO),
            environment: self.bound_environment,
        };
        let first_new = self.opaque.views();
        let lights_remade =
            self.light_textures
                .size(list, &mut self.lights, self.config.max_texture_size)?;
        self.opaque.add_views(list, views)?;
        // Every camera view's frame groups bind the shadow maps and the light textures, so each
        // view binds them again when the graph or the light textures make them again.
        let rebind = lights_remade || self.graph.textures_made();
        for index in 0..self.opaque.views() {
            if index >= first_new || rebind {
                Opaque::bind_frame(list, ViewId::from_index(index), Some(lit))?;
            }
        }
        let cascades = self.cascades();
        let first_new_cascade = self.cascade_draws.views();
        self.cascade_draws.add_views(list, cascades)?;
        for cascade in first_new_cascade..cascades {
            Opaque::bind_frame(list, ViewId::cascade(cascade), None)?;
        }
        let tiles = self.tile_count();
        let first_new_tile = self.tile_draws.views();
        self.tile_draws.add_views(list, tiles)?;
        for tile in first_new_tile..tiles {
            Opaque::bind_frame(list, ViewId::tile(tile), None)?;
        }
        let outlines = self.outline_views();
        let first_new_outline = self.outline_draws.views();
        self.outline_draws.add_views(list, outlines)?;
        if first_new_outline < outlines {
            Opaque::bind_frame(list, ViewId::OUTLINE, None)?;
        }
        let rebuilt = self.layout.built_in == input.frame;
        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::DFG)?;
        }
        self.meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        // Draws bind the maps' groups by id as they run, so a group made again needs nothing more.
        let table = MaterialStorage::Texture(ids::MATERIALS);
        self.settings
            .record_materials(list, arena, table, input.frame)?;
        // The environment's map may have finished its upload, or gone, with this frame's texture
        // work, so the views read it from here on.
        let (environment, uniform) = self.settings.environment_map(ids::BLANK_ENVIRONMENT);
        if environment != self.bound_environment {
            self.bound_environment = environment;
            lit.environment = environment;
            for index in 0..self.opaque.views() {
                Opaque::bind_frame(list, ViewId::from_index(index), Some(lit))?;
            }
        }
        for index in 0..views {
            if let Some(frame) = self.culling.frame_mut(ViewId::from_index(index)) {
                frame.uniform.environment = uniform;
            }
        }
        self.graph.upload(
            list,
            arena,
            self.settings.drawn_output(),
            self.settings.grading(),
        )?;
        self.background.prepare(&self.settings);
        let new_views = first_new < views
            || first_new_cascade < cascades
            || first_new_tile < tiles
            || first_new_outline < outlines;
        let new_texture = if rebuilt || new_views {
            let first_new = [
                first_new,
                first_new_cascade,
                first_new_tile,
                first_new_outline,
            ];
            self.size_resources(list, input, first_new, rebuilt)?
        } else {
            false
        };
        self.upload_resident(list, input, rebuilt || new_texture)?;
        self.skins.set_morph_cap(self.settings.morph_cap());
        let meshes = self.settings.meshes();
        self.skins
            .upload(list, arena, input.animations, input.morphs, meshes)?;
        self.clusters.upload(list, arena, &self.layout)?;
        self.light_textures
            .upload(list, arena, &mut self.lights, input.frame)?;

        // The streamed ring moves to a new slot only for moving rows, and each view's rings only
        // for new data: a changed frame uniform, or an index list that differs from the previous
        // frame's.
        let frame = input.frame;
        let drawn = (0..views).any(|v| self.culling.frame(ViewId::from_index(v)).is_some());
        if drawn {
            let moving = self.has_moving_rows(input);
            let streamed = self.streamed_slot.take(frame, moving);
            if moving {
                self.upload_streamed(list, input, streamed)?;
            }
            upload_views(
                list,
                arena,
                (&mut self.culling, &mut self.opaque, &self.layout),
                Some((&mut self.transparent, &self.sorted, &self.settings)),
                views,
                frame,
                streamed,
            )?;
            let shadowed = self.layouts_shadowed;
            if self.shadow.is_none() && self.cascades_held && shadowed {
                // Receivers of point and spot light shadows read the cascades too: none now.
                let (at, bytes) = arena.push(ShadowUniform::default().as_bytes())?;
                list.push(Op::WriteBuffer, &[ids::SHADOWS, 0, at, bytes])?;
            }
            self.cascades_held = self.shadow.is_some() || (self.cascades_held && !shadowed);
            self.tiles.upload(list, arena, ids::SHADOW_TILES)?;
            upload_views(
                list,
                arena,
                (&mut self.tile_culling, &mut self.tile_draws, &self.casters),
                None,
                tiles,
                frame,
                streamed,
            )?;
            upload_views(
                list,
                arena,
                (
                    &mut self.outline_culling,
                    &mut self.outline_draws,
                    &self.outlined,
                ),
                None,
                outlines,
                frame,
                streamed,
            )?;
            if let Some(shadow) = &self.shadow {
                shadows::upload(list, arena, ids::SHADOWS, shadow)?;
                upload_views(
                    list,
                    arena,
                    (
                        &mut self.cascade_culling,
                        &mut self.cascade_draws,
                        &self.casters,
                    ),
                    None,
                    cascades,
                    frame,
                    streamed,
                )?;
            }
        }
        let camera = self.culling.frame(ViewId::CAMERA);
        self.lines.upload(
            list,
            arena,
            &input.lines,
            camera.map(|values| &values.camera),
        )?;

        let (culling, opaque, lines) = (&self.culling, &self.opaque, &self.lines);
        let (cascade_culling, cascade_draws) = (&self.cascade_culling, &self.cascade_draws);
        let (tile_culling, tile_draws) = (&self.tile_culling, &self.tile_draws);
        let (outline_culling, outline_draws) = (&self.outline_culling, &self.outline_draws);
        let (layout, casters, meshes) = (&self.layout, &self.casters, &self.meshes);
        let outlined = &self.outlined;
        let (transparent, background) = (&self.transparent, &self.background);
        let light_slot = self.light_textures.slot();
        // A cascade or a tile that does not draw keeps its depth: its render pass is left out.
        let skips = |role: Role| match role {
            Role::Shadow(view) if view.tile_index().is_some() => tile_culling.frame(view).is_none(),
            Role::Shadow(view) => cascade_culling.frame(view).is_none(),
            _ => false,
        };
        self.graph.record(
            list,
            self.settings.clear_color(),
            skips,
            |list, role| match role {
                Role::Opaque(view) if culling.frame(view).is_some() => {
                    if view == ViewId::CAMERA {
                        let slot = opaque.frame_slot(view);
                        let group = ids::frame_group(view) + light_slot;
                        background.record(list, group, &[slot, slot])?;
                    }
                    let starts = culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Lit { light_slot };
                    opaque.record(list, arena, view, starts, layout, meshes, shading)
                }
                Role::Prepass(view) if culling.frame(view).is_some() => {
                    let starts = culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Prepass { light_slot };
                    opaque.record(list, arena, view, starts, layout, meshes, shading)
                }
                Role::Shadow(view) if cascade_culling.frame(view).is_some() => {
                    let starts = cascade_culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Depth;
                    cascade_draws.record(list, arena, view, starts, casters, meshes, shading)
                }
                Role::Shadow(view) if tile_culling.frame(view).is_some() => {
                    let starts = tile_culling.culled(frame, view).bucket_starts();
                    tile_draws.record(list, arena, view, starts, casters, meshes, Shading::Depth)
                }
                Role::OutlineMask if outline_culling.frame(ViewId::OUTLINE).is_some() => {
                    let view = ViewId::OUTLINE;
                    let starts = outline_culling.culled(frame, view).bucket_starts();
                    outline_draws.record(
                        list,
                        arena,
                        view,
                        starts,
                        outlined,
                        meshes,
                        Shading::Depth,
                    )
                }
                Role::Transparent(view) if culling.frame(view).is_some() => {
                    let at = opaque.sorted_records_at(view, layout);
                    let draws = ids::draws_group(view);
                    let bind = |list: &mut DrawList| opaque.bind_view(list, view, light_slot);
                    transparent.record(list, arena, view.index(), draws, at, meshes, bind)
                }
                Role::DebugLines => {
                    let slot = opaque.frame_slot(ViewId::CAMERA);
                    let group = ids::frame_group(ViewId::CAMERA) + light_slot;
                    lines.record(list, group, &[slot, slot])
                }
                _ => Ok(()),
            },
        )?;
        self.tiles
            .finish(input.frame, created_pipelines, input.pipelines_built);
        Ok(rebuilt)
    }
}

/// Uploads, for each of the first `count` views of `culling` that the frame draws, its index list
/// when it changed, and its frame uniform and draw records, from the views' culling output and the
/// draws of `layout`. Every view reads the streamed texture of ring slot `streamed`. With
/// `transparent`, each view also prepares its transparent pass's draws of the sorted rows, which
/// follow the opaque ones in its index list, and uploads their records with a new list.
fn upload_views(
    list: &mut DrawList,
    arena: &mut UploadArena,
    (culling, draws, layout): (&mut Culling, &mut Opaque, &Layout),
    mut transparent: Option<(&mut Transparent, &SortedLayout, &SceneSettings)>,
    count: usize,
    frame: u32,
    streamed: u32,
) -> Result<(), RecordError> {
    for k in 0..count {
        let view = culling.view(k);
        let Some(values) = culling.frame(view).copied() else {
            continue;
        };
        let (listed, new_list) = culling.upload(list, view, frame)?;
        let starts = culling.culled(frame, view).bucket_starts();
        let upload = ViewUpload {
            frame,
            values: &values,
            offsets: culling.offsets(view),
            streamed,
            listed,
            new_list,
            starts,
        };
        draws.upload(list, arena, view, upload, layout)?;
        if let Some((transparent, sorted, settings)) = transparent.as_mut() {
            let first_sorted = starts.last().copied().unwrap_or(0);
            transparent.prepare(k, culling.sorted(view), sorted, settings, first_sorted);
            if new_list {
                let at = draws.sorted_records_at(view, layout);
                transparent.upload(list, arena, k, ids::draws(view), at)?;
            }
        }
    }
    Ok(())
}

impl FrameBuilder for CpuCulledRenderer {
    fn settings(&self) -> &SceneSettings {
        &self.settings
    }

    fn settings_mut(&mut self) -> &mut SceneSettings {
        &mut self.settings
    }

    fn max_sources(&self) -> u32 {
        max_sources(self.config.max_texture_size)
    }

    fn reserve_sources(&mut self, sources: u32) -> Result<(), TryReserveError> {
        self.culling.reserve_sources(sources)?;
        self.cascade_culling.reserve_sources(sources)?;
        self.tile_culling.reserve_sources(sources)?;
        self.outline_culling.reserve_sources(sources)
    }

    fn cull(&mut self, input: &FrameInput<'_>) -> Result<(), RecordError> {
        let (scene, parity, canvas, scale) = (
            input.scene,
            input.parity(),
            input.canvas,
            input.render_scale,
        );
        self.shadow = self.settings.shadow_frame(input);
        let camera = self
            .settings
            .view_frame(ViewId::CAMERA, scene, parity, canvas, scale);
        let tile_settings = self.settings.tile_settings();
        let filter = self.settings.shadow_quality().filter;
        self.tiles
            .plan(input, tile_settings, filter, camera.as_ref());
        // Receivers read the shadow maps while the sun or a point or spot light casts shadows.
        let shadows = self.shadow.is_some() || self.tiles.shape().is_some();
        let outlines = self.settings.outline().is_some();
        // Ambient occlusion reads the depth prepass's depth, so turning it on or off can switch
        // the prepass, whose pipelines the layout holds.
        let ao = self
            .settings
            .ao()
            .zip(self.settings.camera_projection(canvas));
        self.graph.set_ao(ao, self.settings.ao_scale());
        let prepass_changed = self.graph.depth_prepass() != self.layout_prepass;
        if input.structure_changed
            || !self.layout.built
            || shadows != self.layouts_shadowed
            || outlines != self.layouts_outlined
            || prepass_changed
        {
            self.rebuild_layout(input, shadows, outlines)?;
        }
        self.add_culled_views()?;
        self.cells.update(input);
        let out_of_memory = |layout: &Layout| RecordError::OutOfMemory {
            bytes: layout.room.rows.saturating_mul(8),
        };
        self.sorted
            .gather(input.scene, input.batches, input.parity())
            .map_err(|_| out_of_memory(&self.layout))?;
        let (settings, cells, sorted) = (&self.settings, &self.cells, &self.sorted);
        self.culling
            .cull(
                input,
                &self.layout,
                &mut self.clusters,
                cells,
                &|view| settings.view_frame(view, scene, parity, canvas, scale),
                Some(sorted),
                Some(cull::Occlusion {
                    occluders: &mut self.occluders,
                    meshes: settings.meshes(),
                    materials: settings.materials(),
                }),
            )
            .map_err(|_| out_of_memory(&self.layout))?;
        if let Some(frame) = self.culling.frame_mut(ViewId::CAMERA) {
            self.lights.assign(input.jobs, frame, input.lights);
            self.lights.mark_shadows(&self.tiles, input.shadow_lights);
        }
        // The cascades skip the cells out of their view too: the casters' layout gives every other
        // object no bucket, so the scene's cell order serves it.
        let shadow = self.shadow.as_ref();
        self.cascade_culling
            .cull(
                input,
                &self.casters,
                &mut self.clusters,
                cells,
                &|view| {
                    let cascade = view.cascade_index()?;
                    let shadow = shadow.filter(|s| s.draws(cascade))?;
                    Some(shadow.view_frame(cascade))
                },
                None,
                None,
            )
            .map_err(|_| out_of_memory(&self.casters))?;
        let tiles = &self.tiles;
        self.tile_culling
            .cull(
                input,
                &self.casters,
                &mut self.clusters,
                cells,
                &|view| tiles.frame(view.tile_index()?).copied(),
                None,
                None,
            )
            .map_err(|_| out_of_memory(&self.casters))?;
        // The outline view sees what the camera's view sees, while some object is outlined. It
        // skips no object behind the blockers, as the hidden line shows outlined objects through
        // them.
        let camera = self.culling.frame(ViewId::CAMERA).copied();
        let outlines = !self.outlined.buckets.is_empty();
        self.outline_culling
            .cull(
                input,
                &self.outlined,
                &mut self.clusters,
                cells,
                &|_| camera.filter(|_| outlines),
                None,
                None,
            )
            .map_err(|_| out_of_memory(&self.outlined))
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        let (mut list, mut arena) = self.lists.take(input.frame)?;
        let result = self.record_into(input, &mut list, &mut arena);
        self.lists.restore(input.frame, list, arena, result)
    }

    fn visible_entries(&self, frame: u32) -> Option<u32> {
        Some(self.culling.visible_entries(frame))
    }

    fn occluded_entries(&self, frame: u32) -> Option<u32> {
        Some(self.culling.occluded_entries(frame))
    }

    fn set_software_occlusion(&mut self, on: bool) {
        self.occluders.set_on(on);
    }

    fn set_mesh_blocker(
        &mut self,
        mesh: u32,
        blocker: null3d_core::occlusion::BlockerMesh,
    ) -> Result<(), TryReserveError> {
        self.occluders.set_blocker(mesh, blocker)
    }

    fn casts_tile_shadows(&self) -> bool {
        self.tiles.shape().is_some()
    }

    fn reset_gpu(&mut self) {
        self.lists.reset_gpu();
        self.created = false;
        self.bound_environment = ids::BLANK_ENVIRONMENT;
        self.graph.reset_gpu();
        self.settings.forget_shadow_maps();
        self.layout.built = false;
        self.meshes.forget();
        self.pipelines.forget();
        self.textures.forget_gpu();
        self.culling.forget_gpu();
        self.opaque.forget_gpu();
        self.cascade_culling.forget_gpu();
        self.cascade_draws.forget_gpu();
        self.tile_culling.forget_gpu();
        self.tile_draws.forget_gpu();
        self.outline_culling.forget_gpu();
        self.outline_draws.forget_gpu();
        self.tiles.forget_gpu();
        self.cascades_held = false;
        self.lines.forget_gpu();
        self.streamed_slot.forget();
        self.lights.forget_gpu();
        self.light_textures.forget_gpu();
        self.skins.forget_gpu();
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
