//! The output transform on both frame builders: HDR scene color, which the final pass tone maps
//! into the canvas, and the 8-bit path, whose scene shaders tone map themselves and whose render
//! pass resolves straight into the canvas. Checked through the mock backend and by decoding the
//! lists the builders record.

mod common;

use common::{World, count};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{
    NO_TARGET, Op, format, layout, permutation, resource_kind, template, texture_usage,
};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder, linear_to_srgb};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::output::{Output, SceneColor, ToneMapping};
use null3d_render::view::ViewId;

/// The formats of HDR scene color.
const HDR: [u32; 2] = [format::RGBA16_FLOAT, format::RG11B10_UFLOAT];

fn canvas(scene_color: u32, transparent: bool) -> CanvasOutput {
    CanvasOutput {
        scene_color: SceneColor::from_format(scene_color),
        transparent,
    }
}

/// The world drawn by each frame builder, both with scene color in `scene_color`: WebGPU's, then
/// WebGL2's with multi-draw.
fn worlds(
    scene_color: u32,
    transparent: bool,
) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = canvas(scene_color, transparent);
    let webgpu = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas,
        ..RendererConfig::default()
    }));
    let webgl2 = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        canvas,
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    (webgpu, webgl2)
}

/// A device that draws into both HDR formats with MSAA, as core WebGPU with the
/// `rg11b10ufloat-renderable` feature does.
fn hdr_device() -> MockBackend {
    MockBackend::with_capabilities(
        Capabilities::MSAA_FLOAT16.union(Capabilities::RG11B10_RENDERABLE),
    )
}

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The render targets a frame makes: its textures with the render attachment usage, apart from
/// the data textures of the WebGL2 path.
fn targets_made(commands: &[(Op, Vec<u32>)]) -> usize {
    operands(commands, Op::CreateTexture)
        .iter()
        .filter(|o| o[5] & texture_usage::RENDER_ATTACHMENT != 0)
        .count()
}

/// Records the first frame, replays it on `device`, and checks what the HDR path records: scene
/// pipelines that draw linear color into the scene color, a render pass that resolves it into a
/// texture, and the final pass, which reads that texture in a render pass of its own into the
/// canvas.
fn check_hdr_frame<B: FrameBuilder>(world: &mut World<B>, device: &mut MockBackend, scene: u32) {
    world.record(true);
    device
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    let commands = world.commands();
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    let (finals, meshes): (Vec<_>, Vec<_>) =
        pipelines.iter().partition(|o| o[1] == template::FINAL);
    assert_eq!(meshes.len(), 2);
    for mesh in meshes {
        assert_eq!(mesh[2] & permutation::TONE_MAP, 0, "{mesh:?}");
        assert_eq!((mesh[3], mesh[5]), (scene, 4));
    }
    let [final_pipeline] = &finals[..] else {
        panic!("one final pipeline: {finals:?}");
    };
    assert_eq!(&final_pipeline[3..6], [format::CANVAS, format::NONE, 1]);
    // Every pipeline has an id of its own, and the final pass, which draws last, draws with its
    // pipeline.
    let mut ids: Vec<u32> = pipelines.iter().map(|o| o[0]).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), pipelines.len(), "{pipelines:?}");
    let set = operands(&commands, Op::SetPipeline);
    assert_eq!(set.last().map(|o| o[0]), Some(final_pipeline[0]));

    // The multisampled color and the depth, then the texture the color resolves into.
    assert_eq!(targets_made(&commands), 3);
    let passes = operands(&commands, Op::BeginRenderPass);
    let [scene_pass, final_pass] = &passes[..] else {
        panic!("two render passes: {passes:?}");
    };
    let resolved = scene_pass[1];
    assert!(resolved != 0 && resolved != NO_TARGET);
    assert_eq!(
        [final_pass[0], final_pass[1], final_pass[2]],
        [0, NO_TARGET, NO_TARGET]
    );

    // The final pass binds its settings and the resolved color, and draws one triangle.
    let groups = operands(&commands, Op::CreateBindGroup);
    let group = groups.iter().find(|o| o[1] == layout::FINAL).unwrap();
    assert_eq!(group[2], 2);
    assert_eq!(group[4], resource_kind::BUFFER);
    assert_eq!((group[9], group[10]), (resource_kind::TEXTURE, resolved));
    let draws = operands(&commands, Op::Draw);
    assert_eq!(draws, [vec![3, 1, 0, 0]]);
    let settings = group[5];
    assert_eq!(
        operands(&commands, Op::WriteBuffer)
            .iter()
            .filter(|o| o[0] == settings)
            .count(),
        1
    );
}

