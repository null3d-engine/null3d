//! The sharpening on both frame builders: a sketch that sets it draws the two steps of the final
//! pass at the whole canvas's render scale, where the second step sharpens the display color, and a
//! sketch that turns it off draws the frame it drew before. Checked through the mock backend and by
//! decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::output::{Antialias, SceneColor};

/// The world drawn by each frame builder with scene color in `scene_color` and MSAA, whose render
/// scale cannot drop below the whole canvas: WebGPU's, then WebGL2's with multi-draw.
fn worlds(scene_color: u32) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(scene_color),
        antialias: Antialias::Msaa,
        transparent: false,
    };
    let mut webgpu = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let mut webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    webgpu.renderer.settings_mut().set_render_scaling(false);
    webgl2.renderer.settings_mut().set_render_scaling(false);
    (webgpu, webgl2)
}

/// The render passes of a frame.
fn passes(commands: &[(Op, Vec<u32>)]) -> usize {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::BeginRenderPass)
        .count()
}

/// Checks the sharpening on a builder whose render scale cannot drop: at the whole canvas's scale
/// it draws the two steps, and turning it off gives the frame back.
fn check_sharpening<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    // HDR color draws the final pass in place of a resolve pass into the canvas.
    let plain = world.step(&mut mock, true);
    assert_eq!(passes(&plain), 2);
    world.renderer.settings_mut().set_sharpen(Some(0.5));
    // The frame that turns the sharpening on asks for the second step's build, the pass's only one
    // with the upscale and the sharpening, and draws without it until the build is built.
    assert_eq!(passes(&world.step(&mut mock, false)), 2);
    let sharpened = world.step(&mut mock, false);
    // The scene's pass, the first step into the display target, and the second step into the
    // canvas, which draws at the whole canvas's scale.
    assert_eq!(passes(&sharpened), 3);
    // Its strength changes nothing that the frame declares.
    world.renderer.settings_mut().set_sharpen(Some(1.0));
    assert_eq!(passes(&world.step(&mut mock, false)), 3);
    world.renderer.settings_mut().set_sharpen(None);
    assert_eq!(passes(&world.step(&mut mock, false)), 2);
}

#[test]
fn the_sharpening_draws_the_two_steps_at_the_whole_scale() {
    let (webgpu, webgl2) = worlds(format::RGBA16_FLOAT);
    check_sharpening(webgpu);
    check_sharpening(webgl2);
}

/// Checks the 8-bit path, whose scene's pass resolves straight into the canvas until the sketch
/// sharpens or grades: then the final pass draws the two steps.
fn check_eight_bit<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    assert_eq!(passes(&world.step(&mut mock, true)), 1);
    world.renderer.settings_mut().set_sharpen(Some(0.5));
    // The final pass draws at once, and the two steps once the second step's build is built.
    assert_eq!(passes(&world.step(&mut mock, false)), 2);
    assert_eq!(passes(&world.step(&mut mock, false)), 3);
    world.renderer.settings_mut().set_sharpen(None);
    assert_eq!(passes(&world.step(&mut mock, false)), 1);
}

#[test]
fn the_8_bit_path_draws_the_final_pass_while_the_sketch_sharpens() {
    let (webgpu, webgl2) = worlds(format::CANVAS);
    check_eight_bit(webgpu);
    check_eight_bit(webgl2);
}
