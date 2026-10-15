//! Still-camera accumulation on both frame builders: a view whose scene stops changing blends its
//! frames into a kept history and then rests, a change draws at once and starts again, and a page
//! that turns the accumulation off never blends or rests. Checked by replaying each frame's list
//! on the mock backend, so every frame's commands find the objects they use.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::output::{Antialias, SceneColor};
use null3d_render::still::MAX_SAMPLES;

/// The seconds between frames.
const STEP: f32 = 1.0 / 60.0;

/// The world drawn by each frame builder into HDR targets in the `antialias` mode, with the render
/// scale free to drop below the whole canvas: WebGPU's, then WebGL2's with multi-draw. The world's
/// instance batch keeps its rows every frame, so a still view of it settles.
fn worlds(antialias: Antialias) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias,
        transparent: false,
    };
    let mut webgpu = World::build_still(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let mut webgl2 = World::build_still(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    for settings in [
        webgpu.renderer.settings_mut(),
        webgl2.renderer.settings_mut(),
    ] {
        settings.set_render_scaling(true);
        settings.set_still_enabled(true);
    }
    (webgpu, webgl2)
}

/// A device that draws into HDR targets with MSAA.
fn device() -> MockBackend {
    MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16)
}

/// What one stepped frame saw of the signals that decide whether a view settles, so a view that
/// never rests says which one held it back.
#[derive(Clone, Copy)]
struct Seen {
    frame: u32,
    samples: u32,
    transforms: bool,
    batches: bool,
    words: u64,
}

