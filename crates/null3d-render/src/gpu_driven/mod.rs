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
//! frame group binds the atlas and the shadow settings block, which holds each tile's matrix, its
//! texel size and its light's biases.
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
//! # Subsurface blur
//!
//! While the quality setting gives the subsurface blur taps and some material has a scatter radius,
//! a fourth layout holds the objects with such a material, with the skin pass's pipelines (see
//! [`crate::subsurface`]). The subsurface view culls it with the camera's frustum and layers into
//! buffers of its own, and its bundle draws them into the skin pass's target, through the camera
//! view's frame group. Turning the blur's taps on or off, or creating the first such material,
//! rebuilds the layouts.
//!
//! # Motion
//!
//! While a pass reads the motion target, a fifth layout holds every opaque object and instance row
//! (see [`crate::motion`]). The motion view culls it with the camera's frustum and layers, and
//! keeps the sources whose matrices changed since the last frame, or whose buckets move by
//! themselves. Its bundle draws them into the motion target. The builder keeps the last frame's
//! matrices, joints and skinned vertices in two copies, one for each frame parity (see
//! [`motion`]).
//!
//! The debug lines pass, which both builders share, is [`crate::debug_lines`], and the background
//! that the camera's opaque pass draws after its bundle, or before it while a bucket writes no
//! depth, is [`crate::background`]. The render graph ([`crate::frame_graph`]) orders the passes and
//! begins their render passes.
//!
//! # Memory
//!
//! Frames record without the general-purpose allocator. At the start of each frame the arena gets
//! room for the most that any frame can copy for the scene as it stands, and the layout keeps its
//! tables and scratch space between rebuilds. Only the first frames after the scene grows, with a
//! new batch, mesh, view, or mesh and material pair, allocate.

mod copies;
mod cull;
mod direct;
mod layout;
mod lights;
mod motion;
mod opaque;
mod pyramid;
mod shadow;
mod skin;
mod transparent;

use std::collections::TryReserveError;

use null3d_gpu::caps::{BUDGET, Limit, MAX_WORKGROUPS_PER_DIMENSION};
use null3d_gpu::drawlist::{
    DrawList, MAX_WORDS, Op, buffer_usage as usage, format, layout as bind_layout, resource_kind,
    sizes, texture_usage, view,
};

use crate::accumulate::AccumulateIds;
use crate::ao::{self, AoIds};
use crate::background::{BackgroundIds, BackgroundPass, Place};
use crate::bloom::BloomIds;
use crate::cells::CellCulling;
use crate::data_texture::DataTexture;
use crate::debug_lines::LinesPass;
use crate::dfg;
use crate::dof::DofIds;
use crate::effects::EffectIds;
use crate::environment;
use crate::exposure::{ComputeIds, ExposureIds};
use crate::final_pass::FinalIds;
use crate::fog_volume::FogVolumeIds;
use crate::frame::{
    CanvasOutput, FrameBuilder, FrameInput, KeyCounts, MaterialStorage, MeshBuffers, ParityLists,
    RecordError, SceneSettings, StillMarks, UploadArena, bind_frame_group,
};
use crate::frame_graph::{FrameGraph, GraphIds, Role, ShadowPasses, TilePasses};
use crate::fullscreen::FullscreenIds;
use crate::graph::{GraphError, RenderGraph};
use crate::light_grid::{LightGrid, LightGrids, LightLimits};
use crate::materials::{MATERIAL_FLOATS, MATERIAL_TEXELS};
use crate::meshes::{MAX_BUFFER_BYTES, MeshMoves, MeshStorage, Packing};
use crate::motion::MotionIds;
use crate::output::{Antialias, SceneColor};
use crate::particles::{ParticleIds, ParticlePass};
use crate::physical_sky::{self, PhysicalSkyIds, PhysicalSkyPass};
use crate::pipelines::{PipelineCache, Prepass};
use crate::probe_grid;
use crate::probes::{self, ProbeTextures};
use crate::shadow_tiles::{self, MAX_TILES, ShadowTiles};
use crate::shadows::{self, CascadeDepth, CasterPasses, MAX_CASCADES, ShadowUniform};
use crate::skinning::SkinningMode;
use crate::sorted::{SkinnedPipeline, SortedLayout, SortedRows};
use crate::ssr::SsrIds;
use crate::subsurface::SubsurfaceIds;
use crate::textures::{TextureIds, TextureStore};
use crate::transmission::{self, TransmissionIds};
use crate::view::{MAX_VIEWS, ViewFrame, ViewId};
use crate::view_copy::ViewCopyIds;
use crate::weighted::WeightedIds;
use cull::{CULL_PARAMS_BYTES, Culling, INDIRECT_BYTES, Phase};
use direct::Direct;
use layout::{Drawn, Layout};
use lights::LightClusters;
use opaque::{Bundle, FrameInputs};
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
/// the casters', the outlined objects' and the subsurface objects' bucket tables, and its place in
/// the cell order.
const TABLE_BYTES_PER_SOURCE: u32 = 24;

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

/// The camera view whose light buffers `view`'s frame group binds: its own once they exist, in
/// `made`, a mask of camera views, or the camera's, which a view without a grid never reads.
fn light_owner(made: u32, view: ViewId) -> ViewId {
    if made & (1 << view.index()) != 0 {
        view
    } else {
        ViewId::CAMERA
    }
}

/// The texture array of reflection probes that frame groups bind: the probes' array once the GPU
/// holds one, or the blank one.
fn probe_array(probes: Option<(u32, u32)>) -> u32 {
    probes.map_or(ids::BLANK_PROBES, |(array, _)| array)
}

/// The error of a table that memory could not grow for.
fn out_of_memory(_: std::collections::TryReserveError) -> RecordError {
    RecordError::OutOfMemory { bytes: u32::MAX }
}

/// The builder's GPU objects. It owns every id it uses; each view has a range of its own, the
/// shadow cascades' views after the camera views.
mod ids {
    use crate::ao::STEPS as AO_STEPS;
    use crate::bloom::STEPS;
    use crate::dof::STEPS as DOF_STEPS;
    use crate::effects::EffectPass;
    use crate::particles::ParticleIds;
    use crate::subsurface::STEPS as SUBSURFACE_STEPS;
    use crate::view::{MAX_VIEW_IDS, MAX_VIEWS, ViewId};
    use crate::weighted::WeightedIds;

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
    /// The frame's shadow settings, which receivers read beside the shadow map and the atlas: the
    /// sun's cascades, then the atlas's tiles (D-146).
    pub const SHADOWS: u32 = LINES + 3;
    /// The final pass's output settings.
    pub const FINAL_SETTINGS: u32 = LINES + 4;
    /// The first step of the two-step pass's settings.
    pub const OUTPUT_SETTINGS: u32 = FINAL_SETTINGS + 1;
    /// Each camera view's sorted instances of the transparent pass, one buffer per view from here.
    const SORTED: u32 = OUTPUT_SETTINGS + 1;

    pub const fn sorted(view: ViewId) -> u32 {
        SORTED + view.index() as u32
    }

    /// Each camera view's light buffers, three ids from `LIGHT_BUFFERS + 3 * view`: its light grid,
    /// a word per cluster then the light index list, the records of the lights that the grid lists,
    /// and the parameters of the light clustering dispatches that fill the grid.
    const LIGHT_BUFFERS: u32 = SORTED + MAX_VIEWS as u32;

    pub const fn light_grid(view: ViewId) -> u32 {
        LIGHT_BUFFERS + 3 * view.index() as u32
    }
    pub const fn lights(view: ViewId) -> u32 {
        light_grid(view) + 1
    }
    pub const fn light_params(view: ViewId) -> u32 {
        light_grid(view) + 2
    }
    /// The uniform buffer of bloom's steps and of the final pass's bloom build.
    pub const BLOOM: u32 = LIGHT_BUFFERS + 3 * MAX_VIEWS as u32;
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
    /// The motion layout's bucket table and bucket records, which the motion view's culling reads.
    pub const MOTION_BUCKETS: u32 = OUTLINE_RECORDS + 1;
    pub const MOTION_RECORDS: u32 = MOTION_BUCKETS + 1;
    /// The uniform buffer of the background's values.
    pub const BACKGROUND: u32 = MOTION_RECORDS + 1;
    /// Each camera view's buffers of occlusion culling: its depth pyramid and the pyramid's level
    /// parameters, two ids from `OCCLUSION + 2 * view`.
    const OCCLUSION: u32 = BACKGROUND + 1;

    pub const fn pyramid(view: ViewId) -> u32 {
        OCCLUSION + 2 * view.index() as u32
    }
    pub const fn pyramid_params(view: ViewId) -> u32 {
        pyramid(view) + 1
    }

    /// The placeholder that views without a depth pyramid bind in its place.
    pub const NO_PYRAMID: u32 = OCCLUSION + 2 * MAX_VIEWS as u32;

    /// The uniform buffer of the custom effects' blocks.
    pub const EFFECTS: u32 = NO_PYRAMID + 1;
    /// The uniform buffer of depth of field's steps.
    pub const DOF: u32 = EFFECTS + 1;
    /// The motion pass's block: the last frame's view and clock.
    pub const MOTION_BLOCK: u32 = DOF + 1;
    /// The uniform buffer of the motion debug view's step.
    pub const MOTION_VIEW: u32 = MOTION_BLOCK + 1;
    /// The two copies of the last frame's world matrices, one for each frame parity.
    const LAST_MATRICES: u32 = MOTION_VIEW + 1;

    pub const fn last_matrices(copy: usize) -> u32 {
        LAST_MATRICES + copy as u32
    }

    /// The two copies of each skinned vertex buffer's last frame, one for each frame parity.
    const LAST_SKINNED: u32 = LAST_MATRICES + 2;

    pub const fn last_skinned(copy: usize, buffer: u32) -> u32 {
        LAST_SKINNED + copy as u32 * super::skin::MAX_SKINNED_BUFFERS + buffer
    }

    /// The copy of the last frame's vertices of the skinned vertex buffer `id` that a frame of
    /// `parity` reads: the other parity's.
    pub const fn last_skinned_of(id: u32, parity: usize) -> u32 {
        last_skinned(1 - parity, id - SKINNED)
    }

    /// The particle systems' buffers, three for each system from here.
    pub const PARTICLE_BUFFERS: u32 = LAST_SKINNED + 2 * super::skin::MAX_SKINNED_BUFFERS;
    /// The camera view's sorted instances of the decal pass, then of its redraw.
    pub const DECAL_INSTANCES: u32 = PARTICLE_BUFFERS + ParticleIds::BUFFERS;
    pub const REDRAW_INSTANCES: u32 = DECAL_INSTANCES + 1;
    /// The table of object ranges, which the vertex shaders of custom materials that read an
    /// instance's index or an object's id search.
    pub const OBJECT_RANGES: u32 = REDRAW_INSTANCES + 1;
    /// Each camera view's list of reflection probes, one slot per view.
    pub const PROBE_LISTS: u32 = OBJECT_RANGES + 1;
    /// The subsurface objects' bucket table and bucket records, which the subsurface view's
    /// culling reads.
    pub const SUBSURFACE_BUCKETS: u32 = PROBE_LISTS + 1;
    pub const SUBSURFACE_RECORDS: u32 = SUBSURFACE_BUCKETS + 1;
    /// The uniform buffer of the subsurface blur's steps.
    pub const SUBSURFACE: u32 = SUBSURFACE_RECORDS + 1;
    /// The uniform buffer of the physical sky's values.
    pub const PHYSICAL_SKY: u32 = SUBSURFACE + 1;
    /// The uniform buffer of the full-screen passes' blocks.
    pub const FULLSCREEN: u32 = PHYSICAL_SKY + 1;
    /// The uniform buffer of screen-space reflections' steps.
    pub const SSR: u32 = FULLSCREEN + 1;
    /// The uniform buffer of the volumetric fog's steps (see [`crate::fog_volume`]).
    pub const FOG_VOLUME: u32 = SSR + 1;
    /// The automatic exposure's meter: its uniform buffer, its histogram and its stored exposure.
    pub const EXPOSURE: u32 = FOG_VOLUME + 1;
    pub const EXPOSURE_HISTOGRAM: u32 = EXPOSURE + 1;
    pub const EXPOSURE_STATE: u32 = EXPOSURE_HISTOGRAM + 1;
    /// The still-camera accumulation's blend's values.
    pub const ACCUMULATE: u32 = EXPOSURE_STATE + 1;
    /// The settings of the final pass's still build, which draws a still view's accumulated color.
    pub const STILL_SETTINGS: u32 = ACCUMULATE + 1;
    /// Mesh page `p` keeps its vertices in buffer `PAGES + 2p` and its indices in the next one.
    pub const PAGES: u32 = STILL_SETTINGS + 1;

