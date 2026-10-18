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
//! the background that the camera's opaque pass draws after its buckets, or before them while a
//! bucket writes no depth, is [`crate::background`]. The render graph ([`crate::frame_graph`])
//! orders the passes and begins their render passes.
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
//! draw again. Every camera view's frame groups bind the atlas and the shadow settings block,
//! which holds each tile's matrix, its texel size and its light's biases.
//!
//! # Outlines
//!
//! While the sketch turns outlines on, a third layout holds the scene objects that it outlines,
//! grouped by mesh (see [`crate::outline`]). The job workers cull it for the outline view with the
//! camera's frustum and layers, into an index list of its own, and the mask pass draws each of its
//! buckets twice into the outline mask. Outlining an object, or turning outlines on or off,
//! rebuilds the layouts, as casting shadows does.
//!
//! # Subsurface blur
//!
//! While the quality setting gives the subsurface blur taps and some material has a scatter radius,
//! a fourth layout holds the scene objects with such a material, with the skin pass's programs (see
//! [`crate::subsurface`]). The job workers cull it for the subsurface view with the camera's
//! frustum and layers, into an index list of its own, and the skin pass draws it with the camera's
//! lights and shadows: the view's frame groups bind the camera view's light textures. Turning the
//! blur's taps on or off, or creating the first such material, rebuilds the layouts.
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
mod motion;
mod opaque;
mod skin;
mod transparent;

use std::collections::TryReserveError;

use null3d_core::cells::CELL_SHIFT;
use null3d_core::culling::{BucketedCull, NO_BUCKET};
use null3d_core::handle::Handle;
use null3d_core::instances::InstanceBatch;
use null3d_core::snapshot::SCENE_TARGET;
use null3d_gpu::caps::{BUDGET, Limit};
use null3d_gpu::drawlist::{
    DrawList, MAX_WORDS, Op, buffer_usage, format, layout as bind_layout, permutation,
    resource_kind, sizes, texture_usage, view,
};

