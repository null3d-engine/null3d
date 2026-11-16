//! The heap that frames hold for a large blended batch in the camera's one-sample layer, against
//! the same batch in the transparent pass. The layer draws the rows that the transparent pass
//! sorted and uploaded, so it holds nothing more for each row. The test binary counts the bytes
//! that live on the heap with an allocator of its own.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use common::World;
use common::blended::blended_pair;
use null3d_gpu::drawlist::{self, Op, format};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::materials::feature;
use null3d_render::output::SceneColor;
use null3d_render::scope;

/// The bytes that live on the heap.
static LIVE: AtomicUsize = AtomicUsize::new(0);

/// The system allocator, counting the bytes that live.
struct Live;

// SAFETY: every call passes its arguments on to the system allocator unchanged.
unsafe impl GlobalAlloc for Live {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        LIVE.fetch_add(size, Ordering::Relaxed);
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.realloc(ptr, layout, size) }
    }
}

#[global_allocator]
static ALLOCATOR: Live = Live;

/// The rows of the batch.
const ROWS: u32 = 100_000;
/// The frames that the camera moves through.
const FRAMES: u32 = 12;

/// The bytes that frames of a moving camera leave on the heap for a double-sided blended batch of
/// cards that read the scene's depth, as splats are, after the batch itself, and whether the last
/// frame drew the one-sample layer.
fn held<B: FrameBuilder>(mut world: World<B>, single_layer: bool) -> (usize, bool) {
    let features = feature::DOUBLE_SIDED | feature::SCENE_DEPTH;
    let (mesh, material) = blended_pair(&mut world, &common::grid(1, 1), features);
    world
        .renderer
        .settings_mut()
        .materials_mut()
        .set_single_layer(material - 1, single_layer)
        .unwrap();
    let batch = world
        .batches
        .create(ROWS, false, false, mesh, material, 1.5)
        .unwrap();
    let rows = world.batches.get_mut(batch).unwrap();
    for (k, place) in rows.positions_mut().chunks_mut(3).enumerate() {
        place[0] = (k % 100) as f32 * 0.01;
        place[2] = -((k / 100) as f32) * 0.01;
    }
    rows.set_active_count(ROWS).unwrap();
    let before = LIVE.load(Ordering::Relaxed);
    for frame in 1..=FRAMES {
        world.frame = frame;
        let x = frame as f32 * 0.3;
        world
            .scene
            .set_position(world.camera, [x, 1.0, 20.0])
            .unwrap();
        world.record(frame == 1);
    }
    let layered = drawlist::decode(world.renderer.list(FRAMES).words())
        .map(Result::unwrap)
        .filter(|command| command.op == Op::BeginRenderPass)
        .any(|command| command.operands[command.operands.len() - 1] == scope::SINGLE);
    (LIVE.load(Ordering::Relaxed) - before, layered)
}

#[test]
fn a_large_batch_in_the_one_sample_layer_holds_no_more_than_in_the_transparent_pass() {
    let hdr = || {
        World::with_config(RendererConfig {
            canvas: CanvasOutput {
                scene_color: SceneColor::from_format(format::RG11B10_UFLOAT),
                ..CanvasOutput::default()
            },
            ..RendererConfig::default()
        })
    };
    for (name, world) in [("8-bit", World::new as fn() -> World), ("HDR", hdr)] {
        let (sorted, drew) = held(world(), false);
        assert!(!drew, "{name}: the transparent pass draws the batch");
        let (layered, drew) = held(world(), true);
        assert!(drew, "{name}: the layer draws the batch");
        // A few kilobytes cover the layer's own passes, pipelines and bind groups.
        assert!(
            layered <= sorted + (64 << 10),
            "{name}: {layered} bytes with the layer, {sorted} without, for {ROWS} rows"
        );
    }
}