    /// The blank texture array that frame groups bind while the scene has no probe and no area
    /// light. The probes own the frame group's shared array, which holds the light tables' layers
    /// too ([`crate::probes::ProbeTextures`]).
    pub const BLANK_PROBES: u32 = 1;
    /// The custom values of materials: one row of texels per material, then three.js's table of
    /// the split-sum terms of specular light in the columns after the first rows.
    pub const CUSTOM_VALUES: u32 = BLANK_PROBES + 1;
    /// The final pass's blank color grading table, which it binds while the sketch sets none.
    pub const BLANK_LUT: u32 = CUSTOM_VALUES + 1;
    /// The blank cube that the frame's groups bind while the scene has no environment.
    pub const BLANK_ENVIRONMENT: u32 = BLANK_LUT + 1;
    /// Every animated instance's skinning matrices (see [`crate::skinning`]).
    /// The blank 3D texture that the frame's groups bind while the scene has no light probe grid.
    pub const BLANK_PROBE_GRID: u32 = BLANK_ENVIRONMENT + 1;
    pub const JOINTS: u32 = BLANK_PROBE_GRID + 1;
    /// Every morphed mesh's deltas, in half floats (see [`crate::morph`]).
    pub const MORPHS: u32 = JOINTS + 1;
    /// Every morphed object's weights (see [`crate::morph`]).
    pub const MORPH_WEIGHTS: u32 = MORPHS + 1;
    /// The texture that frame groups bind in place of ambient occlusion's while it draws none.
    pub const BLANK_AO: u32 = MORPH_WEIGHTS + 1;
    /// The final pass's blank outline texture, which it binds while no outline draws.
    pub const BLANK_OUTLINE: u32 = BLANK_AO + 1;
    /// The texture that custom effects bind in place of the scene's depth when they read none.
    pub const BLANK_EFFECT_DEPTH: u32 = BLANK_OUTLINE + 1;
    /// The texel that custom effects bind in place of bloom's level when they read none.
    pub const BLANK_EFFECT_BLOOM: u32 = BLANK_EFFECT_DEPTH + 1;
    /// The first step of the two-step pass's own blank color grading table and outline texture,
    /// which it owns so that it never destroys the final pass's.
    pub const OUTPUT_BLANK_LUT: u32 = BLANK_EFFECT_BLOOM + 1;
    pub const OUTPUT_BLANK_OUTLINE: u32 = OUTPUT_BLANK_LUT + 1;
    /// The offset from each view's camera to each grid cell, which the culling pass reads: one row
    /// per view (see [`super::cull`]).
    pub const CELL_OFFSETS: u32 = OUTPUT_BLANK_OUTLINE + 1;
    /// The texel that frame groups bind in place of the copy of the camera's opaque color while
    /// nothing lets light through.
    pub const BLANK_TRANSMISSION: u32 = CELL_OFFSETS + 1;
    /// The row values of instance batches, two texels per source, which the vertex shaders of rows
    /// with row values read.
    pub const ROW_VALUES: u32 = BLANK_TRANSMISSION + 1;
    /// The texel that particle systems bind in place of a view's depth copy.
    pub const BLANK_PARTICLE_DEPTH: u32 = ROW_VALUES + 1;
    /// The texel that custom materials bind in place of the copy of the camera's opaque depth.
    pub const BLANK_SCENE_DEPTH: u32 = BLANK_PARTICLE_DEPTH + 1;
    /// The physical sky's tables and panorama.
    pub const SKY_TABLES: u32 = BLANK_SCENE_DEPTH + 1;
    /// The texel that a full-screen pass without an input image reads, and the one that it binds
    /// in place of the scene's depth when it reads none.
    pub const BLANK_PASS_COLOR: u32 = SKY_TABLES + crate::physical_sky::TEXTURES;
    pub const BLANK_PASS_DEPTH: u32 = BLANK_PASS_COLOR + 1;
    /// The first joint of the skin of each scene slot that the vertex shaders skin, which the
    /// culling pass copies into the instances of buckets that such objects share.
    pub const SKIN_FIRSTS: u32 = BLANK_PASS_DEPTH + 1;
    /// The start distance and the end distance of every source's distance range, which the
    /// culling pass reads.
    pub const INSTANCE_RANGES: u32 = SKIN_FIRSTS + 1;
    /// The two copies of the last frame's joint texture, one for each frame parity.
    const LAST_JOINTS: u32 = INSTANCE_RANGES + 1;

    pub const fn last_joints(copy: usize) -> u32 {
        LAST_JOINTS + copy as u32
    }

    /// The texel that the motion view's frame groups bind in place of the last frame's joints
    /// before the scene skins.
    pub const BLANK_JOINTS: u32 = LAST_JOINTS + 2;
    /// The texture of one texel that the motion debug view reads in place of the motion target
    /// where the device draws none.
    pub const BLANK_MOTION: u32 = BLANK_JOINTS + 1;
    /// The map of one texel that the motion view's buckets without a map bind.
    pub const BLANK_MAP: u32 = BLANK_MOTION + 1;
    /// The automatic exposure's cells, its texel, which the final pass reads, and its stored texel.
    pub const EXPOSURE_CELLS: u32 = BLANK_MAP + 1;
    pub const EXPOSURE_TEXEL: u32 = EXPOSURE_CELLS + 1;
    pub const EXPOSURE_STORED: u32 = EXPOSURE_TEXEL + 1;
    /// The blank color grading table and outline mask that the final pass's still build owns, so
    /// that it never destroys the final pass's.
    pub const STILL_BLANK_LUT: u32 = EXPOSURE_STORED + 1;
    pub const STILL_BLANK_OUTLINE: u32 = STILL_BLANK_LUT + 1;
    /// Two pairs of the reflection probes' maps and the chain that each probe's filter draws
    /// through (see [`crate::probes::ProbeTextures`]).
    pub const PROBE_TEXTURES: u32 = STILL_BLANK_OUTLINE + 1;
    /// The buffers of GPU picking's reads, one for each read that may wait for the GPU.
    pub const PICK_BUFFERS: u32 = PROBE_TEXTURES + 4;
    /// The bind group of GPU picking's resolve pass.
    pub const PICK_GROUP: u32 = PICK_BUFFERS + crate::pick::RING as u32;
    /// The render graph's textures, from this id on.
    pub const TARGETS: u32 = PICK_GROUP + 1;
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
    /// The linear sampler of the custom effects.
    pub const EFFECT_SAMPLER: u32 = 6;
    /// The linear sampler of depth of field's steps.
    pub const DOF_SAMPLER: u32 = 7;
    /// The physical sky's samplers.
    pub const SKY_SAMPLERS: u32 = 8;
    /// The sampler of the motion view's blank map and of the motion debug view's step.
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
    /// The automatic exposure's histogram and adaptation.
    pub const EXPOSURE_BINS: u32 = 12;
    pub const EXPOSURE_ADAPT: u32 = 13;
    /// The motion view's culling pipeline.
    pub const CULL_MOTION: u32 = 14;

    /// Each view's bind groups: the frame group of its render pipelines, its culling group, and
    /// the group of the pipelines that read their instances by index.
    pub const fn frame_group(view: ViewId) -> u32 {
        1 + 3 * view.index() as u32
    }
    pub const fn cull_group(view: ViewId) -> u32 {
        frame_group(view) + 1
    }
    pub const fn index_group(view: ViewId) -> u32 {
        frame_group(view) + 2
    }
    /// The final pass's group, after every view's.
    pub const FINAL_GROUP: u32 = 1 + 3 * MAX_VIEW_IDS as u32;
    /// The first step of the two-step pass's group, after the final pass's view copies.
    pub const OUTPUT_GROUP: u32 = FINAL_GROUP + 1 + 2 * MAX_VIEWS as u32;
    /// Each camera view's group of its light clustering dispatches, after the final pass's group.
    pub const fn light_group(view: ViewId) -> u32 {
        FINAL_GROUP + 1 + view.index() as u32
    }
    /// Each camera view's group of its depth prepass, after the light clustering groups.
    pub const fn prepass_group(view: ViewId) -> u32 {
        FINAL_GROUP + 1 + MAX_VIEWS as u32 + view.index() as u32
    }
    /// The second step of the two-step pass's group, which reads the first step's target.
    pub const PRESENT_GROUP: u32 = OUTPUT_GROUP + 1;
    /// The bind group of each step of bloom, after the groups of the depth prepass.
    pub const BLOOM_GROUPS: u32 = PRESENT_GROUP + 1;
    /// The skinning pass's bind group for each of its segments, by their order, after bloom's.
    pub const SKIN_GROUPS: u32 = BLOOM_GROUPS + STEPS as u32;
    /// The joint texture's bind group, which pipelines that skin in the vertex shader read.
    pub const JOINTS_GROUP: u32 = SKIN_GROUPS + super::skin::MAX_SEGMENTS;
    /// The bind group of each step of ambient occlusion, after the joint texture's.
    pub const AO_GROUPS: u32 = JOINTS_GROUP + 1;
    /// The background's bind group, after ambient occlusion's.
    pub const BACKGROUND_GROUP: u32 = AO_GROUPS + AO_STEPS as u32;
    /// Each camera view's group of its depth pyramid, after the background's.
    pub const fn pyramid_group(view: ViewId) -> u32 {
        BACKGROUND_GROUP + 1 + view.index() as u32
    }
    /// The bind group of each custom effect, and of each group of joined effects, after the depth
    /// pyramids'.
    pub const EFFECT_GROUPS: u32 = BACKGROUND_GROUP + 1 + MAX_VIEWS as u32;
    /// The bind group of the copy of each view's image into its target, after the effects'.
    pub const VIEW_COPY_GROUPS: u32 = EFFECT_GROUPS + EffectPass::GROUPS;
    /// The bind group of each step of depth of field, after the copies'.
    pub const DOF_GROUPS: u32 = VIEW_COPY_GROUPS + MAX_VIEWS as u32;
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
    /// The bind group of the motion debug view's step, and of the blank map of the motion view,
    /// after screen-space reflections'.
    pub const MOTION_VIEW_GROUP: u32 = SSR_GROUPS + crate::ssr::STEPS as u32;
    pub const BLANK_MAP_GROUP: u32 = MOTION_VIEW_GROUP + 1;
    /// The bind group of the still-camera accumulation's blend, after the motion view's.
    pub const ACCUMULATE_GROUP: u32 = BLANK_MAP_GROUP + 1;
    /// The bind group of the final pass's still build.
    pub const STILL_GROUP: u32 = ACCUMULATE_GROUP + 1;
    /// The bind group of the scene depth that the decal pass reads, after the still build's.
    pub const DECAL_DEPTH_GROUP: u32 = STILL_GROUP + 1;
    /// The decal pass's frame group, after its depth's.
    pub const DECAL_FRAME_GROUP: u32 = DECAL_DEPTH_GROUP + 1;
    /// The first of two bind groups that custom materials which read the scene's depth bind: the
    /// blank texel, then the copy of the camera's opaque depth.
    pub const MATERIAL_SCENE_GROUPS: u32 = DECAL_FRAME_GROUP + 1;
    /// The bind groups of the volumetric fog's steps, after the materials' scene groups.
    pub const FOG_GROUPS: u32 = MATERIAL_SCENE_GROUPS + 2;
    /// The bind groups of the automatic exposure's meter, after the fog's.
    pub const EXPOSURE_GROUPS: u32 = FOG_GROUPS + crate::fog_volume::GROUPS;
    /// The motion view's frame group for each frame parity.
    const MOTION_FRAME_GROUPS: u32 = EXPOSURE_GROUPS + crate::exposure::GROUPS;

