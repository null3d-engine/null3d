//! The WebAssembly entry point. The same source builds twice: the threaded build uses shared
//! memory and atomics, and the single-threaded build runs where the page is not cross-origin
//! isolated.
//!
//! The sketch thread (the sketch worker, or the page in single-threaded mode) owns the engine: the
//! scene, the instance batches, meshes, materials and the frame builder. TypeScript reads and
//! writes the engine's arrays through typed-array views at the addresses these functions return,
//! and appends structural changes to the command ring. Job workers only run the job system's
//! loop. The render worker calls nothing here; it reads the draw lists from memory.
//!
//! Functions that can fail return an error code (0 for success), or 0 in place of a handle or an
//! address; `lastErrorCode` and `lastErrorDetail` then describe the failure with the codes of the
//! engine's error table.

use std::cell::{Cell, UnsafeCell};
use std::sync::{Arc, OnceLock};

use null3d_core::animation::{
    AnimationError, Animations, Blend, Clip, MATRIX_FLOATS, MAX_BLEND, MAX_JOINTS, Play,
    REST_FLOATS, Skeleton, as_floats, resample, staged_tracks,
};
use null3d_core::bvh::mesh::{IndexedTriangles, MeshBvh};
use null3d_core::bvh::query::{QueryHit, QueryScene, SceneQueries};
use null3d_core::bvh::scene::Source;
use null3d_core::bvh::top::WorldRay;
use null3d_core::error::CoreError;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::{BackgroundTask, JobConfig, JobSystem, WorkerId};
use null3d_core::lights::LightTable;
use null3d_core::lines::{LineLook, LineMode};
use null3d_core::morph::MorphWeights;
use null3d_core::occlusion::BlockerMesh;
use null3d_core::scene::{CommandRing, SceneStorage};
use null3d_core::snapshot::FrameSnapshot;
use null3d_core::sprites::SpriteLook;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::sizes;
use null3d_gpu::drawlist::vertex::{self, Type};
use null3d_render::ao::Ao;
use null3d_render::arrays::{ArrayName, ArraysError, Data, MeshArrays, Values, from_arrays};
use null3d_render::bloom::{self, Blend as BloomBlend, Bloom};
use null3d_render::camera::{Lens, Orthographic, Perspective};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_lines::LineStore;
use null3d_render::debug_view::DebugView;
use null3d_render::environment::Environment;
use null3d_render::fog::Fog;
use null3d_render::frame::{CanvasOutput, FrameBuilder, FrameInput, RecordError, SceneSettings};
use null3d_render::geometry::{Geometry, OutOfMemory, Shape, generate};
use null3d_render::gpu_driven::{
    BYTES_PER_SOURCE, GpuDrivenRenderer, MAX_USEFUL_BINDING_BYTES, RendererConfig,
};
use null3d_render::grading::{Lut, Vignette};
use null3d_render::graph::RenderScale;
use null3d_render::materials::{self, CustomShading, MapSlot, MaterialError, Shading};
use null3d_render::meshes::MeshError;
use null3d_render::morph::{ARRAY_VALUES, MAX_DELTA_TEXELS, MorphError, MorphTargets};
use null3d_render::outline::Outline;
use null3d_render::output::{Antialias, Output, SceneColor, ToneMapping};
use null3d_render::pipelines::DepthBias;
use null3d_render::shadow_tiles::TileSettings;
use null3d_render::shadows::ShadowQuality;
use null3d_render::skinning;
use null3d_render::textures::{MAX_TEXTURES, Sampling, TextureDesc, TextureError};
use null3d_render::view::ViewId;
use wasm_bindgen::prelude::*;

pub mod constants;

use constants::{
    CLIP_PENDING, animation_field, animation_problem, arrays_problem, batch_field, camera_target,
    debug_line_field, mesh_arrays, morph_arrays, play_arg, play_flag, query, ring_field,
    scene_field, shading, texture_option, texture_stat,
};

/// The engine version, as the loader reports it.
#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// True in the build compiled with atomics and shared memory.
#[wasm_bindgen(js_name = isThreadedBuild)]
pub fn is_threaded_build() -> bool {
    cfg!(target_feature = "atomics")
}

#[wasm_bindgen]
extern "C" {
    /// The browser's clock, in milliseconds, on the thread that calls it.
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

/// Upload ranges one frame can list before it uploads everything instead.
const UPLOAD_RANGES: u32 = 4096;

/// Engine error codes for failures that do not come from the core.
mod codes {
    /// Arrays that make no mesh; the details give the problem (`constants::arrays_problem`).
    pub const BAD_ARRAYS: u32 = 1206;
    /// Animation data that makes no skeleton or clip; the details give the problem
    /// (`constants::animation_problem`). No public call raises it yet, so the TypeScript error
    /// table does not list it.
    pub const BAD_ANIMATION: u32 = 1218;
    /// A function that needs the engine ran before `initEngine`, or `initEngine` ran twice.
    pub const NOT_READY: u32 = 1403;
    /// A mesh, material or GPU buffer is full, or an id names nothing (details say which).
    pub const RENDER: u32 = 1501;
}

/// Details of `codes::RENDER` failures.
mod render_detail {
    /// The second detail is the most the draw list holds, in mebibytes.
    pub const DRAW_LIST_FULL: u32 = 1;
    pub const TOO_MANY_SOURCES: u32 = 3;
    pub const MATERIALS_FULL: u32 = 4;
    pub const UNKNOWN_MATERIAL: u32 = 5;
    pub const UNKNOWN_MESH: u32 = 6;
    pub const BAD_MESH: u32 = 7;
    pub const UPLOADS_FULL: u32 = 8;
    /// The second detail is the largest texture size the device allows.
    pub const TEXTURE_TOO_LARGE: u32 = 9;
    /// The second detail is the most textures that live at once.
    pub const TEXTURES_FULL: u32 = 10;
    pub const BAD_TEXTURE: u32 = 11;
    /// The second detail is the most bytes of skinned vertices that WebGPU skinning holds, in
    /// mebibytes.
    pub const SKINNED_VERTICES_FULL: u32 = 12;
    /// The second detail is the most mesh pages of skinned meshes that WebGPU skinning reads.
    pub const SKINNED_PAGES_FULL: u32 = 13;
}

struct Engine {
    scene: SceneStorage,
    ring: CommandRing,
    batches: BatchTable,
    lights: LightTable,
    snapshot: FrameSnapshot,
    renderer: Box<dyn FrameBuilder>,
    structure_changed: bool,
    /// True when the last recorded frame rebuilt its draw tables.
    rebuilt: bool,
    /// The words that TypeScript writes a mesh's arrays into, for `createMeshFromArrays`.
    staging: Vec<u32>,
    /// The numbers of the next play of a clip or a blend (`constants::play_arg`), which
    /// TypeScript writes.
    play_args: [f32; play_arg::COUNT],
    /// The debug lines of the next frame, which only development builds of the engine write.
    lines: LineStore,
    /// Skeletons, clips and animated instances, from the first `initAnimations` on.
    animations: Option<Animations>,
    /// The morph weights of morphed objects, which TypeScript writes.
    morphs: MorphWeights,
    /// The clips that job workers resample in the background, by `createClipLater` ticket, each
    /// with its skeleton's id.
    clip_jobs: Vec<Option<(u32, Arc<ClipJob>)>>,
    /// The trees and lists of raycasts and overlap queries, which allocate on the first query.
    queries: SceneQueries,
    /// A query's input (`constants::query`).
    query_input: [f64; query::INPUT_FLOATS as usize],
    /// The hit records that queries write, `query::HIT_FLOATS` numbers each.
    query_hits: Vec<f64>,
    /// The rays of a batch, `query::RAY_FLOATS` numbers each.
    query_rays: Vec<f64>,
    /// The world matrix that `worldMatrix` copies last, which TypeScript reads in place, so a read
    /// passes no array across and allocates nothing.
    world_matrix: [f64; 12],
    /// The post-processing values that TypeScript writes (`constants::post_value`), with three.js's
    /// defaults until it writes others.
    post_values: Box<[f32; constants::post_value::COUNT as usize]>,
    /// The environment's values that TypeScript writes (`constants::environment_value`).
    environment_values: Box<[f32; constants::environment_value::COUNT as usize]>,
}

/// The post-processing values before TypeScript writes any: an exposure of 1, bloom's intensity,
/// threshold and soft edge, a table at its full intensity over colors from 0 to 1,
/// `VignetteShader`'s offset and darkness, `GTAOPass`'s radius, thickness, distance exponent,
/// distance falloff, scale, samples and blend intensity, a white outline of 2 CSS pixels with no
/// line around hidden parts, then bloom's mixing blend and its levels' default shares.
const POST_DEFAULTS: [f32; constants::post_value::COUNT as usize] = {
    let mut values = [
        1.0, 0.15, 0.0, 0.1, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.25, 1.0, 1.0, 1.0, 1.0,
        16.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,
    ];
    let mut level = 0;
    while level < bloom::LEVELS {
        values[constants::post_value::BLOOM_WEIGHTS as usize + level] =
            bloom::DEFAULT_WEIGHTS[level];
        level += 1;
    }
    values
};

impl Engine {
    /// The post-processing value at `place` (`constants::post_value`).
    fn post_value(&self, place: u32) -> f32 {
        self.post_values[place as usize]
    }

    /// Three post-processing values from `place` on.
    fn post_values3(&self, place: u32) -> [f32; 3] {
        std::array::from_fn(|k| self.post_value(place + k as u32))
    }
}

impl Engine {
    /// The frame builder, and the frame's input for it. The frame's upload list and its lights are
    /// recorded once, by the frame's first step. `pipelines_built` is the newest frame that the
    /// thread that draws drew with every pipeline built.
    fn frame(
        &mut self,
        frame: u32,
        canvas: (u32, u32),
        render_scale: RenderScale,
        jobs: &'static JobSystem,
        pipelines_built: u32,
    ) -> (&mut dyn FrameBuilder, FrameInput<'_>) {
        if self.snapshot.frame() != frame {
            self.snapshot.record(frame, &self.scene, &self.batches);
            self.renderer.settings_mut().gather_lights(
                &mut self.lights,
                &self.scene,
                self.scene.parity(),
                canvas,
            );
        }
        let input = FrameInput {
            frame,
            scene: &self.scene,
            batches: &self.batches,
            snapshot: &self.snapshot,
            canvas,
            render_scale,
            structure_changed: self.structure_changed,
            jobs,
            lines: self.lines.lines(),
            lights: self.lights.visible(),
            shadow_lights: self.lights.shadows(),
            pipelines_built,
            animations: self.animations.as_ref(),
            morphs: &self.morphs,
        };
        (self.renderer.as_mut(), input)
    }
}

/// The engine, which only the sketch thread touches.
struct SketchCell(UnsafeCell<Option<Engine>>);

// SAFETY: every function that reaches the cell is documented for the sketch thread only, and
// TypeScript calls them only there; job workers reach only `JOBS`.
unsafe impl Sync for SketchCell {}

static ENGINE: SketchCell = SketchCell(UnsafeCell::new(None));
static JOBS: OnceLock<JobSystem> = OnceLock::new();

thread_local! {
    static LAST_ERROR: Cell<(u32, [u32; 2])> = const { Cell::new((0, [0, 0])) };
}

fn fail(code: u32, details: [u32; 2]) -> u32 {
    LAST_ERROR.with(|e| e.set((code, details)));
    code
}

fn core_failure(error: CoreError) -> u32 {
    fail(error.code(), error.details())
}

fn render_failure(detail: u32, value: u32) -> u32 {
    fail(codes::RENDER, [detail, value])
}

fn record_failure(error: RecordError) -> u32 {
    let (detail, value) = match error {
        RecordError::DrawListFull { megabytes } => (render_detail::DRAW_LIST_FULL, megabytes),
        RecordError::TooManySources { limit } => (render_detail::TOO_MANY_SOURCES, limit),
        RecordError::SkinnedVerticesFull { megabytes } => {
            (render_detail::SKINNED_VERTICES_FULL, megabytes)
        }
        RecordError::SkinnedPagesFull { limit } => (render_detail::SKINNED_PAGES_FULL, limit),
        RecordError::UploadsFull => (render_detail::UPLOADS_FULL, 0),
        RecordError::OutOfMemory { bytes } => {
            return core_failure(CoreError::OutOfMemory { bytes });
        }
        RecordError::Graph(error) => return fail(error.code(), error.details()),
    };
    render_failure(detail, value)
}

/// The failure of an allocation of `bytes` that the engine's memory could not hold: E1109.
fn out_of_memory(bytes: u64) -> u32 {
    core_failure(CoreError::OutOfMemory {
        bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
    })
}

fn arrays_failure(error: ArraysError) -> u32 {
    let (problem, value) = match error {
        ArraysError::OutOfMemory { bytes } => return out_of_memory(bytes),
        ArraysError::NoVertices => (arrays_problem::NO_VERTICES, 0),
        ArraysError::Length(array) => (arrays_problem::LENGTH, array as u32),
        ArraysError::Type(array) => (arrays_problem::TYPE, array as u32),
        ArraysError::NotTriangles => (arrays_problem::NOT_TRIANGLES, 0),
        ArraysError::Twice(array) => (arrays_problem::TWICE, array as u32),
        ArraysError::Missing(array) => (arrays_problem::MISSING, array as u32),
        ArraysError::IndexOutOfRange { at } => (arrays_problem::INDEX_OUT_OF_RANGE, at),
        ArraysError::NotFinite { array, at } => (arrays_problem::NOT_FINITE + array as u32, at),
    };
    fail(codes::BAD_ARRAYS, [problem, value])
}

fn texture_failure(error: TextureError) -> u32 {
    match error {
        TextureError::Core(error) => core_failure(error),
        TextureError::TooLarge { limit } => render_failure(render_detail::TEXTURE_TOO_LARGE, limit),
        TextureError::Full => render_failure(render_detail::TEXTURES_FULL, MAX_TEXTURES),
        TextureError::Unsupported => render_failure(render_detail::BAD_TEXTURE, 0),
    }
}

/// The handle of `texture`, a texture's handle or 0 for none, or the failure of a texture that is
/// not live.
fn texture_or_none(settings: &SceneSettings, texture: u32) -> Result<Handle, u32> {
    let handle = Handle::from_raw(texture);
    if !handle.is_none()
        && let Err(error) = settings.textures().bytes(handle)
    {
        return Err(texture_failure(error));
    }
    Ok(handle)
}

fn material_failure(error: MaterialError) -> u32 {
    match error {
        MaterialError::Full => render_failure(render_detail::MATERIALS_FULL, 0),
        MaterialError::Unknown(id) => render_failure(render_detail::UNKNOWN_MATERIAL, id),
        // The engine's own calls name only the values that sketches set.
        MaterialError::Value(_) => render_failure(render_detail::UNKNOWN_MATERIAL, 0),
    }
}

/// Runs `f` on the engine, or fails with `NOT_READY` before `initEngine`.
fn with_engine(f: impl FnOnce(&mut Engine) -> u32) -> u32 {
    // SAFETY: only the sketch thread calls this (see `SketchCell`), and no call nests another, so
    // this is the only reference to the engine while `f` runs.
    let engine = unsafe { (*ENGINE.0.get()).as_mut() };
    match engine {
        Some(engine) => f(engine),
        None => fail(codes::NOT_READY, [0, 0]),
    }
}

/// Like `with_engine`, for functions that return a handle, an id or an address: 0 on failure.
fn value_with_engine(f: impl FnOnce(&mut Engine) -> Result<u32, u32>) -> u32 {
    let mut value = 0;
    let status = with_engine(|engine| match f(engine) {
        Ok(v) => {
            value = v;
            0
        }
        Err(code) => code,
    });
    if status == 0 { value } else { 0 }
}

fn address<T>(slice: &[T]) -> u32 {
    slice.as_ptr() as usize as u32
}

/// The code of the last failure on this thread, from the engine's error table (1101 and up).
#[wasm_bindgen(js_name = lastErrorCode)]
pub fn last_error_code() -> u32 {
    LAST_ERROR.with(|e| e.get().0)
}

/// One of the last failure's two detail numbers; the error table says what each means.
#[wasm_bindgen(js_name = lastErrorDetail)]
pub fn last_error_detail(index: u32) -> u32 {
    LAST_ERROR.with(|e| e.get().1[(index & 1) as usize])
}

/// Creates the engine on the sketch thread, and the job system that `job_workers` job workers
/// serve, timing their work with the browser's clock. On WebGPU, `storage_binding_bytes` is the
/// largest storage binding of the device the engine draws with, and the capability flags say
/// whether it has transient attachments. On WebGL2 (`webgl2`), the capability flags say whether
/// the device has multi-draw, and `max_texture_size` is its largest texture. Scene passes draw
/// into a target of format `scene_color`: a float format for HDR color, or the canvas's for the
/// 8-bit path. `antialias` is the anti-aliasing mode's code; an unknown code takes MSAA.
/// `transparent` keeps the canvas clear where nothing draws. Without `cell_culling`, culling tests
/// every object, with no grid cells skipped first. With `depth_prepass`, each camera view draws its
/// opaque objects' depth before it shades them. With `vertex_skinning`, WebGPU skins in
/// the vertex shader of each pass, not in a compute pass. With `large_world`, each object's position
/// holds whole cells besides its 32-bit part, so positions keep their precision at any distance.
/// Every capacity is fixed from here on.
#[wasm_bindgen(js_name = initEngine)]
#[allow(clippy::too_many_arguments)]
pub fn init_engine(
    job_workers: u32,
    scene_capacity: u32,
    max_batches: u32,
    commands: u32,
    storage_binding_bytes: u32,
    webgl2: bool,
    capabilities: u32,
    max_texture_size: u32,
    scene_color: u32,
    antialias: u32,
    transparent: bool,
    cell_culling: bool,
    depth_prepass: bool,
    vertex_skinning: bool,
    large_world: bool,
) -> u32 {
    // SAFETY: as in `with_engine`; no other call on the sketch thread runs while this one does.
    let cell = unsafe { &mut *ENGINE.0.get() };
    if cell.is_some() {
        return fail(codes::NOT_READY, [1, 0]);
    }
    // An engine started again in the same instance, as the single-threaded build is, keeps the
    // job system of the one before when it has the same workers.
    let reusable = |jobs: &JobSystem| jobs.worker_count() == job_workers && !jobs.is_shut_down();
    let jobs_ready = match JOBS.get() {
        Some(jobs) => reusable(jobs),
        None => JOBS
            .set(JobSystem::with_config(JobConfig {
                workers: job_workers,
                clock: Some(performance_now),
                ..JobConfig::default()
            }))
            .is_ok(),
    };
    if !jobs_ready {
        return fail(codes::NOT_READY, [1, 0]);
    }
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(scene_color),
        antialias: Antialias::from_code(antialias).unwrap_or_default(),
        transparent,
    };
    let capabilities = Capabilities::from_bits(u64::from(capabilities));
    *cell = Some(Engine {
        scene: if large_world {
            SceneStorage::with_large_world(scene_capacity)
        } else {
            SceneStorage::with_capacity(scene_capacity)
        },
        ring: CommandRing::with_capacity(commands),
        batches: BatchTable::with_capacity(max_batches),
        lights: LightTable::new(),
        snapshot: FrameSnapshot::with_capacity(UPLOAD_RANGES),
        renderer: if webgl2 {
            Box::new(CpuCulledRenderer::new(CpuCulledConfig {
                canvas,
                multi_draw: capabilities.contains(Capabilities::MULTI_DRAW),
                max_texture_size: max_texture_size.max(CpuCulledConfig::default().max_texture_size),
                cell_culling,
                depth_prepass,
                ..CpuCulledConfig::default()
            }))
        } else {
            Box::new(GpuDrivenRenderer::new(RendererConfig {
                canvas,
                transient_attachments: capabilities.contains(Capabilities::TRANSIENT_ATTACHMENTS),
                storage_binding_bytes: storage_binding_bytes.clamp(
                    sizes::PORTABLE_STORAGE_BINDING_BYTES,
                    MAX_USEFUL_BINDING_BYTES,
                ),
                cell_culling,
                depth_prepass,
                vertex_skinning,
                ..RendererConfig::default()
            }))
        },
        structure_changed: true,
        rebuilt: false,
        world_matrix: [0.0; 12],
        staging: Vec::new(),
        play_args: [0.0; play_arg::COUNT],
        lines: LineStore::default(),
        animations: None,
        morphs: MorphWeights::new(),
        clip_jobs: Vec::new(),
        queries: SceneQueries::new(),
        query_input: [0.0; query::INPUT_FLOATS as usize],
        query_hits: vec![0.0; query::HIT_FLOATS as usize],
        query_rays: Vec::new(),
        post_values: Box::new(POST_DEFAULTS),
        environment_values: Box::new([0.0; constants::environment_value::COUNT as usize]),
    });
    0
}