/// A hash of a frame's draw-list words: two frames of one parity that repeat their words hash the
/// same.
fn words_hash(words: &[u32]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &word in words {
        hash = (hash ^ u64::from(word)).wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Records the world's next frame with the clock moved on, replays it on `device`, and returns
/// its commands.
fn step<B: FrameBuilder>(world: &mut World<B>, device: &mut MockBackend) -> Vec<(Op, Vec<u32>)> {
    step_seen(world, device).0
}

/// As [`step`], with what the frame saw of the still signals.
fn step_seen<B: FrameBuilder>(
    world: &mut World<B>,
    device: &mut MockBackend,
) -> (Vec<(Op, Vec<u32>)>, Seen) {
    world.frame += 1;
    let frame = world.frame;
    world
        .renderer
        .settings_mut()
        .set_clock(frame as f32 * STEP, STEP, frame);
    world.record(frame == 1);
    device.replay(world.renderer.list(frame).words()).unwrap();
    let seen = Seen {
        frame,
        samples: world.renderer.still().samples(),
        transforms: world.scene.changed().any(),
        batches: world.batches.changed(),
        words: words_hash(world.renderer.list(frame).words()),
    };
    (world.commands(), seen)
}

/// The draw calls of a frame.
fn draws(commands: &[(Op, Vec<u32>)]) -> usize {
    commands
        .iter()
        .filter(|(op, _)| matches!(op, Op::Draw | Op::DrawIndexed))
        .count()
}

/// True when a frame creates the accumulation's pipeline.
fn creates_accumulation(commands: &[(Op, Vec<u32>)]) -> bool {
    commands.iter().any(|(op, operands)| {
        *op == Op::CreateRenderPipeline && operands[1] == template::ACCUMULATE
    })
}

/// The frames a still view may take to rest: one blended frame per sample, plus the frames the
/// first blend waits for and the frames after a change.
const REST_FRAMES: u32 = MAX_SAMPLES + 16;

/// Steps the world until its view rests, and returns the frames that took. Fails after more frames
/// than a still view needs, and names what each of the last frames saw.
fn rest<B: FrameBuilder>(world: &mut World<B>, device: &mut MockBackend) -> u32 {
    let mut seen = Vec::new();
    for frames in 1..=REST_FRAMES {
        let (_, entry) = step_seen(world, device);
        if world.renderer.still().rests() {
            return frames;
        }
        seen.push(entry);
    }
    for entry in &seen[seen.len().saturating_sub(10)..] {
        eprintln!(
            "frame {}: {} samples, transform {} batches {} words {:#018x}",
            entry.frame, entry.samples, entry.transforms, entry.batches, entry.words
        );
    }
    panic!(
        "the view did not rest within {REST_FRAMES} frames: {} samples",
        world.renderer.still().samples()
    );
}

fn accumulates_rests_and_draws_a_change_at_once<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    let first = step(&mut world, &mut device);
    let moving = draws(&first);
    assert_eq!(world.renderer.still().samples(), 0);
    // The frames of a still view blend: the blend draws one triangle into the history, and the
    // still build draws in place of the final pass. The pipeline comes earlier, so no frame that
    // blends makes a GPU object.
    let mut blended = None;
    let mut asked = false;
    for _ in 0..REST_FRAMES {
        let commands = step(&mut world, &mut device);
        if world.renderer.still().samples() >= 2 {
            assert!(
                !creates_accumulation(&commands),
                "a frame that blends creates no pipeline"
            );
            blended = Some(draws(&commands));
            break;
        }
        asked |= creates_accumulation(&commands);
    }
    assert!(
        asked,
        "the accumulation's pipeline is asked for before a frame blends"
    );
    assert_eq!(blended, Some(moving + 1), "a still frame blends its color");
    rest(&mut world, &mut device);

    // A moved object draws in the next frame, unblended, and the view accumulates again.
    let object = world.objects[0];
    world.scene.set_position(object, [0.0, 3.0, 0.0]).unwrap();
    step(&mut world, &mut device);
    assert_eq!(world.renderer.still().samples(), 0, "a change starts again");
    assert!(!world.renderer.still().rests());
    rest(&mut world, &mut device);
}

#[test]
fn a_still_view_accumulates_rests_and_draws_a_change_at_once() {
    let (webgpu, webgl2) = worlds(Antialias::Msaa);
    accumulates_rests_and_draws_a_change_at_once(webgpu);
    accumulates_rests_and_draws_a_change_at_once(webgl2);
}

#[test]
fn a_still_view_rests_below_the_whole_canvas_and_with_fxaa() {
    for antialias in [Antialias::Fxaa, Antialias::None] {
        let (mut webgpu, mut webgl2) = worlds(antialias);
        webgpu.render_scale = RenderScale::from_thousandths(500);
        webgl2.render_scale = RenderScale::from_thousandths(500);
        rest(&mut webgpu, &mut device());
        rest(&mut webgl2, &mut device());
    }
}

fn moving_camera_never_blends<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    let camera = world.camera;
    for k in 0..MAX_SAMPLES + 8 {
        world
            .scene
            .set_position(camera, [0.0, 0.0, 20.0 + k as f32 * 0.01])
            .unwrap();
        step(&mut world, &mut device);
        assert_eq!(world.renderer.still().samples(), 0, "frame {k}");
    }
}

#[test]
fn a_moving_camera_never_blends() {
    let (webgpu, webgl2) = worlds(Antialias::Msaa);
    moving_camera_never_blends(webgpu);
    moving_camera_never_blends(webgl2);
}

fn turned_off_never_blends<B: FrameBuilder>(mut world: World<B>) {
    world.renderer.settings_mut().set_still_enabled(false);
    let mut device = device();
    let first = step(&mut world, &mut device);
    assert!(!creates_accumulation(&first));
    for k in 0..MAX_SAMPLES + 8 {
        step(&mut world, &mut device);
        assert_eq!(world.renderer.still().samples(), 0, "frame {k}");
    }
}

#[test]
fn a_page_that_turns_the_accumulation_off_never_blends() {
    let (webgpu, webgl2) = worlds(Antialias::Msaa);
    turned_off_never_blends(webgpu);
    turned_off_never_blends(webgl2);
}