    pub const fn motion_frame_group(parity: usize) -> u32 {
        MOTION_FRAME_GROUPS + parity as u32
    }

    /// The first of each view's frame group for the builds of parallax occlusion mapping, after
    /// the motion view's: [`frame_group`] without the copy of the opaque color, which no parallax
    /// build reads. A parallax material reads the displacement map in the fragment stage as well
    /// as the vertex stage, so its maps' group holds one more sampled texture than any other
    /// material's, and this group keeps that stage within WebGPU's default count. Only WebGPU has
    /// it.
    pub const PARALLAX_FRAME_GROUPS: u32 = MOTION_FRAME_GROUPS + 2;

    /// Each view's frame group for those builds, which the passes bind in place of
    /// [`frame_group`].
    pub const fn frame_parallax_group(view: ViewId) -> u32 {
        PARALLAX_FRAME_GROUPS + view.index() as u32
    }

    /// The bind groups of materials' maps, after the parallax frame groups.
    pub const TEXTURE_GROUPS: u32 = PARALLAX_FRAME_GROUPS + MAX_VIEW_IDS as u32;

    pub const fn bundle(view: ViewId) -> u32 {
        1 + view.index() as u32
    }
    /// Each camera view's bundle of its depth prepass, after every view's bundle.
    pub const fn prepass_bundle(view: ViewId) -> u32 {
        1 + MAX_VIEW_IDS as u32 + view.index() as u32
    }