/// The address of the environment's values (`constants::environment_value`), which TypeScript
/// writes before it calls `setEnvironment`.
#[wasm_bindgen(js_name = environmentValues)]
pub fn environment_values() -> u32 {
    value_with_engine(|e| Ok(address(&e.environment_values[..])))
}

/// The address of the post-processing values (`constants::post_value`), which TypeScript writes
/// before it calls `setOutput`, `setBloom`, `setLut`, `setVignette` or `setOutline`.
#[wasm_bindgen(js_name = postValues)]
pub fn post_values() -> u32 {
    value_with_engine(|e| Ok(address(&e.post_values[..])))
}

// The page calls this when it stops an engine that runs on the page's own thread, as the
// single-threaded build does, because the page keeps that build's instance for the next engine.
// Its doc comment stays short: wasm-bindgen copies it into the glue that every page downloads.
/// Drops the engine, so that `initEngine` can create another.
#[wasm_bindgen(js_name = destroyEngine)]
pub fn destroy_engine() {
    // SAFETY: as in `with_engine`; the sketch thread calls it after the engine's last step.
    unsafe { *ENGINE.0.get() = None };
}

/// Serves the job system on a job worker until the page sets its stop flag. It first waits for
/// the sketch thread to create the job system.
#[wasm_bindgen(js_name = jobWorkerLoop)]
pub fn job_worker_loop(index: u32) {
    JOBS.wait().worker_loop(index);
}

/// Counts the frame chunk that job worker `index` held when its loop failed as done and as
/// failed, so the sketch thread's wait for it ends. The worker's own thread calls it after the
/// failure.
#[wasm_bindgen(js_name = jobWorkerFailed)]
pub fn job_worker_failed(index: u32) {
    if let Some(jobs) = JOBS.get() {
        jobs.worker_failed(index);
    }
}

/// The milliseconds job worker `index` spent on work since the last call for it, which starts
/// its total again from zero. The sketch thread reads it once per frame.
#[wasm_bindgen(js_name = takeJobBusyMs)]
pub fn take_job_busy_ms(index: u32) -> f64 {
    JOBS.get().map_or(0.0, |jobs| jobs.take_busy_ms(index))
}

/// The address of the job system's wake word, or 0 before it exists.
#[wasm_bindgen(js_name = jobsWakeAddress)]
pub fn jobs_wake_address() -> u32 {
    JOBS.get()
        .map_or(0, |jobs| jobs.stop_words().0.as_ptr() as usize as u32)
}

/// The address of the job system's stop flag, a byte, or 0 before it exists.
#[wasm_bindgen(js_name = jobsStopAddress)]
pub fn jobs_stop_address() -> u32 {
    JOBS.get()
        .map_or(0, |jobs| jobs.stop_words().1.as_ptr() as usize as u32)
}

// --- Scene objects ---

/// The number of object slots; arrays have one more row, because slot 0 is never used.
#[wasm_bindgen(js_name = sceneCapacity)]
pub fn scene_capacity() -> u32 {
    value_with_engine(|e| Ok(e.scene.capacity()))
}

/// The address of one of the per-slot arrays TypeScript writes (see `constants::scene_field`):
/// positions (3 floats), rotations (4), scales (3), local bounding radii (1), local bounding
/// sphere centres (3), the whole cells of each position (3 integers, or 0 without large-world
/// mode), or the dirty bitset's words, which TypeScript views as 32-bit words.
#[wasm_bindgen(js_name = sceneArrays)]
pub fn scene_arrays(field: u32) -> u32 {
    value_with_engine(|e| {
        Ok(match field {
            scene_field::POSITIONS => address(e.scene.positions()),
            scene_field::ROTATIONS => address(e.scene.rotations()),
            scene_field::SCALES => address(e.scene.scales()),
            scene_field::LOCAL_RADII => address(e.scene.local_radii()),
            scene_field::LOCAL_CENTERS => address(e.scene.local_centers()),
            scene_field::POSITION_CELLS if e.scene.is_large_world() => {
                address(e.scene.position_cells())
            }
            scene_field::POSITION_CELLS => 0,
            _ => address(e.scene.dirty().words()),
        })
    })
}

/// Reserves an object slot and returns its handle; TypeScript writes the object's transform, then
/// a create command.
#[wasm_bindgen(js_name = reserveObject)]
pub fn reserve_object() -> u32 {
    value_with_engine(|e| e.scene.reserve().map(Handle::raw).map_err(core_failure))
}

/// Reserves `count` object slots at once, or none when too few are free, and returns the address
/// of their handles in the staging words. TypeScript writes the objects' transforms, then their
/// create commands, as after `reserveObject`.
#[wasm_bindgen(js_name = reserveObjects)]
pub fn reserve_objects(count: u32) -> u32 {
    value_with_engine(|e| {
        let at = reserve_staging(e, count)?;
        e.scene.reserve_many(&mut e.staging).map_err(core_failure)?;
        Ok(at)
    })
}

/// Copies an object's world matrix of the current frame into the engine's matrix words (see
/// `worldMatrixAddress`): 12 numbers, rows of a 3 × 4 matrix, with its translation from the origin
/// in 64-bit floats.
#[wasm_bindgen(js_name = worldMatrix)]
pub fn world_matrix(handle: u32) -> u32 {
    with_engine(
        |e| match e.scene.absolute_world_matrix(Handle::from_raw(handle)) {
            Ok(matrix) => {
                e.world_matrix = matrix;
                0
            }
            Err(error) => core_failure(error),
        },
    )
}

/// The address of the 12 64-bit floats that `worldMatrix` writes.
#[wasm_bindgen(js_name = worldMatrixAddress)]
pub fn world_matrix_address() -> u32 {
    value_with_engine(|e| Ok(address(&e.world_matrix)))
}

/// The command ring (see `constants::ring_field`): the record array's address, its capacity in
/// records, or the address of the write index TypeScript advances or of the read index the core
/// advances.
#[wasm_bindgen(js_name = commandRing)]
pub fn command_ring(field: u32) -> u32 {
    value_with_engine(|e| {
        Ok(match field {
            ring_field::RECORDS => address(e.ring.records()),
            ring_field::CAPACITY => e.ring.capacity(),
            ring_field::WRITE_INDEX => e.ring.write_index().as_ptr() as usize as u32,
            _ => e.ring.read_index().as_ptr() as usize as u32,
        })
    })
}

// --- The frame ---

/// Starts a frame and applies every pending command. Frames count from 1. The sketch time in
/// milliseconds and the step since the frame before in microseconds come as whole numbers, which
/// cross into WebAssembly without a new number object each frame; shaders read them as seconds.
#[wasm_bindgen(js_name = beginFrame)]
pub fn begin_frame(frame: u32, time_ms: u32, step_us: u32) -> u32 {
    with_engine(|e| {
        let time = time_ms as f32 / 1000.0;
        let step = step_us as f32 / 1_000_000.0;
        e.renderer.settings_mut().set_clock(time, step, frame);
        let applied = e.scene.apply_ring(&e.ring, frame);
        e.structure_changed |= e.scene.take_structure_changed();
        match applied {
            Ok(()) => 0,
            Err(failure) => {
                e.structure_changed = true;
                core_failure(failure.error)
            }
        }
    })
}

/// Wakes the job workers ahead of the frame's engine work when the previous frame gave them work,
/// so they are ready when this frame's parallel work comes.
#[wasm_bindgen(js_name = prepareJobs)]
pub fn prepare_jobs() {
    if let Some(jobs) = JOBS.get() {
        jobs.prepare_frame();
    }
}