use crate::accumulate::AccumulateIds;
use crate::ao::{self, AoIds};
use crate::background::{BackgroundIds, BackgroundPass, Place};
use crate::bloom::BloomIds;
use crate::cells::CellCulling;
use crate::debug_lines::LinesPass;
use crate::dfg;
use crate::dof::DofIds;
use crate::effects::EffectIds;
use crate::environment;
use crate::exposure::ExposureIds;
use crate::final_pass::FinalIds;
use crate::fog_volume::FogVolumeIds;
use crate::frame::{
    CanvasOutput, FrameBuilder, FrameInput, KeyCounts, MaterialStorage, MeshBuffers, ParityLists,
    RecordError, SceneSettings, StillMarks, UploadArena, bind_frame_group, drawn_rows, joined_rows,
    settled,
};
use crate::frame_graph::{FrameGraph, GraphIds, Role, ShadowPasses, TilePasses};
use crate::fullscreen::FullscreenIds;
use crate::graph::{GraphError, RenderGraph};
use crate::light_grid::{LightGrid, LightGrids, LightLimits};
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MeshMoves, MeshStorage, Packing};
use crate::motion::MotionIds;
use crate::occlusion::Occluders;
use crate::output::{Antialias, SceneColor};
use crate::particles::{ParticleIds, ParticlePass};
use crate::physical_sky::{self, PhysicalSkyIds, PhysicalSkyPass};
use crate::pipelines::{PassTargets, PipelineCache, Prepass};
use crate::probe_grid;
use crate::shadow_tiles::{self, MAX_TILES, ShadowTiles};
use crate::shadows::{self, CascadeDepth, CasterPasses, MAX_CASCADES, ShadowFrame, ShadowUniform};
use crate::sorted::{SkinnedPipeline, SortedLayout, SortedRows};
use crate::ssr::SsrIds;
use crate::subsurface::SubsurfaceIds;
use crate::textures::{TextureIds, TextureStore};
use crate::transmission::{self, TransmissionIds};
use crate::view::{ViewFrame, ViewId};
use crate::weighted::WeightedIds;
use cull::Culling;
use data::{RingSlot, SharedTextures, matrices_of, write_matrices, write_row_values};
use layout::{BatchSlot, Clusters, Drawn, Layout, RESIDENT, STREAMED};
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
    use crate::dof::STEPS as DOF_STEPS;
    use crate::effects::EffectPass;
    use crate::particles::ParticleIds;
    use crate::subsurface::STEPS as SUBSURFACE_STEPS;
    use crate::view::{MAX_VIEW_IDS, MAX_VIEWS, ViewId};
    use crate::weighted::WeightedIds;

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
    /// The frame's shadow settings, which receivers read beside the shadow map and the atlas: the
    /// sun's cascades, then the atlas's tiles (D-146).
    pub const SHADOWS: u32 = LINES + 1;
    /// The final pass's settings.
    pub const FINAL_SETTINGS: u32 = SHADOWS + 1;
    /// The first step of the two-step pass's settings.
    pub const OUTPUT_SETTINGS: u32 = FINAL_SETTINGS + 1;
    /// The uniform buffer of bloom's steps and of the final pass's bloom build.
    pub const BLOOM: u32 = OUTPUT_SETTINGS + 1;
    /// The uniform buffer of ambient occlusion's steps.
    pub const AO: u32 = BLOOM + 1;
    /// The uniform buffer of the background's values.
    pub const BACKGROUND: u32 = AO + 1;
    /// The uniform buffer of the custom effects' blocks.
    pub const EFFECTS: u32 = BACKGROUND + 1;
    /// The uniform buffer of depth of field's steps.
    pub const DOF: u32 = EFFECTS + 1;
    /// The uniform buffer of the motion debug view's step.
    pub const MOTION_VIEW: u32 = DOF + 1;
    /// The motion pass's block: the last frame's view and clock.
    pub const MOTION_BLOCK: u32 = MOTION_VIEW + 1;
    /// The particle systems' buffers, three for each system from here.
    pub const PARTICLE_BUFFERS: u32 = MOTION_BLOCK + 1;
    /// The table of object ranges, which the vertex shaders of custom materials that read an
    /// instance's index or an object's id search.
    pub const OBJECT_RANGES: u32 = PARTICLE_BUFFERS + ParticleIds::BUFFERS;
    /// The uniform buffer of the subsurface blur's steps.
    pub const SUBSURFACE: u32 = OBJECT_RANGES + 1;
    /// The uniform buffer of the physical sky's values.
    pub const PHYSICAL_SKY: u32 = SUBSURFACE + 1;
    /// The uniform buffer of the full-screen passes' blocks.
    pub const FULLSCREEN: u32 = PHYSICAL_SKY + 1;
    /// The uniform buffer of screen-space reflections' steps.
    pub const SSR: u32 = FULLSCREEN + 1;
    /// The uniform buffer of the volumetric fog's steps (see [`crate::fog_volume`]).
    pub const FOG_VOLUME: u32 = SSR + 1;
    /// The uniform buffer of the automatic exposure's meter.
    pub const EXPOSURE: u32 = FOG_VOLUME + 1;
    /// The still-camera accumulation's blend's values.
    pub const ACCUMULATE: u32 = EXPOSURE + 1;
    /// The settings of the final pass's still build, which draws a still view's accumulated color.
    pub const STILL_SETTINGS: u32 = ACCUMULATE + 1;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = STILL_SETTINGS + 1;

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

    /// The material table: one row of texels per material, then one per material's custom
    /// values, with three.js's table of the split-sum terms of specular light in the columns after
    /// the rows' texels.
    pub const MATERIALS: u32 = VIEW_TEXTURES + RING * MAX_VIEW_IDS as u32;
    /// Each camera view's ring of light data textures, one per ring slot, from
    /// `LIGHT_DATA + RING * view`: the records of the lights that the view's light grid lists, and
    /// the grid's words.
    const LIGHT_DATA: u32 = MATERIALS + 1;

    pub const fn light_data(view: ViewId) -> u32 {
        LIGHT_DATA + RING * view.index() as u32
    }
    /// The final pass's blank color grading table, which it binds while the sketch sets none.
    pub const BLANK_LUT: u32 = LIGHT_DATA + RING * MAX_VIEWS as u32;
    /// The blank cube that the frame's groups bind while the scene has no environment.
    pub const BLANK_ENVIRONMENT: u32 = BLANK_LUT + 1;
    /// The final pass's blank outline texture, which it binds while no outline draws.
    /// The blank 3D texture that the frame's groups bind while the scene has no light probe grid.
    pub const BLANK_PROBE_GRID: u32 = BLANK_ENVIRONMENT + 1;
    pub const BLANK_OUTLINE: u32 = BLANK_PROBE_GRID + 1;
    /// The first step of the two-step pass's own blank color grading table and outline texture,
    /// which it owns so that it never destroys the final pass's.
    pub const OUTPUT_BLANK_LUT: u32 = BLANK_OUTLINE + 1;
    pub const OUTPUT_BLANK_OUTLINE: u32 = OUTPUT_BLANK_LUT + 1;
    /// Every animated instance's skinning matrices (see [`crate::skinning`]).
    pub const JOINTS: u32 = OUTPUT_BLANK_OUTLINE + 1;
    /// The first joint of the instance that skins each source row, then the first texel of the
    /// morph weights of each source row.
    pub const FIRST_JOINTS: u32 = JOINTS + 1;
    /// Every morphed mesh's deltas, in half floats (see [`crate::morph`]).
    pub const MORPHS: u32 = FIRST_JOINTS + 1;
    /// Every morphed object's weights (see [`crate::morph`]).
    pub const MORPH_WEIGHTS: u32 = MORPHS + 1;
    /// The texture that frame groups bind in place of ambient occlusion's while it draws none.
    pub const BLANK_AO: u32 = MORPH_WEIGHTS + 1;
    /// The texture that custom effects bind in place of the scene's depth when they read none.
    pub const BLANK_EFFECT_DEPTH: u32 = BLANK_AO + 1;
    /// The texel that frame groups bind in place of the copy of the camera's opaque color while
    /// nothing lets light through.
    pub const BLANK_TRANSMISSION: u32 = BLANK_EFFECT_DEPTH + 1;
    /// The texel that a full-screen pass without an input image reads, and the one that it binds
    /// in place of the scene's depth when it reads none.
    pub const BLANK_PASS_COLOR: u32 = BLANK_TRANSMISSION + 1;
    pub const BLANK_PASS_DEPTH: u32 = BLANK_PASS_COLOR + 1;
    /// The row values of instance batches at the resident texture's rows, two texels per row.
    pub const RESIDENT_VALUES: u32 = BLANK_PASS_DEPTH + 1;
    /// The ring of row values at the streamed textures' rows, one per ring slot.
    pub const STREAMED_VALUES: u32 = RESIDENT_VALUES + 1;
    /// The light tables: the area lights' tables (see [`crate::light_tables`]). WebGL2 reads the
    /// split-sum table beside the material table instead.
    pub const LIGHT_TABLES: u32 = STREAMED_VALUES + RING;
    /// The texel that particle systems bind in place of a view's depth copy.
    pub const BLANK_PARTICLE_DEPTH: u32 = LIGHT_TABLES + 1;
    /// The texture of one texel that the motion debug view reads in place of the motion target
    /// where the device draws none.
    pub const BLANK_MOTION: u32 = BLANK_PARTICLE_DEPTH + 1;
    /// The physical sky's tables and panorama.
    pub const SKY_TABLES: u32 = BLANK_MOTION + 1;
    /// The automatic exposure's cells, its texel, which the final pass reads, and its stored texel.
    pub const EXPOSURE_CELLS: u32 = SKY_TABLES + crate::physical_sky::TEXTURES;
    pub const EXPOSURE_TEXEL: u32 = EXPOSURE_CELLS + 1;
    pub const EXPOSURE_STORED: u32 = EXPOSURE_TEXEL + 1;
    /// The blank color grading table and outline mask that the final pass's still build owns, so
    /// that it never destroys the final pass's.
    pub const STILL_BLANK_LUT: u32 = EXPOSURE_STORED + 1;
    pub const STILL_BLANK_OUTLINE: u32 = STILL_BLANK_LUT + 1;
    /// The two copies of the last frame's resident texture, and of its joint texture with its
    /// morph weights after it, one for each frame parity.
    const LAST_RESIDENT: u32 = STILL_BLANK_OUTLINE + 1;
    const LAST_SKINS: u32 = LAST_RESIDENT + 2;

    pub const fn last_resident(copy: usize) -> u32 {
        LAST_RESIDENT + copy as u32
    }
    pub const fn last_skins(copy: usize) -> u32 {
        LAST_SKINS + copy as u32
    }

    /// The texel that the motion view's frame groups bind in place of the last frame's resident
    /// rows, joints and morph weights before the scene has them.
    pub const BLANK_LAST: u32 = LAST_SKINS + 2;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = BLANK_LAST + 1;
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
    /// The linear sampler of the custom effects.
    pub const EFFECT_SAMPLER: u32 = 5;
    /// The linear sampler of depth of field's steps.
    pub const DOF_SAMPLER: u32 = 6;
    /// The physical sky's samplers.
    pub const SKY_SAMPLERS: u32 = 7;
    /// The sampler of the motion debug view's step.
    pub const MOTION_SAMPLER: u32 = SKY_SAMPLERS + crate::physical_sky::SAMPLERS;
    /// The linear sampler of the full-screen passes.
    pub const FULLSCREEN_SAMPLER: u32 = MOTION_SAMPLER + 1;
    /// The linear sampler of the volumetric fog's steps.
    pub const FOG_SAMPLER: u32 = FULLSCREEN_SAMPLER + 1;
    /// The linear sampler of the automatic exposure's meter.
    pub const EXPOSURE_SAMPLER: u32 = FOG_SAMPLER + 1;
    /// The linear sampler of the first step of the two-step pass's color grading table, which it
    /// owns so that it never destroys the final pass's.
    pub const OUTPUT_LUT_SAMPLER: u32 = EXPOSURE_SAMPLER + 1;
    /// The color grading table's sampler that the final pass's still build owns.
    pub const STILL_LUT_SAMPLER: u32 = OUTPUT_LUT_SAMPLER + 1;
    /// The samplers of materials' maps.
    pub const SAMPLERS: u32 = STILL_LUT_SAMPLER + 1;

    /// Each view's bind groups: a frame group per slot of the light textures' ring, the draw
    /// record group, then the groups of its instance textures, one per pair of ring slots.
    const GROUPS_PER_VIEW: u32 = RING + 1 + RING * RING;
    /// The final pass's group, after every view's.
    pub const FINAL_GROUP: u32 = 1 + GROUPS_PER_VIEW * MAX_VIEW_IDS as u32;
    /// The first step of the two-step pass's group, after the final pass's.
    pub const OUTPUT_GROUP: u32 = FINAL_GROUP + 1;
    /// The second step of the two-step pass's group, which reads the first step's target.
    pub const PRESENT_GROUP: u32 = OUTPUT_GROUP + 1;

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
    /// The bind group of each step of bloom, after the two-step pass's groups.
    pub const BLOOM_GROUPS: u32 = PRESENT_GROUP + 1;
    /// The bind group of each step of ambient occlusion, after bloom's.
    pub const AO_GROUPS: u32 = BLOOM_GROUPS + STEPS as u32;
    /// The background's bind group, after ambient occlusion's.
    pub const BACKGROUND_GROUP: u32 = AO_GROUPS + AO_STEPS as u32;
    /// The bind group of each custom effect, and of each group of joined effects, after the
    /// background's.
    pub const EFFECT_GROUPS: u32 = BACKGROUND_GROUP + 1;
    /// The bind group of each step of depth of field, after the effects'.
    pub const DOF_GROUPS: u32 = EFFECT_GROUPS + EffectPass::GROUPS;
    /// The bind group of the copy of the camera's opaque color, after depth of field's.
    pub const TRANSMISSION_GROUP: u32 = DOF_GROUPS + DOF_STEPS as u32;
    /// The bind group of each step of the subsurface blur, after the copy's.
    pub const SUBSURFACE_GROUPS: u32 = TRANSMISSION_GROUP + 1;
    /// The bind groups of the weighted layer's composite and depth copy, after the blur's.
    pub const WEIGHTED_GROUPS: u32 = SUBSURFACE_GROUPS + SUBSURFACE_STEPS as u32;
    /// Each particle system's bind group, after the weighted layer's.
    pub const PARTICLE_GROUPS: u32 = WEIGHTED_GROUPS + WeightedIds::GROUPS;
    /// Each camera view's group of its depth copy for soft particles, after the systems'.
    pub const PARTICLE_DEPTH_GROUPS: u32 = PARTICLE_GROUPS + ParticleIds::GROUPS;
    /// The bind group of the copy of the camera's opaque depth that soft particles read.
    pub const PARTICLE_DEPTH_COPY_GROUP: u32 = PARTICLE_DEPTH_GROUPS + MAX_VIEWS as u32;
    /// The physical sky's bind groups, after the particles'.
    pub const SKY_GROUPS: u32 = PARTICLE_DEPTH_COPY_GROUP + 1;
    /// The bind group of each full-screen pass, by its view's place, after the physical sky's.
    pub const FULLSCREEN_GROUPS: u32 = SKY_GROUPS + crate::physical_sky::GROUPS;
    /// The bind group of each step of screen-space reflections, after the full-screen passes'.
    pub const SSR_GROUPS: u32 = FULLSCREEN_GROUPS + MAX_VIEWS as u32;
    /// The bind group of the motion debug view's step, after screen-space reflections'.
    pub const MOTION_VIEW_GROUP: u32 = SSR_GROUPS + crate::ssr::STEPS as u32;
    /// The bind group of the still-camera accumulation's blend, after the motion view's step.
    pub const ACCUMULATE_GROUP: u32 = MOTION_VIEW_GROUP + 1;
    /// The bind group of the final pass's still build.
    pub const STILL_GROUP: u32 = ACCUMULATE_GROUP + 1;
    /// The bind group of the scene depth that the decal pass reads, after the still build's.
    pub const DECAL_DEPTH_GROUP: u32 = STILL_GROUP + 1;
    /// The bind groups of the volumetric fog's steps, after the decal pass's depth.
    pub const FOG_GROUPS: u32 = DECAL_DEPTH_GROUP + 1;
    /// The bind groups of the automatic exposure's meter, after the fog's.
    pub const EXPOSURE_GROUPS: u32 = FOG_GROUPS + crate::fog_volume::GROUPS;
    /// The motion pass's frame group for each frame parity and each slot of the streamed ring,
    /// whose slot before it holds the last frame's dynamic rows.
    const MOTION_FRAME_GROUPS: u32 = EXPOSURE_GROUPS + crate::exposure::GROUPS;

    pub const fn motion_frame_group(parity: usize, streamed: u32) -> u32 {
        MOTION_FRAME_GROUPS + parity as u32 * RING + streamed
    }

    /// The bind groups of materials' maps, after the motion pass's.
    pub const TEXTURE_GROUPS: u32 = MOTION_FRAME_GROUPS + 2 * RING;
}