#[test]
fn hdr_color_draws_linear_color_and_the_final_pass_tone_maps_it_into_the_canvas() {
    for scene in HDR {
        let (mut webgpu, mut webgl2) = worlds(scene, false);
        check_hdr_frame(&mut webgpu, &mut hdr_device(), scene);
        check_hdr_frame(&mut webgl2, &mut hdr_device(), scene);
    }
}

#[test]
fn a_device_without_hdr_msaa_or_the_small_float_format_rejects_those_targets() {
    let (mut webgpu, _) = worlds(format::RGBA16_FLOAT, false);
    webgpu.record(true);
    assert!(
        MockBackend::default()
            .replay(webgpu.renderer.list(1).words())
            .is_err()
    );
    let (mut webgpu, _) = worlds(format::RG11B10_UFLOAT, false);
    webgpu.record(true);
    let mut msaa_float16 = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    assert!(
        msaa_float16
            .replay(webgpu.renderer.list(1).words())
            .is_err()
    );
}

/// Steps a world to its next frame and records it.
fn next<B: FrameBuilder>(world: &mut World<B>, device: &mut MockBackend) -> Vec<(Op, Vec<u32>)> {
    world.frame += 1;
    world.record(false);
    device
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    world.commands()
}

/// The final pass's writes of its settings, and the groups it binds, in a frame.
fn final_work(commands: &[(Op, Vec<u32>)], settings: u32) -> (usize, usize) {
    let writes = operands(commands, Op::WriteBuffer)
        .iter()
        .filter(|o| o[0] == settings)
        .count();
    let groups = operands(commands, Op::CreateBindGroup)
        .iter()
        .filter(|o| o[1] == layout::FINAL)
        .count();
    (writes, groups)
}

fn check_final_updates<B: FrameBuilder>(mut world: World<B>) {
    let mut device = hdr_device();
    world.record(true);
    device.replay(world.renderer.list(1).words()).unwrap();
    let group = operands(&world.commands(), Op::CreateBindGroup)
        .into_iter()
        .find(|o| o[1] == layout::FINAL)
        .unwrap();
    let settings = group[5];

    // A steady frame uploads nothing for the final pass, and keeps its bind group.
    assert_eq!(final_work(&next(&mut world, &mut device), settings), (0, 0));

    // New settings upload once, and reach the frame uniform too.
    let output = Output {
        tone_mapping: ToneMapping::Agx,
        exposure: 2.0,
    };
    world.renderer.settings_mut().set_output(output);
    assert_eq!(final_work(&next(&mut world, &mut device), settings), (1, 0));
    assert_eq!(final_work(&next(&mut world, &mut device), settings), (0, 0));

    // A new canvas size makes the textures again, so the pass binds the new scene color.
    world.canvas = (800, 600);
    let resized = next(&mut world, &mut device);
    assert_eq!(targets_made(&resized), 3);
    assert_eq!(final_work(&resized, settings), (0, 1));

    // After the GPU is replaced, the pass makes its pipeline, buffer and group again.
    world.renderer.reset_gpu();
    let mut new_device = hdr_device();
    let again = next(&mut world, &mut new_device);
    assert_eq!(final_work(&again, settings), (1, 1));
    assert!(
        operands(&again, Op::CreateRenderPipeline)
            .iter()
            .any(|o| o[1] == template::FINAL)
    );
}