/// Updates world matrices and bounding spheres of scene objects, in parallel on the job workers.
#[wasm_bindgen(js_name = updateTransforms)]
pub fn update_transforms() -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        e.scene.update_transforms(jobs);
        0
    })
}

/// Updates the world matrices and bounding spheres of the objects that the sketch moved after
/// `updateTransforms`, and of the objects below them. Call it before `cullFrame`.
#[wasm_bindgen(js_name = updateLateTransforms)]
pub fn update_late_transforms() -> u32 {
    with_engine(|e| {
        e.scene.update_late_transforms();
        0
    })
}

/// The times that an object or an instance row entered a new grid cell while every cell was in
/// use, so that it went into the origin's cell instead.
#[wasm_bindgen(js_name = cellsRefused)]
pub fn cells_refused() -> u32 {
    value_with_engine(|e| Ok(e.scene.cell_table().refused()))
}

/// Updates the rows of every instance batch that need it.
#[wasm_bindgen(js_name = updateBatches)]
pub fn update_batches(frame: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        e.batches.update(jobs, frame, e.scene.cell_table_mut());
        0
    })
}

/// Finds the frame's visible objects on the job workers, where the frame builder culls on the CPU,
/// for a canvas of this size in device pixels. Call it before `recordFrame`, with the same `built`:
/// the newest frame that the thread that draws drew with every pipeline built.
#[wasm_bindgen(js_name = cullFrame)]
pub fn cull_frame(frame: u32, width: u32, height: u32, built: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        let (renderer, input) = e.frame(frame, (width, height), RenderScale::FULL, jobs, built);
        match renderer.cull(&input) {
            Ok(()) => 0,
            Err(error) => record_failure(error),
        }
    })
}

// The frame draws the debug lines that `drawDebugLines` gave it, and then forgets them. `built` is
// the newest frame that the thread that draws drew with every pipeline built: shadow tiles drawn
// while a pipeline may still build draw again in the next frame.
/// Records the frame's upload list and its draw list for a canvas of this size in device pixels.
/// The scene draws at a render scale of `scale` thousandths of the canvas's width and height, from
/// 1 to 1000.
#[wasm_bindgen(js_name = recordFrame)]
pub fn record_frame(frame: u32, width: u32, height: u32, scale: u32, built: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        let scale = RenderScale::from_thousandths(scale);
        let (renderer, input) = e.frame(frame, (width, height), scale, jobs, built);
        let recorded = renderer.record(&input);
        e.lines.clear();
        match recorded {
            Ok(rebuilt) => {
                e.structure_changed = false;
                e.rebuilt = rebuilt;
                0
            }
            Err(error) => record_failure(error),
        }
    })
}

/// The index list entries that a recorded frame draws, where the frame builder culls on the CPU,
/// or `NOT_COUNTED` where the GPU culls.
#[wasm_bindgen(js_name = visibleEntries)]
pub fn visible_entries(frame: u32) -> u32 {
    value_with_engine(|e| {
        Ok(e.renderer
            .visible_entries(frame)
            .unwrap_or(constants::NOT_COUNTED))
    })
}

/// The sources inside the camera's frustum that software occlusion culling hid in a recorded
/// frame, where the frame builder culls on the CPU, or `NOT_COUNTED` where the GPU culls.
#[wasm_bindgen(js_name = occludedEntries)]
pub fn occluded_entries(frame: u32) -> u32 {
    value_with_engine(|e| {
        Ok(e.renderer
            .occluded_entries(frame)
            .unwrap_or(constants::NOT_COUNTED))
    })
}

/// True when the last recorded frame rebuilt its draw tables after a structure change.
#[wasm_bindgen(js_name = drawTablesRebuilt)]
pub fn draw_tables_rebuilt() -> bool {
    let mut rebuilt = false;
    with_engine(|e| {
        rebuilt = e.rebuilt;
        0
    });
    rebuilt
}

/// Makes the next recorded frame create every GPU object again and upload the whole scene, after
/// the thread that draws replaced a GPU device the browser took away.
#[wasm_bindgen(js_name = resetGpu)]
pub fn reset_gpu() -> u32 {
    with_engine(|e| {
        e.renderer.reset_gpu();
        0
    })
}

/// The address of the draw list of a frame parity. It moves when a frame needs more room than any
/// before, so the thread that draws reads it with each frame.
#[wasm_bindgen(js_name = drawListAddress)]
pub fn draw_list_address(parity: u32) -> u32 {
    value_with_engine(|e| Ok(address(e.renderer.list(parity).words())))
}

/// The number of 32-bit words recorded for a frame.
#[wasm_bindgen(js_name = drawListWords)]
pub fn draw_list_words(frame: u32) -> u32 {
    value_with_engine(|e| Ok(e.renderer.list(frame).len() as u32))
}

// --- Debug lines, which only development builds of the engine draw ---
//
// TypeScript writes each frame's points into the arrays whose addresses `debugLineArrays` gives,
// after `reserveDebugLines` makes room for them, and `drawDebugLines` has the next recorded frame
// draw them. Making room keeps the points written since the last recorded frame, but can move
// the arrays, so TypeScript then reads their addresses again. The arrays hold each point's
// position, three 64-bit floats, and its sRGB color, one 32-bit word (`constants::debug_line_field`).
// The doc comments stay short: wasm-bindgen copies them into the glue that every page downloads.

/// Makes room for debug line points.
#[wasm_bindgen(js_name = reserveDebugLines)]
pub fn reserve_debug_lines(points: u32) -> u32 {
    with_engine(|e| match e.lines.reserve(points) {
        Ok(()) => 0,
        Err(_) => core_failure(CoreError::OutOfMemory {
            bytes: points.saturating_mul(28),
        }),
    })
}

/// The address of a debug line array.
#[wasm_bindgen(js_name = debugLineArrays)]
pub fn debug_line_arrays(field: u32) -> u32 {
    value_with_engine(|e| {
        Ok(match field {
            debug_line_field::POSITIONS => address(e.lines.positions()),
            _ => address(e.lines.colors()),
        })
    })
}

// Fails when the arrays have room for fewer points.
/// Draws debug line points in the next frame.
#[wasm_bindgen(js_name = drawDebugLines)]
pub fn draw_debug_lines(points: u32) -> u32 {
    with_engine(|e| {
        if e.lines.set_points(points) {
            0
        } else {
            core_failure(CoreError::OutOfRange {
                value: points,
                limit: e.lines.capacity(),
            })
        }
    })
}

// --- Instance batches ---

/// Creates an instance batch of one mesh and one material, and returns its id.
#[wasm_bindgen(js_name = createBatch)]
pub fn create_batch(capacity: u32, dynamic: bool, colors: bool, mesh: u32, material: u32) -> u32 {
    value_with_engine(|e| {
        add_batch(e, capacity, mesh, |batches, radius| {
            batches.create(capacity, dynamic, colors, mesh, material, radius)
        })
    })
}

/// Creates one part of a model as an instance batch, and returns its id: a mesh and a material,
/// placed in the space of each row by `part`, 12 numbers of a 3 × 4 matrix by rows. With a
/// `source` batch other than 0, the part reads that batch's rows, and takes its capacity, its
/// dynamic flag and its colors; without one, it owns `capacity` rows.
#[wasm_bindgen(js_name = createBatchPart)]
#[allow(clippy::too_many_arguments)]
pub fn create_batch_part(
    source: u32,
    capacity: u32,
    dynamic: bool,
    colors: bool,
    mesh: u32,
    material: u32,
    part: &[f32],
) -> u32 {
    value_with_engine(|e| {
        let source = (source != 0).then(|| Handle::from_raw(source));
        let capacity = match source {
            Some(id) => e.batches.get(id).map_err(core_failure)?.capacity(),
            None => capacity,
        };
        let mut matrix = null3d_core::math::IDENTITY;
        let n = part.len().min(matrix.len());
        matrix[..n].copy_from_slice(&part[..n]);
        add_batch(e, capacity, mesh, |batches, radius| {
            batches.create_part(
                source, capacity, dynamic, colors, mesh, material, radius, matrix,
            )
        })
    })
}

/// Creates a sprite batch: `capacity` sprites drawn with `mesh`, a quad around their anchor, and
/// `material`, a sprite material. Frames come from an atlas of `columns` by `rows`, and with
/// `screen_size` the sizes are in CSS pixels of the screen rather than in world units. Returns
/// its id.
#[wasm_bindgen(js_name = createSpriteBatch)]
pub fn create_sprite_batch(
    capacity: u32,
    dynamic: bool,
    mesh: u32,
    material: u32,
    columns: u32,
    rows: u32,
    screen_size: bool,
) -> u32 {
    let look = SpriteLook::new(columns, rows, screen_size);
    value_with_engine(|e| {
        add_batch(e, capacity, mesh, |batches, radius| {
            batches.create_sprites(capacity, dynamic, mesh, material, radius, look)
        })
    })
}

/// Creates a line batch: `points` points joined as `mode` says (a `LineMode` code), each segment
/// drawn with `mesh`, the segment mesh, and `material`, a line material. The segments are `width`
/// CSS pixels wide, or `width` world units with `world_units`, and dashed with `dashed`. Returns
/// its id.
#[wasm_bindgen(js_name = createLineBatch)]
#[allow(clippy::too_many_arguments)]
pub fn create_line_batch(
    points: u32,
    dynamic: bool,
    mesh: u32,
    material: u32,
    mode: u32,
    width: f32,
    world_units: bool,
    dashed: bool,
) -> u32 {
    value_with_engine(|e| {
        let mode = LineMode::from_code(mode).ok_or_else(|| {
            core_failure(CoreError::OutOfRange {
                value: mode,
                limit: LineMode::Loop as u32,
            })
        })?;
        let look = LineLook::new(mode, width, world_units, dashed);
        add_batch(e, mode.rows(points), mesh, |batches, radius| {
            batches.create_lines(points, dynamic, mesh, material, radius, look)
        })
    })
}

/// Sets the width of a line batch's segments: CSS pixels, or world units for a batch made with
/// world units. Every segment updates and uploads again.
#[wasm_bindgen(js_name = setLineWidth)]
pub fn set_line_width(batch: u32, width: f32) -> u32 {
    with_engine(|e| match e.batches.get_mut(Handle::from_raw(batch)) {
        Ok(batch) => {
            batch.set_line_width(width);
            0
        }
        Err(error) => core_failure(error),
    })
}

/// Adds a batch of `capacity` rows of `mesh`, made by `make` with the mesh's radius, once the
/// renderer has room for its rows, and returns its id.
fn add_batch(
    e: &mut Engine,
    capacity: u32,
    mesh: u32,
    make: impl FnOnce(&mut BatchTable, f32) -> Result<Handle, CoreError>,
) -> Result<u32, u32> {
    let Some(slot) = mesh
        .checked_sub(1)
        .and_then(|id| e.renderer.settings().meshes().mesh(id))
    else {
        return Err(render_failure(render_detail::UNKNOWN_MESH, mesh));
    };
    let radius = slot.radius;
    // Refused here, at the call that makes the scene too large to draw, before the core
    // allocates the batch's rows.
    let sources = e
        .batches
        .iter()
        .fold(e.scene.capacity() + 1, |sum, (_, batch)| {
            sum.saturating_add(batch.capacity())
        })
        .saturating_add(capacity);
    let limit = e.renderer.max_sources();
    if sources > limit {
        return Err(record_failure(RecordError::TooManySources { limit }));
    }
    // The renderer's own room for the new rows comes first, so no later frame runs out of
    // memory while it records.
    e.renderer.reserve_sources(sources).map_err(|_| {
        core_failure(CoreError::OutOfMemory {
            bytes: capacity.saturating_mul(BYTES_PER_SOURCE),
        })
    })?;
    let id = make(&mut e.batches, radius).map_err(core_failure)?;
    e.structure_changed = true;
    Ok(id.raw())
}

#[wasm_bindgen(js_name = destroyBatch)]
pub fn destroy_batch(batch: u32, frame: u32) -> u32 {
    with_engine(|e| {
        match e
            .batches
            .destroy(Handle::from_raw(batch), frame, e.scene.cell_table_mut())
        {
            Ok(()) => {
                e.structure_changed = true;
                0
            }
            Err(error) => core_failure(error),
        }
    })
}

/// The address of one of a batch's row arrays (see `constants::batch_field`): positions (3 floats
/// a row), rotations (4), scales (3), or colors (4, or 0 for a batch without colors). A sprite
/// batch has positions, sizes (2 floats a row), rotations in radians (1), colors (4) and frames
/// (one 32-bit integer a row), and 0 for scales. A line batch has positions (3 floats a point) and
/// colors (3 floats a point), and 0 for the others.
#[wasm_bindgen(js_name = batchArrays)]
pub fn batch_arrays(batch: u32, field: u32) -> u32 {
    value_with_engine(|e| {
        let batch = e
            .batches
            .get(Handle::from_raw(batch))
            .map_err(core_failure)?;
        if batch.sprite_look().is_some() {
            let (sizes, rotations, colors, frames) = batch.sprite_rows();
            return Ok(match field {
                batch_field::POSITIONS => address(batch.positions()),
                batch_field::ROTATIONS => address(rotations),
                batch_field::SIZES => address(sizes),
                batch_field::COLORS => address(colors),
                batch_field::FRAMES => address(frames),
                _ => 0,
            });
        }
        if batch.line_look().is_some() {
            let (points, colors) = batch.line_points();
            return Ok(match field {
                batch_field::POSITIONS => address(points),
                batch_field::COLORS => address(colors),
                _ => 0,
            });
        }
        Ok(match field {
            batch_field::POSITIONS => address(batch.positions()),
            batch_field::ROTATIONS => address(batch.rotations()),
            batch_field::SCALES => address(batch.scales()),
            batch_field::COLORS if batch.has_colors() => address(batch.colors()),
            _ => 0,
        })
    })
}

/// Draws only the first `count` rows, or for a line batch, the segments of its first `count`
/// points.
#[wasm_bindgen(js_name = setBatchActiveCount)]
pub fn set_batch_active_count(batch: u32, count: u32) -> u32 {
    with_engine(|e| match e.batches.get_mut(Handle::from_raw(batch)) {
        // A new active count changes which rows draw, not the scene's structure: the renderer
        // updates those rows' draw membership without rebuilding its tables.
        Ok(batch) => match batch.set_active_points(count) {
            Ok(()) => 0,
            Err(error) => core_failure(error),
        },
        Err(error) => core_failure(error),
    })
}

