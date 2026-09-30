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
use std::sync::OnceLock;

use null3d_core::error::CoreError;
use null3d_core::handle::Handle;
use null3d_core::instances::BatchTable;
use null3d_core::jobs::{JobConfig, JobSystem};
use null3d_core::scene::{CommandRing, SceneStorage};
use null3d_core::snapshot::FrameSnapshot;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::sizes;
use null3d_render::arrays::{ArrayName, ArraysError, MeshArrays, from_arrays};
use null3d_render::camera::Perspective;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, FrameInput, RecordError};
use null3d_render::geometry::{Geometry, box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{
    BYTES_PER_SOURCE, GpuDrivenRenderer, MAX_USEFUL_BINDING_BYTES, RendererConfig,
};
use null3d_render::materials::{MaterialError, MaterialTable, Shading};
use wasm_bindgen::prelude::*;

pub mod constants;

use constants::{arrays_problem, batch_field, mesh_arrays, ring_field, scene_field, shading};

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
    /// A function that needs the engine ran before `initEngine`, or `initEngine` ran twice.
    pub const NOT_READY: u32 = 1403;
    /// A mesh, material or GPU buffer is full, or an id names nothing (details say which).
    pub const RENDER: u32 = 1501;
}

/// Details of `codes::RENDER` failures.
mod render_detail {
    pub const DRAW_LIST_FULL: u32 = 1;
    pub const TOO_MANY_SOURCES: u32 = 3;
    pub const MATERIALS_FULL: u32 = 4;
    pub const UNKNOWN_MATERIAL: u32 = 5;
    pub const UNKNOWN_MESH: u32 = 6;
    pub const BAD_MESH: u32 = 7;
    pub const UPLOADS_FULL: u32 = 8;
}

struct Engine {
    scene: SceneStorage,
    ring: CommandRing,
    batches: BatchTable,
    snapshot: FrameSnapshot,
    renderer: Box<dyn FrameBuilder>,
    structure_changed: bool,
    /// True when the last recorded frame rebuilt its draw tables.
    rebuilt: bool,
    /// The words that TypeScript writes a mesh's arrays into, for `createMeshFromArrays`.
    staging: Vec<u32>,
}

