//! The render scale on both frame builders: scene passes draw into the top-left corner of their
//! targets through the viewport and the scissor, the final pass scales the corner up to the whole
//! canvas, and a new scale makes, destroys and resizes no GPU object. Checked through the mock
//! backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, layout, resource_kind, texture_usage};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::output::SceneColor;

/// Commands that make, destroy or resize a GPU object.
const OBJECT_OPS: [Op; 9] = [
    Op::CreateBuffer,
    Op::DestroyBuffer,
    Op::CreateTexture,
    Op::DestroyTexture,
    Op::ResizeCanvas,
    Op::CreateRenderPipeline,
    Op::CreateComputePipeline,
    Op::CreateBindGroup,
    Op::CreateSampler,
];

/// The world drawn by each frame builder, both with scene color in `scene_color` and the render
/// scale free to drop below the whole canvas: WebGPU's, then WebGL2's with multi-draw.
fn worlds(scene_color: u32) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(scene_color),
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
    webgpu.renderer.settings_mut().set_render_scaling(true);
    webgl2.renderer.settings_mut().set_render_scaling(true);
    (webgpu, webgl2)
}

/// A device that draws into HDR targets with MSAA.
fn device() -> MockBackend {
    MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16)
}

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// Records the world's next frame at `scale` thousandths, replays it on `device`, and returns its
/// commands.
fn frame_at<B: FrameBuilder>(
    world: &mut World<B>,
    device: &mut MockBackend,
    scale: u32,
) -> Vec<(Op, Vec<u32>)> {
    world.frame += 1;
    world.render_scale = RenderScale::from_thousandths(scale);
    world.record(world.frame == 1);
    device
        .replay(world.renderer.list(world.frame).words())
        .unwrap();
    world.commands()
}

/// The viewport and the scissor that each render pass of a frame sets, in pass order: `None` for
/// a pass that draws into its whole targets.
fn render_areas(commands: &[(Op, Vec<u32>)]) -> Vec<Option<[u32; 4]>> {
    let mut areas = Vec::new();
    for (k, (op, _)) in commands.iter().enumerate() {
        if *op != Op::BeginRenderPass {
            continue;
        }
        let area = match (commands.get(k + 1), commands.get(k + 2)) {
            (Some((Op::SetViewport, viewport)), Some((Op::SetScissor, scissor))) => {
                assert_eq!(
                    &viewport[..4],
                    &scissor[..],
                    "the scissor fits the viewport"
                );
                assert_eq!(
                    [f32::from_bits(viewport[4]), f32::from_bits(viewport[5])],
                    [0.0, 1.0]
                );
                Some([viewport[0], viewport[1], viewport[2], viewport[3]])
            }
            _ => None,
        };
        areas.push(area);
    }
    assert_eq!(
        commands
            .iter()
            .filter(|(op, _)| *op == Op::SetViewport)
            .count(),
        areas.iter().flatten().count(),
        "viewports come only at the start of a render pass"
    );
    areas
}

fn check_scaled_frames<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    let first = frame_at(&mut world, &mut device, 1000);
    // The scene pass, then the final pass into the canvas, both over their whole targets.
    assert_eq!(render_areas(&first), [None, None]);
    let settings = operands(&first, Op::CreateBindGroup)
        .into_iter()
        .find(|o| o[1] == layout::FINAL)
        .map(|o| o[5])
        .unwrap();
    let writes = |commands: &[(Op, Vec<u32>)]| {
        operands(commands, Op::WriteBuffer)
            .iter()
            .filter(|o| o[0] == settings)
            .count()
    };
    // The canvas is 640 x 360 device pixels. Sizes round up.
    for (scale, width, height) in [
        (750, 480, 270),
        (500, 320, 180),
        (333, 214, 120),
        (1000, 640, 360),
        (601, 385, 217),
    ] {
        let commands = frame_at(&mut world, &mut device, scale);
        let area = (scale < 1000).then_some([0, 0, width, height]);
        assert_eq!(render_areas(&commands), [area, None], "scale {scale}");
        for op in OBJECT_OPS {
            assert_eq!(
                common::count(&commands, op),
                0,
                "a new render scale records no {op:?}"
            );
        }
        // The final pass learns the new render size.
        assert_eq!(writes(&commands), 1, "scale {scale}");
        // A steady frame at the same scale uploads nothing for the final pass.
        let steady = frame_at(&mut world, &mut device, scale);
        assert_eq!(writes(&steady), 0, "scale {scale}");
        assert_eq!(render_areas(&steady), [area, None]);
    }
}