/// Sets the layer mask of every row of a batch. Like a new active count, a new mask needs no
/// rebuild of the renderer's tables.
#[wasm_bindgen(js_name = setBatchLayers)]
pub fn set_batch_layers(batch: u32, mask: u32) -> u32 {
    with_engine(|e| match e.batches.get_mut(Handle::from_raw(batch)) {
        Ok(batch) => {
            batch.set_layers(mask);
            0
        }
        Err(error) => core_failure(error),
    })
}

/// Places a batch's origin, which its rows' positions are relative to, in 64-bit floats, and marks
/// every row for update.
#[wasm_bindgen(js_name = setBatchOrigin)]
pub fn set_batch_origin(batch: u32, x: f64, y: f64, z: f64) -> u32 {
    with_engine(|e| match e.batches.get_mut(Handle::from_raw(batch)) {
        Ok(batch) => {
            batch.set_origin([x, y, z]);
            0
        }
        Err(error) => core_failure(error),
    })
}

/// Marks rows of a static batch for update and upload, or for a line batch, points whose segments
/// update.
#[wasm_bindgen(js_name = markBatchDirty)]
pub fn mark_batch_dirty(batch: u32, start: u32, count: u32) -> u32 {
    with_engine(|e| {
        match e
            .batches
            .get_mut(Handle::from_raw(batch))
            .and_then(|b| b.mark_points_dirty(start, count))
        {
            Ok(()) => 0,
            Err(error) => core_failure(error),
        }
    })
}

/// The address of the memory epoch, which grows by one each time WebAssembly memory grows, so
/// TypeScript knows to rebuild its views.
#[wasm_bindgen(js_name = memoryEpoch)]
pub fn memory_epoch() -> u32 {
    value_with_engine(|e| Ok(e.batches.memory_epoch_word().as_ptr() as usize as u32))
}

// --- Meshes and materials ---

fn add_mesh(e: &mut Engine, geometry: &Geometry) -> Result<u32, u32> {
    let id = e
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(geometry)
        .map_err(|error| match error {
            MeshError::OutOfMemory { bytes } => out_of_memory(bytes),
            _ => render_failure(render_detail::BAD_MESH, 0),
        })?;
    Ok(id + 1)
}

/// A mesh from a geometry generator: `shape` is a `Shape` code, and the numbers after it are the
/// arguments of the three.js class's constructor, in their order. Returns the mesh id.
#[wasm_bindgen(js_name = createShapeMesh)]
#[allow(clippy::too_many_arguments)]
pub fn create_shape_mesh(
    shape: u32,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
    g: f64,
    h: f64,
) -> u32 {
    value_with_engine(|engine| {
        let kind = Shape::from_code(shape)
            .ok_or_else(|| core_failure(CoreError::UnknownCommand { op: shape }))?;
        let geometry =
            generate(kind, [a, b, c, d, e, f, g, h]).map_err(|OutOfMemory { bytes }| {
                core_failure(CoreError::OutOfMemory {
                    bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
                })
            })?;
        add_mesh(engine, &geometry)
    })
}

/// Makes room for `words` 32-bit staging words, which TypeScript then writes, and returns their
/// address.
fn reserve_staging(e: &mut Engine, words: u32) -> Result<u32, u32> {
    e.staging.clear();
    e.staging
        .try_reserve_exact(words.max(1) as usize)
        .map_err(|_| {
            core_failure(CoreError::OutOfMemory {
                bytes: words.saturating_mul(4),
            })
        })?;
    e.staging.resize(words as usize, 0);
    Ok(address(e.staging.as_slice()))
}

/// Makes room for `words` 32-bit words of a mesh's arrays, which TypeScript then writes, and
/// returns their address. `createMeshFromArrays` reads them, and frees them.
#[wasm_bindgen(js_name = meshArrays)]
pub fn mesh_arrays(words: u32) -> u32 {
    value_with_engine(|e| reserve_staging(e, words))
}

/// A mesh from the arrays in the staging words, as `layout` (`constants::mesh_arrays` bits)
/// describes them, for `vertices` vertices and `indices` indices. `types` gives each array's type
/// in its attribute's type field of a vertex format. Normals and tangents that `layout` asks for
/// are computed on the job workers. With `targets` morph targets, the arrays that `morph`
/// (`constants::morph_arrays` bits) names follow the indices. Returns the mesh id.
#[wasm_bindgen(js_name = createMeshFromArrays)]
pub fn create_mesh_from_arrays(
    vertices: u32,
    indices: u32,
    layout: u32,
    types: u32,
    targets: u32,
    morph: u32,
) -> u32 {
    value_with_engine(|e| {
        let jobs = JOBS.get().ok_or_else(|| fail(codes::NOT_READY, [0, 0]))?;
        let staging = std::mem::take(&mut e.staging);
        let bits = [
            morph_arrays::POSITIONS,
            morph_arrays::NORMALS,
            morph_arrays::TANGENTS,
            morph_arrays::COLORS,
        ];
        let per_vertex = (targets as usize).saturating_mul(vertices as usize);
        let words_of = |k: usize| per_vertex.saturating_mul(ARRAY_VALUES[k]);
        let morph_words = (0..bits.len())
            .filter(|&k| morph & bits[k] != 0)
            .fold(0usize, |sum, k| sum.saturating_add(words_of(k)));
        let base = staging.len().checked_sub(morph_words);
        let short = || arrays_failure(ArraysError::Length(ArrayName::Positions));
        let geometry = {
            let words = &staging[..base.ok_or_else(short)?];
            let arrays = staged_arrays(words, vertices as usize, indices as usize, layout, types)
                .ok_or_else(short)?;
            from_arrays(&arrays, jobs).map_err(arrays_failure)?
        };
        let mut at = base.unwrap_or(0);
        let mut array = |k: usize| {
            (morph & bits[k] != 0).then(|| {
                let words = &staging[at..at + words_of(k)];
                at += words.len();
                // SAFETY: the words are initialized and aligned, and every bit pattern is a float.
                unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<f32>(), words.len()) }
            })
        };
        let targets = MorphTargets {
            targets,
            positions: array(0),
            normals: array(1),
            tangents: array(2),
            colors: array(3),
        };
        let added = if morph == 0 {
            add_mesh(e, &geometry)
        } else {
            let meshes = e.renderer.settings_mut().meshes_mut();
            meshes
                .add_morphed(&geometry, &targets)
                .map(|id| id + 1)
                .map_err(mesh_failure)
        };
        drop(staging);
        added
    })
}

/// The failure of a mesh that the storage refused.
fn mesh_failure(error: MeshError) -> u32 {
    let morph = |problem: u32, value: u32| fail(codes::BAD_ARRAYS, [problem, value]);
    match error {
        MeshError::Morph(MorphError::TooLarge) => {
            morph(arrays_problem::MORPH_TOO_LARGE, MAX_DELTA_TEXELS)
        }
        MeshError::Morph(MorphError::Length) => morph(arrays_problem::MORPH_LENGTH, 0),
        MeshError::Morph(MorphError::NotFinite { array, at }) => {
            morph(arrays_problem::MORPH_NOT_FINITE, at | array << 28)
        }
        _ => render_failure(render_detail::BAD_MESH, 0),
    }
}

// --- Morph weights ---
//
// Each morphed object owns a block of the morph weight table, which TypeScript writes in place at
// the address that `morphWeightsAddress` gives. The table never moves once it exists.

/// Makes a block of `count` morph weights, all 0, and returns its id plus one.
#[wasm_bindgen(js_name = createMorphWeights)]
pub fn create_morph_weights(count: u32) -> u32 {
    value_with_engine(|e| {
        e.morphs
            .create(count)
            .map(|id| id + 1)
            .map_err(core_failure)
    })
}

/// Frees block `id` of the morph weight table.
#[wasm_bindgen(js_name = destroyMorphWeights)]
pub fn destroy_morph_weights(id: u32) -> u32 {
    with_engine(|e| e.morphs.destroy(id).map_or_else(core_failure, |()| 0))
}

/// Links block `id` of the morph weight table to the animated instance with id `instance` minus
/// one, whose skeleton's joints from `joint` on animate its weights, or with 0, unlinks it.
#[wasm_bindgen(js_name = linkMorphWeights)]
pub fn link_morph_weights(id: u32, instance: u32, joint: u32) -> u32 {
    with_engine(|e| {
        let link = instance.checked_sub(1).map(|instance| (instance, joint));
        e.morphs.link(id, link).map_or_else(core_failure, |()| 0)
    })
}

/// The address of the morph weight table, or 0 before its first block.
#[wasm_bindgen(js_name = morphWeightsAddress)]
pub fn morph_weights_address() -> u32 {
    value_with_engine(|e| {
        Ok(match e.morphs.values() {
            [] => 0,
            values => address(values),
        })
    })
}

/// The first weight of block `id` in the morph weight table.
#[wasm_bindgen(js_name = morphWeightsFirst)]
pub fn morph_weights_first(id: u32) -> u32 {
    value_with_engine(|e| match e.morphs.block(id) {
        Some(block) => Ok(block.first),
        None => Err(core_failure(CoreError::OutOfRange {
            value: id,
            limit: 0,
        })),
    })
}

/// The most morph weights of each object that vertex shaders that morph keep, the largest, from
/// the next frame on.
#[wasm_bindgen(js_name = setMorphTargets)]
pub fn set_morph_targets(cap: u32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_morph_cap(cap);
        0
    })
}

/// Gives mesh `mesh` the tree over its triangles that a model file stores, in the format of
/// `MeshBvh::to_bytes`, from the first `bytes` bytes of the staging words. Raycasts then use it
/// instead of building one. Returns 1 when the mesh takes the tree, and 0 when the tree does not
/// fit the mesh's triangles, which then get a tree of their own on the first query.
#[wasm_bindgen(js_name = setMeshBvh)]
pub fn set_mesh_bvh(mesh: u32, bytes: u32) -> u32 {
    value_with_engine(|e| {
        let staging = std::mem::take(&mut e.staging);
        let data: &[u8] = bytemuck_bytes(&staging);
        let tree = data.get(..bytes as usize).and_then(|data| {
            let triangles = e
                .renderer
                .settings()
                .meshes()
                .triangles(mesh.checked_sub(1)?)?;
            MeshBvh::from_bytes(data, &triangles).ok()
        });
        drop(staging);
        match tree {
            Some(tree) => e
                .queries
                .store_mesh_bvh(mesh, tree)
                .map(|()| 1)
                .map_err(core_failure),
            None => Ok(0),
        }
    })
}

/// Gives mesh `mesh` a blocker of its own for software occlusion culling: `vertices` corners of
/// three floats, then `indices` indices, three per triangle, in the staging words. Objects with
/// the mesh draw it in place of the mesh. Returns 1 when the mesh takes it, and 0 when it holds
/// no triangle, too many, or a corner that is not a number.
#[wasm_bindgen(js_name = setMeshBlocker)]
pub fn set_mesh_blocker(mesh: u32, vertices: u32, indices: u32) -> u32 {
    value_with_engine(|e| {
        let staging = std::mem::take(&mut e.staging);
        let (v, i) = (vertices as usize * 3, indices as usize);
        let blocker = (staging.len() >= v + i && i % 3 == 0)
            .then(|| {
                let positions: Vec<f32> = staging[..v].iter().map(|&w| f32::from_bits(w)).collect();
                BlockerMesh::build(&IndexedTriangles {
                    positions: &positions,
                    indices: &staging[v..v + i],
                })
            })
            .flatten();
        drop(staging);
        match blocker {
            Some(blocker) => e
                .renderer
                .set_mesh_blocker(mesh, blocker)
                .map(|()| 1)
                .map_err(|_| core_failure(CoreError::OutOfMemory { bytes: indices * 4 })),
            None => Ok(0),
        }
    })
}

/// The bytes of 32-bit words, little-endian as WebAssembly keeps them.
fn bytemuck_bytes(words: &[u32]) -> &[u8] {
    // SAFETY: a u32 slice is a valid u8 slice four times as long, with the same lifetime.
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), words.len() * 4) }
}

/// The arrays in the staging words, or `None` when the words do not hold what `layout` and
/// `types` describe. The arrays follow each other in the order of `MeshArrays`' codes, each from a
/// whole word on, then the indices.
fn staged_arrays(
    words: &[u32],
    vertices: usize,
    indices: usize,
    layout: u32,
    types: u32,
) -> Option<MeshArrays<'_>> {
    let has = |bit: u32| layout & bit != 0;
    let color_components = if has(mesh_arrays::COLORS_ALPHA) { 4 } else { 3 };
    // Each array in staging order: whether it is there, its attribute's location and its values
    // per vertex.
    let staged = [
        (true, vertex::POSITION, 3),
        (has(mesh_arrays::NORMALS), vertex::NORMAL, 3),
        (has(mesh_arrays::UVS), 2, 2),
        (has(mesh_arrays::UVS1), 3, 2),
        (has(mesh_arrays::COLORS), 5, color_components),
        (has(mesh_arrays::TANGENTS), 4, 4),
        (has(mesh_arrays::JOINTS), 6, 4),
        (has(mesh_arrays::WEIGHTS), 7, 4),
    ];
    let mut arrays = [None; 8];
    let mut at = 0;
    for (array, &(present, location, per_vertex)) in arrays.iter_mut().zip(&staged) {
        if !present {
            continue;
        }
        let attribute = vertex::ATTRIBUTES[location];
        let place = ((types & attribute.mask()) >> attribute.shift) as usize;
        let ty = *attribute.types.get(place)?;
        let count = vertices * per_vertex;
        let size = (count * ty.bytes() as usize).div_ceil(4);
        *array = Some(staged_values(words.get(at..at + size)?, ty, count));
        at += size;
    }
    let index_words = if has(mesh_arrays::INDICES) {
        indices
    } else {
        0
    };
    if words.len() != at + index_words {
        return None;
    }
    let [
        positions,
        normals,
        uvs,
        uvs1,
        colors,
        tangents,
        joints,
        weights,
    ] = arrays;
    Some(MeshArrays {
        positions: positions?,
        normals,
        uvs,
        uvs1,
        colors,
        color_components,
        tangents,
        joints,
        weights,
        indices: has(mesh_arrays::INDICES).then(|| &words[at..]),
        compute_normals: has(mesh_arrays::COMPUTE_NORMALS),
        compute_tangents: has(mesh_arrays::COMPUTE_TANGENTS),
    })
}