/// The group index of the decal pass's scene depth in the decal templates on WebGL2: after the
/// maps' group.
const DECAL_DEPTH_INDEX: u32 = 4;

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
    /// How the shadow cascades store depth.
    pub cascade_depth: CascadeDepth,
    /// True when the device draws into one-sample targets of 16-bit floats, which the camera's
    /// weighted layer needs (`Capabilities::FLOAT16_TARGETS`).
    pub float16_targets: bool,
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
            cascade_depth: CascadeDepth::default(),
            float16_targets: true,
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
    /// The shadow casters' layout, which the shadow cascades and tiles draw.
    casters: Layout,
    /// The outlined objects' layout, which the outline view draws.
    outlined: Layout,
    /// The layouts' scratch for rebuilds, which they share.
    key_counts: KeyCounts,
    /// The shadow passes of the frame that the layouts were built for.
    layouts_shadowed: CasterPasses,
    /// True when the layouts were built while outlines are on.
    layouts_outlined: bool,
    /// The layout of the objects whose material has a scatter radius, which the subsurface view
    /// draws.
    scattering: Layout,
    /// True when the layouts were built while the subsurface blur has taps.
    layouts_scattered: bool,
    /// True when the scene's layout was built with the motion pipelines, while a pass reads the
    /// motion.
    layouts_moving: bool,
    /// The motion pass's last frame's data.
    motion: motion::Motion,
    /// Whether each bucket of the scene's layout holds something that moved in the frame.
    motion_moving: Vec<bool>,

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
    /// The subsurface view's culling output and draws.
    skin_culling: Culling,
    skin_draws: Opaque,
    /// True when the cascades' uniform block holds cascades, which receivers then read.
    cascades_held: bool,
    lines: LinesPass,
    /// The sources of the transparent pass, and each view's draws of it.
    sorted: SortedLayout,
    transparent: Transparent,
    /// The decals, and the camera view's draws of them in the decal pass.
    decal_layout: SortedLayout,
    decals: Transparent,
    /// The opaque pairs, and the camera view's draws of them on the layers that decals skip,
    /// which draw again after the decals.
    redraw_layout: SortedLayout,
    redraws: Transparent,
    /// True when the redraw's layout holds the opaque pairs: some object is a decal, and decals
    /// skip some layers.
    redraws_built: bool,
    /// Where the decal pass's records, then its redraw's, start in the transparent part of a ring
    /// slot of draw records: after the transparent pass's.
    decal_records_at: u32,
    redraw_records_at: u32,
    /// The depth texture that the decal pass's group binds, or `None` before the group exists.
    decal_depth_bound: Option<u32>,
    background: BackgroundPass,
    /// The particle systems' GPU objects and draws.
    particles: ParticlePass,
    /// The physical sky's tables.
    physical_sky: PhysicalSkyPass,
    /// The vertex pages' vertex and index buffers.
    meshes: MeshBuffers,
    pipelines: PipelineCache,
    textures: SharedTextures,
    /// The slot of the streamed textures, which every view reads.
    streamed_slot: RingSlot,
    /// The point and spot lights of each camera view, and the textures that hold them.
    lights: LightGrids,
    light_textures: LightTextures,
    /// The skinned scene objects, and the textures that their vertex shaders read.
    skins: Skins,
    created: bool,
    /// True from the creation of three.js's table of specular terms until a frame uploads it.
    dfg_pending: bool,
    /// The cube texture that the camera views' frame groups bind: the environment's, or the
    /// blank one.
    bound_environment: u32,
    /// The 3D texture that the frame groups bind: the grid's, or the blank one.
    bound_probe_grid: u32,
}