impl Engine {
    /// The frame builder, and the frame's input for it. The frame's upload list is recorded once,
    /// by the frame's first step.
    fn frame(
        &mut self,
        frame: u32,
        canvas: (u32, u32),
        jobs: &'static JobSystem,
    ) -> (&mut dyn FrameBuilder, FrameInput<'_>) {
        if self.snapshot.frame() != frame {
            self.snapshot.record(frame, &self.scene, &self.batches);
        }
        let input = FrameInput {
            frame,
            scene: &self.scene,
            batches: &self.batches,
            snapshot: &self.snapshot,
            canvas,
            structure_changed: self.structure_changed,
            jobs,
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
        RecordError::DrawListFull => (render_detail::DRAW_LIST_FULL, 0),
        RecordError::TooManySources { limit } => (render_detail::TOO_MANY_SOURCES, limit),
        RecordError::UploadsFull => (render_detail::UPLOADS_FULL, 0),
        RecordError::OutOfMemory { bytes } => {
            return core_failure(CoreError::OutOfMemory { bytes });
        }
        RecordError::Graph(error) => return fail(error.code(), error.details()),
    };
    render_failure(detail, value)
}

fn arrays_failure(error: ArraysError) -> u32 {
    let (problem, value) = match error {
        ArraysError::NoVertices => (arrays_problem::NO_VERTICES, 0),
        ArraysError::Length(array) => (arrays_problem::LENGTH, array as u32),
        ArraysError::NotTriangles => (arrays_problem::NOT_TRIANGLES, 0),
        ArraysError::Twice(array) => (arrays_problem::TWICE, array as u32),
        ArraysError::Missing(array) => (arrays_problem::MISSING, array as u32),
        ArraysError::IndexOutOfRange { at } => (arrays_problem::INDEX_OUT_OF_RANGE, at),
        ArraysError::NotFinite { array, at } => (arrays_problem::NOT_FINITE + array as u32, at),
    };
    fail(codes::BAD_ARRAYS, [problem, value])
}

fn material_failure(error: MaterialError) -> u32 {
    match error {
        MaterialError::Full => render_failure(render_detail::MATERIALS_FULL, 0),
        MaterialError::Unknown(id) => render_failure(render_detail::UNKNOWN_MATERIAL, id),
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
/// largest storage binding of the device the engine draws with. On WebGL2 (`webgl2`), the
/// capability flags say whether the device has multi-draw, and `max_texture_size` is its largest
/// texture. Without `cell_culling`, culling tests every object, with no grid cells skipped first.
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
    cell_culling: bool,
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
    *cell = Some(Engine {
        scene: SceneStorage::with_capacity(scene_capacity),
        ring: CommandRing::with_capacity(commands),
        batches: BatchTable::with_capacity(max_batches),
        snapshot: FrameSnapshot::with_capacity(UPLOAD_RANGES),
        renderer: if webgl2 {
            let capabilities = Capabilities::from_bits(u64::from(capabilities));
            Box::new(CpuCulledRenderer::new(CpuCulledConfig {
                multi_draw: capabilities.contains(Capabilities::MULTI_DRAW),
                max_texture_size: max_texture_size.max(CpuCulledConfig::default().max_texture_size),
                cell_culling,
                ..CpuCulledConfig::default()
            }))
        } else {
            Box::new(GpuDrivenRenderer::new(RendererConfig {
                storage_binding_bytes: storage_binding_bytes.clamp(
                    sizes::PORTABLE_STORAGE_BINDING_BYTES,
                    MAX_USEFUL_BINDING_BYTES,
                ),
                cell_culling,
                ..RendererConfig::default()
            }))
        },
        structure_changed: true,
        rebuilt: false,
        staging: Vec::new(),
    });
    0
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

/// Serves the job system on a job worker until `shutdownJobs`. It first waits for the sketch
/// thread to create the job system.
#[wasm_bindgen(js_name = jobWorkerLoop)]
pub fn job_worker_loop(index: u32) {
    JOBS.wait().worker_loop(index);
}

/// The milliseconds job worker `index` spent on work since the last call for it, which starts
/// its total again from zero. The sketch thread reads it once per frame.
#[wasm_bindgen(js_name = takeJobBusyMs)]
pub fn take_job_busy_ms(index: u32) -> f64 {
    JOBS.get().map_or(0.0, |jobs| jobs.take_busy_ms(index))
}

/// Stops every job worker's loop.
#[wasm_bindgen(js_name = shutdownJobs)]
pub fn shutdown_jobs() {
    if let Some(jobs) = JOBS.get() {
        jobs.shutdown();
    }
}

// --- Scene objects ---

/// The number of object slots; arrays have one more row, because slot 0 is never used.
#[wasm_bindgen(js_name = sceneCapacity)]
pub fn scene_capacity() -> u32 {
    value_with_engine(|e| Ok(e.scene.capacity()))
}

/// The address of one of the per-slot arrays TypeScript writes (see `constants::scene_field`):
/// positions (3 floats), rotations (4), scales (3), local bounding radii (1), or the dirty
/// bitset's words, which TypeScript views as 32-bit words.
#[wasm_bindgen(js_name = sceneArrays)]
pub fn scene_arrays(field: u32) -> u32 {
    value_with_engine(|e| {
        Ok(match field {
            scene_field::POSITIONS => address(e.scene.positions()),
            scene_field::ROTATIONS => address(e.scene.rotations()),
            scene_field::SCALES => address(e.scene.scales()),
            scene_field::LOCAL_RADII => address(e.scene.local_radii()),
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

/// Copies an object's world matrix of the current frame (12 numbers, rows of a 3 × 4 matrix), with
/// its translation from the origin in 64-bit floats.
#[wasm_bindgen(js_name = worldMatrix)]
pub fn world_matrix(handle: u32, out: &mut [f64]) -> u32 {
    with_engine(
        |e| match e.scene.absolute_world_matrix(Handle::from_raw(handle)) {
            Ok(matrix) => {
                let n = out.len().min(matrix.len());
                out[..n].copy_from_slice(&matrix[..n]);
                0
            }
            Err(error) => core_failure(error),
        },
    )
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

/// Starts a frame and applies every pending command. Frames count from 1.
#[wasm_bindgen(js_name = beginFrame)]
pub fn begin_frame(frame: u32) -> u32 {
    with_engine(|e| {
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
/// for a canvas of this size in device pixels. Call it before `recordFrame`.
#[wasm_bindgen(js_name = cullFrame)]
pub fn cull_frame(frame: u32, width: u32, height: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        let (renderer, input) = e.frame(frame, (width, height), jobs);
        match renderer.cull(&input) {
            Ok(()) => 0,
            Err(error) => record_failure(error),
        }
    })
}

/// Records the frame's upload list and its draw list for a canvas of this size in device pixels.
#[wasm_bindgen(js_name = recordFrame)]
pub fn record_frame(frame: u32, width: u32, height: u32) -> u32 {
    let Some(jobs) = JOBS.get() else {
        return fail(codes::NOT_READY, [0, 0]);
    };
    with_engine(|e| {
        let (renderer, input) = e.frame(frame, (width, height), jobs);
        match renderer.record(&input) {
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

/// The address of the draw list of a frame parity. It never moves.
#[wasm_bindgen(js_name = drawListAddress)]
pub fn draw_list_address(parity: u32) -> u32 {
    value_with_engine(|e| Ok(address(e.renderer.list(parity).words())))
}

/// The number of 32-bit words recorded for a frame.
#[wasm_bindgen(js_name = drawListWords)]
pub fn draw_list_words(frame: u32) -> u32 {
    value_with_engine(|e| Ok(e.renderer.list(frame).len() as u32))
}

// --- Instance batches ---

/// Creates an instance batch of one mesh and one material, and returns its id.
#[wasm_bindgen(js_name = createBatch)]
pub fn create_batch(capacity: u32, dynamic: bool, colors: bool, mesh: u32, material: u32) -> u32 {
    value_with_engine(|e| {
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
        let id = e
            .batches
            .create(capacity, dynamic, colors, mesh, material, radius)
            .map_err(core_failure)?;
        e.structure_changed = true;
        Ok(id.raw())
    })
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
/// a row), rotations (4), scales (3), or colors (4, or 0 for a batch without colors).
#[wasm_bindgen(js_name = batchArrays)]
pub fn batch_arrays(batch: u32, field: u32) -> u32 {
    value_with_engine(|e| {
        let batch = e
            .batches
            .get(Handle::from_raw(batch))
            .map_err(core_failure)?;
        Ok(match field {
            batch_field::POSITIONS => address(batch.positions()),
            batch_field::ROTATIONS => address(batch.rotations()),
            batch_field::SCALES => address(batch.scales()),
            _ if batch.has_colors() => address(batch.colors()),
            _ => 0,
        })
    })
}

/// Draws only the first `count` rows.
#[wasm_bindgen(js_name = setBatchActiveCount)]
pub fn set_batch_active_count(batch: u32, count: u32) -> u32 {
    with_engine(|e| match e.batches.get_mut(Handle::from_raw(batch)) {
        // A new active count changes which rows draw, not the scene's structure: the renderer
        // updates those rows' draw membership without rebuilding its tables.
        Ok(batch) => match batch.set_active_count(count) {
            Ok(()) => 0,
            Err(error) => core_failure(error),
        },
        Err(error) => core_failure(error),
    })
}

/// Marks rows of a static batch for update and upload.
#[wasm_bindgen(js_name = markBatchDirty)]
pub fn mark_batch_dirty(batch: u32, start: u32, count: u32) -> u32 {
    with_engine(|e| {
        match e
            .batches
            .get_mut(Handle::from_raw(batch))
            .and_then(|b| b.mark_dirty(start, count))
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
        .map_err(|_| render_failure(render_detail::BAD_MESH, 0))?;
    Ok(id + 1)
}

/// A box mesh with three.js's `BoxGeometry` parameters; returns its mesh id.
#[wasm_bindgen(js_name = createBoxMesh)]
pub fn create_box_mesh(
    width: f32,
    height: f32,
    depth: f32,
    width_segments: u32,
    height_segments: u32,
    depth_segments: u32,
) -> u32 {
    value_with_engine(|e| {
        add_mesh(
            e,
            &box_geometry(
                width,
                height,
                depth,
                [
                    width_segments.max(1),
                    height_segments.max(1),
                    depth_segments.max(1),
                ],
            ),
        )
    })
}

/// A sphere mesh with three.js's `SphereGeometry` parameters; returns its mesh id.
#[wasm_bindgen(js_name = createSphereMesh)]
pub fn create_sphere_mesh(radius: f32, width_segments: u32, height_segments: u32) -> u32 {
    value_with_engine(|e| {
        add_mesh(
            e,
            &sphere_geometry(radius, width_segments.max(3), height_segments.max(2)),
        )
    })
}

/// Makes room for `words` 32-bit words of a mesh's arrays, which TypeScript then writes, and
/// returns their address. `createMeshFromArrays` reads them, and frees them.
#[wasm_bindgen(js_name = meshArrays)]
pub fn mesh_arrays(words: u32) -> u32 {
    value_with_engine(|e| {
        let out_of_memory = || {
            core_failure(CoreError::OutOfMemory {
                bytes: words.saturating_mul(4),
            })
        };
        e.staging.clear();
        e.staging
            .try_reserve_exact(words.max(1) as usize)
            .map_err(|_| out_of_memory())?;
        e.staging.resize(words as usize, 0);
        Ok(address(e.staging.as_slice()))
    })
}

/// A mesh from the arrays in the staging words, as `layout` (`constants::mesh_arrays` bits)
/// describes them, for `vertices` vertices and `indices` indices. Normals and tangents that
/// `layout` asks for are computed on the job workers. Returns the mesh id.
#[wasm_bindgen(js_name = createMeshFromArrays)]
pub fn create_mesh_from_arrays(vertices: u32, indices: u32, layout: u32) -> u32 {
    value_with_engine(|e| {
        let jobs = JOBS.get().ok_or_else(|| fail(codes::NOT_READY, [0, 0]))?;
        let staging = std::mem::take(&mut e.staging);
        let geometry = {
            let arrays = staged_arrays(&staging, vertices as usize, indices as usize, layout)
                .ok_or_else(|| arrays_failure(ArraysError::Length(ArrayName::Positions)))?;
            from_arrays(&arrays, jobs).map_err(arrays_failure)?
        };
        drop(staging);
        add_mesh(e, &geometry)
    })
}

/// The arrays in the staging words, or `None` when the words are fewer than the layout needs.
fn staged_arrays(
    words: &[u32],
    vertices: usize,
    indices: usize,
    layout: u32,
) -> Option<MeshArrays<'_>> {
    let has = |bit: u32| layout & bit != 0;
    let color_floats = if has(mesh_arrays::COLORS_ALPHA) { 4 } else { 3 };
    let float_words = vertices
        * [
            (true, 3),
            (has(mesh_arrays::NORMALS), 3),
            (has(mesh_arrays::UVS), 2),
            (has(mesh_arrays::UVS1), 2),
            (has(mesh_arrays::COLORS), color_floats),
            (has(mesh_arrays::TANGENTS), 4),
        ]
        .iter()
        .filter(|(present, _)| *present)
        .map(|(_, floats)| floats)
        .sum::<usize>();
    let index_words = if has(mesh_arrays::INDICES) {
        indices
    } else {
        0
    };
    if words.len() != float_words + index_words {
        return None;
    }
    // SAFETY: every `u32` is four initialized bytes that make a valid `f32`, of the same size and
    // alignment, and the float words stay in bounds.
    let floats: &[f32] =
        unsafe { std::slice::from_raw_parts(words.as_ptr().cast::<f32>(), float_words) };
    let mut at = 0;
    let mut next = |present: bool, per_vertex: usize| {
        present.then(|| {
            let array = &floats[at..at + vertices * per_vertex];
            at += vertices * per_vertex;
            array
        })
    };
    Some(MeshArrays {
        positions: next(true, 3)?,
        normals: next(has(mesh_arrays::NORMALS), 3),
        uvs: next(has(mesh_arrays::UVS), 2),
        uvs1: next(has(mesh_arrays::UVS1), 2),
        colors: next(has(mesh_arrays::COLORS), color_floats),
        color_floats,
        tangents: next(has(mesh_arrays::TANGENTS), 4),
        indices: has(mesh_arrays::INDICES).then(|| &words[float_words..]),
        compute_normals: has(mesh_arrays::COMPUTE_NORMALS),
        compute_tangents: has(mesh_arrays::COMPUTE_TANGENTS),
    })
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

/// Creates a material with a linear color and returns its id, counting from 1. Its shading
/// (`constants::shading`) is lit, like three.js's `MeshLambertMaterial`, unlit, like its
/// `MeshBasicMaterial`, or the first texture coordinates as colors, for the engine's own tests.
#[wasm_bindgen(js_name = createMaterial)]
pub fn create_material(shading: u32, r: f32, g: f32, b: f32, a: f32) -> u32 {
    let shading = match shading {
        shading::UNLIT => Shading::Unlit,
        shading::TEXCOORDS => Shading::TexCoords,
        _ => Shading::Lit,
    };
    value_with_engine(|e| {
        e.renderer
            .settings_mut()
            .materials_mut()
            .create(shading, [r, g, b, a])
            .map(|id| id + 1)
            .map_err(material_failure)
    })
}

/// Changes a material's linear color and keeps its opacity.
#[wasm_bindgen(js_name = setMaterialColor)]
pub fn set_material_color(material: u32, r: f32, g: f32, b: f32) -> u32 {
    change_material(material, |table, id| table.set_color(id, [r, g, b]))
}

/// Changes a material's opacity and keeps its color.
#[wasm_bindgen(js_name = setMaterialOpacity)]
pub fn set_material_opacity(material: u32, opacity: f32) -> u32 {
    change_material(material, |table, id| table.set_opacity(id, opacity))
}

/// Applies a change to the material with this id, counting from 1.
fn change_material(
    material: u32,
    change: impl FnOnce(&mut MaterialTable, u32) -> Result<(), MaterialError>,
) -> u32 {
    with_engine(|e| {
        let table = e.renderer.settings_mut().materials_mut();
        match change(table, material.wrapping_sub(1)) {
            Ok(()) => 0,
            Err(error) => material_failure(error),
        }
    })
}

// --- Camera, lights and background ---

/// Draws from this camera object with a perspective lens (vertical field of view in degrees).
#[wasm_bindgen(js_name = setCamera)]
pub fn set_camera(camera: u32, fov_degrees: f32, near: f32, far: f32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_camera(
            Handle::from_raw(camera),
            Perspective {
                fov_degrees,
                near,
                far,
            },
        );
        0
    })
}

/// The directional light: the direction its light travels, and its linear color times intensity.
#[wasm_bindgen(js_name = setSun)]
pub fn set_sun(dx: f32, dy: f32, dz: f32, r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_sun([dx, dy, dz], [r, g, b]);
        0
    })
}

/// The ambient light's linear color times its intensity.
#[wasm_bindgen(js_name = setAmbient)]
pub fn set_ambient(r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.renderer.settings_mut().set_ambient([r, g, b]);
        0
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