/// The first `count` values of type `ty` in `words`, which hold at least that many.
fn staged_values(words: &[u32], ty: Type, count: usize) -> Values<'_> {
    assert!(count * ty.bytes() as usize <= words.len() * 4);
    let at = words.as_ptr();
    // SAFETY: the words are initialized, aligned for every narrower type, and hold `count` values
    // of `ty`, as the assertion checks; every bit pattern is a valid float or integer.
    let data = unsafe {
        use std::slice::from_raw_parts;
        match ty {
            Type::F32 => Data::F32(from_raw_parts(at.cast(), count)),
            Type::Unorm8 | Type::Uint8 => Data::U8(from_raw_parts(at.cast(), count)),
            Type::Snorm8 | Type::Sint8 => Data::I8(from_raw_parts(at.cast(), count)),
            Type::Unorm16 | Type::Uint16 => Data::U16(from_raw_parts(at.cast(), count)),
            Type::Snorm16 | Type::Sint16 => Data::I16(from_raw_parts(at.cast(), count)),
        }
    };
    Values::integers(data, ty.normalized())
}

/// The distance from a mesh's origin to its farthest vertex, or 0 for an unknown mesh.
#[wasm_bindgen(js_name = meshRadius)]
pub fn mesh_radius(mesh: u32) -> f32 {
    let mut radius = 0.0;
    with_engine(|e| {
        if let Some(slot) = mesh
            .checked_sub(1)
            .and_then(|id| e.renderer.settings().meshes().mesh(id))
        {
            radius = slot.radius;
        }
        0
    });
    radius
}

/// Creates a material with a linear color and opacity, and returns its id, counting from 1. Its
/// shading (`constants::shading`) is the standard material, like three.js's
/// `MeshStandardMaterial`, unlit, like its `MeshBasicMaterial`, or the first texture coordinates as
/// colors, for the engine's own tests. A shading from `shading::CUSTOM_FIRST` up is a custom
/// material's: its template in the low 16 bits, the vertex attributes that its shader reads from
/// `shading::CUSTOM_ATTRIBUTE_SHIFT`, `shading::CUSTOM_BASE_COLOR`, and the number of textures
/// that its WGSL declares from `shading::CUSTOM_TEXTURE_SHIFT`. Its features
/// (`constants::material_feature`) and its depth bias are fixed from now on. The bias takes
/// three.js's `polygonOffsetUnits` as `bias_constant` and its `polygonOffsetFactor` as
/// `bias_slope`, whose positive values push the surface away.
#[wasm_bindgen(js_name = createMaterial)]
#[allow(clippy::too_many_arguments)]
pub fn create_material(
    shading: u32,
    features: u32,
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    bias_constant: f32,
    bias_slope: f32,
) -> u32 {
    let shading = match shading {
        shading::UNLIT => Shading::Unlit,
        shading::TEXCOORDS => Shading::TexCoords,
        shading::UNLIT_MAP => Shading::UnlitMap,
        shading::SPRITE => Shading::Sprite,
        shading::LINE => Shading::Line,
        shading::LINE_LIT => Shading::LineLit,
        custom if custom >= shading::CUSTOM_FIRST => Shading::Custom(CustomShading {
            template: custom & 0xffff,
            attributes: (custom >> shading::CUSTOM_ATTRIBUTE_SHIFT) & 0xff,
            base_color: custom & shading::CUSTOM_BASE_COLOR != 0,
            textures: (custom >> shading::CUSTOM_TEXTURE_SHIFT) & 7,
        }),
        _ => Shading::Lit,
    };
    let bias = DepthBias::from_polygon_offset(bias_constant, bias_slope);
    value_with_engine(|e| {
        let table = e.renderer.settings_mut().materials_mut();
        let id = table
            .create(shading, features, [r, g, b, a])
            .map_err(material_failure)?;
        table.set_depth_bias(id, bias).map_err(material_failure)?;
        Ok(id + 1)
    })
}

// Destroying a material changes which objects draw, as a new material does. Its id goes back to
// the table once no object or batch names it, at a rebuild of the draw tables.
/// Destroys a material: objects that still use it draw nothing.
#[wasm_bindgen(js_name = destroyMaterial)]
pub fn destroy_material(material: u32) -> u32 {
    with_engine(|e| {
        let table = e.renderer.settings_mut().materials_mut();
        match table.destroy(material.wrapping_sub(1)) {
            Ok(()) => {
                e.structure_changed = true;
                0
            }
            Err(error) => material_failure(error),
        }
    })
}

/// Changes one value of a material, by the float where the value starts in the material's row
/// (`constants::material_param`), and keeps the others. The value takes as many of `x`, `y` and
/// `z` as it has floats. Colors are linear.
#[wasm_bindgen(js_name = setMaterialValue)]
pub fn set_material_value(material: u32, param: u32, x: f32, y: f32, z: f32) -> u32 {
    with_engine(|e| {
        let table = e.renderer.settings_mut().materials_mut();
        let at = param as usize;
        let values = [x, y, z];
        let width = materials::param::width(at).unwrap_or(0);
        match table.set(material.wrapping_sub(1), at, &values[..width]) {
            Ok(()) => 0,
            Err(error) => material_failure(error),
        }
    })
}

/// Changes `count` custom values of a material, 1 to 4 of `x`, `y`, `z` and `w`, from float `at`
/// of its row of custom values, and keeps the others: a custom material's uniform, as the shader
/// compiler placed it.
#[wasm_bindgen(js_name = setMaterialValues)]
pub fn set_material_values(
    material: u32,
    at: u32,
    count: u32,
    x: f32,
    y: f32,
    z: f32,
    w: f32,
) -> u32 {
    with_engine(|e| {
        let table = e.renderer.settings_mut().materials_mut();
        let values = [x, y, z, w];
        let width = (count as usize).min(values.len());
        match table.set_values(material.wrapping_sub(1), at as usize, &values[..width]) {
            Ok(()) => 0,
            Err(error) => material_failure(error),
        }
    })
}

// Gives a material a map in a slot, a texture's handle, or none with 0. Which objects draw with a
// map changes the draw tables, as a new material does.
/// Gives a material a map in a slot (`constants::map_slot`), which the shader reads at the second
/// texture coordinates when `second_uv` is 1.
#[wasm_bindgen(js_name = setMaterialMap)]
pub fn set_material_map(material: u32, slot: u32, texture: u32, second_uv: u32) -> u32 {
    // The engine's own calls name only the slots that exist.
    let Some(&slot) = MapSlot::ALL.get(slot as usize) else {
        return render_failure(render_detail::UNKNOWN_MATERIAL, 0);
    };
    with_engine(|e| {
        let settings = e.renderer.settings_mut();
        let map = match texture_or_none(settings, texture) {
            Ok(map) => map,
            Err(failure) => return failure,
        };
        match settings
            .materials_mut()
            .set_map(material.wrapping_sub(1), slot, map, second_uv != 0)
        {
            Ok(()) => {
                e.structure_changed = true;
                0
            }
            Err(error) => material_failure(error),
        }
    })
}

// --- Textures ---

// Creates a texture of `width` x `height` texels in `depth` layers, with no texels yet, in a
// texture array, and returns its handle. `format` is the engine's format code: sRGB for colors,
// linear for data, half floats, or a compressed format. `mipmaps` asks for a whole chain of mip
// levels, which the GPU makes from each upload. Without it, `levels` is the mip levels that the
// texture's data brings, as a KTX2 file's do. The rest set its sampler: the address modes along u
// and v, the filters of magnified and minified texels and between mip levels, and the anisotropy.
/// Creates a texture and returns its handle.
#[wasm_bindgen(js_name = createTexture)]
#[allow(clippy::too_many_arguments)]
pub fn create_texture(
    width: u32,
    height: u32,
    depth: u32,
    format: u32,
    mipmaps: bool,
    levels: u32,
    wrap_u: u32,
    wrap_v: u32,
    mag_filter: u32,
    min_filter: u32,
    mip_filter: u32,
    anisotropy: u32,
) -> u32 {
    value_with_engine(|e| {
        let desc = TextureDesc {
            width,
            height,
            depth,
            format,
            mipmaps,
            levels,
            sampling: Sampling {
                wrap: [wrap_u, wrap_v],
                mag_filter,
                min_filter,
                mip_filter,
                anisotropy,
            },
        };
        let textures = e.renderer.settings_mut().textures_mut();
        textures
            .create(desc)
            .map(Handle::raw)
            .map_err(texture_failure)
    })
}

// Creates a 3D texture of `width` x `height` x `depth` texels in `format`, linear 8-bit color or
// half floats, with no texels yet, and returns its handle. It is read with a linear filter and
// clamped at its edges, as a color grading table is. Its texels come from `setTextureData`, slice
// after slice.
/// Creates a 3D texture and returns its handle.
#[wasm_bindgen(js_name = createVolumeTexture)]
pub fn create_volume_texture(width: u32, height: u32, depth: u32, format: u32) -> u32 {
    value_with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        textures
            .create_volume(width, height, depth, format)
            .map(Handle::raw)
            .map_err(texture_failure)
    })
}

// Creates a cube texture with faces of `size` x `size` texels in `format`, shared-exponent floats
// or half floats, with `levels` mip levels and no texels yet, and returns its handle. It is read
// with linear filters within and between levels. Its texels come from `setTextureData`: each level
// in turn from the largest, each level's six faces in turn.
/// Creates a cube texture and returns its handle.
#[wasm_bindgen(js_name = createCubeTexture)]
pub fn create_cube_texture(size: u32, levels: u32, format: u32) -> u32 {
    value_with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        textures
            .create_cube(size, levels, format)
            .map(Handle::raw)
            .map_err(texture_failure)
    })
}

// Gives a texture an image of `width` x `height` pixels, uploaded with the `upload_flags` in
// `flags`, and returns the image's id. TypeScript sends the image to the thread that draws under
// that id, in id order, and the image uploads once the thread has it. An image of another size
// moves the texture to another array, which changes the draw tables.
/// Gives a texture an image and returns the image's id.
#[wasm_bindgen(js_name = setTextureImage)]
pub fn set_texture_image(texture: u32, width: u32, height: u32, flags: u32) -> u32 {
    value_with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        let (image, moved) = textures
            .set_image(Handle::from_raw(texture), width, height, flags)
            .map_err(texture_failure)?;
        e.structure_changed |= moved;
        Ok(image)
    })
}

// Gives a cube texture of shared-exponent floats texels that a generator makes on the GPU in one
// go, and returns the generator's id, which it takes from the images' ids. TypeScript sends the
// generator's name to the thread that draws under that id, in id order, and the cube fills in the
// first frame after the thread has loaded the generator's code and built its pipelines.
/// Gives a cube texture texels from a generator and returns the generator's id.
#[wasm_bindgen(js_name = generateTexture)]
pub fn generate_texture(texture: u32) -> u32 {
    value_with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        textures
            .set_generated(Handle::from_raw(texture))
            .map_err(texture_failure)
    })
}

// Gives a texture new texels of `width` x `height` in each of its layers, and returns the address
// of the memory that TypeScript fills with them at once: tightly packed rows, of blocks in a
// compressed format, layer after layer, and level after level for a texture whose data brings its
// mip levels.
// The texels upload in the texture's turn, and the store frees the memory once no list reads it.
// Texels of another size move the texture to another array, which changes the draw tables.
/// Gives a texture new texels and returns the address to write them at.
#[wasm_bindgen(js_name = setTextureData)]
pub fn set_texture_data(texture: u32, width: u32, height: u32) -> u32 {
    value_with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        let (words, moved) = textures
            .set_data(Handle::from_raw(texture), width, height)
            .map_err(texture_failure)?;
        let at = address(words);
        e.structure_changed |= moved;
        Ok(at)
    })
}

// Destroys a texture. Materials that map it draw with their colors alone, which changes the draw
// tables.
/// Destroys a texture.
#[wasm_bindgen(js_name = destroyTexture)]
pub fn destroy_texture(texture: u32, frame: u32) -> u32 {
    with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        match textures.destroy(Handle::from_raw(texture), frame) {
            Ok(()) => {
                e.structure_changed = true;
                0
            }
            Err(error) => texture_failure(error),
        }
    })
}

// Tells the texture store what the thread that draws has: the newest image id it received, which
// says that every earlier id arrived too, and the newest frame it took. The sketch thread calls it before it records each frame.
/// Tells the texture store what the thread that draws has.
#[wasm_bindgen(js_name = syncTextures)]
pub fn sync_textures(images_arrived: u32, frames_taken: u32) {
    with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        textures.sync(images_arrived, frames_taken);
        0
    });
}

// One of the texture store's numbers (`constants::texture_stat`). `texture` names the texture of
// the numbers about one texture. Fails with 0 for a texture that is not live.
/// Reads one of the texture store's numbers.
#[wasm_bindgen(js_name = textureStat)]
pub fn texture_stat(field: u32, texture: u32) -> f64 {
    let mut value = 0.0;
    with_engine(|e| {
        let textures = e.renderer.settings().textures();
        let stats = textures.stats();
        let bytes = |b: u64| b as f64;
        value = match field {
            texture_stat::MEMORY_BYTES => bytes(textures.memory_bytes()),
            texture_stat::TEXTURE_BYTES => match textures.bytes(Handle::from_raw(texture)) {
                Ok(b) => bytes(b),
                Err(error) => return texture_failure(error),
            },
            texture_stat::LAST_FRAME_BYTES => f64::from(stats.last_frame_bytes),
            texture_stat::LARGEST_FRAME_BYTES => f64::from(stats.largest_frame_bytes),
            texture_stat::WAITING => f64::from(stats.waiting),
            texture_stat::IMAGES_SENT => f64::from(textures.images_sent()),
            texture_stat::UPLOAD_BUDGET => f64::from(textures.budget()),
            texture_stat::MAX_ANISOTROPY => f64::from(textures.max_anisotropy()),
            _ => f64::from(textures.max_size()),
        };
        0
    });
    value
}