impl CpuCulledRenderer {
    pub fn new(mut config: CpuCulledConfig) -> Self {
        assert!(
            config.max_materials <= sizes::MAX_MATERIALS,
            "the material texture holds {} materials",
            sizes::MAX_MATERIALS
        );
        // The material texture's rows also hold the table of specular terms beside them.
        config.max_materials = config.max_materials.max(dfg::SIZE.div_ceil(2));
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
        let mut settings = SceneSettings::new(
            MeshStorage::new(Packing::Pages),
            config.max_materials,
            textures,
            config.canvas,
            config.cascade_depth,
        );
        settings.share_map_units(sizes::SHARED_MAP_UNITS as usize);
        Self {
            config,
            settings,
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
                        accumulate: AccumulateIds {
                            buffer: ids::ACCUMULATE,
                            group: ids::ACCUMULATE_GROUP,
                        },
                        still_pass: FinalIds {
                            settings: ids::STILL_SETTINGS,
                            group: ids::STILL_GROUP,
                            blank_lut: ids::STILL_BLANK_LUT,
                            lut_sampler: ids::STILL_LUT_SAMPLER,
                            blank_outline: ids::STILL_BLANK_OUTLINE,
                        },
                        output_pass: FinalIds {
                            settings: ids::OUTPUT_SETTINGS,
                            group: ids::OUTPUT_GROUP,
                            blank_lut: ids::OUTPUT_BLANK_LUT,
                            lut_sampler: ids::OUTPUT_LUT_SAMPLER,
                            blank_outline: ids::OUTPUT_BLANK_OUTLINE,
                        },
                        present_group: ids::PRESENT_GROUP,
                        bloom: BloomIds {
                            buffer: ids::BLOOM,
                            sampler: ids::BLOOM_SAMPLER,
                            first_group: ids::BLOOM_GROUPS,
                        },
                        ao: AoIds {
                            buffer: ids::AO,
                            first_group: ids::AO_GROUPS,
                        },
                        effects: EffectIds {
                            buffer: ids::EFFECTS,
                            sampler: ids::EFFECT_SAMPLER,
                            first_group: ids::EFFECT_GROUPS,
                            blank_depth: ids::BLANK_EFFECT_DEPTH,
                        },
                        fullscreen: FullscreenIds {
                            buffer: ids::FULLSCREEN,
                            sampler: ids::FULLSCREEN_SAMPLER,
                            first_group: ids::FULLSCREEN_GROUPS,
                            blank_color: ids::BLANK_PASS_COLOR,
                            blank_depth: ids::BLANK_PASS_DEPTH,
                        },
                        dof: DofIds {
                            buffer: ids::DOF,
                            sampler: ids::DOF_SAMPLER,
                            first_group: ids::DOF_GROUPS,
                        },
                        fog: FogVolumeIds {
                            buffer: ids::FOG_VOLUME,
                            sampler: ids::FOG_SAMPLER,
                            first_group: ids::FOG_GROUPS,
                        },
                        exposure: ExposureIds {
                            buffer: ids::EXPOSURE,
                            sampler: ids::EXPOSURE_SAMPLER,
                            cells: ids::EXPOSURE_CELLS,
                            texel: ids::EXPOSURE_TEXEL,
                            stored: ids::EXPOSURE_STORED,
                            first_group: ids::EXPOSURE_GROUPS,
                            compute: None,
                        },
                        view_copy: None,
                        transmission: TransmissionIds {
                            group: ids::TRANSMISSION_GROUP,
                            blank: ids::BLANK_TRANSMISSION,
                        },
                        subsurface: SubsurfaceIds {
                            buffer: ids::SUBSURFACE,
                            first_group: ids::SUBSURFACE_GROUPS,
                        },
                        motion: MotionIds {
                            buffer: ids::MOTION_VIEW,
                            group: ids::MOTION_VIEW_GROUP,
                            sampler: ids::MOTION_SAMPLER,
                            blank: ids::BLANK_MOTION,
                        },
                        ssr: SsrIds {
                            buffer: ids::SSR,
                            first_group: ids::SSR_GROUPS,
                        },
                        weighted: WeightedIds {
                            first_group: ids::WEIGHTED_GROUPS,
                        },
                        particle_depth: ids::PARTICLE_DEPTH_COPY_GROUP,
                    },
                );
                graph.bind_shadow_map(config.cascade_depth);
                graph.set_weighted_targets(config.float16_targets);
                graph.set_depth_prepass(config.depth_prepass);
                graph
            },
            layout: Layout::new(Drawn::Scene),
            casters: Layout::new(Drawn::Casters),
            outlined: Layout::new(Drawn::Outlined),
            key_counts: KeyCounts::new(),
            layouts_shadowed: CasterPasses::default(),
            layouts_outlined: false,
            scattering: Layout::new(Drawn::Subsurface),
            layouts_scattered: false,
            layouts_moving: false,
            motion: motion::Motion::default(),
            motion_moving: Vec::new(),

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
            skin_culling: Culling::new(ViewId::SUBSURFACE),
            skin_draws: Opaque::new(ViewId::SUBSURFACE, config.multi_draw),
            cascades_held: false,
            lines: LinesPass::new(ids::LINES),
            sorted: SortedLayout::default(),
            transparent: Transparent::new(config.multi_draw),
            decal_layout: SortedLayout::decals(),
            decals: Transparent::new(config.multi_draw),
            redraw_layout: SortedLayout::redraws(),
            redraws: Transparent::new(config.multi_draw),
            redraws_built: false,
            decal_records_at: 0,
            redraw_records_at: 0,
            decal_depth_bound: None,
            background: BackgroundPass::new(BackgroundIds {
                buffer: ids::BACKGROUND,
                group: ids::BACKGROUND_GROUP,
                blank_cube: ids::BLANK_ENVIRONMENT,
                sampler: ids::ENVIRONMENT_SAMPLER,
            }),
            particles: ParticlePass::new(ParticleIds {
                buffers: ids::PARTICLE_BUFFERS,
                groups: ids::PARTICLE_GROUPS,
                depth_groups: ids::PARTICLE_DEPTH_GROUPS,
                blank_depth: ids::BLANK_PARTICLE_DEPTH,
            }),
            physical_sky: PhysicalSkyPass::new(PhysicalSkyIds {
                buffer: ids::PHYSICAL_SKY,
                textures: ids::SKY_TABLES,
                samplers: ids::SKY_SAMPLERS,
                groups: ids::SKY_GROUPS,
            }),
            meshes: MeshBuffers::new(ids::PAGES),
            pipelines: PipelineCache::default(),
            textures: SharedTextures::default(),
            streamed_slot: RingSlot::default(),
            lights: LightGrids::new(config.light_limits, false),
            light_textures: LightTextures::default(),
            skins: Skins::default(),
            created: false,
            dfg_pending: false,
            bound_environment: ids::BLANK_ENVIRONMENT,
            bound_probe_grid: ids::BLANK_PROBE_GRID,
        }
    }

    /// The render graph of the builder's passes.
    pub fn render_graph(&self) -> &RenderGraph {
        self.graph.graph()
    }

    /// The light grid of the camera's view in the frame recorded last, with the records that the
    /// shaders read.
    pub fn light_grid(&self) -> &LightGrid {
        self.lights.camera().grid()
    }

    /// The light grid of camera view `view` in the frame recorded last, or `None` while the view
    /// has seen no point or spot light.
    pub fn view_light_grid(&self, view: ViewId) -> Option<&LightGrid> {
        Some(self.lights.get(view)?.grid())
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
    /// tiles', the outline view's or the subsurface view's.
    fn culling_of(&self, view: ViewId) -> &Culling {
        match (view.cascade_index(), view.tile_index()) {
            (Some(_), _) => &self.cascade_culling,
            (_, Some(_)) => &self.tile_culling,
            _ if view == ViewId::OUTLINE => &self.outline_culling,
            _ if view == ViewId::SUBSURFACE => &self.skin_culling,
            _ => &self.culling,
        }
    }

    /// The outline views that the frame culls: one while outlines are on.
    fn outline_views(&self) -> usize {
        usize::from(self.layouts_outlined)
    }

    /// The subsurface views that the frame culls: one while the subsurface blur has taps and some
    /// object's material has a scatter radius.
    fn skin_views(&self) -> usize {
        usize::from(self.layouts_scattered && !self.scattering.buckets.is_empty())
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
    /// the clusters, the culling runs and every view's output, and the upload arenas. While
    /// `shadows` has a pass on, the casters' layout holds the casters, and the receivers read the
    /// shadow maps. With `outlines`, the outlined layout holds the outlined objects, and with
    /// `scatters` the subsurface layout holds the objects whose material has a scatter radius.
    /// With `motion`, the scene's draws get their motion pipelines.
    fn rebuild_layout(
        &mut self,
        input: &FrameInput<'_>,
        shadows: CasterPasses,
        outlines: bool,
        scatters: bool,
        motion: bool,
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
        self.skins.open_before_first_frame(input.pipelines_built);
        let limit = FrameBuilder::max_sources(self);
        let multi_draw = self.config.multi_draw;
        let targets = self.with_draw_index(self.graph.scene_targets());
        self.layout_prepass = self.graph.depth_prepass();
        let prepass = self.graph.depth_pass(Prepass::OwnVertexShader);
        let motion_targets = motion.then(|| self.with_draw_index(self.graph.motion_targets()));
        let (settings, pipelines, skins) = (&self.settings, &mut self.pipelines, &self.skins);
        self.layout.rebuild(
            settings,
            pipelines,
            skins,
            targets,
            input,
            limit,
            multi_draw,
            shadows,
            prepass,
            motion_targets,
            &mut self.key_counts,
        )?;
        self.layouts_moving = motion;
        // The casters' layout holds buckets only while a light casts shadows.
        if shadows.any() {
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
                None,
                &mut self.key_counts,
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
                None,
                &mut self.key_counts,
            )?;
        } else {
            self.outlined.clear();
        }
        self.layouts_outlined = outlines;
        if scatters {
            let targets = self.with_draw_index(self.graph.skin_targets());
            let (settings, pipelines, skins) = (&self.settings, &mut self.pipelines, &self.skins);
            // The scattering layout draws the skin pass alone, which the motion pass does not read.
            self.scattering.rebuild(
                settings,
                pipelines,
                skins,
                targets,
                input,
                limit,
                multi_draw,
                shadows,
                Prepass::Off,
                None,
                &mut self.key_counts,
            )?;
        } else {
            self.scattering.clear();
        }
        self.layouts_scattered = scatters;
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
                shadows.any(),
                |slot, key| skins.sorted_pipeline(slot, key),
                self.graph.weighted_targets(targets),
                &mut self.key_counts,
            )
            .map_err(out_of_memory)?;
        self.skins.asked();
        let targets = self.with_draw_index(self.graph.decal_targets());
        self.decal_layout
            .rebuild(
                &self.settings,
                &mut self.pipelines,
                targets,
                input.scene,
                input.batches,
                place,
                RESIDENT,
                shadows.any(),
                |_, _| SkinnedPipeline::NotSkinned,
                None,
                &mut self.key_counts,
            )
            .map_err(out_of_memory)?;
        // The redraw's layout holds every opaque pair, so it is built only while decals skip some
        // layers. Its rows are listed a second time, after the decals'.
        self.redraws_built = self.redraws_wanted();
        if self.redraws_built {
            let targets = self.with_draw_index(self.graph.scene_targets());
            let skins = &self.skins;
            self.redraw_layout
                .rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    targets,
                    input.scene,
                    input.batches,
                    place,
                    RESIDENT,
                    shadows.any(),
                    |slot, key| skins.sorted_pipeline(slot, key),
                    None,
                    &mut self.key_counts,
                )
                .map_err(out_of_memory)?;
        } else {
            self.redraw_layout = SortedLayout::redraws();
        }
        let multi_draw = self.config.multi_draw;
        let records = Transparent::records_bound(&self.sorted, multi_draw);
        let decals = Transparent::records_bound(&self.decal_layout, multi_draw);
        let redraws = Transparent::records_bound(&self.redraw_layout, multi_draw);
        self.decal_records_at = records;
        self.redraw_records_at = records + decals;
        self.layout.add_sorted(
            records + decals + redraws,
            self.sorted.scene_slots(),
            self.decal_layout.scene_slots(),
        );
        self.layout.room.rows = self
            .layout
            .room
            .rows
            .saturating_add(self.redraw_layout.rows());
        self.clusters
            .prepare(input.batches, &self.layout)
            .map_err(out_of_memory)?;
        // The cell order holds every object that a view or a cascade culls: blended casters have
        // no bucket in the scene's layout, as the transparent pass draws them, but cast all the
        // same, and blended objects can be outlined. Each culling skips the rows that have no bucket
        // in its own layout.
        let (scene_buckets, casters) = (&self.layout.scene_buckets, &self.casters.scene_buckets);
        let outlined = &self.outlined.scene_buckets;
        let scattering = &self.scattering.scene_buckets;
        let in_layout = |buckets: &[u32], slot: usize| {
            buckets.get(slot).is_some_and(|&bucket| bucket != NO_BUCKET)
        };
        let culled = |slot: usize| {
            scene_buckets[slot] != NO_BUCKET
                || in_layout(casters, slot)
                || in_layout(outlined, slot)
                || in_layout(scattering, slot)
        };
        self.cells
            .classify(input.scene, &culled)
            .map_err(out_of_memory)?;
        let views = self.settings.views().len();
        self.culling.reserve(room, views).map_err(out_of_memory)?;
        self.culling
            .reserve_sorted(&self.sorted, &self.decal_layout, &self.redraw_layout)
            .map_err(out_of_memory)?;
        self.transparent
            .reserve(&self.sorted, views)
            .map_err(out_of_memory)?;
        self.decals
            .reserve(&self.decal_layout, 1)
            .map_err(out_of_memory)?;
        self.redraws
            .reserve(&self.redraw_layout, 1)
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
        self.skin_culling
            .reserve(self.scattering.room, self.skin_views())
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
        let skins = self.skin_views();
        for (culling, layout, count) in [
            (&mut self.culling, &self.layout, views),
            (&mut self.cascade_culling, &self.casters, cascades),
            (&mut self.tile_culling, &self.casters, tiles),
            (&mut self.outline_culling, &self.outlined, outlines),
            (&mut self.skin_culling, &self.scattering, skins),
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
                .reserve_sorted(&self.sorted, &self.decal_layout, &self.redraw_layout)
                .map_err(out_of_memory)?;
            self.transparent
                .reserve(&self.sorted, views)
                .map_err(out_of_memory)?;
        }
        Ok(())
    }

    /// True when objects on the layers that decals skip must draw again after them: some object is
    /// a decal, and decals skip some layers.
    fn redraws_wanted(&self) -> bool {
        !self.decal_layout.is_empty() && self.settings.decal_skipped_layers() != 0
    }

    /// Makes the group of the scene depth that the decal pass reads, when the pass starts, and when
    /// the frame made the plan's textures again. The backend binds a copy of one sample of a
    /// multisampled depth.
    fn bind_decal_depth(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let depth = self.graph.decal_depth();
        if let Some(texture) = depth
            && (self.graph.textures_made() || depth != self.decal_depth_bound)
        {
            let (group, layout) = (ids::DECAL_DEPTH_GROUP, bind_layout::DECAL_DEPTH);
            let words = [group, layout, 1, 0, resource_kind::TEXTURE, texture, 0, 0];
            list.push(Op::CreateBindGroup, &words)?;
        }
        self.decal_depth_bound = depth;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the material table, three.js's table of specular terms, the light grid, each
    /// view's, each shadow cascade's and each shadow tile's frame uniform, draw records and
    /// multi-draw arrays, the shadow settings block's parts, the final pass's settings,
    /// the skinned objects' first joints after a change, and the cluster orders not uploaded yet.
    fn upload_bound(&self) -> usize {
        self.upload_bound_without_clusters()
            + self.clusters.pending_bytes(&self.layout, &self.casters)
    }

    /// [`Self::upload_bound`] without the cluster orders.
    fn upload_bound_without_clusters(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials = self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 * 2
            + dfg::BYTES
            + ao::BLANK_BYTES;
        let per_view = |layout: &Layout| {
            (sizes::FRAME_UNIFORM_BYTES + OFFSETS_BYTES) as usize
                + layout.draws_slot_bytes as usize
                + layout.draws.len() * 12
        };
        let views = self.settings.views().len();
        let tiles = (self.settings.tile_settings().tiles as usize).min(MAX_TILES);
        let cascades = (MAX_CASCADES + tiles) * per_view(&self.casters);
        let outline = per_view(&self.outlined) + per_view(&self.scattering);
        let shadows = (sizes::SHADOW_UNIFORM_BYTES + sizes::SHADOW_TILES_UNIFORM_BYTES) as usize;
        meshes
            + materials
            + self.lights.upload_room()
            + views * per_view(&self.layout)
            + Transparent::upload_bound(&self.sorted, views, self.config.multi_draw)
            + Transparent::upload_bound(&self.decal_layout, 1, self.config.multi_draw)
            + Transparent::upload_bound(&self.redraw_layout, 1, self.config.multi_draw)
            + cascades
            + outline
            + shadows
            + self.skins.upload_bound(self.settings.meshes())
            + self.graph.upload_bound()
            + BackgroundPass::UPLOAD_BYTES
            + self
                .particles
                .upload_bound(self.settings.particles(), views)
            + PhysicalSkyPass::UPLOAD_BYTES
            + sizes::OBJECT_RANGE_BYTES as usize
            + if self.layouts_moving {
                crate::motion::BLOCK_BYTES as usize
            } else {
                0
            }
    }

    /// Records the creation of the material table, a data texture with one row of texels for each
    /// material it holds and one for each material's custom values, and three.js's table of
    /// specular terms in the columns after them, and of the shadows' settings block and comparison
    /// sampler.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        shadows::create_objects(list, ids::SHADOWS, ids::SHADOW_SAMPLER, None)?;
        list.push(
            Op::CreateTexture,
            &[
                ids::MATERIALS,
                MATERIAL_TEXELS + dfg::SIZE,
                self.config.max_materials * 2,
                1,
                format::RGBA32_FLOAT,
                texture_usage::TEXTURE_BINDING | texture_usage::COPY_DST,
                1,
                1,
                view::D2,
            ],
        )?;
        list.push(
            Op::CreateBuffer,
            &[
                ids::OBJECT_RANGES,
                sizes::OBJECT_RANGE_BYTES,
                buffer_usage::UNIFORM | buffer_usage::COPY_DST,
            ],
        )?;
        environment::create_objects(list, ids::BLANK_ENVIRONMENT, ids::ENVIRONMENT_SAMPLER)?;
        probe_grid::create_objects(list, ids::BLANK_PROBE_GRID)?;
        ao::create_blank(list, ids::BLANK_AO)?;
        transmission::create_blank(list, ids::BLANK_TRANSMISSION)?;
        self.settings
            .light_tables_mut()
            .create(list, ids::LIGHT_TABLES)?;
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
        first_new: [usize; 5],
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
        let skin_views = self.skin_views();
        let [
            first_new,
            first_new_cascade,
            first_new_tile,
            first_new_outline,
            first_new_skin,
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
            (
                &mut self.skin_culling,
                &mut self.skin_draws,
                &self.scattering,
                skin_views,
                first_new_skin,
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
    /// texture, and the changed row values of static batches that have them into the resident row
    /// values texture, straight from the core's world buffers of this parity, or every one of them
    /// after the layout changed.
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
        let upload_rows =
            |list: &mut DrawList, slot: &BatchSlot, batch: &InstanceBatch, start, count| {
                upload(
                    list,
                    slot.base,
                    batch.world(parity).matrices(),
                    start,
                    count,
                )?;
                if slot.values {
                    let values = batch.world(parity).row_values();
                    write_row_values(list, ids::RESIDENT_VALUES, slot.base, values, start, count)?;
                }
                Ok::<(), RecordError>(())
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
                upload_rows(list, slot, batch, 0, batch.frame_active_count(parity))?;
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
            upload_rows(list, slot, batch, range.start, range.count)?;
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

    /// Writes the active rows of every dynamic batch into the streamed texture of slot `streamed`,
    /// and the row values of those that have them into the streamed row values texture of the
    /// same slot.
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
            if slot.values {
                let values = batch.world(parity).row_values();
                let texture = ids::STREAMED_VALUES + streamed;
                write_row_values(list, texture, slot.base, values, 0, active)?;
            }
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
        // A view whose scene stopped changing draws from the uniform slot of its frame's parity,
        // so the frames of one parity record the same words (see `crate::still`).
        let hold_uniforms = settled(input, self.settings.still_enabled());
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
        self.graph.set_dof(
            self.settings
                .dof_frame(input.scene, input.parity(), input.canvas),
        );
        self.graph.set_fog_volume(self.settings.fog_volume_frame(
            input.scene,
            input.parity(),
            input.canvas,
        ));
        self.settings.prepare_effect_maps();
        self.graph.set_exposure(self.settings.exposure_frame());
        self.graph.set_effects(
            self.settings.effects(),
            self.settings.effect_joins(),
            self.settings.clock_seconds(),
            self.settings.camera_projection(input.canvas),
        );
        self.graph.set_tone_curve(self.settings.tone_curve());
        self.graph.set_grading(self.settings.grades());
        self.graph
            .set_outline(self.settings.outline(), !self.outlined.buckets.is_empty());
        self.graph.set_still_enabled(self.settings.still_enabled());
        self.graph.set_still(self.settings.still());
        self.graph.set_subsurface(
            self.settings.subsurface_frame(input.canvas),
            !self.scattering.buckets.is_empty(),
        );
        self.graph.set_transmission(self.sorted.transmits());
        let motion = self.settings.motion_wanted();
        let motion_frame = match (motion, self.culling.frame(ViewId::CAMERA)) {
            (true, Some(camera)) => Some(self.motion.advance(camera)),
            _ => {
                if !motion {
                    self.motion.stop();
                }
                None
            }
        };
        self.graph.set_motion(motion, motion_frame);
        self.graph.set_weighted(self.sorted.weighs());
        let skipped = self.settings.decal_skipped_layers();
        let redraws = self.redraws_built && skipped != 0;
        self.graph
            .set_decals(!self.decal_layout.is_empty(), redraws);
        self.graph
            .set_soft_particles(self.settings.particles().wants_depth());
        // The render scale's range decides which of the final pass's pipelines the frame asks for.
        self.graph.set_scaling(self.settings.render_scaling());
        self.graph
            .request_pipelines(&mut self.pipelines, input.pipelines_built);
        self.graph
            .request_fullscreen_pipelines(&mut self.pipelines, self.settings.views());
        self.background.request_pipeline(
            &self.settings,
            &mut self.pipelines,
            self.graph.scene_targets(),
            Place::of(self.layout.depthless),
        );
        self.physical_sky
            .request_pipeline(&mut self.pipelines, self.settings.physical_sky().is_some());
        let created_pipelines = self.pipelines.create_new(list, input.frame)? > 0;
        if !self.created {
            self.create_fixed(list)?;
        }
        self.graph
            .set_shadows(self.shadow.as_ref().map(ShadowPasses::of));
        self.graph.set_tiles(self.tiles.shape().map(|s| TilePasses {
            tiles: s.layers,
            size: s.size,
        }));
        self.settings.pace_views(input.canvas, input.render_scale);
        self.settings.mark_shown_views();
        self.graph
            .sync_views(self.settings.views(), self.settings.view_names());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.set_transparent(!self.sorted.is_empty());
        self.graph.prepare(list, input.canvas, input.render_scale)?;
        let graph = &self.graph;
        self.settings
            .set_view_targets(|view| graph.view_target(view), graph.textures_made());
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
            probe_grid: self.bound_probe_grid,
            lights: 0,
            transmission: ids::BLANK_TRANSMISSION,
        };
        let first_new = self.opaque.views();
        let lights_remade =
            self.light_textures
                .size(list, &mut self.lights, self.config.max_texture_size)?;
        self.opaque.add_views(list, views)?;
        // Every camera view's frame groups bind the shadow maps and its light textures, so a view
        // binds them again when the graph or its light textures make them again. Only the camera's
        // view copies its opaque color for surfaces that let light through.
        let copy = self.graph.transmission_texture();
        let light_textures = &self.light_textures;
        let lit_for = |lit: LitTextures, view: ViewId| LitTextures {
            lights: ids::light_data(light_textures.owner(view)),
            transmission: if view == ViewId::CAMERA {
                copy
            } else {
                ids::BLANK_TRANSMISSION
            },
            ..lit
        };
        // Every view binds the light tables too, so each binds them again when they are made again.
        let tables_remade = self
            .settings
            .light_tables_mut()
            .record(list, ids::LIGHT_TABLES)?;
        let textures_made = tables_remade || self.graph.textures_made();
        for index in 0..self.opaque.views() {
            if index >= first_new || textures_made || lights_remade & (1 << index) != 0 {
                let view = ViewId::from_index(index);
                Opaque::bind_frame(list, view, Some(lit_for(lit, view)))?;
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
        // The subsurface view lights its objects as the camera's view does, so its frame groups
        // bind the camera's textures, again whenever the camera's do.
        let skin_views = self.skin_views();
        let first_new_skin = self.skin_draws.views();
        self.skin_draws.add_views(list, skin_views)?;
        let camera_rebound = textures_made || lights_remade & 1 != 0;
        if skin_views > 0 && (first_new_skin < skin_views || camera_rebound) {
            Opaque::bind_frame(list, ViewId::SUBSURFACE, Some(lit_for(lit, ViewId::CAMERA)))?;
        }
        let rebuilt = self.layout.built_in == input.frame;
        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::MATERIALS, MATERIAL_TEXELS)?;
            ao::upload_blank(list, arena, ids::BLANK_AO)?;
        }
        self.meshes
            .upload(list, arena, self.settings.meshes().pages())?;
        // Draws bind the maps' groups by id as they run, so a group made again needs nothing more.
        let table = MaterialStorage::Texture(ids::MATERIALS);
        let camera_y = self
            .culling
            .frame(ViewId::CAMERA)
            .map_or(0.0, |frame| frame.uniform.camera_world[1]);
        physical_sky::record_frame(
            &mut self.physical_sky,
            &mut self.settings,
            (&self.pipelines, input.pipelines_built),
            camera_y,
            list,
            arena,
        )?;
        self.settings
            .record_materials(input, list, arena, table, &self.physical_sky)?;
        // The frame's texture work made the passes' targets and uploads ready, so the textures
        // of the effects and the full-screen passes sample from this frame on.
        self.settings.update_post_layers();
        self.graph
            .set_post_values(self.settings.effects(), self.settings.views());
        // The environment's map may have finished its upload, or gone, with this frame's texture
        // work, so the views read it from here on.
        let (environment, uniform) = self.settings.environment_map(ids::BLANK_ENVIRONMENT);
        if environment != self.bound_environment {
            self.bound_environment = environment;
            lit.environment = environment;
            for index in 0..self.opaque.views() {
                let view = ViewId::from_index(index);
                Opaque::bind_frame(list, view, Some(lit_for(lit, view)))?;
            }
            if skin_views > 0 {
                let camera = lit_for(lit, ViewId::CAMERA);
                Opaque::bind_frame(list, ViewId::SUBSURFACE, Some(camera))?;
            }
        }
        let (probe_grid, grid_uniform) = self.settings.probe_grid_map(ids::BLANK_PROBE_GRID);
        if probe_grid != self.bound_probe_grid {
            self.bound_probe_grid = probe_grid;
            lit.probe_grid = probe_grid;
            for index in 0..self.opaque.views() {
                let view = ViewId::from_index(index);
                Opaque::bind_frame(list, view, Some(lit_for(lit, view)))?;
            }
        }
        for index in 0..views {
            if let Some(frame) = self.culling.frame_mut(ViewId::from_index(index)) {
                frame.uniform.environment = uniform;
                frame.uniform.probe_grid = grid_uniform;
            }
        }
        let copied = f32::from(u8::from(self.graph.transmission_copied()));
        if let Some(frame) = self.culling.frame_mut(ViewId::CAMERA) {
            frame.uniform.camera_world[3] = copied;
            let eye = frame.camera.absolute();
            self.graph.write_screen_values(&mut frame.uniform, eye);
        }
        if let Some(frame) = self.skin_culling.frame_mut(ViewId::SUBSURFACE) {
            frame.uniform.environment = uniform;
            frame.uniform.camera_world[3] = copied;
        }
        self.graph.upload(
            list,
            arena,
            self.settings.drawn_output(),
            self.settings.grading(),
        )?;
        self.bind_decal_depth(list)?;
        self.background
            .prepare(list, arena, &self.settings, self.physical_sky.group())?;
        let culling = &self.culling;
        self.particles.prepare(
            list,
            arena,
            &self.settings,
            self.settings.particles(),
            input.scene,
            input.parity(),
            views,
            &|k| culling.frame(ViewId::from_index(k)),
            (
                self.graph.particle_depth_texture(),
                self.graph.textures_made(),
            ),
        )?;
        self.settings.particles_mut().clear_marks();
        let new_views = first_new < views
            || first_new_cascade < cascades
            || first_new_tile < tiles
            || first_new_outline < outlines
            || first_new_skin < skin_views;
        let new_texture = if rebuilt || new_views {
            let first_new = [
                first_new,
                first_new_cascade,
                first_new_tile,
                first_new_outline,
                first_new_skin,
            ];
            self.size_resources(list, input, first_new, rebuilt)?
        } else {
            false
        };
        self.upload_resident(list, input, rebuilt || new_texture)?;
        let motion_on =
            motion && self.layouts_moving && self.graph.motion_draws() && motion_frame.is_some();
        if let (true, Some(motion_frame)) = (motion_on, motion_frame.as_ref()) {
            let ranges = input.snapshot.uploads().len() + 1;
            self.motion.reserve(ranges)?;
            let buckets = self.layout.buckets.len();
            self.motion_moving
                .try_reserve(buckets.saturating_sub(self.motion_moving.len()))
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: buckets as u32,
                })?;
            let resident_rows = self.textures.resident_rows();
            let remade = rebuilt || new_texture;
            self.motion
                .prepare(list, resident_rows, &self.skins, remade)?;
            self.motion
                .mark(input, &self.layout, &mut self.motion_moving);
            self.motion.upload(list, arena, motion_frame)?;
        }
        self.skins.set_morph_cap(self.settings.morph_cap());
        let meshes = self.settings.meshes();
        self.skins
            .upload(list, arena, input.animations, input.morphs, meshes)?;
        self.clusters
            .upload(list, arena, &self.layout, &self.casters)?;
        self.layout.upload_object_ranges(list, arena)?;
        let drawn_views = (0..views)
            .filter(|&index| self.culling.frame(ViewId::from_index(index)).is_some())
            .fold(0u32, |mask, index| mask | 1 << index);
        self.light_textures
            .upload(list, arena, &mut self.lights, input.frame, drawn_views)?;

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
                Some(SortedPasses {
                    settings: &self.settings,
                    transparent: (&mut self.transparent, &self.sorted),
                    camera: [
                        (&mut self.decals, &self.decal_layout, self.decal_records_at),
                        (
                            &mut self.redraws,
                            &self.redraw_layout,
                            self.redraw_records_at,
                        ),
                    ],
                }),
                views,
                UploadFrame {
                    frame,
                    hold_uniforms,
                    streamed,
                },
            )?;
            let shadowed = self.layouts_shadowed.any();
            if self.shadow.is_none() && self.cascades_held && shadowed {
                // Receivers of point and spot light shadows read the cascades too: none now.
                let (at, bytes) = arena.push(ShadowUniform::default().as_bytes())?;
                list.push(Op::WriteBuffer, &[ids::SHADOWS, 0, at, bytes])?;
            }
            self.cascades_held = self.shadow.is_some() || (self.cascades_held && !shadowed);
            self.tiles
                .upload(list, arena, ids::SHADOWS, sizes::SHADOW_UNIFORM_BYTES)?;
            upload_views(
                list,
                arena,
                (&mut self.tile_culling, &mut self.tile_draws, &self.casters),
                None,
                tiles,
                UploadFrame {
                    frame,
                    hold_uniforms,
                    streamed,
                },
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
                UploadFrame {
                    frame,
                    hold_uniforms,
                    streamed,
                },
            )?;
            upload_views(
                list,
                arena,
                (
                    &mut self.skin_culling,
                    &mut self.skin_draws,
                    &self.scattering,
                ),
                None,
                skin_views,
                UploadFrame {
                    frame,
                    hold_uniforms,
                    streamed,
                },
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
                    UploadFrame {
                        frame,
                        hold_uniforms,
                        streamed,
                    },
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
        let weighted = self.graph.weighted_declared();
        let (cascade_culling, cascade_draws) = (&self.cascade_culling, &self.cascade_draws);
        let (tile_culling, tile_draws) = (&self.tile_culling, &self.tile_draws);
        let (outline_culling, outline_draws) = (&self.outline_culling, &self.outline_draws);
        let (skin_culling, skin_draws) = (&self.skin_culling, &self.skin_draws);
        let (layout, casters, meshes) = (&self.layout, &self.casters, &self.meshes);
        let (outlined, scattering) = (&self.outlined, &self.scattering);
        let (transparent, background) = (&self.transparent, &self.background);
        let (decals, decal_records_at) = (&self.decals, self.decal_records_at);
        let (redraws, redraw_records_at) = (&self.redraws, self.redraw_records_at);
        let particles = &self.particles;
        let light_textures = &self.light_textures;
        // A view leaves out the objects whose maps show a target that it does not read.
        let settings = &self.settings;
        let hidden_in = |view: ViewId| {
            let hidden_targets = settings.hidden_targets(view);
            move |group| {
                hidden_targets != 0
                    && settings.textures().group_pass_views(group) & hidden_targets != 0
            }
        };
        let never = |_| false;
        let motion_draws = motion_on && self.motion.draws();
        let (motion_state, motion_moving, skins) =
            (&mut self.motion, &self.motion_moving, &self.skins);
        let motion_group = ids::motion_frame_group(input.parity(), self.streamed_slot.slot());
        // A cascade or a tile that does not draw keeps its depth: its render pass is left out.
        let skips = |role: Role| match role {
            Role::Shadow(view) if view.tile_index().is_some() => tile_culling.frame(view).is_none(),
            Role::Shadow(view) => cascade_culling.frame(view).is_none(),
            _ => false,
        };
        self.graph.record(
            list,
            |view| settings.clear_color_of(view),
            skips,
            |list, role| match role {
                Role::Opaque(view) if culling.frame(view).is_some() => {
                    let backdrop = settings.draws_background(view);
                    let slot = opaque.frame_slot(view);
                    let light_slot = light_textures.slot(view);
                    let group = ids::frame_group(view) + light_slot;
                    if backdrop {
                        background.record(list, group, &[slot, slot], Place::First)?;
                    }
                    let starts = culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Lit { light_slot };
                    let hidden = hidden_in(view);
                    opaque.record(list, arena, view, starts, layout, meshes, shading, &hidden)?;
                    if backdrop {
                        background.record(list, group, &[slot, slot], Place::Last)?;
                    }
                    Ok(())
                }
                Role::Prepass(view) if culling.frame(view).is_some() => {
                    let starts = culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Prepass {
                        light_slot: light_textures.slot(view),
                    };
                    let hidden = hidden_in(view);
                    opaque.record(list, arena, view, starts, layout, meshes, shading, &hidden)
                }
                Role::Shadow(view) if cascade_culling.frame(view).is_some() => {
                    let starts = cascade_culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Depth;
                    cascade_draws
                        .record(list, arena, view, starts, casters, meshes, shading, &never)
                }
                Role::Shadow(view) if tile_culling.frame(view).is_some() => {
                    let starts = tile_culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Tile;
                    tile_draws.record(list, arena, view, starts, casters, meshes, shading, &never)
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
                        &never,
                    )
                }
                Role::SkinLight if skin_culling.frame(ViewId::SUBSURFACE).is_some() => {
                    let view = ViewId::SUBSURFACE;
                    let starts = skin_culling.culled(frame, view).bucket_starts();
                    let shading = Shading::Lit {
                        light_slot: light_textures.slot(ViewId::CAMERA),
                    };
                    let hidden = hidden_in(ViewId::CAMERA);
                    skin_draws.record(
                        list, arena, view, starts, scattering, meshes, shading, &hidden,
                    )
                }
                Role::Transparent(view) if culling.frame(view).is_some() => {
                    let rows = if weighted && view == ViewId::CAMERA {
                        SortedRows::Sorted
                    } else {
                        SortedRows::All
                    };
                    let at = opaque.sorted_records_at(view, layout);
                    let draws = ids::draws_group(view);
                    let light_slot = light_textures.slot(view);
                    let bind = |list: &mut DrawList| opaque.bind_view(list, view, light_slot);
                    let hidden = hidden_in(view);
                    let index = view.index();
                    transparent.record(
                        list, arena, index, rows, draws, at, meshes, bind, &hidden, particles,
                    )
                }
                Role::Weighted if culling.frame(ViewId::CAMERA).is_some() => {
                    let view = ViewId::CAMERA;
                    let at = opaque.sorted_records_at(view, layout);
                    let draws = ids::draws_group(view);
                    let light_slot = light_textures.slot(view);
                    let bind = |list: &mut DrawList| opaque.bind_view(list, view, light_slot);
                    let hidden = hidden_in(view);
                    let (index, rows) = (view.index(), SortedRows::Weighted);
                    transparent.record(
                        list, arena, index, rows, draws, at, meshes, bind, &hidden, particles,
                    )
                }
                Role::Decals if culling.frame(ViewId::CAMERA).is_some() => {
                    let view = ViewId::CAMERA;
                    let at = opaque.sorted_records_at(view, layout) + decal_records_at;
                    let draws = ids::draws_group(view);
                    let light_slot = light_textures.slot(view);
                    let bind = |list: &mut DrawList| {
                        opaque.bind_view(list, view, light_slot)?;
                        let group = ids::DECAL_DEPTH_GROUP;
                        list.push(Op::SetBindGroup, &[DECAL_DEPTH_INDEX, group, 0])?;
                        Ok(())
                    };
                    let hidden = hidden_in(view);
                    decals.record(
                        list,
                        arena,
                        0,
                        SortedRows::All,
                        draws,
                        at,
                        meshes,
                        bind,
                        &hidden,
                        particles,
                    )
                }
                Role::DecalRedraw if culling.frame(ViewId::CAMERA).is_some() => {
                    let view = ViewId::CAMERA;
                    let at = opaque.sorted_records_at(view, layout) + redraw_records_at;
                    let draws = ids::draws_group(view);
                    let light_slot = light_textures.slot(view);
                    let bind = |list: &mut DrawList| opaque.bind_view(list, view, light_slot);
                    let hidden = hidden_in(view);
                    redraws.record(
                        list,
                        arena,
                        0,
                        SortedRows::All,
                        draws,
                        at,
                        meshes,
                        bind,
                        &hidden,
                        particles,
                    )
                }
                Role::DebugLines => {
                    let slot = opaque.frame_slot(ViewId::CAMERA);
                    let group =
                        ids::frame_group(ViewId::CAMERA) + light_textures.slot(ViewId::CAMERA);
                    lines.record(list, group, &[slot, slot])
                }
                Role::Motion if motion_draws && culling.frame(ViewId::CAMERA).is_some() => {
                    let starts = culling.culled(frame, ViewId::CAMERA).bucket_starts();
                    let moving = motion_moving.as_slice();
                    opaque.record_motion(list, arena, starts, layout, meshes, motion_group, moving)
                }
                Role::FogLight(_) => {
                    let slot = opaque.frame_slot(ViewId::CAMERA);
                    let group =
                        ids::frame_group(ViewId::CAMERA) + light_textures.slot(ViewId::CAMERA);
                    bind_frame_group(list, group, &[slot, slot])
                }
                _ => Ok(()),
            },
            |list| {
                if motion_on {
                    motion_state.finish(list, input.parity(), skins)?;
                }
                Ok(())
            },
        )?;
        self.tiles
            .finish(input.frame, created_pipelines, input.pipelines_built);
        Ok(rebuilt)
    }
}

