//! Outlines on both frame builders: the outlined objects' layout, the outline view's mask pass,
//! which draws every outlined object twice with the scene's depth, and the final pass that binds
//! the mask and draws the line from it. Checked through the mock backend and by decoding the lists
//! the builders record.

mod common;

use common::World;
use null3d_core::scene::{Command, flags};
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{NO_TARGET, Op, format, layout, pass_flags, permutation, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::outline::{MASK_FORMAT, Outline};
use null3d_render::output::{Antialias, SceneColor};

/// The binding of the outline mask in the final pass's group.
const MASK_BINDING: u32 = 11;

/// The world drawn by each frame builder with HDR scene color and MSAA: WebGPU's, then WebGL2's
/// with multi-draw.
fn worlds() -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias: Antialias::Msaa,
        transparent: false,
    };
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

/// The operands of each command of a kind in a frame.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, o)| o.clone())
        .collect()
}

/// The commands of the render pass that begins with `begin`, up to its end.
fn render_pass(commands: &[(Op, Vec<u32>)], begin: usize) -> &[(Op, Vec<u32>)] {
    let end = commands[begin..]
        .iter()
        .position(|(op, _)| *op == Op::EndRenderPass)
        .unwrap();
    &commands[begin..begin + end]
}

/// The place of the render pass that draws into a texture of the mask's format, or `None`.
fn mask_pass(commands: &[(Op, Vec<u32>)]) -> Option<usize> {
    let made = operands(commands, Op::CreateTexture);
    commands.iter().position(|(op, o)| {
        *op == Op::BeginRenderPass
            && made
                .iter()
                .any(|t| t[0] == o[0] && t[4] == MASK_FORMAT && t[6] > 1)
    })
}

/// Sets an object's outlined flag in the world's current frame.
fn outline<B: FrameBuilder>(world: &mut World<B>, object: usize, on: bool) {
    let handle = world.objects[object];
    let value = if on { flags::OUTLINED } else { 0 };
    let frame = world.frame;
    world
        .scene
        .apply_commands(&[Command::set_flags(handle, flags::OUTLINED, value)], frame)
        .unwrap();
}

fn check_outlines<B: FrameBuilder>(mut world: World<B>, culls_on_gpu: bool) {
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    world.step(&mut mock, true);
    let without = operands(&world.step(&mut mock, false), Op::BeginRenderPass).len();

    // Outlines on with nothing outlined add no pass.
    world
        .renderer
        .settings_mut()
        .set_outline(Some(Outline::default()));
    let commands = world.step(&mut mock, true);
    assert_eq!(operands(&commands, Op::BeginRenderPass).len(), without);

    // One outlined object: two mask pipelines, the mask pass with the scene's depth, and the final
    // pass with the mask.
    outline(&mut world, 0, true);
    let commands = world.step(&mut mock, true);
    let pipelines = operands(&commands, Op::CreateRenderPipeline);
    let masks: Vec<_> = pipelines
        .iter()
        .filter(|p| p[1] == template::OUTLINE_MASK)
        .collect();
    assert_eq!(masks.len(), 2, "{pipelines:?}");
    assert_eq!(masks[0][2] & permutation::OUTLINE_VISIBLE, 0);
    assert_ne!(masks[1][2] & permutation::OUTLINE_VISIBLE, 0);
    let passes = operands(&commands, Op::BeginRenderPass);
    assert_eq!(
        passes.len(),
        without + 1,
        "the mask pass is the only new pass"
    );
    let at = mask_pass(&commands).expect("a render pass draws the mask");
    let begin = &commands[at].1;
    let scene = &passes[0];
    assert_eq!(begin[2], scene[2], "the mask pass tests the scene's depth");
    assert_ne!(begin[1], NO_TARGET, "the multisampled mask resolves");
    assert_eq!(begin[8] & pass_flags::CLEAR_DEPTH, 0, "it loads the depth");
    assert_ne!(begin[8] & pass_flags::CLEAR_COLOR, 0, "it clears the mask");
    assert_ne!(scene[8] & pass_flags::STORE_DEPTH, 0, "the scene stores it");
    let drawn = render_pass(&commands, at);
    if culls_on_gpu {
        assert!(drawn.iter().any(|(op, _)| *op == Op::ExecuteBundles));
    } else {
        let set: Vec<u32> = drawn
            .iter()
            .filter(|(op, _)| *op == Op::SetPipeline)
            .map(|(_, o)| o[0])
            .collect();
        let ids: Vec<u32> = masks.iter().map(|p| p[0]).collect();
        assert_eq!(
            set, ids,
            "every part first, then the parts that nothing hides"
        );
    }
    let group = operands(&commands, Op::CreateBindGroup)
        .into_iter()
        .find(|o| o[1] == layout::FINAL)
        .expect("the final pass binds the mask");
    let textures: Vec<u32> = group[3..]
        .chunks(5)
        .filter(|e| e[0] >= MASK_BINDING)
        .map(|e| e[2])
        .collect();
    assert_eq!(
        textures,
        [begin[1]],
        "the texture that the mask resolves into"
    );

    // A steady frame makes nothing.
    let steady = world.step(&mut mock, false);
    for op in [
        Op::CreateTexture,
        Op::CreateBindGroup,
        Op::CreateRenderPipeline,
    ] {
        assert!(operands(&steady, op).is_empty(), "{op:?}");
    }
    assert!(mask_pass(&commands).is_some());

    // With nothing outlined, the mask pass is gone.
    outline(&mut world, 0, false);
    let commands = world.step(&mut mock, true);
    assert_eq!(operands(&commands, Op::BeginRenderPass).len(), without);
    assert!(mask_pass(&commands).is_none());
}

#[test]
fn outlined_objects_draw_into_the_mask_with_the_scene_depth_on_both_builders() {
    let (webgpu, webgl2) = worlds();
    check_outlines(webgpu, true);
    check_outlines(webgl2, false);
}