#[test]
fn the_final_pass_uploads_settings_when_they_change_and_binds_each_new_scene_color() {
    let (webgpu, webgl2) = worlds(format::RGBA16_FLOAT, false);
    check_final_updates(webgpu);
    check_final_updates(webgl2);
}

#[test]
fn new_settings_reach_the_frame_uniform_of_every_view() {
    let (mut webgpu, _) = worlds(format::CANVAS, false);
    let output = Output {
        tone_mapping: ToneMapping::Neutral,
        exposure: 0.5,
    };
    webgpu.renderer.settings_mut().set_output(output);
    webgpu.record(true);
    let frame = webgpu.renderer.view_frame(ViewId::CAMERA).unwrap();
    assert_eq!(frame.uniform.output, output.uniform());
}

fn check_eight_bit_frame<B: FrameBuilder>(mut world: World<B>) {
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    assert_eq!(pipelines.len(), 2);
    for pipeline in pipelines {
        assert_ne!(pipeline[2] & permutation::TONE_MAP, 0, "{pipeline:?}");
        assert_eq!(pipeline[3], format::CANVAS);
    }
    // The scene's render pass resolves into the canvas, and nothing draws after it.
    let passes = operands(&commands, Op::BeginRenderPass);
    assert_eq!(passes.len(), 1);
    assert_eq!(passes[0][1], 0);
    assert_eq!(count(&commands, Op::Draw), 0);
    assert_eq!(targets_made(&commands), 2);
}

#[test]
fn the_8_bit_path_tone_maps_in_the_scene_shaders_and_adds_no_pass() {
    let (webgpu, webgl2) = worlds(format::CANVAS, false);
    check_eight_bit_frame(webgpu);
    check_eight_bit_frame(webgl2);
}

/// The clear color of the frame's first render pass.
fn clear_color<B: FrameBuilder>(world: &mut World<B>) -> [f32; 4] {
    world.record(true);
    let passes = operands(&world.commands(), Op::BeginRenderPass);
    std::array::from_fn(|k| f32::from_bits(passes[0][3 + k]))
}

#[test]
fn the_background_clears_linear_for_hdr_and_after_the_output_on_the_8_bit_path() {
    let background = [0.5, 0.2, 0.1];
    let (mut webgpu, mut webgl2) = worlds(format::RGBA16_FLOAT, false);
    webgpu.renderer.settings_mut().set_background(background);
    webgl2.renderer.settings_mut().set_background(background);
    assert_eq!(clear_color(&mut webgpu), [0.5, 0.2, 0.1, 1.0]);
    assert_eq!(clear_color(&mut webgl2), [0.5, 0.2, 0.1, 1.0]);

    let (mut webgpu, _) = worlds(format::CANVAS, false);
    webgpu.renderer.settings_mut().set_background(background);
    let [r, g, b] = Output::default().tone_map(background).map(linear_to_srgb);
    assert_eq!(clear_color(&mut webgpu), [r, g, b, 1.0]);
}

#[test]
fn a_transparent_canvas_stays_clear_until_the_sketch_sets_a_background() {
    for scene in [format::RGBA16_FLOAT, format::CANVAS] {
        let (mut webgpu, mut webgl2) = worlds(scene, true);
        assert_eq!(clear_color(&mut webgpu), [0.0; 4]);
        assert_eq!(clear_color(&mut webgl2), [0.0; 4]);
        let (mut opaque, _) = worlds(scene, false);
        assert_eq!(clear_color(&mut opaque), [0.0, 0.0, 0.0, 1.0]);
        webgpu.frame += 1;
        webgpu.renderer.settings_mut().set_background([0.0; 3]);
        assert_eq!(clear_color(&mut webgpu), [0.0, 0.0, 0.0, 1.0]);
    }
}