#[test]
fn a_lower_render_scale_draws_into_a_corner_of_the_same_targets() {
    for scene_color in [format::RGBA16_FLOAT, format::CANVAS] {
        let (webgpu, webgl2) = worlds(scene_color);
        check_scaled_frames(webgpu);
        check_scaled_frames(webgl2);
    }
}

/// Checks the final pass of the 8-bit path: the scene's render pass resolves into a texture of the
/// canvas's format, which the final pass reads.
fn check_eight_bit_scaling<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    let commands = frame_at(&mut world, &mut device, 500);
    let passes = operands(&commands, Op::BeginRenderPass);
    let [scene_pass, final_pass] = &passes[..] else {
        panic!("two render passes: {passes:?}");
    };
    let resolved = scene_pass[1];
    assert_eq!(final_pass[0], 0, "the final pass draws into the canvas");
    let made = operands(&commands, Op::CreateTexture);
    let texture = made.iter().find(|o| o[0] == resolved).unwrap();
    assert_eq!((texture[4], texture[6]), (format::CANVAS, 1));
    assert_ne!(texture[5] & texture_usage::TEXTURE_BINDING, 0);
    let group = operands(&commands, Op::CreateBindGroup)
        .into_iter()
        .find(|o| o[1] == layout::FINAL)
        .unwrap();
    assert_eq!(group[2], 2);
    assert_eq!((group[9], group[10]), (resource_kind::TEXTURE, resolved));
    assert_eq!(operands(&commands, Op::Draw), [vec![3, 1, 0, 0]]);
}

#[test]
fn the_8_bit_path_scales_up_in_the_final_pass_while_the_scale_can_drop() {
    let (webgpu, webgl2) = worlds(format::CANVAS);
    check_eight_bit_scaling(webgpu);
    check_eight_bit_scaling(webgl2);
}

/// Checks that an 8-bit world whose render scale cannot drop resolves into the canvas and draws
/// the whole canvas at any scale it is given, then switches to the final pass when its scale can
/// drop, and back.
fn check_scaling_switch<B: FrameBuilder>(mut world: World<B>) {
    let mut device = MockBackend::default();
    world.renderer.settings_mut().set_render_scaling(false);
    let commands = frame_at(&mut world, &mut device, 500);
    let passes = operands(&commands, Op::BeginRenderPass);
    assert_eq!(passes.len(), 1);
    assert_eq!(
        passes[0][1], 0,
        "the scene's render pass resolves into the canvas"
    );
    assert_eq!(render_areas(&commands), [None]);

    world.renderer.settings_mut().set_render_scaling(true);
    let commands = frame_at(&mut world, &mut device, 500);
    assert_eq!(render_areas(&commands), [Some([0, 0, 320, 180]), None]);
    // The final pass's pipeline was made with the first frame, so it draws at once.
    assert_eq!(common::count(&commands, Op::CreateRenderPipeline), 0);

    world.renderer.settings_mut().set_render_scaling(false);
    let commands = frame_at(&mut world, &mut device, 500);
    assert_eq!(operands(&commands, Op::BeginRenderPass).len(), 1);
    assert_eq!(render_areas(&commands), [None]);
}

#[test]
fn an_8_bit_scene_resolves_into_the_canvas_while_its_scale_cannot_drop() {
    let (webgpu, webgl2) = worlds(format::CANVAS);
    check_scaling_switch(webgpu);
    check_scaling_switch(webgl2);
}