// Sets up the shadow atlas of point and spot lights: its most tiles, from 0, which turns their
// shadows off, the texels on each side of each tile, and whether point lights cast shadows.
/// Sets up the shadow atlas of point and spot lights.
#[wasm_bindgen(js_name = setShadowTiles)]
pub fn set_shadow_tiles(tiles: u32, size: u32, point_shadows: bool) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_tile_settings(TileSettings {
            tiles,
            size,
            point_shadows,
        });
        0
    })
}

// Changes one of the texture store's settings (`constants::texture_option`): the bytes one frame
// may upload, the largest anisotropy, or an upload of every waiting image in the next frame.
/// Changes one of the texture store's settings.
#[wasm_bindgen(js_name = setTextureOption)]
pub fn set_texture_option(option: u32, value: u32) -> u32 {
    with_engine(|e| {
        let textures = e.renderer.settings_mut().textures_mut();
        match option {
            texture_option::UPLOAD_BUDGET => textures.set_budget(value),
            texture_option::MAX_ANISOTROPY => textures.set_max_anisotropy(value),
            _ => textures.upload_all_next_frame(),
        }
        0
    })
}

// --- Camera, lights and background ---

/// Draws from this camera object with a perspective lens (vertical field of view in degrees), the
/// objects whose layer masks share a bit with `layers`. With `target` the shadows' camera
/// (`constants::camera_target`), the camera fits the main directional light's cascades instead.
#[wasm_bindgen(js_name = setPerspectiveCamera)]
pub fn set_perspective_camera(
    camera: u32,
    fov_degrees: f32,
    near: f32,
    far: f32,
    layers: u32,
    target: u32,
) -> u32 {
    set_camera(
        camera,
        Lens::Perspective(Perspective {
            fov_degrees,
            near,
            far,
        }),
        layers,
        target,
    )
}

/// Draws from this camera object with an orthographic lens: a view `height` tall and `width` wide,
/// with a width of 0 following the canvas's aspect ratio, centered right of and above the camera's
/// axis by `center_x` and `center_y`. It draws the objects whose layer masks share a bit with
/// `layers`. With `target` the shadows' camera, it fits the main directional light's cascades.
#[wasm_bindgen(js_name = setOrthographicCamera)]
#[allow(clippy::too_many_arguments)]
pub fn set_orthographic_camera(
    camera: u32,
    height: f32,
    width: f32,
    center_x: f32,
    center_y: f32,
    near: f32,
    far: f32,
    layers: u32,
    target: u32,
) -> u32 {
    set_camera(
        camera,
        Lens::Orthographic(Orthographic {
            height,
            width: (width > 0.0).then_some(width),
            center: [center_x, center_y],
            near,
            far,
        }),
        layers,
        target,
    )
}

fn set_camera(camera: u32, lens: Lens, layers: u32, target: u32) -> u32 {
    with_engine(|e| {
        let settings = e.renderer.settings_mut();
        let camera = Handle::from_raw(camera);
        if target == camera_target::SHADOWS {
            settings.set_shadow_camera(Some((camera, lens)));
        } else {
            settings.set_camera(camera, lens);
            settings.set_layers(ViewId::CAMERA, layers);
        }
        0
    })
}

/// Fits the main directional light's cascades to the camera's view again, after a camera with the
/// shadows' target fitted them.
#[wasm_bindgen(js_name = clearShadowCamera)]
pub fn clear_shadow_camera() -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_shadow_camera(None);
        0
    })
}

// A light is a scene object with a row in the light table, which holds its kind, colors and
// numbers (see `constants::light_kind`, `light_color` and `light_value`). The object's handle is
// reserved first, and its create command applies at the next frame; the light lights frames from
// then on. Destroying the object frees nothing here, so TypeScript destroys the light too.

/// Adds a light of `kind` for the object `handle`; returns its id.
#[wasm_bindgen(js_name = createLight)]
pub fn create_light(handle: u32, kind: u32) -> u32 {
    value_with_engine(|e| {
        e.lights
            .create(Handle::from_raw(handle), kind)
            .map_err(core_failure)
    })
}

/// Adds a light for the object `handle` with the kind, colors and numbers of light `light`, and
/// returns its id.
#[wasm_bindgen(js_name = copyLight)]
pub fn copy_light(light: u32, handle: u32) -> u32 {
    value_with_engine(|e| {
        e.lights
            .duplicate(light, Handle::from_raw(handle))
            .map_err(core_failure)
    })
}

/// Frees a light's row.
#[wasm_bindgen(js_name = destroyLight)]
pub fn destroy_light(light: u32) -> u32 {
    with_engine(|e| e.lights.destroy(light).map_or_else(core_failure, |()| 0))
}

/// Sets one of a light's linear colors.
#[wasm_bindgen(js_name = setLightColor)]
pub fn set_light_color(light: u32, which: u32, r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.lights
            .set_color(light, which, [r, g, b])
            .map_or_else(core_failure, |()| 0)
    })
}

/// Sets one of a light's numbers.
#[wasm_bindgen(js_name = setLightValue)]
pub fn set_light_value(light: u32, which: u32, value: f32) -> u32 {
    with_engine(|e| {
        e.lights
            .set_value(light, which, value)
            .map_or_else(core_failure, |()| 0)
    })
}

/// Sets the number that each light created from now on starts with, such as the shadow cascades
/// of the quality preset.
#[wasm_bindgen(js_name = setLightDefault)]
pub fn set_light_default(which: u32, value: f32) -> u32 {
    with_engine(|e| {
        e.lights
            .set_default(which, value)
            .map_or_else(core_failure, |()| 0)
    })
}

/// The linear background color.
#[wasm_bindgen(js_name = setBackground)]
pub fn set_background(r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_background([r, g, b]);
        0
    })
}

/// The device pixels per CSS pixel that the canvas draws with, which sizes sprites given in pixels
/// of the screen.
#[wasm_bindgen(js_name = setPixelRatio)]
pub fn set_pixel_ratio(ratio: f32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_pixel_ratio(ratio);
        0
    })
}

/// Says whether the render scale may drop below the whole canvas, as the quality settings allow.
#[wasm_bindgen(js_name = setRenderScaling)]
pub fn set_render_scaling(scaling: bool) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_render_scaling(scaling);
        0
    })
}

/// What casts shadows in the last recorded frame: the main directional light's cascades in the
/// bits of `shadow_casters::CASCADE_MASK`, 0 when it casts none, and `shadow_casters::TILES` when
/// point or spot lights cast shadows. The quality governor lightens only the shadows that exist.
#[wasm_bindgen(js_name = shadowCasters)]
pub fn shadow_casters() -> u32 {
    value_with_engine(|e| {
        let tiles = if e.renderer.casts_tile_shadows() {
            constants::shadow_casters::TILES
        } else {
            0
        };
        let cascades = e.renderer.settings().sun_shadow_cascades();
        Ok(cascades & constants::shadow_casters::CASCADE_MASK | tiles)
    })
}

/// The shadow settings that the quality settings give every light: the texels on each side of the
/// shadow filter, how many frames pass between two draws of a far cascade, whether a far cascade
/// draws in every frame while a moving caster touches it, and the share of each cascade's length
/// over which it blends into the next. The TypeScript API checks them.
#[wasm_bindgen(js_name = setShadowQuality)]
pub fn set_shadow_quality(filter: u32, far_interval: u32, follow_movers: bool, blend: f32) -> u32 {
    with_engine(|e| {
        let quality = ShadowQuality {
            filter,
            far_interval,
            follow_movers,
            blend,
        };
        e.renderer.settings_mut().set_shadow_quality(quality);
        0
    })
}

/// The tone mapping, by code, and the exposure from the post-processing values, from the next
/// frame on. The TypeScript API checks both, so an unknown code keeps the tone mapping as it was.
#[wasm_bindgen(js_name = setOutput)]
pub fn set_output(tone_mapping: u32) -> u32 {
    with_engine(|e| {
        let exposure = e.post_value(constants::post_value::EXPOSURE);
        let settings = e.renderer.settings_mut();
        let tone_mapping =
            ToneMapping::from_code(tone_mapping).unwrap_or_else(|| settings.output().tone_mapping);
        settings.set_output(Output {
            tone_mapping,
            exposure,
        });
        0
    })
}

/// Turns bloom on with its intensity, threshold, soft edge, blend and level weights from the
/// post-processing values, or off, from the next frame on. The TypeScript API checks the values.
#[wasm_bindgen(js_name = setBloom)]
pub fn set_bloom(on: bool) -> u32 {
    with_engine(|e| {
        use constants::post_value as place;
        let [intensity, threshold, knee] = e.post_values3(place::BLOOM_INTENSITY);
        let bloom = on.then(|| Bloom {
            intensity,
            threshold,
            knee,
            blend: BloomBlend::from_code(e.post_value(place::BLOOM_BLEND) as u32)
                .unwrap_or_default(),
            weights: std::array::from_fn(|level| e.post_value(place::BLOOM_WEIGHTS + level as u32)),
        });
        e.renderer.settings_mut().set_bloom(bloom);
        0
    })
}

/// Turns ambient occlusion on with its settings from the post-processing values, or off, from the
/// next frame on. The TypeScript API checks the values.
#[wasm_bindgen(js_name = setAo)]
pub fn set_ao(on: bool) -> u32 {
    with_engine(|e| {
        let value = |place| e.post_value(place);
        use constants::post_value as v;
        let ao = on.then(|| Ao {
            radius: value(v::AO_RADIUS),
            thickness: value(v::AO_THICKNESS),
            distance_exponent: value(v::AO_DISTANCE_EXPONENT),
            distance_falloff: value(v::AO_DISTANCE_FALLOFF),
            scale: value(v::AO_SCALE),
            samples: value(v::AO_SAMPLES) as u32,
            intensity: value(v::AO_INTENSITY),
        });
        e.renderer.settings_mut().set_ao(ao);
        0
    })
}

/// Sets the size of ambient occlusion's targets, in thousandths of the render size each way, from
/// the next frame on: 0 draws none.
#[wasm_bindgen(js_name = setAoScale)]
pub fn set_ao_scale(thousandths: u32) -> u32 {
    with_engine(|e| {
        e.renderer
            .settings_mut()
            .set_ao_scale(thousandths as f32 / 1000.0);
        0
    })
}

/// Grades the canvas color with the color grading table in 3D texture `texture`, or with none
/// when `texture` is 0, from the next frame on. The post-processing values give its intensity, the
/// share of the graded color, and its domain, the colors that the table's first and last texels
/// along each axis stand for. The TypeScript API checks the values. Fails for a texture that is
/// not live.
#[wasm_bindgen(js_name = setLut)]
pub fn set_lut(texture: u32) -> u32 {
    with_engine(|e| {
        let intensity = e.post_value(constants::post_value::LUT_INTENSITY);
        let domain_min = e.post_values3(constants::post_value::LUT_DOMAIN_MIN);
        let domain_max = e.post_values3(constants::post_value::LUT_DOMAIN_MAX);
        let settings = e.renderer.settings_mut();
        let texture = match texture_or_none(settings, texture) {
            Ok(texture) => texture,
            Err(failure) => return failure,
        };
        let lut = (!texture.is_none()).then_some(Lut {
            texture,
            intensity,
            domain_min,
            domain_max,
        });
        settings.set_lut(lut);
        0
    })
}

/// Lights the scene with the environment whose prefiltered light is cube texture `texture`, or
/// with none when `texture` is 0, from the next frame on. The environment's values give its
/// intensity, its rotation and the coefficients of its diffuse light. The TypeScript API checks the
/// values. Fails for a texture that is not live.
#[wasm_bindgen(js_name = setEnvironment)]
pub fn set_environment(texture: u32) -> u32 {
    with_engine(|e| {
        use constants::environment_value as at;
        let values = &e.environment_values;
        let value = |place: u32| values[place as usize];
        let rotation = std::array::from_fn(|k| value(at::ROTATION + k as u32));
        let sh = std::array::from_fn(|i| {
            std::array::from_fn(|c| value(at::SH + 3 * i as u32 + c as u32))
        });
        let intensity = value(at::INTENSITY);
        let settings = e.renderer.settings_mut();
        let texture = match texture_or_none(settings, texture) {
            Ok(texture) => texture,
            Err(failure) => return failure,
        };
        settings.set_environment((!texture.is_none()).then_some(Environment {
            texture,
            intensity,
            rotation,
            sh,
        }));
        0
    })
}

/// Turns the vignette on with three.js's offset and darkness from the post-processing values, or
/// off, from the next frame on. The TypeScript API checks the values.
#[wasm_bindgen(js_name = setVignette)]
pub fn set_vignette(on: bool) -> u32 {
    with_engine(|e| {
        let vignette = on.then_some(Vignette {
            offset: e.post_value(constants::post_value::VIGNETTE_OFFSET),
            darkness: e.post_value(constants::post_value::VIGNETTE_DARKNESS),
        });
        e.renderer.settings_mut().set_vignette(vignette);
        0
    })
}

/// Turns outlines on with the line's colors and width from the post-processing values, or off, from
/// the next frame on. They draw around the objects whose outlined flag is set. The TypeScript API
/// checks the values.
#[wasm_bindgen(js_name = setOutline)]
pub fn set_outline(on: bool) -> u32 {
    with_engine(|e| {
        let outline = on.then(|| Outline {
            color: e.post_values3(constants::post_value::OUTLINE_COLOR),
            hidden_color: (e.post_value(constants::post_value::OUTLINE_HIDDEN) > 0.0)
                .then(|| e.post_values3(constants::post_value::OUTLINE_HIDDEN_COLOR)),
            width: e.post_value(constants::post_value::OUTLINE_WIDTH),
        });
        e.renderer.settings_mut().set_outline(outline);
        0
    })
}

/// Draws the scene into a target of format `scene_color` with anti-aliasing mode `antialias`, by
/// code, from the next frame on: the HDR color that an effect needs, on a device that started on
/// the 8-bit path. The next frame makes the targets and the pipelines that draw into them again.
#[wasm_bindgen(js_name = setCanvasOutput)]
pub fn set_canvas_output(scene_color: u32, antialias: u32) -> u32 {
    with_engine(|e| {
        e.renderer.set_canvas_output(
            SceneColor::from_format(scene_color),
            Antialias::from_code(antialias).unwrap_or_default(),
        );
        e.structure_changed = true;
        0
    })
}

