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
use null3d_gpu::drawlist::sizes;
use null3d_render::camera::Perspective;
use null3d_render::geometry::{box_geometry, sphere_geometry};
use null3d_render::gpu_driven::{
    BYTES_PER_SOURCE, FrameInput, GpuDrivenRenderer, MAX_USEFUL_BINDING_BYTES, RecordError,
    RendererConfig,
};
use null3d_render::materials::{MaterialError, Shading};
use wasm_bindgen::prelude::*;

pub mod constants;

use constants::{batch_field, ring_field, scene_field};

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
    /// A function that needs the engine ran before `initEngine`, or `initEngine` ran twice.
    pub const NOT_READY: u32 = 1403;
    /// A mesh, material or GPU buffer is full, or an id names nothing (details say which).
    pub const RENDER: u32 = 1501;
}

/// Details of `codes::RENDER` failures.
mod render_detail {
    pub const DRAW_LIST_FULL: u32 = 1;
    pub const MESH_BUFFERS_FULL: u32 = 2;
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
    renderer: GpuDrivenRenderer,
    structure_changed: bool,
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
    render_failure(
        match error {
            RecordError::DrawListFull => render_detail::DRAW_LIST_FULL,
            RecordError::MeshBuffersFull => render_detail::MESH_BUFFERS_FULL,
            RecordError::TooManySources { .. } => render_detail::TOO_MANY_SOURCES,
            RecordError::UploadsFull => render_detail::UPLOADS_FULL,
        },
        match error {
            RecordError::TooManySources { limit } => limit,
            _ => 0,
        },
    )
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
/// serve, timing their work with the browser's clock. `storage_binding_bytes` is the largest
/// storage binding of the device the engine draws with. Every capacity is fixed from here on.
#[wasm_bindgen(js_name = initEngine)]
pub fn init_engine(
    job_workers: u32,
    scene_capacity: u32,
    max_batches: u32,
    commands: u32,
    storage_binding_bytes: u32,
) -> u32 {
    // SAFETY: as in `with_engine`; this is the first call on the sketch thread.
    let cell = unsafe { &mut *ENGINE.0.get() };
    let jobs = JobSystem::with_config(JobConfig {
        workers: job_workers,
        clock: Some(performance_now),
        ..JobConfig::default()
    });
    if cell.is_some() || JOBS.set(jobs).is_err() {
        return fail(codes::NOT_READY, [1, 0]);
    }
    *cell = Some(Engine {
        scene: SceneStorage::with_capacity(scene_capacity),
        ring: CommandRing::with_capacity(commands),
        batches: BatchTable::with_capacity(max_batches),
        snapshot: FrameSnapshot::with_capacity(UPLOAD_RANGES),
        renderer: GpuDrivenRenderer::new(RendererConfig {
            storage_binding_bytes: storage_binding_bytes.clamp(
                sizes::PORTABLE_STORAGE_BINDING_BYTES,
                MAX_USEFUL_BINDING_BYTES,
            ),
            ..RendererConfig::default()
        }),
        structure_changed: true,
    });
    0
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

/// Copies an object's world matrix of the current frame (12 floats, rows of a 3 × 4 matrix).
#[wasm_bindgen(js_name = worldMatrix)]
pub fn world_matrix(handle: u32, out: &mut [f32]) -> u32 {
    with_engine(|e| match e.scene.world_matrix(Handle::from_raw(handle)) {
        Ok(matrix) => {
            let n = out.len().min(matrix.len());
            out[..n].copy_from_slice(&matrix[..n]);
            0
        }
        Err(error) => core_failure(error),
    })
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
        e.batches.update(jobs, frame);
        0
    })
}

/// Records the frame's upload list and its draw list for a canvas of this size in device pixels.
#[wasm_bindgen(js_name = recordFrame)]
pub fn record_frame(frame: u32, width: u32, height: u32) -> u32 {
    with_engine(|e| {
        e.snapshot.record(frame, &e.scene, &e.batches);
        let input = FrameInput {
            frame,
            scene: &e.scene,
            batches: &e.batches,
            snapshot: &e.snapshot,
            canvas: (width, height),
            structure_changed: e.structure_changed,
        };
        match e.renderer.record(&input) {
            Ok(()) => {
                e.structure_changed = false;
                0
            }
            Err(error) => record_failure(error),
        }
    })
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
            .and_then(|id| e.renderer.meshes().mesh(id))
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
    with_engine(
        |e| match e.batches.destroy(Handle::from_raw(batch), frame) {
            Ok(()) => {
                e.structure_changed = true;
                0
            }
            Err(error) => core_failure(error),
        },
    )
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

fn add_mesh(e: &mut Engine, geometry: &null3d_render::geometry::Geometry) -> Result<u32, u32> {
    let id = e
        .renderer
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

/// The distance from a mesh's origin to its farthest vertex, or 0 for an unknown mesh.
#[wasm_bindgen(js_name = meshRadius)]
pub fn mesh_radius(mesh: u32) -> f32 {
    let mut radius = 0.0;
    with_engine(|e| {
        if let Some(slot) = mesh
            .checked_sub(1)
            .and_then(|id| e.renderer.meshes().mesh(id))
        {
            radius = slot.radius;
        }
        0
    });
    radius
}

/// Creates a material with a linear color and returns its id, counting from 1: a lit material
/// shades like three.js's `MeshLambertMaterial`, an unlit one like its `MeshBasicMaterial`.
#[wasm_bindgen(js_name = createMaterial)]
pub fn create_material(unlit: bool, r: f32, g: f32, b: f32, a: f32) -> u32 {
    let shading = if unlit { Shading::Unlit } else { Shading::Lit };
    value_with_engine(|e| {
        e.renderer
            .materials_mut()
            .create(shading, [r, g, b, a])
            .map(|id| id + 1)
            .map_err(material_failure)
    })
}

/// Changes a material's linear color.
#[wasm_bindgen(js_name = setMaterialColor)]
pub fn set_material_color(material: u32, r: f32, g: f32, b: f32, a: f32) -> u32 {
    with_engine(|e| {
        match e
            .renderer
            .materials_mut()
            .set_color(material.wrapping_sub(1), [r, g, b, a])
        {
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
        e.renderer.set_camera(
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
        e.renderer.set_sun([dx, dy, dz], [r, g, b]);
        0
    })
}

/// The ambient light's linear color times its intensity.
#[wasm_bindgen(js_name = setAmbient)]
pub fn set_ambient(r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.renderer.set_ambient([r, g, b]);
        0
    })
}

/// The linear background color.
#[wasm_bindgen(js_name = setBackground)]
pub fn set_background(r: f32, g: f32, b: f32) -> u32 {
    with_engine(|e| {
        e.renderer.set_background([r, g, b]);
        0
    })
}