    /// The motion view's bundle for each frame parity: its own, and the place of a depth prepass's
    /// bundle, which the motion view has none of.
    pub const fn motion_bundle(parity: usize) -> u32 {
        if parity == 0 {
            bundle(ViewId::MOTION)
        } else {
            prepass_bundle(ViewId::MOTION)
        }
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
    /// Where to skin skinned meshes: in the vertex shader of each pass that draws them, or once
    /// per frame in the skinning pass, with its savings.
    pub skinning: SkinningMode,
    /// True when the vertex shaders of the culled buckets read each instance by index from
    /// storage buffers, where their templates can, instead of a copy that the culling shader
    /// writes. A test switch asks for it on core WebGPU (decision record D-23).
    pub index_instances: bool,
    /// True to cull each camera view in two phases against a depth pyramid of what it drew, so
    /// objects that others hide do not draw. The depth prepass turns it off.
    pub gpu_occlusion: bool,
    /// True to cull on the CPU and draw every bucket with `drawIndexed` and a known instance
    /// count, instead of drawing the GPU's indirect draws. A start-up probe picks it on a device
    /// where indirect draws are measurably slower (decision record D-174). It turns GPU occlusion
    /// culling and the `index_instances` test switch off, which both need the GPU's counts.
    pub direct_draws: bool,
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
            skinning: SkinningMode::default(),
            index_instances: false,
            gpu_occlusion: false,
            direct_draws: false,
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
    /// The motion layout, which the motion view draws while a pass reads the motion.
    moving: Layout,
    /// True when the layouts were built while a pass reads the motion.
    layouts_moving: bool,
    /// True once the motion view's culling buffers exist.
    motion_made: bool,
    /// The motion view's objects and the last frame's data.
    motion: motion::Motion,
    /// The layouts' scratch for rebuilds, which they share.
    key_counts: KeyCounts,
    /// The shadow passes of the frame that the layouts were built for.
    layouts_shadowed: CasterPasses,
    /// True when the layouts were built while outlines are on.
    layouts_outlined: bool,
    /// True when the scene's layout was built while a pick waits, so its buckets hold the pick
    /// pipelines.
    layouts_picked: bool,
    /// True once the outline view's GPU objects exist.
    outline_made: bool,
    /// The layout of the objects whose material has a scatter radius, which the subsurface view
    /// draws.
    scattering: Layout,
    /// True when the layouts were built while the subsurface blur has taps.
    layouts_scattered: bool,
    /// True once the subsurface view's GPU objects exist.
    subsurface_made: bool,
    /// True when the scene's layout was built with the depth prepass's pipelines.
    layout_prepass: bool,
    /// The views whose depth prepass has its bind group.
    prepass_views: usize,
    /// Grid-cell culling: the scene's still objects in cell order, and each cell's box.
    cells: CellCulling,
    culling: Culling,
    /// The views' CPU culling on the direct-draw path.
    direct: Direct,
    /// Each camera view's depth pyramid, with occlusion culling.
    pyramids: Pyramids,
    lines: LinesPass,
    /// The sources of the transparent pass, and each camera view's sorted rows.
    sorted: SortedLayout,
    transparent: Transparent,
    /// The decals, and the camera view's rows of them that the decal pass draws.
    decal_layout: SortedLayout,
    decals: Transparent,
    /// The opaque pairs, and the camera view's rows of them on the layers that decals skip, which
    /// draw again after the decals.
    redraw_layout: SortedLayout,
    redraws: Transparent,
    /// True when the redraw's layout holds the opaque pairs: some object is a decal, and decals
    /// skip some layers.
    redraws_built: bool,
    /// The depth texture that the decal pass's group binds, or `None` before the group exists.
    decal_depth_bound: Option<u32>,
    /// What the camera view's frame group binds, which the decal pass's frame group binds too.
    camera_frame: Option<FrameInputs>,
    /// True when the decal pass's frame group must be made again: the camera's frame group was
    /// made again, or the pass did not run in the last frame.
    decal_frame_stale: bool,
    background: BackgroundPass,
    /// The particle systems' GPU objects and draws.
    particles: ParticlePass,
    /// The physical sky's tables.
    physical_sky: PhysicalSkyPass,
    /// The point and spot lights of each camera view.
    lights: LightGrids,
    /// The camera views whose light buffers exist, as a mask of view places.
    lights_made: u32,
    /// The pass that lists the lights of each cluster of each camera view's light grid.
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
    /// The 3D texture that the frame groups bind: the grid's, or the blank one.
    bound_probe_grid: u32,
    /// The reflection probes' array that the camera views' frame groups bind, with its
    /// generation, or `None` for the blank one.
    bound_probes: Option<(u32, u32)>,
    /// True when the last frame wrote a view's list of probes, so the next writes the lists
    /// again even when the scene has no probe left.
    probes_listed: bool,
    /// The texel rows of the row values texture, 0 before it exists.
    value_rows: u32,
    /// GPU picking's GPU objects, while a page picks.
    pick: crate::pick::PickState,
    /// The views that draw each layout, as the sizing of the levels' copies reads them, and the
    /// offsets from each view's camera to the cells, which that sizing computes in turn.
    copy_views: Vec<copies::CopyView>,
    copy_offsets: crate::frame::CellOffsets,
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
        let mut config = config;
        if config.direct_draws {
            // Both need the instance counts that the culling shader writes; the direct path keeps
            // the counts on the CPU.
            config.index_instances = false;
            config.gpu_occlusion = false;
        }
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
                            blank_bloom: ids::BLANK_EFFECT_BLOOM,
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
                            compute: Some(ComputeIds {
                                histogram: ids::EXPOSURE_HISTOGRAM,
                                state: ids::EXPOSURE_STATE,
                                pipelines: [ids::EXPOSURE_BINS, ids::EXPOSURE_ADAPT],
                            }),
                        },
                        transmission: TransmissionIds {
                            group: ids::TRANSMISSION_GROUP,
                            blank: ids::BLANK_TRANSMISSION,
                        },
                        ssr: SsrIds {
                            buffer: ids::SSR,
                            first_group: ids::SSR_GROUPS,
                        },
                        weighted: WeightedIds {
                            first_group: ids::WEIGHTED_GROUPS,
                        },
                        particle_depth: ids::PARTICLE_DEPTH_COPY_GROUP,
                        material_scene: ids::MATERIAL_SCENE_GROUPS,
                        blank_scene_depth: ids::BLANK_SCENE_DEPTH,
                        view_copy: Some(ViewCopyIds {
                            first_group: ids::VIEW_COPY_GROUPS,
                        }),
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
                    },
                );
                graph.bind_shadow_map(config.cascade_depth);
                graph.set_depth_prepass(config.depth_prepass);
                graph.set_occlusion(config.gpu_occlusion);
                graph
            },
            layout: Layout::new(Drawn::Scene, config.index_instances),
            casters: Layout::new(Drawn::Casters, config.index_instances),
            outlined: Layout::new(Drawn::Outlined, config.index_instances),
            moving: Layout::new(Drawn::Motion, false),
            layouts_moving: false,
            motion_made: false,
            motion: motion::Motion::default(),
            key_counts: KeyCounts::new(),
            layouts_shadowed: CasterPasses::default(),
            layouts_outlined: false,
            layouts_picked: false,
            outline_made: false,
            scattering: Layout::new(Drawn::Subsurface, config.index_instances),
            layouts_scattered: false,
            subsurface_made: false,
            layout_prepass: false,
            prepass_views: 0,
            cells: CellCulling::new(config.cell_culling, config.direct_draws),
            culling: Culling::new(config.index_instances),
            direct: Direct::default(),
            pyramids: Pyramids::default(),
            lines: LinesPass::new(ids::LINES),
            sorted: SortedLayout::default(),
            transparent: Transparent::default(),
            decal_layout: SortedLayout::decals(),
            decals: Transparent::with_buffers(ids::DECAL_INSTANCES),
            redraw_layout: SortedLayout::redraws(),
            redraws: Transparent::with_buffers(ids::REDRAW_INSTANCES),
            redraws_built: false,
            decal_depth_bound: None,
            camera_frame: None,
            decal_frame_stale: true,
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
            lights: LightGrids::new(config.light_limits, true),
            lights_made: 0,
            light_clusters: LightClusters::default(),
            skinning: Skinning::new(config.skinning),
            frames: Vec::new(),
            cascade_frames: [None; MAX_CASCADES],
            tiles: ShadowTiles::new(),
            views_made: 0,
            cascades_made: 0,
            tiles_made: 0,
            cascades_held: false,
            created: false,
            pick: crate::pick::PickState::default(),
            copy_views: Vec::new(),
            copy_offsets: crate::frame::CellOffsets::default(),
            dfg_pending: false,
            bound_environment: ids::BLANK_ENVIRONMENT,
            bound_probe_grid: ids::BLANK_PROBE_GRID,
            bound_probes: None,
            probes_listed: false,
            value_rows: 0,
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
        self.lights.camera().grid()
    }

    /// The light grid of camera view `view` in the frame recorded last, or `None` while the view
    /// has seen no point or spot light.
    pub fn view_light_grid(&self, view: ViewId) -> Option<&LightGrid> {
        Some(self.lights.get(view)?.grid())
    }

    /// The tiles of the point and spot lights' shadow atlas in the last recorded frame.
    pub fn shadow_tiles(&self) -> &ShadowTiles {
        &self.tiles
    }

    /// The vertices that the skinning pass skins and morphs in the last recorded frame.
    pub fn skinned_vertices(&self) -> u32 {
        self.skinning.skinned_vertices()
    }

    /// Bytes that the skinned and morphed objects' regions take in the skinned vertex buffers.
    pub fn skinned_bytes(&self) -> u64 {
        self.skinning.skinned_bytes()
    }

    /// The bytes that each view's compacted instance buffer takes for each layout in the last
    /// recorded frame, which the levels' copy slices fill: the scene's layout, the shadow casters',
    /// the outlined objects', the scattered ones' and the moving ones'. For tests.
    pub fn compacted_bytes(&self) -> [u32; 5] {
        [
            self.layout.compacted_bytes(),
            self.casters.compacted_bytes(),
            self.outlined.compacted_bytes(),
            self.scattering.compacted_bytes(),
            self.moving.compacted_bytes(),
        ]
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

    /// Sizes each level's slice of every view's compacted instance buffer to the copies that this
    /// frame's views draw, in every layout that holds a level's buckets. A set of levels then
    /// takes the room of its sources in each view, instead of the room of a whole level for each.
    fn fit_level_copies(
        &mut self,
        input: &FrameInput<'_>,
        parity: usize,
    ) -> Result<(), RecordError> {
        let settings = &self.settings;
        if !settings.levels().any() {
            return Ok(());
        }
        // The camera view's rule picks the levels of the plain, outlined, subsurface and motion
        // views, which have no camera of their own, and the shadow rule picks the casters'.
        let Some(camera) = self.frames.first().and_then(|frame| frame.as_ref()) else {
            return Ok(());
        };
        let camera = camera.camera;
        let plain = copies::CopyView {
            rule: settings.level_view(ViewId::CAMERA, input.canvas),
            camera,
        };
        let shadow = copies::CopyView {
            rule: settings.shadow_level_view(input.canvas),
            camera,
        };
        let mut views = std::mem::take(&mut self.copy_views);
        views.clear();
        for (index, frame) in self.frames.iter().enumerate() {
            if let Some(frame) = frame {
                let view = ViewId::from_index(index);
                views.push(copies::CopyView {
                    rule: settings.level_view(view, input.canvas),
                    camera: frame.camera,
                });
            }
        }
        let Self {
            layout,
            casters,
            outlined,
            scattering,
            moving,
            copy_offsets,
            ..
        } = self;
        let scene = input.scene;
        let batches = input.batches;
        for (layout, drawn_by) in [
            (layout, &views[..]),
            (casters, std::slice::from_ref(&shadow)),
            (outlined, std::slice::from_ref(&plain)),
            (scattering, std::slice::from_ref(&plain)),
            (moving, std::slice::from_ref(&plain)),
        ] {
            layout.fit_copies(scene, batches, drawn_by, parity, copy_offsets)?;
        }
        self.copy_views = views;
        Ok(())
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
        if self.settings.take_tiles_stale() {
            self.tiles.forget_drawn();
        }
        let settings = &self.settings;
        let sways = |material| settings.sways(material);
        self.tiles.plan(
            input,
            tile_settings,
            filter,
            camera.as_ref(),
            settings.meshes(),
            &sways,
            shadow.and_then(|shadow| shadow.hero),
        );
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
        let scatters = self.settings.holds_scattering();
        let motion = self.settings.motion_wanted();

        // Ambient occlusion and the sun's contact shadows read the depth prepass's depth, so
        // turning them on or off can switch the prepass, whose pipelines the layout holds.
        let settings = &self.settings;
        // A pick that waits declares the pick's passes for this frame, and builds the layout
        // again with their pipelines. The request stays until a frame records its read, and the
        // passes stay declared for a few frames after it, while its copy may still wait.
        let requested = settings.picking();
        let picking = requested || self.pick.keep > 0;
        self.graph.set_picking(picking);
        self.graph.set_ao(
            settings.ao(),
            settings.contact(camera.as_ref(), input.canvas),
            settings.camera_projection(input.canvas),
            settings.screen_scale(),
        );
        self.graph
            .set_ssr(settings.ssr_frame(input.canvas), settings.ssr_scale());
        let waiting = (self.layout.waiting().iter())
            .chain(self.casters.waiting())
            .chain(self.sorted.waiting())
            .chain(self.decal_layout.waiting())
            .chain(self.redraw_layout.waiting())
            .copied();
        let skinned_appear =
            self.skinning
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
        let upload_everything = particles_changed
            || input.structure_changed
            || !self.layout.built
            || area_switched
            || probe_switched
            || passes != self.layouts_shadowed
            || outlines != self.layouts_outlined
            || scatters != self.layouts_scattered
            || motion != self.layouts_moving
            || self.graph.depth_prepass() != self.layout_prepass
            || self.redraws_wanted() != self.redraws_built
            || picking != self.layouts_picked
            || skinned_appear;
        if upload_everything {
            let limit = max_sources(self.config.storage_binding_bytes);
            self.settings
                .prepare_rebuild(input.scene, input.batches, &mut self.pipelines);
            self.skinning.rebuild(
                input.scene,
                input.animations,
                input.morphs,
                &self.settings,
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
                &mut self.key_counts,
                self.graph.pick_targets(),
                picking,
            )?;
            self.layout_prepass = self.graph.depth_prepass();
            let (skinning, layout) = (&self.skinning, &self.layout);
            self.sorted
                .rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    targets,
                    input.scene,
                    input.batches,
                    |index, _| (layout.batch_base(index), 0),
                    0,
                    shadows,
                    |slot, key| skinning.sorted_pipeline(slot as u32, key),
                    self.graph.weighted_targets(targets),
                    &mut self.key_counts,
                )
                .map_err(out_of_memory)?;
            self.decal_layout
                .rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    self.graph.decal_targets(),
                    input.scene,
                    input.batches,
                    |index, _| (layout.batch_base(index), 0),
                    0,
                    shadows,
                    |_, _| SkinnedPipeline::NotSkinned,
                    None,
                    &mut self.key_counts,
                )
                .map_err(out_of_memory)?;
            // The redraw's layout holds every opaque pair, so it is built only while decals skip
            // some layers.
            self.redraws_built = self.redraws_wanted();
            if self.redraws_built {
                self.redraw_layout
                    .rebuild(
                        &self.settings,
                        &mut self.pipelines,
                        targets,
                        input.scene,
                        input.batches,
                        |index, _| (layout.batch_base(index), 0),
                        0,
                        shadows,
                        |slot, key| skinning.sorted_pipeline(slot as u32, key),
                        None,
                        &mut self.key_counts,
                    )
                    .map_err(out_of_memory)?;
            } else {
                self.redraw_layout = SortedLayout::redraws();
            }
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
                    &mut self.key_counts,
                    self.graph.pick_targets(),
                    false,
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
                    &mut self.key_counts,
                    self.graph.pick_targets(),
                    false,
                )?;
            } else {
                self.outlined.clear();
            }
            self.layouts_outlined = outlines;
            // The subsurface layout holds buckets only while the blur has taps and some material
            // has a scatter radius.
            if scatters {
                self.scattering.rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    self.graph.skin_targets(),
                    input.scene,
                    input.batches,
                    parity,
                    limit,
                    passes,
                    Prepass::Off,
                    &self.skinning,
                    &mut self.key_counts,
                    self.graph.pick_targets(),
                    false,
                )?;
            } else {
                self.scattering.clear();
            }
            self.layouts_scattered = scatters;
            // The motion layout holds buckets only while a pass reads the motion.
            if motion {
                self.moving.rebuild(
                    &self.settings,
                    &mut self.pipelines,
                    self.graph.motion_targets(),
                    input.scene,
                    input.batches,
                    parity,
                    limit,
                    passes,
                    Prepass::Off,
                    &self.skinning,
                    &mut self.key_counts,
                    self.graph.pick_targets(),
                    false,
                )?;
            } else {
                self.moving.clear();
            }
            self.layouts_moving = motion;
            self.layouts_picked = picking;
            // The cell order holds every object that a view or a cascade culls: blended casters
            // have no bucket in the scene's layout, as the transparent pass draws them, but cast
            // all the same. Blended objects can be outlined too.
            let (layout, casters, outlined) = (&self.layout, &self.casters, &self.outlined);
            let scattering = &self.scattering;
            self.cells
                .classify(input.scene, &|slot| {
                    layout.draws(slot)
                        || (shadows && casters.draws(slot))
                        || (outlines && outlined.draws(slot))
                        || (scatters && scattering.draws(slot))
                })
                .map_err(|_| RecordError::OutOfMemory {
                    bytes: (input.scene.capacity() + 1).saturating_mul(16),
                })?;
        }
        let views = self.settings.views().len();
        self.transparent
            .reserve(&self.sorted, views)
            .map_err(out_of_memory)?;
        self.decals
            .reserve(&self.decal_layout, 1)
            .map_err(out_of_memory)?;
        self.redraws
            .reserve(&self.redraw_layout, 1)
            .map_err(out_of_memory)?;
        // The list starts with the pipelines it creates, so the thread that draws can start to
        // build them before it replays the rest (see `null3d_gpu::drawlist`).
        let mut created_pipelines = !self.created;
        let occlusion = self.graph.occlusion();
        if !self.created {
            if !self.config.direct_draws {
                cull::create_pipeline(list)?;
            }
            lights::create_pipelines(list)?;
        }
        if motion {
            created_pipelines |= self.motion.create_pipeline(list)?;
        }
        self.lines.request_pipeline(
            &input.lines,
            &mut self.pipelines,
            self.graph.scene_targets(),
        );
        self.graph
            .set_bloom(self.settings.bloom(), self.settings.bloom_chain());
        self.settings.prepare_effect_maps();
        self.graph.set_effects(
            self.settings.effects(),
            self.settings.effect_joins(),
            self.settings.clock_seconds(),
            self.settings.camera_projection(input.canvas),
        );
        self.graph
            .set_dof(self.settings.dof_frame(input.scene, parity, input.canvas));
        self.graph.set_exposure(self.settings.exposure_frame());
        created_pipelines |= self.graph.create_exposure_pipelines(list, input.frame)?;
        self.graph.set_fog_volume(self.settings.fog_volume_frame(
            input.scene,
            parity,
            input.canvas,
        ));
        self.graph.set_tone_curve(self.settings.tone_curve());
        self.graph.set_grading(self.settings.grades());
        self.graph.set_sharpen(self.settings.sharpen());
        self.graph
            .set_outline(self.settings.outline(), !self.outlined.buckets.is_empty());
        self.graph.set_still_enabled(self.settings.still_enabled());
        self.graph.set_still(self.settings.still());
        self.graph.set_subsurface(
            self.settings.subsurface_frame(input.canvas),
            !self.scattering.buckets.is_empty(),
        );
        self.graph.set_transmission(self.sorted.transmits());
        let motion_frame = match (motion, camera.as_ref()) {
            (true, Some(frame)) => Some(self.motion.advance(frame)),
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
        let shown = self.settings.views()[ViewId::CAMERA.index()].layers();
        self.redraw_layout.set_layer_filter(skipped, shown);
        let redraws = self.redraws_built && skipped != 0;
        self.graph
            .set_decals(!self.decal_layout.is_empty(), redraws);
        let materials_read_depth = self.settings.materials().any_reads_scene_depth();
        self.graph.set_soft_particles(
            self.settings.particles().wants_depth() || materials_read_depth,
            materials_read_depth,
        );
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
        created_pipelines |= self.skinning.create_pipeline(list, input.frame)?;
        // Occlusion culling's shaders load on first use: its pipelines wait for the scene's first
        // marked occluder.
        if occlusion && self.layout.occluders() > 0 {
            created_pipelines |= self.pyramids.create_pipelines(list, input.frame)?;
        }
        // A pick's resolve pass draws one triangle over the render size, after the id pass.
        if picking {
            let id = self
                .pipelines
                .id(crate::pick::resolve_key(crate::pick::FORMAT));
            self.pick.resolve = Some((id, crate::pick::FORMAT));
        }
        created_pipelines |= self.pipelines.create_new(list, input.frame)? > 0;
        if !self.created {
            self.create_fixed(list)?;
        }
        // A new row values texture needs every group that binds it again, and every row's values.
        let values_remade = self.size_row_values(list)?;
        self.graph
            .set_shadows(shadow.as_ref().map(ShadowPasses::of));
        self.graph.set_tiles(self.tiles.shape().map(|s| TilePasses {
            tiles: s.layers,
            size: s.size,
        }));
        self.graph.set_skinning(self.skinning.dispatches());
        self.settings.prepare_probe_capture(input.frame);
        self.settings.pace_views(input.canvas, input.render_scale);
        self.settings.mark_shown_views();
        self.graph
            .sync_views(self.settings.views(), self.settings.view_names());
        self.graph.set_debug_lines(!input.lines.is_empty());
        self.graph.set_transparent(!self.sorted.is_empty());
        // The pick's passes are switched on before the graph compiles this frame: a change that
        // follows the compile would leave them out of the plan, and the frame would copy a stale
        // target. A frame whose pick pipelines still build keeps the passes off.
        let pick_drawing = self.pick_ready(input, requested);
        self.graph.set_picking_draws(pick_drawing);
        self.graph.prepare(list, input.canvas, input.render_scale)?;
        let pick_frame = self.begin_pick(list, input, pick_drawing)?;
        self.pick.keep = if pick_frame.is_some() {
            crate::pick::KEEP_FRAMES
        } else if requested {
            self.pick.keep
        } else {
            self.pick.keep.saturating_sub(1)
        };
        let graph = &self.graph;
        self.settings
            .set_view_targets(|view| graph.view_target(view), graph.textures_made());
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
        // Only the camera's view copies its opaque color for surfaces that let light through.
        // The probes own the frame group's shared array, which the light tables write into, so they
        // record it before the frame groups bind it. A new array leaves the frame groups holding
        // the old one, so every camera view binds the new one again in this frame.
        let shape = self.settings.light_tables().shape(
            self.settings.probes().size(),
            self.settings.probes().probe_layers(),
        );
        self.settings.probes_mut().record(list, shape)?;
        // The next frame destroys the old array, so no frame group may still bind it.
        let probes_now = self.settings.probes().array();
        let probes_remade = probes_now != self.bound_probes;
        self.bound_probes = probes_now;
        let copy = self.graph.transmission_texture();
        let transmission = |view: ViewId| {
            if view == ViewId::CAMERA {
                copy
            } else {
                ids::BLANK_TRANSMISSION
            }
        };
        let (environment, probe_grid) = (self.bound_environment, self.bound_probe_grid);
        let frame_inputs = |lights: ViewId, view: ViewId, probes: u32| FrameInputs {
            lights,
            shadow_map,
            atlas,
            occlusion: ao_texture,
            environment,
            probe_grid,
            transmission: transmission(view),
            probes,
        };
        for index in 0..views {
            let view = ViewId::from_index(index);
            if index >= first_new {
                opaque::create_frame_buffer(list, view)?;
                self.culling.add_view(list, view)?;
            }
            // Ambient occlusion can switch the prepass on after a view first drew, and
            // occlusion culling's occluders' pass draws into the same depth.
            if depth_pass != Prepass::Off && (index >= self.prepass_views || values_remade) {
                shadow::bind_depth(list, ids::prepass_group(view), view)?;
            }
            if index >= first_new || self.graph.textures_made() || values_remade || probes_remade {
                let inputs = frame_inputs(
                    light_owner(self.lights_made, view),
                    view,
                    probe_array(probes_now),
                );
                self.bind_frame(list, view, inputs)?;
            }
        }
        self.views_made = self.views_made.max(views);
        if depth_pass != Prepass::Off {
            self.prepass_views = self.prepass_views.max(views);
        }
        // Each depth pyramid of a view that culls in two phases, whose new buffer its culling
        // group binds again.
        let mut pyramids_made = 0u32;
        if occlusion {
            for index in 0..views {
                let view = ViewId::from_index(index);
                let Some(depth) = self.graph.depth_texture(view) else {
                    continue;
                };
                let remade = self.graph.textures_made();
                if self
                    .pyramids
                    .prepare(list, view, input.canvas, depth, remade)?
                {
                    pyramids_made |= 1 << index;
                }
            }
        }
        if values_remade {
            let made = (0..self.cascades_made).map(ViewId::cascade);
            let tiles = (0..self.tiles_made).map(ViewId::tile);
            let outline = self.outline_made.then_some(ViewId::OUTLINE);
            for view in made.chain(tiles).chain(outline) {
                shadow::bind_depth(list, ids::frame_group(view), view)?;
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
        // The skin pass draws through the camera view's frame group, so its view needs only its
        // culling buffers.
        let skin_drawn = self.graph.subsurface_draws();
        let new_skin = skin_drawn && !self.subsurface_made;
        if new_skin {
            self.culling.add_view(list, ViewId::SUBSURFACE)?;
            self.subsurface_made = true;
        }

        self.cells.update(input);
        // Each view's values first: the light grids set how much their uploads take.
        self.frames.clear();
        let exposure = self.settings.drawn_output().exposure;
        self.lights
            .set_area_light_cap(self.settings.area_light_cap());
        for index in 0..views {
            let view = ViewId::from_index(index);
            // A view that the graph culls needs no values.
            let mut frame = self
                .settings
                .view_draws(view)
                .then(|| {
                    self.settings.view_frame(
                        view,
                        input.scene,
                        parity,
                        input.canvas,
                        input.render_scale,
                    )
                })
                .flatten();
            if let Some(frame) = &mut frame {
                if let Some(Some(camera)) = self.frames.first() {
                    frame.set_shadow_origin(&camera.camera);
                }
                self.lights
                    .assign(view, frame, input, exposure, &self.tiles);
            }
            self.frames.push(frame);
        }
        // A view whose grid has no light buffers yet gets them, and its frame group binds them.
        for index in 0..views {
            let view = ViewId::from_index(index);
            let bit = 1 << index;
            if self.lights_made & bit != 0 {
                continue;
            }
            let Some(lights) = self.lights.get(view) else {
                continue;
            };
            lights::create(list, view, lights)?;
            self.lights_made |= bit;
            self.bind_frame(
                list,
                view,
                frame_inputs(view, view, probe_array(probes_now)),
            )?;
        }

        arena.reset(self.upload_bound() + LinesPass::upload_bytes(&input.lines));
        let array = self.settings.probes().array().map_or(0, |(id, _)| id);
        let probe_layers = self.settings.probes().probe_layers();
        self.settings
            .light_tables_mut()
            .record(list, array, probe_layers)?;
        if std::mem::take(&mut self.dfg_pending) {
            dfg::upload(list, arena, ids::CUSTOM_VALUES, MATERIAL_TEXELS)?;
            ao::upload_blank(list, arena, ids::BLANK_AO)?;
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
        let camera_y = match self.frames.get(ViewId::CAMERA.index()) {
            Some(Some(frame)) => frame.uniform.camera_world[1],
            _ => 0.0,
        };
        physical_sky::record_frame(
            &mut self.physical_sky,
            &mut self.settings,
            (&self.pipelines, input.pipelines_built),
            camera_y,
            list,
            arena,
        )?;
        let groups_remade =
            self.settings
                .record_materials(input, list, arena, table, &self.physical_sky)?;
        self.graph.set_probe_filter(self.settings.probes().filter());
        // The frame's texture work made the passes' targets and uploads ready, so the textures
        // of the effects and the full-screen passes sample from this frame on.
        self.settings.update_post_layers();
        self.graph
            .set_post_values(self.settings.effects(), self.settings.views());
        // The environment's map may have finished its upload, or gone, with this frame's texture
        // work, so the views read it from here on.
        // So may the reflection probes' array, which the probes' work makes again.
        let (environment, lit) = self.settings.environment_map(ids::BLANK_ENVIRONMENT);
        let probes = self.settings.probes().array();
        if environment != self.bound_environment || probes != self.bound_probes {
            self.bound_environment = environment;
            self.bound_probes = probes;
            for index in 0..views {
                let view = ViewId::from_index(index);
                let inputs = FrameInputs {
                    environment,
                    ..frame_inputs(
                        light_owner(self.lights_made, view),
                        view,
                        probe_array(probes),
                    )
                };
                self.bind_frame(list, view, inputs)?;
            }
        }
        let (probe_grid, grid_uniform) = self.settings.probe_grid_map(ids::BLANK_PROBE_GRID);
        if probe_grid != self.bound_probe_grid {
            self.bound_probe_grid = probe_grid;
            for index in 0..views {
                let view = ViewId::from_index(index);
                let inputs = FrameInputs {
                    environment,
                    probe_grid,
                    ..frame_inputs(
                        light_owner(self.lights_made, view),
                        view,
                        probe_array(probes),
                    )
                };
                self.bind_frame(list, view, inputs)?;
            }
        }
        for frame in self.frames.iter_mut().flatten() {
            frame.uniform.environment = lit;
            frame.uniform.probe_grid = grid_uniform;
        }
        if let Some(Some(frame)) = self.frames.get_mut(ViewId::CAMERA.index()) {
            frame.uniform.camera_world[3] = f32::from(u8::from(self.graph.transmission_copied()));
            let eye = frame.camera.absolute();
            self.graph.write_screen_values(&mut frame.uniform, eye);
        }
        self.graph.upload(
            list,
            arena,
            self.settings.drawn_output(),
            self.settings.grading(),
        )?;
        self.bind_decal_groups(list)?;
        self.background
            .prepare(list, arena, &self.settings, self.physical_sky.group())?;
        let binding_bytes = self.config.storage_binding_bytes;
        // Each level's slice holds the copies that this frame's views draw, rather than the room
        // for every source. It comes before the layouts are applied and the views' bundles are
        // recorded: both name the slices' bases in commands that the frame keeps.
        self.fit_level_copies(input, parity)?;
        let (shared_recreated, casters_recreated) = if upload_everything {
            let shared = self.layout.apply(list, arena, binding_bytes)?;
            let casters = shadows && self.casters.apply(list, arena, binding_bytes)?;
            if outlines {
                self.outlined.apply(list, arena, binding_bytes)?;
            }
            if scatters {
                self.scattering.apply(list, arena, binding_bytes)?;
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
            if scatters {
                self.scattering
                    .update_membership(list, arena, input, parity)?;
            }
            (false, false)
        };
        // Build the motion tables when their layout changes, even while its pipelines load.
        // Once the view can draw, the scene may no longer need a layout upload.
        if motion && upload_everything {
            self.moving.apply(list, arena, binding_bytes)?;
        }
        // Every change to a layout's bucket records this frame, a rebuilt table's included, goes
        // up in one write here, after the slices settled, so the culling pass reads a table that
        // no later write of the same frame can undo.
        self.layout.upload_records(list, arena)?;
        if shadows {
            self.casters.upload_records(list, arena)?;
        }
        if outlines {
            self.outlined.upload_records(list, arena)?;
        }
        if scatters {
            self.scattering.upload_records(list, arena)?;
        }
        // The motion view draws while a pass reads the motion and the device draws its target. Its
        // bundles and culling groups name the copies of the last frame's data, which can grow.
        let motion_on = motion && self.graph.motion_draws();
        if motion_on {
            self.moving.upload_records(list, arena)?;
        }
        if motion_on {
            let mut motion_new = false;
            if !self.motion_made {
                self.culling.add_view(list, ViewId::MOTION)?;
                self.motion_made = true;
                motion_new = true;
            }
            if !upload_everything {
                self.moving.update_membership(list, arena, input, parity)?;
            }
            self.motion.reserve(input.snapshot.uploads().len() + 1)?;
            let stale = self.motion.prepare(
                list,
                &self.layout,
                &self.skinning,
                upload_everything,
                values_remade,
            )?;
            let records =
                motion_new || stale || upload_everything || buffers_remade || groups_remade;
            let last = [ids::last_matrices(1), ids::last_matrices(0)];
            self.culling.apply_motion(
                list,
                &self.moving,
                records || shared_recreated,
                binding_bytes,
                last,
            )?;
            if records {
                let targets = self.graph.motion_targets();
                let (moving, meshes) = (&self.moving, &self.meshes);
                for parity in 0..2 {
                    let kind = Bundle::Motion(parity);
                    let view = ViewId::MOTION;
                    opaque::record_bundle(list, view, moving, meshes, targets, kind, 0, &|_| {
                        false
                    })?;
                }
            }
        }
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
            let occludes = occlusion && self.graph.occludes(view);
            if self.config.direct_draws {
                self.culling
                    .apply_direct(list, view, layout, binding_bytes)?;
            } else {
                self.culling
                    .apply(list, view, layout, recreated, binding_bytes, occludes)?;
            }
            if !records || self.config.direct_draws {
                continue;
            }
            // With occlusion culling, the opaque pass draws the second set of indirect draws, and
            // the occluders' pass the first, into its depth target alone.
            let (first_draw, depth_targets) = if occludes {
                (layout.draws.len() as u32, scene_targets.occluder_depth())
            } else {
                (0, scene_targets)
            };
            // A view leaves out the objects whose maps show a target that it does not read.
            let hidden_targets = self.settings.hidden_targets(view);
            let textures = self.settings.textures();
            let hidden = |group| textures.group_pass_views(group) & hidden_targets != 0;
            let kind = Bundle::Opaque;
            opaque::record_bundle(
                list,
                view,
                layout,
                meshes,
                scene_targets,
                kind,
                first_draw,
                &hidden,
            )?;
            if depth_pass != Prepass::Off {
                let depth = Bundle::Prepass;
                opaque::record_bundle(
                    list,
                    view,
                    layout,
                    meshes,
                    depth_targets,
                    depth,
                    0,
                    &hidden,
                )?;
            }
        }
        if outline_drawn && (upload_everything || buffers_remade || new_outline) {
            let view = ViewId::OUTLINE;
            // The outlined layout's tables are new whenever the layouts are.
            let recreated = shared_recreated || upload_everything;
            if self.config.direct_draws {
                self.culling
                    .apply_direct(list, view, &self.outlined, binding_bytes)?;
            } else {
                self.culling
                    .apply(list, view, &self.outlined, recreated, binding_bytes, false)?;
            }
            if !self.config.direct_draws {
                let targets = self.graph.outline_targets();
                let (outlined, meshes) = (&self.outlined, &self.meshes);
                let kind = Bundle::Outline;
                opaque::record_bundle(list, view, outlined, meshes, targets, kind, 0, &|_| false)?;
            }
        }
        if skin_drawn && (upload_everything || buffers_remade || groups_remade || new_skin) {
            let view = ViewId::SUBSURFACE;
            if self.config.direct_draws {
                self.culling
                    .apply_direct(list, view, &self.scattering, binding_bytes)?;
            } else {
                let recreated = shared_recreated || upload_everything;
                self.culling.apply(
                    list,
                    view,
                    &self.scattering,
                    recreated,
                    binding_bytes,
                    false,
                )?;
                let targets = self.graph.skin_targets();
                // The skin pass leaves out what the camera's view leaves out.
                let hidden_targets = self.settings.hidden_targets(ViewId::CAMERA);
                let textures = self.settings.textures();
                let hidden = |group| textures.group_pass_views(group) & hidden_targets != 0;
                let (scattering, meshes) = (&self.scattering, &self.meshes);
                let kind = Bundle::Subsurface;
                opaque::record_bundle(list, view, scattering, meshes, targets, kind, 0, &hidden)?;
            }
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
            if self.config.direct_draws {
                self.culling
                    .apply_direct(list, view, &self.casters, binding_bytes)?;
                continue;
            }
            self.culling
                .apply(list, view, &self.casters, recreated, binding_bytes, false)?;
            let (casters, meshes) = (&self.casters, &self.meshes);
            let (targets, kind) = if view.tile_index().is_some() {
                (shadow_tiles::TARGETS, Bundle::Tile)
            } else {
                (self.settings.cascade_depth().targets(), Bundle::Opaque)
            };
            opaque::record_bundle(list, view, casters, meshes, targets, kind, 0, &|_| false)?;
        }
        let changed = motion_on.then_some(self.motion.changed_matrices());
        self.layout
            .upload_matrices(list, input, parity, upload_everything, changed)?;
        self.layout
            .upload_row_values(list, input, parity, upload_everything || values_remade)?;
        self.layout.upload_object_ranges(list, arena)?;
        self.layout.update_skinned(input.scene)?;
        if shadows {
            self.casters.update_skinned(input.scene)?;
        }
        if outlines {
            self.outlined.update_skinned(input.scene)?;
        }
        if scatters {
            self.scattering.update_skinned(input.scene)?;
        }
        if motion_on {
            self.moving.update_skinned(input.scene)?;
        }
        self.skinning.begin_frame();
        self.layout
            .update_order(list, arena, &self.cells, input, &self.casters)?;
        let drawn_views = self
            .frames
            .iter()
            .enumerate()
            .filter(|(_, frame)| frame.is_some())
            .fold(0u32, |mask, (index, _)| mask | 1 << index);
        self.light_clusters.upload(
            list,
            arena,
            &mut self.lights,
            self.lights_made & drawn_views,
        )?;
        self.transparent.size(list, &self.sorted, views)?;
        self.decals.size(list, &self.decal_layout, 1)?;
        self.redraws.size(list, &self.redraw_layout, 1)?;

        let render_size = self.graph.render_size();
        let any_probes = self.settings.probes().any();
        let list_probes = self.probes_listed || any_probes;
        self.probes_listed = any_probes;
        for (index, frame) in self.frames.iter().enumerate() {
            let view = ViewId::from_index(index);
            if let Some(frame) = frame {
                opaque::upload(list, arena, view, frame)?;
                if list_probes {
                    let probes = self.settings.probe_list(view, frame);
                    opaque::upload_probes(list, arena, view, &probes)?;
                }
                let levels = if occlusion && self.graph.occludes(view) {
                    Some(*self.pyramids.upload(list, arena, view, render_size)?)
                } else {
                    None
                };
                let (layout, cells) = (&self.layout, &self.cells);
                let detail = self.settings.level_view(view, input.canvas);
                if self.config.direct_draws {
                    self.direct.record(
                        list,
                        arena,
                        input.jobs,
                        view,
                        frame,
                        input.scene,
                        input.batches,
                        cells,
                        layout,
                        layout,
                        detail,
                        parity,
                    )?;
                } else {
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
                        &detail,
                    )?;
                }
                let offsets = if self.config.direct_draws {
                    self.direct.offsets()
                } else {
                    self.culling.offsets()
                };
                self.skinning
                    .see(frame, offsets, input.scene, parity, false);
            }
        }
        if let (true, Some(frame)) = (outline_drawn, self.frames[ViewId::CAMERA.index()]) {
            let view = ViewId::OUTLINE;
            opaque::upload(list, arena, view, &frame)?;
            let (layout, outlined, cells) = (&self.layout, &self.outlined, &self.cells);
            let detail = self.settings.level_view(view, input.canvas);
            if self.config.direct_draws {
                self.direct.record(
                    list,
                    arena,
                    input.jobs,
                    view,
                    &frame,
                    input.scene,
                    input.batches,
                    cells,
                    layout,
                    outlined,
                    detail,
                    parity,
                )?;
            } else {
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
                    &detail,
                )?;
            }
        }
        if let (true, Some(frame)) = (skin_drawn, self.frames[ViewId::CAMERA.index()]) {
            let view = ViewId::SUBSURFACE;
            let (layout, scattering, cells) = (&self.layout, &self.scattering, &self.cells);
            let detail = self.settings.level_view(view, input.canvas);
            if self.config.direct_draws {
                self.direct.record(
                    list,
                    arena,
                    input.jobs,
                    view,
                    &frame,
                    input.scene,
                    input.batches,
                    cells,
                    layout,
                    scattering,
                    detail,
                    parity,
                )?;
            } else {
                self.culling.upload(
                    list,
                    arena,
                    view,
                    &frame,
                    layout,
                    scattering,
                    input.scene,
                    cells,
                    None,
                    &detail,
                )?;
            }
        }
        if let (true, Some(frame), Some(motion_frame)) = (
            motion_on,
            self.frames[ViewId::CAMERA.index()],
            motion_frame.as_ref(),
        ) {
            self.motion.upload(list, arena, &frame, motion_frame)?;
            let (layout, moving, cells) = (&self.layout, &self.moving, &self.cells);
            // The motion view picks each instance's level of detail as the camera's view does.
            let detail = self.settings.level_view(ViewId::CAMERA, input.canvas);
            self.culling.upload(
                list,
                arena,
                ViewId::MOTION,
                &frame,
                layout,
                moving,
                input.scene,
                cells,
                None,
                &detail,
            )?;
        }
        self.cascade_frames = [None; MAX_CASCADES];
        if shadow.is_none() && self.cascades_held && shadows {
            // Receivers of point and spot light shadows read the cascades too: none now.
            let (at, bytes) = arena.push(ShadowUniform::default().as_bytes())?;
            list.push(Op::WriteBuffer, &[ids::SHADOWS, 0, at, bytes])?;
        }
        self.cascades_held = shadow.is_some() || (self.cascades_held && !shadows);
        self.tiles
            .upload(list, arena, ids::SHADOWS, sizes::SHADOW_UNIFORM_BYTES)?;
        let shadow_detail = self.settings.shadow_level_view(input.canvas);
        for tile in 0..tiles {
            let view = ViewId::tile(tile);
            let Some(frame) = self.tiles.frame(tile).copied() else {
                continue;
            };
            opaque::upload(list, arena, view, &frame)?;
            let (layout, casters, cells) = (&self.layout, &self.casters, &self.cells);
            if self.config.direct_draws {
                self.direct.record(
                    list,
                    arena,
                    input.jobs,
                    view,
                    &frame,
                    input.scene,
                    input.batches,
                    cells,
                    layout,
                    casters,
                    shadow_detail,
                    parity,
                )?;
            } else {
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
                    &shadow_detail,
                )?;
            }
            let offsets = if self.config.direct_draws {
                self.direct.offsets()
            } else {
                self.culling.offsets()
            };
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
                if self.config.direct_draws {
                    self.direct.record(
                        list,
                        arena,
                        input.jobs,
                        view,
                        &frame,
                        input.scene,
                        input.batches,
                        cells,
                        layout,
                        casters,
                        shadow_detail,
                        parity,
                    )?;
                } else {
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
                        &shadow_detail,
                    )?;
                }
                let offsets = if self.config.direct_draws {
                    self.direct.offsets()
                } else {
                    self.culling.offsets()
                };
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
        self.decal_layout
            .gather(scene, batches, parity)
            .map_err(out_of_memory)?;
        self.decals.sort(
            input.jobs,
            &self.decal_layout,
            &self.frames[..1],
            scene,
            batches,
            parity,
        );
        self.decals.upload(
            list,
            arena,
            ViewId::CAMERA,
            &self.decal_layout,
            &self.skinning,
            input.jobs,
            scene,
            batches,
            parity,
        )?;
        self.redraw_layout
            .gather(scene, batches, parity)
            .map_err(out_of_memory)?;
        self.redraws.sort(
            input.jobs,
            &self.redraw_layout,
            &self.frames[..1],
            scene,
            batches,
            parity,
        );
        self.redraws.upload(
            list,
            arena,
            ViewId::CAMERA,
            &self.redraw_layout,
            &self.skinning,
            input.jobs,
            scene,
            batches,
            parity,
        )?;
        let frames_now = &self.frames;
        self.particles.prepare(
            list,
            arena,
            &self.settings,
            self.settings.particles(),
            scene,
            parity,
            views,
            &|k| frames_now.get(k).and_then(Option::as_ref),
            (
                self.graph.particle_depth_texture(),
                self.graph.textures_made(),
            ),
        )?;
        self.settings.particles_mut().clear_marks();
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
        let (outlined, scattering) = (&self.outlined, &self.scattering);
        let moving = &self.moving;
        let motion_draws = motion_on && self.motion.draws();
        let (frames, cascade_frames, tiles) = (&self.frames, &self.cascade_frames, &self.tiles);
        let (background, light_clusters) = (&self.background, &self.light_clusters);
        let skinning = &self.skinning;
        let drawn = |view: ViewId| match (view.cascade_index(), view.tile_index()) {
            (Some(cascade), _) => cascade_frames[cascade].is_some(),
            (_, Some(tile)) => tiles.frame(tile).is_some(),
            _ if view == ViewId::OUTLINE => outline_drawn && frames[0].is_some(),
            _ if view == ViewId::SUBSURFACE => skin_drawn && frames[0].is_some(),
            _ if view == ViewId::MOTION => motion_draws && frames[0].is_some(),

            _ => frames[view.index()].is_some(),
        };
        let layout_of = |view: ViewId| match view {
            ViewId::OUTLINE => outlined,
            ViewId::SUBSURFACE => scattering,
            ViewId::MOTION => moving,

            view if view.is_camera() => layout,
            _ => casters,
        };
        // A cascade or a tile that does not draw keeps its depth: its render pass is left out.
        let skips = |role: Role| match role {
            Role::Shadow(view) => !drawn(view),
            Role::Occluders(_) => !occluding,
            Role::Pick | Role::PickResolve => pick_frame.is_none(),
            _ => false,
        };
        let (sorted, transparent) = (&self.sorted, &self.transparent);
        let (decal_layout, decals) = (&self.decal_layout, &self.decals);
        let (redraw_layout, redraws) = (&self.redraw_layout, &self.redraws);
        let particles = &self.particles;
        let (settings, meshes) = (&self.settings, &self.meshes);
        let motion_state = &mut self.motion;
        let weighted = self.graph.weighted_declared();
        let direct_draws = self.config.direct_draws;
        let direct = &self.direct;
        // A direct draw's instance count changes every frame, so the direct path records the
        // draws in the pass instead of replaying a bundle.
        let record_direct_view =
            |list: &mut DrawList, view: ViewId, kind: Bundle| -> Result<(), RecordError> {
                // The skin pass draws the camera's objects into its own target, so it leaves out
                // what the camera's view leaves out, as its bundle does.
                let targets_view = if kind == Bundle::Subsurface {
                    ViewId::CAMERA
                } else {
                    view
                };
                let hidden_targets = settings.hidden_targets(targets_view);
                let textures = settings.textures();
                let hidden = |group| textures.group_pass_views(group) & hidden_targets != 0;
                opaque::record_direct(
                    list,
                    view,
                    layout_of(view),
                    meshes,
                    kind,
                    direct.counts(view),
                    &hidden,
                )
            };
        let pick_pipeline = self.pick.resolve.map_or(0, |(id, _)| id);
        let pick_group = self.pick.group;
        let pick_pixel = pick_frame.map(|(_, pixel)| pixel);
        self.graph.record(
            list,
            |view| settings.clear_color_of(view),
            skips,
            |list, role| match role {
                Role::LightClusters => light_clusters.record(list),
                Role::Skin => skinning.record(list),
                Role::Cull(ViewId::MOTION) if drawn(ViewId::MOTION) => {
                    culling.record(list, ViewId::MOTION, moving, Phase::Motion(parity))
                }
                Role::Motion if drawn(ViewId::MOTION) => {
                    opaque::record(list, ViewId::MOTION, Bundle::Motion(parity))
                }
                Role::Cull(view) if direct_draws && drawn(view) => Ok(()),
                Role::Cull(view) if drawn(view) => {
                    let phase = if occluding && culling.occludes(view) {
                        Phase::Early
                    } else {
                        Phase::Once
                    };
                    culling.record(list, view, layout_of(view), phase)
                }
                Role::Prepass(view) | Role::Occluders(view) if drawn(view) => {
                    if direct_draws {
                        record_direct_view(list, view, Bundle::Prepass)
                    } else {
                        opaque::record(list, view, Bundle::Prepass)
                    }
                }
                Role::Opaque(view) | Role::Shadow(view) if drawn(view) => {
                    let backdrop = settings.draws_background(view);
                    if backdrop {
                        background.record(list, ids::frame_group(view), &[], Place::First)?;
                    }
                    if direct_draws {
                        // A shadow view of the atlas's tiles draws with its tile pipeline, as its
                        // bundle did; a cascade draws with the cascade pipeline.
                        let kind = if view.tile_index().is_some() {
                            Bundle::Tile
                        } else {
                            Bundle::Opaque
                        };
                        record_direct_view(list, view, kind)?;
                    } else {
                        opaque::record(list, view, Bundle::Opaque)?;
                    }
                    if backdrop {
                        background.record(list, ids::frame_group(view), &[], Place::Last)?;
                    }
                    Ok(())
                }
                Role::Pyramid(view) if drawn(view) && occluding => pyramids.record(list, view),
                Role::LateCull(view) if drawn(view) && occluding => {
                    culling.record(list, view, layout, Phase::Late)
                }
                Role::OutlineMask if drawn(ViewId::OUTLINE) => {
                    if direct_draws {
                        record_direct_view(list, ViewId::OUTLINE, Bundle::Outline)
                    } else {
                        opaque::record(list, ViewId::OUTLINE, Bundle::Outline)
                    }
                }
                Role::SkinLight if drawn(ViewId::SUBSURFACE) => {
                    if direct_draws {
                        record_direct_view(list, ViewId::SUBSURFACE, Bundle::Subsurface)
                    } else {
                        opaque::record(list, ViewId::SUBSURFACE, Bundle::Subsurface)
                    }
                }
                Role::DebugLines => lines.record(list, ids::frame_group(ViewId::CAMERA), &[]),
                Role::FogLight(_) => bind_frame_group(list, ids::frame_group(ViewId::CAMERA), &[]),
                Role::Transparent(view) => {
                    let rows = if weighted && view == ViewId::CAMERA {
                        SortedRows::Sorted
                    } else {
                        SortedRows::All
                    };
                    let frame = ids::frame_group(view);
                    // The camera's transparent pass draws after the copy of its opaque depth; a
                    // scene pass's view has no copy and binds the blank texel.
                    let scene = ids::MATERIAL_SCENE_GROUPS + u32::from(view == ViewId::CAMERA);
                    transparent.record(
                        list, view, rows, sorted, skinning, settings, meshes, frame, 0, scene,
                        particles,
                    )
                }
                Role::Decals => {
                    let depth = ids::DECAL_DEPTH_GROUP;
                    let view = ViewId::CAMERA;
                    decals.record(
                        list,
                        view,
                        SortedRows::All,
                        decal_layout,
                        skinning,
                        settings,
                        meshes,
                        ids::DECAL_FRAME_GROUP,
                        depth,
                        ids::MATERIAL_SCENE_GROUPS,
                        particles,
                    )
                }
                Role::DecalRedraw => {
                    let view = ViewId::CAMERA;
                    redraws.record(
                        list,
                        view,
                        SortedRows::All,
                        redraw_layout,
                        skinning,
                        settings,
                        meshes,
                        ids::frame_group(view),
                        0,
                        ids::MATERIAL_SCENE_GROUPS,
                        particles,
                    )
                }
                Role::Pick => {
                    // One pixel is all the frame reads, so the pass shades no other.
                    if let Some((x, y)) = pick_pixel {
                        list.push(Op::SetScissor, &[x, y, 1, 1])?;
                    }
                    let hidden_targets = settings.hidden_targets(ViewId::CAMERA);
                    let textures = settings.textures();
                    let hidden =
                        |group: u32| textures.group_pass_views(group) & hidden_targets != 0;
                    let counts = direct_draws.then(|| direct.counts(ViewId::CAMERA));
                    opaque::record_pick(list, ViewId::CAMERA, layout, meshes, counts, &hidden)
                }
                Role::PickResolve => {
                    list.push(Op::SetPipeline, &[pick_pipeline])?;
                    list.push(Op::SetBindGroup, &[0, pick_group, 0])?;
                    list.push(Op::Draw, &[3, 1, 0, 0])?;
                    Ok(())
                }
                Role::Weighted => transparent.record(
                    list,
                    ViewId::CAMERA,
                    SortedRows::Weighted,
                    sorted,
                    skinning,
                    settings,
                    meshes,
                    ids::frame_group(ViewId::CAMERA),
                    0,
                    ids::MATERIAL_SCENE_GROUPS,
                    particles,
                ),
                _ => Ok(()),
            },
            |list| {
                if motion_on {
                    motion_state.finish(list, parity, layout, skinning)?;
                }
                Ok(())
            },
        )?;
        if let Some((request, pixel)) = pick_frame
            && let Some(texture) = self.graph.pick_result_texture()
        {
            let buffer = ids::PICK_BUFFERS + request.ring;
            crate::pick::record_readback(
                list,
                &request,
                pixel,
                input.canvas,
                texture,
                buffer,
                false,
            )?;
            self.settings.take_pick();
        }
        self.tiles
            .finish(input.frame, created_pipelines, input.pipelines_built);
        Ok(upload_everything)
    }

    /// True when this frame draws the pick that waits: the resolve pipeline and the pick pipeline
    /// of every bucket are built. A frame that gives false records no read, so the request stays.
    fn pick_ready(&self, input: &FrameInput<'_>, requested: bool) -> bool {
        if !requested {
            return false;
        }
        let pipeline = self.pick.resolve.map(|(id, _)| id);
        pipeline.is_some_and(|id| self.pipelines.built(id, input.pipelines_built))
            && self.layout.buckets.iter().all(|bucket| {
                bucket.pick == 0 || self.pipelines.built(bucket.pick, input.pipelines_built)
            })
    }

    /// Prepares the frame's pick while it draws one: it creates the ring's read buffers and the
    /// bind group that the resolve pass reads the id target through, and says which pixel the
    /// frame copies back.
    fn begin_pick(
        &mut self,
        list: &mut DrawList,
        input: &FrameInput<'_>,
        drawing: bool,
    ) -> Result<Option<crate::pick::PickFrame>, RecordError> {
        let Some(request) = self.settings.pick().filter(|_| drawing) else {
            return Ok(None);
        };
        let Some(texture) = self.graph.pick_sample_texture() else {
            return Ok(None);
        };
        if !self.pick.buffers_made {
            for ring in 0..crate::pick::RING as u32 {
                list.push(
                    Op::CreateBuffer,
                    &[
                        ids::PICK_BUFFERS + ring,
                        crate::pick::READ_BYTES,
                        usage::MAP_READ | usage::COPY_DST,
                    ],
                )?;
            }
            self.pick.buffers_made = true;
        }
        if self.pick.group == 0 || self.pick.bound != texture {
            let group = ids::PICK_GROUP;
            let words = [
                group,
                bind_layout::VIEW_COPY,
                1,
                0,
                resource_kind::TEXTURE,
                texture,
                0,
                0,
            ];
            list.push(Op::CreateBindGroup, &words)?;
            self.pick.group = group;
            self.pick.bound = texture;
        }
        let size = self.graph.render_size();
        let pixel = crate::pick::pixel_of(
            &request,
            self.settings.pixel_ratio(),
            input.render_scale,
            size,
        );
        Ok(Some((request, pixel)))
    }

    /// Makes the row values texture big enough for the scene layout's sources with row values,
    /// with room to grow, and at least one texel row, which the frame groups bind while no batch
    /// has row values. Returns true when it made the texture again.
    fn size_row_values(&mut self, list: &mut DrawList) -> Result<bool, RecordError> {
        let needed = (self.layout.value_sources).div_ceil(sizes::ROW_VALUES_PER_TEXTURE_ROW);
        let limit = BUDGET[Limit::TextureDimension2D as usize];
        DataTexture::row_values(ids::ROW_VALUES, 1).grow(list, &mut self.value_rows, needed, limit)
    }

    /// Records the creation of the material table, the data texture of materials' custom values,
    /// and three.js's table of specular terms, whose sizes never change, and of the shadows'
    /// settings block and sampler.
    fn create_fixed(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        shadows::create_objects(
            list,
            ids::SHADOWS,
            ids::SHADOW_SAMPLER,
            Some(ids::SHADOW_TEXEL_SAMPLER),
        )?;
        probe_grid::create_objects(list, ids::BLANK_PROBE_GRID)?;
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
                MATERIAL_TEXELS + dfg::SIZE,
                materials.max(dfg::SIZE),
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
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        list.push(
            Op::CreateBuffer,
            &[
                ids::PROBE_LISTS,
                MAX_VIEWS as u32 * probes::LIST_STRIDE,
                usage::UNIFORM | usage::COPY_DST,
            ],
        )?;
        probes::create_blank(list, ids::BLANK_PROBES)?;
        // The probes own the frame group's shared array of the probes' maps and the light tables.
        self.settings.probes_mut().set_textures(ProbeTextures {
            first: ids::PROBE_TEXTURES,
        });
        environment::create_objects(list, ids::BLANK_ENVIRONMENT, ids::ENVIRONMENT_SAMPLER)?;
        ao::create_blank(list, ids::BLANK_AO)?;
        transmission::create_blank(list, ids::BLANK_TRANSMISSION)?;
        lights::create(list, ViewId::CAMERA, self.lights.camera())?;
        self.lights_made = 1 << ViewId::CAMERA.index();
        self.dfg_pending = true;
        self.created = true;
        Ok(())
    }

    /// True when objects on the layers that decals skip must draw again after them: some object is
    /// a decal, and decals skip some layers.
    fn redraws_wanted(&self) -> bool {
        !self.decal_layout.is_empty() && self.settings.decal_skipped_layers() != 0
    }

    /// Makes a view's frame group, and keeps the camera's inputs for the decal pass's frame group.
    fn bind_frame(
        &mut self,
        list: &mut DrawList,
        view: ViewId,
        inputs: FrameInputs,
    ) -> Result<(), RecordError> {
        opaque::bind_frame(list, view, &inputs, self.layout.parallax_frame())?;
        if view == ViewId::CAMERA {
            self.camera_frame = Some(inputs);
            self.decal_frame_stale = true;
        }
        Ok(())
    }

    /// Makes the decal pass's groups while the pass runs: its frame group when the pass starts and
    /// whenever the camera's frame group is made again, and the group of the scene depth that it
    /// reads when the pass starts and when the frame made the plan's textures again.
    fn bind_decal_groups(&mut self, list: &mut DrawList) -> Result<(), RecordError> {
        let depth = self.graph.decal_depth();
        match (depth, self.camera_frame) {
            (Some(_), Some(inputs)) if self.decal_frame_stale => {
                opaque::bind_decal_frame(list, &inputs)?;
                self.decal_frame_stale = false;
            }
            (None, _) => self.decal_frame_stale = true,
            _ => {}
        }
        if let Some(texture) = depth
            && (self.graph.textures_made() || depth != self.decal_depth_bound)
        {
            let layout = if self.graph.decal_depth_multisampled() {
                bind_layout::DECAL_DEPTH_MS
            } else {
                bind_layout::DECAL_DEPTH
            };
            let group = ids::DECAL_DEPTH_GROUP;
            let words = [group, layout, 1, 0, resource_kind::TEXTURE, texture, 0, 0];
            list.push(Op::CreateBindGroup, &words)?;
        }
        self.decal_depth_bound = depth;
        Ok(())
    }

    /// The most that one frame can copy into its arena for the scene as it stands: mesh data not
    /// uploaded yet, the whole material table, three.js's table of specular terms, both layouts'
    /// tables, the light grid, each view's, each cascade's and each tile's frame uniform, culling
    /// parameters and indirect draws, the cascades' and the tiles' uniforms, and the final pass's
    /// settings.
    fn upload_bound(&self) -> usize {
        let meshes = self.meshes.pending_bytes(self.settings.meshes().pages());
        let materials = self.settings.materials().capacity() as usize * MATERIAL_FLOATS * 4 * 2
            + dfg::BYTES
            + ao::BLANK_BYTES;
        let per_view = |layout: &Layout| {
            (sizes::FRAME_UNIFORM_BYTES + CULL_PARAMS_BYTES) as usize
                + layout.draws.len() * INDIRECT_BYTES as usize
                + if self.config.direct_draws {
                    layout.compacted_bytes() as usize
                } else {
                    0
                }
        };
        let camera_views = self.settings.views().len();
        let pyramids = if self.graph.occlusion() {
            Pyramids::UPLOAD_BYTES
        } else {
            0
        };
        let motion = if self.layouts_moving {
            per_view(&self.moving) + crate::motion::BLOCK_BYTES as usize
        } else {
            0
        };
        let views = camera_views
            * (per_view(&self.layout) + pyramids + probes::LIST_BYTES as usize)
            + per_view(&self.outlined)
            + per_view(&self.scattering)
            + motion;
        let tiles = self.settings.tile_settings().tiles as usize;
        let cascades = (MAX_CASCADES + tiles.min(MAX_TILES)) * per_view(&self.casters);
        let tables = self.layout.upload_bound()
            + self.casters.upload_bound()
            + self.outlined.upload_bound()
            + self.scattering.upload_bound()
            + self.moving.upload_bound();

        let lights = self.lights.upload_room();
        let shadows = (sizes::SHADOW_UNIFORM_BYTES + sizes::SHADOW_TILES_UNIFORM_BYTES) as usize;
        let sorted = Transparent::upload_bound(&self.sorted, camera_views)
            + Transparent::upload_bound(&self.decal_layout, 1)
            + Transparent::upload_bound(&self.redraw_layout, 1);
        let particles = self
            .particles
            .upload_bound(self.settings.particles(), camera_views);
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
            + particles
            + self.graph.upload_bound()
            + BackgroundPass::UPLOAD_BYTES
            + PhysicalSkyPass::UPLOAD_BYTES
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
        self.scattering.reserve(sources)?;
        self.moving.reserve(sources)?;

        let added = sources.saturating_sub(self.layout.sources);
        let bound = self.upload_bound() + (added * TABLE_BYTES_PER_SOURCE) as usize;
        for arena in self.lists.arenas_mut() {
            arena.try_reserve(bound)?;
        }
        Ok(())
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

    fn casts_tile_shadows(&self) -> bool {
        self.tiles.shape().is_some()
    }

    fn pick_covers_scene(&self) -> bool {
        self.layout.buckets.iter().all(|bucket| bucket.pick != 0) && self.sorted.is_empty()
    }

    fn pick_target(&self, key: u32) -> Option<(u32, u32)> {
        if key == 0 {
            return None;
        }
        let layout = &self.layout;
        if key < layout.scene_rows {
            return Some((key, u32::MAX));
        }
        let &(batch, base) = layout
            .batch_bases()
            .iter()
            .rev()
            .find(|&&(_, first)| first <= key)?;
        Some((batch, key - base))
    }

    fn meshes_moved(&mut self, _ids: &[u32], moves: &MeshMoves) {
        self.meshes.moved(moves);
        if let Some(first) = moves.morph_texels {
            self.skinning.morph_mut().deltas_moved(first);
        }
    }

    fn meshes_updated(&mut self, _id: u32, _positions: bool) {
        self.meshes.updated(self.settings.meshes().updated());
    }

    fn mesh_gpu_bytes(&self) -> u64 {
        self.meshes.gpu_bytes() + self.skinning.morph().delta_bytes()
    }

    fn reset_gpu(&mut self) {
        self.lists.reset_gpu();
        self.created = false;
        self.bound_environment = ids::BLANK_ENVIRONMENT;
        self.bound_probe_grid = ids::BLANK_PROBE_GRID;
        self.bound_probes = None;
        self.probes_listed = false;
        self.value_rows = 0;
        self.background.reset_gpu();
        self.particles.reset_gpu();
        self.physical_sky.reset_gpu();
        self.graph.reset_gpu();
        self.settings.forget_shadow_maps();
        self.layout.forget_gpu();
        self.casters.forget_gpu();
        self.outlined.forget_gpu();
        self.outline_made = false;
        self.scattering.forget_gpu();
        self.subsurface_made = false;
        self.moving.forget_gpu();
        self.motion_made = false;
        self.motion.forget_gpu();
        self.pick.reset_gpu();
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
        self.lights_made = 0;
        self.skinning.forget_gpu();
        self.transparent.forget_gpu();
        self.decals.forget_gpu();
        self.redraws.forget_gpu();
        self.decal_depth_bound = None;
        self.camera_frame = None;
        self.decal_frame_stale = true;
        self.meshes.forget();
        self.pipelines.forget();
        self.settings.materials_mut().mark_changed();
        self.settings.textures_mut().reset_gpu();
        self.settings.light_tables_mut().reset_gpu();
        self.settings.sky_maps_mut().reset_gpu();
        self.settings.probes_mut().reset_gpu();
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