/// The texels on the short side of bloom's base, and the governor's halvings of it, from the
/// next frame on.
#[wasm_bindgen(js_name = setBloomChain)]
pub fn set_bloom_chain(size: u32, halvings: u32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_bloom_chain(size, halvings);
        0
    })
}

/// Turns software occlusion culling on or off from the next frame on, where the frame builder
/// culls on the CPU: objects with the occluder flag then hide what lies wholly behind them.
#[wasm_bindgen(js_name = setSoftwareOcclusion)]
pub fn set_software_occlusion(on: bool) -> u32 {
    with_engine(|e| {
        e.renderer.set_software_occlusion(on);
        0
    })
}

// Draws a texture behind every object in the camera's view, or only the background color when
// `texture` is 0. Fails for a texture that is not live.
/// Draws a texture behind every object, or none with 0.
#[wasm_bindgen(js_name = setBackgroundTexture)]
pub fn set_background_texture(texture: u32) -> u32 {
    with_engine(|e| {
        let settings = e.renderer.settings_mut();
        match texture_or_none(settings, texture) {
            Ok(background) => {
                settings.set_background_texture(background);
                0
            }
            Err(failure) => failure,
        }
    })
}

/// Draws the scene with a debug view (`debug_view::code`), or with its materials with `LIT`, from
/// the next frame on. A change rebuilds the draw tables. The TypeScript API checks the code, so an
/// unknown one keeps the view as it was.
#[wasm_bindgen(js_name = setDebugView)]
pub fn set_debug_view(view: u32) -> u32 {
    with_engine(|e| {
        if let Some(view) = DebugView::from_code(view)
            && e.renderer.settings_mut().set_debug_view(view)
        {
            e.structure_changed = true;
        }
        0
    })
}

/// The scene's fog: its kind (`constants::fog_kind`), its linear color, the near and far distances
/// of linear fog, and the density of exponential squared fog.
#[wasm_bindgen(js_name = setFog)]
pub fn set_fog(kind: u32, r: f32, g: f32, b: f32, near: f32, far: f32, density: f32) -> u32 {
    with_engine(|e| {
        let fog = Fog::from_code(kind, [r, g, b], near, far, density);
        e.renderer.settings_mut().set_fog(fog);
        0
    })
}

// --- Animation ---
//
// Skeletons and clips come in through the staging words. The sketch thread writes each animated
// instance's sample slots (clip, time and weight) into the table's arrays, and `updateAnimations`
// writes every instance's skinning matrices on the job workers. Ids that these calls return are
// the table's ids plus one, so that 0 can mean a failure.

/// The failure of animation data, as an E1218 or a core error.
fn animation_failure(error: AnimationError) -> u32 {
    let (problem, at) = match error {
        AnimationError::Core(error) => return core_failure(error),
        AnimationError::Joints { joints } => (animation_problem::JOINTS, joints),
        AnimationError::Parent { joint, .. } => (animation_problem::PARENT, joint),
        AnimationError::Length { array, .. } => (animation_problem::LENGTH, array),
        AnimationError::NotFinite { at } => (animation_problem::NOT_FINITE, at),
        AnimationError::Keys { keys } => (animation_problem::KEYS, keys),
        AnimationError::UnknownSkeleton { skeleton } => {
            (animation_problem::UNKNOWN_SKELETON, skeleton)
        }
        AnimationError::WrongSkeleton { clip_joints, .. } => {
            (animation_problem::WRONG_SKELETON, clip_joints)
        }
        AnimationError::Track { track, problem } => {
            (animation_problem::TRACK + problem as u32, track)
        }
        AnimationError::Events { event } => (animation_problem::EVENTS, event),
        AnimationError::Mask { joint } => (animation_problem::MASK, joint),
        AnimationError::Play { option } => (animation_problem::PLAY, option),
        AnimationError::UnknownInstance { instance } => {
            (animation_problem::UNKNOWN_INSTANCE, instance)
        }
        AnimationError::UnknownClip { clip } => (animation_problem::UNKNOWN_CLIP, clip),
        AnimationError::Layer { layer } => (animation_problem::LAYER, layer),
        AnimationError::UnknownMask { mask } => (animation_problem::UNKNOWN_MASK, mask),
    };
    fail(codes::BAD_ANIMATION, [problem, at])
}

/// Runs `f` on the animation table, or fails with `NOT_READY` before `initAnimations`.
fn with_animations(f: impl FnOnce(&mut Animations, &mut Vec<u32>) -> Result<u32, u32>) -> u32 {
    value_with_engine(|e| match e.animations.as_mut() {
        Some(animations) => f(animations, &mut e.staging),
        None => Err(fail(codes::NOT_READY, [2, 0])),
    })
}

/// Runs `f` as `with_animations` does, with the engine's numbers for the next play
/// (`PLAY_ARGS`).
fn with_play_args(
    f: impl FnOnce(&mut Animations, &mut Vec<u32>, &[f32; play_arg::COUNT]) -> Result<u32, u32>,
) -> u32 {
    value_with_engine(|e| match e.animations.as_mut() {
        Some(animations) => f(animations, &mut e.staging, &e.play_args),
        None => Err(fail(codes::NOT_READY, [2, 0])),
    })
}

/// Creates the animation table for `instances` animated objects with `joints` joints in all, at
/// most as many as the joint texture's rows hold on every WebGL2 device.
#[wasm_bindgen(js_name = initAnimations)]
pub fn init_animations(instances: u32, joints: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        if e.animations.is_some() {
            return fail(codes::NOT_READY, [2, 1]);
        }
        if let Err(error) = skinning::check_table_joints(joints) {
            return core_failure(error);
        }
        match Animations::new(jobs, instances, joints) {
            Ok(animations) => {
                e.animations = Some(animations);
                0
            }
            Err(error) => animation_failure(error),
        }
    })
}

/// Makes room for `words` staging words of animation data and returns their address.
#[wasm_bindgen(js_name = animationStaging)]
pub fn animation_staging(words: u32) -> u32 {
    value_with_engine(|e| reserve_staging(e, words))
}

// The staging words hold each joint's parent, then its rest pose (`REST_FLOATS` floats), then its
// inverse bind matrix (12 floats, row-major 3 × 4).
/// Creates a skeleton of `joints` joints from the staging words; returns its id plus one.
#[wasm_bindgen(js_name = createSkeleton)]
pub fn create_skeleton(joints: u32) -> u32 {
    with_animations(|animations, staging| {
        let staged = std::mem::take(staging);
        // Past the joint limit, the skeleton refuses the count before any length matters.
        let n = (joints as usize).min(MAX_JOINTS as usize + 1);
        let rest_end = n + n * REST_FLOATS;
        let end = (rest_end + n * MATRIX_FLOATS).min(staged.len());
        let floats = as_floats(&staged);
        let skeleton = Skeleton::new(
            &staged[..n.min(end)],
            &floats[n.min(end)..rest_end.min(end)],
            &floats[rest_end.min(end)..end],
        )
        .map_err(animation_failure)?;
        let id = animations
            .add_skeleton(skeleton)
            .map_err(animation_failure)?;
        Ok(id + 1)
    })
}

// The staging words hold `tracks` headers of `TRACK_WORDS` words (joint, channel, interpolation,
// key count), then each track's key times and values as floats, track after track. The clip is
// resampled at `rate` keys per second (`resample`).
/// Creates a clip for `skeleton` from the staging words; returns its id plus one.
#[wasm_bindgen(js_name = createClip)]
pub fn create_clip(skeleton: u32, tracks: u32, rate: f32) -> u32 {
    with_animations(|animations, staging| {
        let staged = std::mem::take(staging);
        let id = skeleton.wrapping_sub(1);
        let clip = {
            let target = animations
                .skeleton(id)
                .ok_or(AnimationError::UnknownSkeleton { skeleton: id })
                .map_err(animation_failure)?;
            let sources = staged_tracks(&staged, tracks as usize).map_err(animation_failure)?;
            resample(target, &sources, rate).map_err(animation_failure)?
        };
        let clip = animations.add_clip(id, clip).map_err(animation_failure)?;
        Ok(clip + 1)
    })
}

/// A clip that a job worker resamples in the background: the staging words of `createClip`,
/// a copy of its skeleton, and the clip once it is built.
struct ClipJob {
    skeleton: Skeleton,
    words: Vec<u32>,
    tracks: u32,
    rate: f32,
    clip: OnceLock<Result<Clip, AnimationError>>,
}

impl ClipJob {
    fn run(&self) {
        let clip = staged_tracks(&self.words, self.tracks as usize)
            .and_then(|sources| resample(&self.skeleton, &sources, self.rate));
        // Only this job's one task sets the clip.
        let _ = self.clip.set(clip);
    }
}

/// The background task of a [`ClipJob`]: its argument is the address of the job's `Arc`, which
/// the task takes over.
fn run_clip_job(arg: u64, _: WorkerId) {
    // SAFETY: `create_clip_later` made the address with `Arc::into_raw` for this one task.
    let job = unsafe { Arc::from_raw(arg as usize as *const ClipJob) };
    job.run();
}

// The staging words are those of `createClip`. A job worker resamples the clip between frames, so
// no frame waits for it; `clipReady` then adds it to the skeleton. Without job workers, `clipReady`
// resamples it.
/// Starts resampling a clip for `skeleton` from the staging words; returns a ticket for
/// `clipReady`, plus one.
#[wasm_bindgen(js_name = createClipLater)]
pub fn create_clip_later(skeleton: u32, tracks: u32, rate: f32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    value_with_engine(|e| {
        let Some(animations) = e.animations.as_ref() else {
            return Err(fail(codes::NOT_READY, [2, 0]));
        };
        let id = skeleton.wrapping_sub(1);
        let target = animations
            .skeleton(id)
            .ok_or(AnimationError::UnknownSkeleton { skeleton: id })
            .map_err(animation_failure)?;
        let job = Arc::new(ClipJob {
            skeleton: target.clone(),
            words: std::mem::take(&mut e.staging),
            tracks,
            rate,
            clip: OnceLock::new(),
        });
        let ticket = match e.clip_jobs.iter().position(Option::is_none) {
            Some(free) => free,
            None => {
                e.clip_jobs.push(None);
                e.clip_jobs.len() - 1
            }
        };
        let task = BackgroundTask {
            run: run_clip_job,
            arg: Arc::into_raw(Arc::clone(&job)) as usize as u64,
        };
        if jobs.worker_count() == 0 || jobs.spawn_background(task).is_err() {
            // No job worker would run it: `clipReady` resamples the clip on this thread.
            // SAFETY: the task was never queued, so its reference is still this one.
            drop(unsafe { Arc::from_raw(task.arg as usize as *const ClipJob) });
        }
        e.clip_jobs[ticket] = Some((id, job));
        Ok(ticket as u32 + 1)
    })
}

/// The clip of a `createClipLater` ticket: its id plus one once a job worker has resampled it,
/// [`CLIP_PENDING`] before that, or 0 for a failure. A ticket that gave an id or failed is spent.
#[wasm_bindgen(js_name = clipReady)]
pub fn clip_ready(ticket: u32) -> u32 {
    value_with_engine(|e| {
        let slot = ticket.wrapping_sub(1) as usize;
        let Some(Some((skeleton, job))) = e.clip_jobs.get(slot) else {
            return Err(fail(codes::NOT_READY, [2, 2]));
        };
        // A queued job's task holds a reference until it has run and let go.
        if Arc::strong_count(job) > 1 {
            return Ok(CLIP_PENDING);
        }
        // A job that no task held runs here: without job workers, or with a full queue.
        if job.clip.get().is_none() {
            job.run();
        }
        let skeleton = *skeleton;
        let Some((_, job)) = e.clip_jobs[slot].take() else {
            unreachable!("the slot holds a job")
        };
        let Some(animations) = e.animations.as_mut() else {
            return Err(fail(codes::NOT_READY, [2, 0]));
        };
        let Ok(job) = Arc::try_unwrap(job) else {
            unreachable!("no task holds the job")
        };
        let Some(clip) = job.clip.into_inner() else {
            unreachable!("the job ran")
        };
        let clip = clip.map_err(animation_failure)?;
        let clip = animations
            .add_clip(skeleton, clip)
            .map_err(animation_failure)?;
        Ok(clip + 1)
    })
}

/// Adds an animated instance of `skeleton`; returns its id plus one.
#[wasm_bindgen(js_name = createAnimatedInstance)]
pub fn create_animated_instance(skeleton: u32) -> u32 {
    with_animations(|animations, _| {
        let instance = animations
            .add_instance(skeleton.wrapping_sub(1))
            .map_err(animation_failure)?;
        Ok(instance + 1)
    })
}

/// Removes an animated instance; its id and joints go to later instances.
#[wasm_bindgen(js_name = removeAnimatedInstance)]
pub fn remove_animated_instance(instance: u32) -> u32 {
    with_animations(|animations, _| {
        animations
            .remove_instance(instance.wrapping_sub(1))
            .map_err(animation_failure)?;
        Ok(0)
    })
}

/// The clips that loading resampled at each frame, plus one: the others held keys on their frames
/// already, as the asset tool writes them, and were copied.
#[wasm_bindgen(js_name = resampledClips)]
pub fn resampled_clips() -> u32 {
    with_animations(|animations, _| Ok(animations.resampled_clips() + 1))
}

/// The first joint of animated instance `instance` in the skinning matrices, plus one, or 0 when
/// no live instance has that id.
#[wasm_bindgen(js_name = animatedInstanceJoints)]
pub fn animated_instance_joints(instance: u32) -> u32 {
    with_animations(|animations, _| {
        let id = instance.wrapping_sub(1);
        match animations.instance_joints(id) {
            Some((first, _)) => Ok(first + 1),
            None => Err(animation_failure(AnimationError::UnknownInstance {
                instance: id,
            })),
        }
    })
}

