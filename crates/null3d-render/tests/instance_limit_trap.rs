//! A scene of a device's full instance limit on the direct-draw path: each view that draws it
//! copies its visible instances through the frame's upload arena. A frame whose arena cannot fit
//! the engine's shared memory reports the bytes it needs (E1109), and never aborts.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use null3d_core::handle::Handle;
use null3d_core::scene::flags;
use null3d_gpu::drawlist::sizes;
use null3d_render::frame::{FrameBuilder, RecordError};
use null3d_render::gpu_driven::RendererConfig;

/// The engine's shared memory maximum, which every preset sets.
const ENGINE_MAX: usize = 1024 * 1024 * 1024;
/// The storage binding of a device with WebGPU's default limits.
const PORTABLE_BINDING: u32 = sizes::PORTABLE_STORAGE_BINDING_BYTES;

/// The bytes that the process holds, standing in for the engine's shared memory.
static LIVE: AtomicUsize = AtomicUsize::new(0);

/// The process-wide allocator of the test, which refuses a block that would take the engine's
/// held bytes past its shared memory maximum. The wasm build allocates from one such memory, so a
/// frame that passes it cannot grow its memory either.
struct SharedMemory;

impl SharedMemory {
    /// Takes `size` bytes from the maximum, or returns false when they would pass it.
    fn take(size: usize) -> bool {
        let mut live = LIVE.load(Ordering::Relaxed);
        loop {
            let Some(next) = live.checked_add(size) else {
                return false;
            };
            if next > ENGINE_MAX {
                return false;
            }
            match LIVE.compare_exchange_weak(live, next, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => return true,
                Err(held) => live = held,
            }
        }
    }
}

unsafe impl GlobalAlloc for SharedMemory {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let size = layout.size().max(1);
        if !Self::take(size) {
            return std::ptr::null_mut();
        }
        let ptr = unsafe { System.alloc(layout) };
        if ptr.is_null() {
            LIVE.fetch_sub(size, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let size = layout.size().max(1);
        if !Self::take(size) {
            return std::ptr::null_mut();
        }
        let ptr = unsafe { System.alloc_zeroed(layout) };
        if ptr.is_null() {
            LIVE.fetch_sub(size, Ordering::Relaxed);
        }
        ptr
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let (old, new) = (layout.size().max(1), new_size.max(1));
        let grown = new > old && !Self::take(new - old);
        if grown {
            return std::ptr::null_mut();
        }
        if new < old {
            LIVE.fetch_sub(old - new, Ordering::Relaxed);
        }
        let out = unsafe { System.realloc(ptr, layout, new_size) };
        if out.is_null() && new > old {
            LIVE.fetch_sub(new - old, Ordering::Relaxed);
        }
        out
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size().max(1), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOC: SharedMemory = SharedMemory;

/// Serialises the tests, which share the process's memory maximum.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Waits for the other test to release the memory maximum.
fn serial() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// A static scene of `rows` instances that cast the sun's shadows, drawn on the direct path with
/// the storage binding of a device that has WebGPU's default limits. Returns the world and the
/// batch, whose rows start inactive.
fn world(rows: u32) -> (common::World, Handle) {
    let mut world = common::World::with_config(RendererConfig {
        storage_binding_bytes: PORTABLE_BINDING,
        direct_draws: true,
        ..RendererConfig::default()
    });
    let batch = world
        .batches
        .create(rows, false, false, 1, 1, 0.9)
        .expect("the batch");
    let rows_active = world.batches.get_mut(batch).expect("the batch exists");
    rows_active.set_shadows(flags::CAST_SHADOWS | flags::RECEIVE_SHADOWS);
    // A new batch draws every row until the page sets its load.
    rows_active
        .set_active_count(0)
        .expect("the rows start inactive");
    world.cast_sun_shadows(4);
    (world, batch)
}

/// Makes `rows` of `batch` draw, as the page does when its load arrives.
fn activate(world: &mut common::World, batch: Handle, rows: u32) {
    world
        .batches
        .get_mut(batch)
        .expect("the batch exists")
        .set_active_count(rows)
        .expect("the rows are active");
}

/// The rows that the wind stress page draws on a device whose storage binding is the portable
/// 128 MiB: 2,097,152 rows of 64 bytes, less the room the page keeps for the scene.
const FULL_LOAD: u32 = 2_095_104;

/// Rows whose copies fit the engine's memory when the frame counts only the shadow views that
/// draw. A bound that also counts the shadow tiles, which no light draws into, passes the memory
/// at this count.
const LARGE_LOAD: u32 = 1_300_000;

#[test]
fn a_scene_that_holds_a_full_load_without_drawing_it_records() {
    let _serial = serial();
    let (mut world, _batch) = world(FULL_LOAD);
    // The rows exist but none draws, so the frame copies none of them and fits the memory.
    world.try_record(true).expect("the frame records");
}

#[test]
fn a_full_load_that_cannot_fit_reports_it_and_a_smaller_load_records_next() {
    let _serial = serial();
    let (mut world, batch) = world(FULL_LOAD);
    // The page's start: the rows exist and none draws.
    world.try_record(true).expect("the first frame records");
    // The page draws them all, and the frame's copies pass the memory. It reports the bytes.
    activate(&mut world, batch, FULL_LOAD);
    world.frame += 1;
    match world.try_record(false) {
        Err(RecordError::OutOfMemory { bytes }) if bytes > 0 => {}
        other => panic!("expected the frame to report its uploads, got {other:?}"),
    }
    // The page gives up the load it cannot draw, and the next frame records.
    activate(&mut world, batch, 10_000);
    world.frame += 1;
    world.try_record(false).expect("the next frame records");
}

#[test]
fn a_large_load_records_when_the_frame_counts_only_the_shadow_views_that_draw() {
    let _serial = serial();
    let (mut world, batch) = world(LARGE_LOAD);
    activate(&mut world, batch, LARGE_LOAD);
    world.try_record(true).expect("the frame records");
}

#[test]
fn a_first_frame_that_cannot_fit_records_again_once_the_load_drops() {
    let _serial = serial();
    let (mut world, batch) = world(FULL_LOAD);
    activate(&mut world, batch, FULL_LOAD);
    match world.try_record(true) {
        Err(RecordError::OutOfMemory { bytes }) if bytes > 0 => {}
        other => panic!("expected the first frame to report its uploads, got {other:?}"),
    }
    // The page lowers the load. The next frame starts the frame's GPU objects again, from the
    // beginning, and records.
    activate(&mut world, batch, 10_000);
    world.frame += 1;
    world.try_record(false).expect("the next frame records");
    // The list that the recovered frame recorded is whole: the mock backend, which refuses an
    // object or a binding that a real device refuses, replays all of it.
    null3d_gpu::mock::MockBackend::default()
        .replay(world.renderer.list(world.frame).words())
        .expect("the recovered frame replays");
}