/// The sorted passes that the camera's view prepares after its opaque draws: its blended rows, then
/// its decals and the rows that draw again after them, each pass with the layout it reads and, for
/// the camera's own passes, where their records start after the blended rows' records.
struct SortedPasses<'a> {
    settings: &'a SceneSettings,
    transparent: (&'a mut Transparent, &'a SortedLayout),
    camera: [(&'a mut Transparent, &'a SortedLayout, u32); 2],
}

/// What the uploads of one frame's views share: the frame's number, whether a settled view holds
/// its uniform slot to its parity's, and the streamed texture's ring slot.
#[derive(Clone, Copy)]
struct UploadFrame {
    frame: u32,
    hold_uniforms: bool,
    streamed: u32,
}

/// Uploads, for each of the first `count` views of `culling` that the frame draws, its index list
/// when it changed, and its frame uniform and draw records, from the views' culling output and the
/// draws of `layout`. Every view reads the streamed texture of ring slot `streamed`. With `sorted`,
/// each view also prepares its transparent pass's draws of the sorted rows, which follow the opaque
/// ones in its index list, and uploads their records with a new list; the camera's decals and
/// redrawn rows follow its blended rows in the same way.
fn upload_views(
    list: &mut DrawList,
    arena: &mut UploadArena,
    (culling, draws, layout): (&mut Culling, &mut Opaque, &Layout),
    mut sorted: Option<SortedPasses>,
    count: usize,
    upload_frame: UploadFrame,
) -> Result<(), RecordError> {
    let UploadFrame {
        frame,
        hold_uniforms,
        streamed,
    } = upload_frame;
    for k in 0..count {
        let view = culling.view(k);
        let Some(values) = culling.frame(view).copied() else {
            continue;
        };
        let (listed, new_list) = culling.upload(list, view, frame)?;
        let starts = culling.culled(frame, view).bucket_starts();
        let upload = ViewUpload {
            frame,
            hold_uniforms,
            values: &values,
            offsets: culling.offsets(view),
            streamed,
            listed,
            new_list,
            starts,
        };
        draws.upload(list, arena, view, upload, layout)?;
        let Some(SortedPasses {
            settings,
            transparent: (transparent, transparent_layout),
            camera,
        }) = sorted.as_mut()
        else {
            continue;
        };
        let mut first = starts.last().copied().unwrap_or(0);
        transparent.prepare(k, culling.sorted(view), transparent_layout, settings, first);
        let sorted_at = draws.sorted_records_at(view, layout);
        if new_list {
            transparent.upload(list, arena, k, ids::draws(view), sorted_at)?;
        }
        if view != ViewId::CAMERA {
            continue;
        }
        first += culling.sorted(view).items().len() as u32;
        for ((pass, pass_layout, records_at), rows) in camera
            .iter_mut()
            .zip([culling.decals(view), culling.redraws(view)])
        {
            pass.prepare(0, rows, pass_layout, settings, first);
            if new_list {
                pass.upload(list, arena, 0, ids::draws(view), sorted_at + *records_at)?;
            }
            first += rows.items().len() as u32;
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
        self.outline_culling.reserve_sources(sources)?;
        self.skin_culling.reserve_sources(sources)
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
        let settings = &self.settings;
        let sways = |material| settings.sways(material);
        self.tiles.plan(
            input,
            tile_settings,
            filter,
            camera.as_ref(),
            settings.meshes(),
            &sways,
        );
        // Receivers read the shadow maps while the sun or a point or spot light casts shadows, and
        // casters draw into the passes of each.
        let cascades = self.settings.cascade_depth().targets();
        let shadows = CasterPasses {
            cascades: self
                .shadow
                .is_some()
                .then(|| self.with_draw_index(cascades)),
            tiles: (self.tiles.shape().is_some())
                .then(|| self.with_draw_index(shadow_tiles::TARGETS)),
        };
        let outlines = self.settings.outline().is_some();
        let scatters = self.settings.holds_scattering();
        let motion = self.settings.motion_wanted();
        // Ambient occlusion and the sun's contact shadows read the depth prepass's depth, so
        // turning them on or off can switch the prepass, whose pipelines the layout holds.
        let settings = &self.settings;
        self.graph.set_ao(
            settings.ao(),
            settings.contact(camera.as_ref(), canvas),
            settings.camera_projection(canvas),
            settings.screen_scale(),
        );
        self.graph
            .set_ssr(settings.ssr_frame(canvas), settings.ssr_scale());
        let prepass_changed = self.graph.depth_prepass() != self.layout_prepass;
        let waiting = (self.layout.waiting().iter())
            .chain(self.casters.waiting())
            .chain(self.sorted.waiting())
            .chain(self.decal_layout.waiting())
            .chain(self.redraw_layout.waiting())
            .copied();
        let skinned_appear =
            self.skins
                .open_when_built(&self.pipelines, waiting, input.pipelines_built);
        // The lit templates switch to or from their builds that shade area lights.
        let area_switched = self
            .settings
            .update_area_shading(&mut self.pipelines, input.pipelines_built);
        // Lit meshes switch to or from the light probe grid's templates.
        let probe_switched = self
            .settings
            .update_probe_shading(&mut self.pipelines, input.pipelines_built);
        let particles_changed = self.settings.particles_mut().take_changed();
        if particles_changed
            || input.structure_changed
            || !self.layout.built
            || area_switched
            || probe_switched
            || shadows != self.layouts_shadowed
            || outlines != self.layouts_outlined
            || scatters != self.layouts_scattered
            || motion != self.layouts_moving
            || prepass_changed
            || self.redraws_wanted() != self.redraws_built
            || skinned_appear
        {
            self.rebuild_layout(input, shadows, outlines, scatters, motion)?;
        }
        self.add_culled_views()?;
        self.cells.update(input);
        let out_of_memory = |layout: &Layout| RecordError::OutOfMemory {
            bytes: layout.room.rows.saturating_mul(8),
        };
        self.sorted
            .gather(input.scene, input.batches, input.parity())
            .map_err(|_| out_of_memory(&self.layout))?;
        self.decal_layout
            .gather(input.scene, input.batches, input.parity())
            .map_err(|_| out_of_memory(&self.layout))?;
        let shown = self.settings.views()[ViewId::CAMERA.index()].layers();
        self.redraw_layout
            .set_layer_filter(self.settings.decal_skipped_layers(), shown);
        self.redraw_layout
            .gather(input.scene, input.batches, input.parity())
            .map_err(|_| out_of_memory(&self.layout))?;
        let (settings, cells, sorted) = (&self.settings, &self.cells, &self.sorted);
        let (decal_layout, redraw_layout) = (&self.decal_layout, &self.redraw_layout);
        self.culling
            .cull(
                input,
                &self.layout,
                &mut self.clusters,
                cells,
                &|view| {
                    settings
                        .view_draws(view)
                        .then(|| settings.view_frame(view, scene, parity, canvas, scale))
                        .flatten()
                },
                &|view| settings.level_view(view, canvas),
                Some((sorted, decal_layout, redraw_layout)),
                Some(cull::Occlusion {
                    occluders: &mut self.occluders,
                    meshes: settings.meshes(),
                    materials: settings.materials(),
                }),
            )
            .map_err(|_| out_of_memory(&self.layout))?;
        self.lights
            .set_area_light_cap(self.settings.area_light_cap());
        let main = self.culling.frame(ViewId::CAMERA).map(|frame| frame.camera);
        let exposure = self.settings.drawn_output().exposure;
        for index in 0..self.settings.views().len() {
            let view = ViewId::from_index(index);
            if let Some(frame) = self.culling.frame_mut(view) {
                if let Some(main) = &main {
                    frame.set_shadow_origin(main);
                }
                self.lights
                    .assign(view, frame, input, exposure, &self.tiles);
            }
        }
        // Shadow views pick the camera's levels with a larger threshold, and the outline view the
        // camera's own.
        let shadow_rule = self.settings.shadow_level_view(canvas);
        let camera_rule = self.settings.level_view(ViewId::CAMERA, canvas);
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
                &|_| shadow_rule,
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
                &|_| shadow_rule,
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
                &|_| camera_rule,
                None,
                None,
            )
            .map_err(|_| out_of_memory(&self.outlined))?;
        // The subsurface view sees what the camera's view sees, while some object's material has a
        // scatter radius.
        let scatters = !self.scattering.buckets.is_empty();
        self.skin_culling
            .cull(
                input,
                &self.scattering,
                &mut self.clusters,
                cells,
                &|_| camera.filter(|_| scatters),
                &|_| camera_rule,
                None,
                None,
            )
            .map_err(|_| out_of_memory(&self.scattering))
    }

    fn record(&mut self, input: &FrameInput<'_>) -> Result<bool, RecordError> {
        self.settings.set_still(self.lists.still());
        let (mut list, mut arena) = self.lists.take(input.frame)?;
        let result = self.record_into(input, &mut list, &mut arena);
        let marks = StillMarks::of(input, &self.settings, &self.graph, &self.pipelines);
        self.lists.restore(input.frame, list, arena, marks, result)
    }

    fn still(&self) -> crate::still::Still {
        self.lists.still()
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

    fn set_occlusion_buffer(&mut self, pixels: u32) {
        self.occluders.set_buffer_pixels(pixels);
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

    fn meshes_moved(&mut self, ids: &[u32], moves: &MeshMoves) {
        self.meshes.moved(moves);
        if let Some(first) = moves.morph_texels {
            self.skins.morph_mut().deltas_moved(first);
        }
        self.occluders.forget(ids);
    }

    fn meshes_updated(&mut self, id: u32, positions: bool) {
        self.meshes.updated(self.settings.meshes().updated());
        if positions {
            self.occluders.stop_blocking(id);
        }
    }

    fn mesh_gpu_bytes(&self) -> u64 {
        self.meshes.gpu_bytes() + self.skins.morph().delta_bytes()
    }

    fn reset_gpu(&mut self) {
        self.lists.reset_gpu();
        self.created = false;
        self.bound_environment = ids::BLANK_ENVIRONMENT;
        self.bound_probe_grid = ids::BLANK_PROBE_GRID;
        self.background.reset_gpu();
        self.particles.reset_gpu();
        self.physical_sky.reset_gpu();
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
        self.skin_culling.forget_gpu();
        self.skin_draws.forget_gpu();
        self.tiles.forget_gpu();
        self.cascades_held = false;
        self.lines.forget_gpu();
        self.streamed_slot.forget();
        self.lights.forget_gpu();
        self.light_textures.forget_gpu();
        self.skins.forget_gpu();
        self.motion.forget_gpu();
        self.decal_depth_bound = None;
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
        self.settings.light_tables_mut().reset_gpu();
        self.settings.sky_maps_mut().reset_gpu();
    }

    fn list(&self, frame: u32) -> &DrawList {
        self.lists.list(frame)
    }

    fn check_graph(&mut self) -> Result<(), GraphError> {
        self.settings.prepare_effect_maps();
        self.settings.mark_shown_views();
        self.graph
            .check(self.settings.views(), self.settings.view_names())
    }

    fn graph_dot(&mut self) -> String {
        self.settings.prepare_effect_maps();
        self.settings.mark_shown_views();
        self.graph
            .sync_views(self.settings.views(), self.settings.view_names());
        self.graph.dot()
    }

    fn reads_last_frame(&self) -> bool {
        self.graph.ssr_draws()
    }

    fn graph_message(&self, error: GraphError) -> String {
        self.graph.graph().explain(error)
    }

    fn set_canvas_output(&mut self, scene_color: SceneColor, antialias: Antialias) {
        let canvas = self.settings.switch_canvas(scene_color, antialias);
        self.graph.set_canvas(canvas);
    }

    fn allow_motion(&mut self, one_sample: bool, multisampled: bool) {
        self.graph.allow_motion(one_sample, multisampled);
    }
}