/// The address of an animation table array (`constants::animation_field`).
#[wasm_bindgen(js_name = animationArrays)]
pub fn animation_arrays(field: u32) -> u32 {
    with_play_args(|animations, _, args| {
        Ok(match field {
            animation_field::PLAY_ARGS => address(&args[..]),
            animation_field::SLOT_CLIPS => address(&animations.slots().clip),
            animation_field::SLOT_TIMES => address(&animations.slots().time),
            animation_field::SLOT_WEIGHTS => address(&animations.slots().weight),
            animation_field::TIME_SCALES => address(animations.time_scales()),
            animation_field::LAYER_WEIGHTS => address(animations.layer_weights()),
            animation_field::EVENTS => address(animations.event_buffer()),
            animation_field::EVENT_TOTALS => address(animations.event_totals()),
            animation_field::SLOT_SOURCES => address(&animations.slots().source),
            animation_field::BLEND_VALUES => address(animations.blend_values()),
            _ => address(animations.matrices()),
        })
    })
}

/// Plays clip `clip` on instance `instance`, on layer `layer`, with `flags`
/// (`constants::play_flag`) and the numbers in `PLAY_ARGS`: `Animations::play`.
#[wasm_bindgen(js_name = animatorPlay)]
pub fn animator_play(instance: u32, clip: u32, layer: u32, flags: u32) -> u32 {
    with_play_args(|animations, _, args| {
        let play = Play {
            layer,
            fade: args[play_arg::FADE],
            speed: args[play_arg::SPEED],
            looping: flags & play_flag::LOOP != 0,
            additive: flags & play_flag::ADDITIVE != 0,
            time: (flags & play_flag::TIME != 0).then_some(args[play_arg::TIME]),
            weight: (flags & play_flag::WEIGHT != 0).then_some(args[play_arg::WEIGHT]),
            join: flags & play_flag::JOIN != 0,
        };
        animations
            .play(instance.wrapping_sub(1), clip.wrapping_sub(1), play)
            .map_err(animation_failure)?;
        Ok(0)
    })
}

// The staging words hold `count` clip ids plus one, then `count` blend points as floats.
/// Plays a 1D blend of the staged clips on instance `instance`, on layer `layer`, with `flags`
/// and the numbers in `PLAY_ARGS`: `Animations::play_blend`.
#[wasm_bindgen(js_name = animatorPlayBlend)]
pub fn animator_play_blend(instance: u32, count: u32, layer: u32, flags: u32) -> u32 {
    // The staging words stay with the engine, so switching blends reuses them.
    with_play_args(|animations, staging, args| {
        let staged = staging.as_slice();
        let n = (count as usize).min(staged.len() / 2);
        let mut clips = [0u32; MAX_BLEND];
        let named = n.min(MAX_BLEND);
        for (to, from) in clips.iter_mut().zip(&staged[..named]) {
            *to = from.wrapping_sub(1);
        }
        let points = &as_floats(&staged[n..])[..n];
        let blend = Blend {
            layer,
            fade: args[play_arg::FADE],
            speed: args[play_arg::SPEED],
            looping: flags & play_flag::LOOP != 0,
            phase: (flags & play_flag::TIME != 0).then_some(args[play_arg::TIME]),
            value: (flags & play_flag::VALUE != 0).then_some(args[play_arg::VALUE]),
        };
        // More clips than slots reach the core's check through the point count.
        let clips = if n > MAX_BLEND {
            &clips[..]
        } else {
            &clips[..n]
        };
        animations
            .play_blend(instance.wrapping_sub(1), clips, points, blend)
            .map_err(animation_failure)?;
        Ok(0)
    })
}

/// Stops clip `clip` on instance `instance`, or every clip when `clip` is 0, fading out over
/// `fade` seconds.
#[wasm_bindgen(js_name = animatorStop)]
pub fn animator_stop(instance: u32, clip: u32, fade: f32) -> u32 {
    with_animations(|animations, _| {
        let clip = clip.checked_sub(1);
        animations
            .stop(instance.wrapping_sub(1), clip, fade)
            .map_err(animation_failure)?;
        Ok(0)
    })
}

// The staging words hold one weight from 0 to 1 per joint of the skeleton.
/// Creates a joint mask for `skeleton` from the staging words; returns its id plus one.
#[wasm_bindgen(js_name = createJointMask)]
pub fn create_joint_mask(skeleton: u32) -> u32 {
    with_animations(|animations, staging| {
        let staged = std::mem::take(staging);
        let mask = animations
            .add_mask(skeleton.wrapping_sub(1), as_floats(&staged))
            .map_err(animation_failure)?;
        Ok(mask + 1)
    })
}

/// Gives layer `layer` of instance `instance` joint mask `mask`, or every joint when `mask` is 0.
#[wasm_bindgen(js_name = setLayerMask)]
pub fn set_layer_mask(instance: u32, layer: u32, mask: u32) -> u32 {
    with_animations(|animations, _| {
        animations
            .set_layer_mask(instance.wrapping_sub(1), layer, mask.checked_sub(1))
            .map_err(animation_failure)?;
        Ok(0)
    })
}

// The staging words hold `count` event times in seconds as floats, then `count` event ids.
/// Sets the events of clip `clip` from the staging words.
#[wasm_bindgen(js_name = setClipEvents)]
pub fn set_clip_events(clip: u32, count: u32) -> u32 {
    with_animations(|animations, staging| {
        let staged = std::mem::take(staging);
        let n = (count as usize).min(staged.len() / 2);
        let (times, ids) = staged.split_at(n);
        animations
            .set_clip_events(clip.wrapping_sub(1), &as_floats(times)[..n], &ids[..n])
            .map_err(animation_failure)?;
        Ok(0)
    })
}

/// Advances every played clip by `step_us` microseconds, then writes every animated instance's
/// skinning matrices, on the job workers. Then the bounds of skinned and morphed objects follow
/// their poses and weights, which marks the objects before the transform update. The microseconds
/// cross from TypeScript as a whole number, so no number object is made for them.
#[wasm_bindgen(js_name = updateAnimations)]
pub fn update_animations(step_us: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        if let Some(animations) = e.animations.as_mut() {
            animations.update(jobs, step_us as f32 * 1e-6);
        }
        let meshes = e.renderer.settings().meshes();
        skinning::update_bounds(&mut e.scene, e.animations.as_ref(), &e.morphs, meshes);
        0
    })
}

// --- Raycasts and overlap queries ---
//
// TypeScript writes a query's input into the input array and reads the hit records that the query
// writes (`constants::query`). Each query first brings the scene's trees up to date with the last
// world output, which costs nothing more within a frame. A query returns its hit count, or
// `query::FAILED`. The hit array moves when it grows, so TypeScript reads its address again when
// a query returns more hits than the capacity it last read. The doc comments stay short:
// wasm-bindgen copies them into the glue that every page downloads.

/// Grows `array` to `len` numbers.
fn grow_query_array(array: &mut Vec<f64>, len: usize) -> Result<(), u32> {
    if array.len() < len {
        array.try_reserve_exact(len - array.len()).map_err(|_| {
            core_failure(CoreError::OutOfMemory {
                bytes: u32::try_from(len * 8).unwrap_or(u32::MAX),
            })
        })?;
        array.resize(len, 0.0);
    }
    Ok(())
}

/// Writes a hit record: a hit, or a miss.
fn write_hit(out: &mut [f64], hit: Option<&QueryHit>) {
    let Some(hit) = hit else {
        out.fill(0.0);
        out[query::HIT_ROW as usize] = -1.0;
        out[query::HIT_TRIANGLE as usize] = -1.0;
        out[query::HIT_DISTANCE as usize] = -1.0;
        return;
    };
    let (slot, batch, row) = match hit.source {
        Source::Object(slot) => (f64::from(slot), 0.0, -1.0),
        Source::Row { batch, row } => (0.0, f64::from(batch.raw()), f64::from(row)),
    };
    out[query::HIT_SLOT as usize] = slot;
    out[query::HIT_BATCH as usize] = batch;
    out[query::HIT_ROW as usize] = row;
    out[query::HIT_TRIANGLE as usize] = f64::from(hit.triangle);
    out[query::HIT_DISTANCE as usize] = f64::from(hit.distance);
    let point = query::HIT_POINT as usize;
    out[point..point + 3].copy_from_slice(&hit.point);
    let normal = query::HIT_NORMAL as usize;
    for k in 0..3 {
        out[normal + k] = f64::from(hit.normal[k]);
    }
}

/// Writes the records of `hits` and returns their count.
fn write_hits(out: &mut Vec<f64>, hits: &[QueryHit]) -> Result<u32, u32> {
    let floats = query::HIT_FLOATS as usize;
    grow_query_array(out, hits.len().max(1) * floats)?;
    for (record, hit) in out.chunks_exact_mut(floats).zip(hits) {
        write_hit(record, Some(hit));
    }
    Ok(hits.len() as u32)
}

/// A ray from an origin and a direction, which becomes a unit vector, with its far limit; `None`
/// for a ray that is not one, which then hits nothing (see `WorldRay::toward`).
fn ray_from(numbers: &[f64], t_max: f64) -> Option<WorldRay> {
    let origin = [numbers[0], numbers[1], numbers[2]];
    let direction = [numbers[3], numbers[4], numbers[5]];
    WorldRay::toward(origin, direction).map(|ray| ray.with_max(t_max as f32))
}

/// The parts of the engine that a query uses, with the scene's trees brought up to date.
struct QueryParts<'a> {
    queries: &'a mut SceneQueries,
    view: QueryScene<'a, SceneSettings>,
    input: &'a [f64; query::INPUT_FLOATS as usize],
    hits: &'a mut Vec<f64>,
    rays: &'a [f64],
    jobs: &'static JobSystem,
}

/// Runs a query on the engine after a sync of its trees; returns its hit count, or
/// `query::FAILED` with the last error set.
fn run_query(f: impl FnOnce(QueryParts<'_>) -> Result<u32, u32>) -> u32 {
    let Some(jobs) = JOBS.get() else {
        fail(codes::NOT_READY, [0, 0]);
        return query::FAILED;
    };
    let mut count = query::FAILED;
    let status = with_engine(|e| {
        let view = QueryScene {
            scene: &e.scene,
            batches: &e.batches,
            meshes: e.renderer.settings(),
        };
        if let Err(error) = e.queries.sync(&view, jobs) {
            return core_failure(error);
        }
        let parts = QueryParts {
            queries: &mut e.queries,
            view,
            input: &e.query_input,
            hits: &mut e.query_hits,
            rays: &e.query_rays,
            jobs,
        };
        match f(parts) {
            Ok(n) => {
                count = n;
                0
            }
            Err(code) => code,
        }
    });
    if status == 0 { count } else { query::FAILED }
}

/// The address of a query array, or the hit array's capacity in records.
#[wasm_bindgen(js_name = queryArrays)]
pub fn query_arrays(field: u32) -> u32 {
    value_with_engine(|e| {
        Ok(match field {
            query::INPUT => address(&e.query_input),
            query::RAYS => address(&e.query_rays),
            query::HIT_CAPACITY => (e.query_hits.len() / query::HIT_FLOATS as usize) as u32,
            _ => address(&e.query_hits),
        })
    })
}

/// Makes room for a batch of `count` rays.
#[wasm_bindgen(js_name = reserveRays)]
pub fn reserve_rays(count: u32) -> u32 {
    with_engine(|e| {
        let n = count as usize;
        let floats = |per: u32| {
            n.checked_mul(per as usize).ok_or_else(|| {
                core_failure(CoreError::OutOfMemory {
                    bytes: count.saturating_mul(per.saturating_mul(8)),
                })
            })
        };
        let grown = floats(query::RAY_FLOATS)
            .and_then(|len| grow_query_array(&mut e.query_rays, len))
            .and_then(|()| floats(query::HIT_FLOATS))
            .and_then(|len| grow_query_array(&mut e.query_hits, len));
        match grown {
            Ok(()) => 0,
            Err(code) => code,
        }
    })
}

/// Casts the input's ray on the layers of `layers`.
#[wasm_bindgen(js_name = raycast)]
pub fn raycast(kind: u32, layers: u32) -> u32 {
    run_query(|q| {
        let input = q.input;
        let Some(ray) = ray_from(input, input[query::INPUT_LIMIT as usize]) else {
            return Ok(0);
        };
        match kind {
            query::ANY => Ok(u32::from(q.queries.raycast_any(&q.view, &ray, layers))),
            query::ALL => write_hits(q.hits, q.queries.raycast_all(&q.view, &ray, layers)),
            _ => {
                let hit = q.queries.raycast(&q.view, &ray, layers);
                write_hit(&mut q.hits[..query::HIT_FLOATS as usize], hit.as_ref());
                Ok(u32::from(hit.is_some()))
            }
        }
    })
}

/// Casts the first `count` rays of the ray array on the job workers.
#[wasm_bindgen(js_name = raycastBatch)]
pub fn raycast_batch(count: u32, layers: u32) -> u32 {
    run_query(|q| {
        let (ray_floats, hit_floats) = (query::RAY_FLOATS as usize, query::HIT_FLOATS as usize);
        let room = (q.rays.len() / ray_floats).min(q.hits.len() / hit_floats) as u32;
        if count > room {
            return Err(core_failure(CoreError::OutOfRange {
                value: count,
                limit: room,
            }));
        }
        let (rays, t_max) = (q.rays, q.input[query::INPUT_LIMIT as usize]);
        let at = |i: u32| ray_from(&rays[i as usize * ray_floats..], t_max);
        let results = q
            .queries
            .raycast_batch(&q.view, q.jobs, count, &at, layers)
            .map_err(core_failure)?;
        let mut found = 0;
        for (record, hit) in q.hits.chunks_exact_mut(hit_floats).zip(results) {
            write_hit(record, hit.as_ref());
            found += u32::from(hit.is_some());
        }
        Ok(found)
    })
}

/// Finds the objects on the layers of `layers` with a triangle in the input's sphere or box.
#[wasm_bindgen(js_name = overlap)]
pub fn overlap(kind: u32, layers: u32) -> u32 {
    run_query(|q| {
        let input = q.input;
        let a = [input[0], input[1], input[2]];
        let found = if kind == query::BOX {
            q.queries
                .overlap_box(&q.view, a, [input[3], input[4], input[5]], layers)
        } else {
            let radius = input[query::INPUT_LIMIT as usize] as f32;
            q.queries.overlap_sphere(&q.view, a, radius, layers)
        };
        write_hits(q.hits, found)
    })
}
