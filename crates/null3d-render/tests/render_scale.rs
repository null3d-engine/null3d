//! The render scale on both frame builders: scene passes draw into the top-left corner of their
//! targets through the viewport and the scissor, and below the whole canvas the final pass draws in
//! two steps: the first draws the corner's display color into the same corner of its own target,
//! and the second scales that up to the whole canvas. A new scale makes, destroys and resizes no
//! GPU object. Checked through the mock backend and by decoding the lists the builders record.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, format, layout, resource_kind, template, texture_usage};
use null3d_gpu::mock::MockBackend;
use null3d_render::bloom::Bloom;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{CanvasOutput, FrameBuilder};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::output::{Antialias, SceneColor};

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
    // The two steps' objects and bind groups are made with the first frame, while the render scale
    // can drop, so a scale that drops later makes none.
    let created = operands(&first, Op::CreateRenderPipeline);
    let layouts = group_layouts(&first);
    let made = operands(&first, Op::CreateBindGroup);
    // Each step of the final pass binds a settings buffer of its own, which carries the render
    // size of that step: the frame's list makes them with the groups.
    let settings_of = |group: u32| -> u32 {
        made.iter()
            .rev()
            .find(|o| o[0] == group)
            .expect("a pass binds a group the frame made")[5]
    };
    let writes = |commands: &[(Op, Vec<u32>)], buffer: u32| {
        operands(commands, Op::WriteBuffer)
            .iter()
            .filter(|o| o[0] == buffer)
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
        // Below the whole canvas the scene and the first step draw into the corner, and the second
        // step into the whole canvas.
        let areas = if scale < 1000 {
            vec![Some([0, 0, width, height]); 2]
        } else {
            vec![None]
        };
        let areas = [areas, vec![None]].concat();
        assert_eq!(render_areas(&commands), areas, "scale {scale}");
        for op in OBJECT_OPS {
            assert_eq!(
                common::count(&commands, op),
                0,
                "a new render scale records no {op:?}"
            );
        }
        // Each step of the final pass that draws learns the new render size, and a step that does
        // not draw keeps the one it holds: at the whole canvas only the second step draws.
        let steps: Vec<u32> = groups_bound(&commands)
            .iter()
            .skip(1)
            .flatten()
            .map(|group| settings_of(*group))
            .collect();
        assert_eq!(
            steps.len(),
            if scale < 1000 { 2 } else { 1 },
            "scale {scale}"
        );
        for buffer in &steps {
            assert_eq!(writes(&commands, *buffer), 1, "scale {scale}");
        }
        // A steady frame at the same scale uploads nothing for either step.
        let steady = frame_at(&mut world, &mut device, scale);
        for buffer in &steps {
            assert_eq!(writes(&steady, *buffer), 0, "scale {scale}");
        }
        assert_eq!(render_areas(&steady), areas);
        // Each step draws with a group of its pipeline's own layout.
        check_groups_fit(
            &commands,
            &created,
            &layouts,
            &[(template::FINAL, layout::FINAL)],
        );
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

/// The worlds of `worlds`, with `antialias` in place of MSAA, and the state of the frame that hold
/// mode records: the thread that draws has built none of its pipelines yet.
fn held_worlds(antialias: Antialias) -> (World<GpuDrivenRenderer>, World<CpuCulledRenderer>) {
    let canvas = CanvasOutput {
        scene_color: SceneColor::from_format(format::RGBA16_FLOAT),
        antialias,
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
    // Hold mode draws one frame, and the thread that draws has built none of its pipelines.
    webgpu.pipelines_built = 0;
    webgl2.pipelines_built = 0;
    (webgpu, webgl2)
}

#[test]
fn fxaa_draws_the_two_step_pass_on_the_first_frame_below_the_whole_canvas() {
    // A held picture draws one frame. That frame must run the two steps, since the first step
    // runs FXAA below the whole canvas's scale: the one pass leaves the image unsmoothed.
    let (mut webgpu, mut webgl2) = held_worlds(Antialias::Fxaa);
    let corner = Some([0, 0, 480, 270]);
    let expected = [corner, corner, None];
    check_first_frame(&mut webgpu, 750, None, expected);
    check_first_frame(&mut webgl2, 750, None, expected);
}

#[test]
fn the_sharpening_draws_the_two_step_pass_on_the_first_frame() {
    // The sharpening draws in the second step, so a held picture at the whole canvas's scale also
    // needs both steps in its one frame. Neither step draws a corner there.
    let (mut webgpu, mut webgl2) = held_worlds(Antialias::Msaa);
    let expected = [None, None, None];
    check_first_frame(&mut webgpu, 1000, Some(1.0), expected);
    check_first_frame(&mut webgl2, 1000, Some(1.0), expected);
}

/// Checks that `world`'s first frame at `scale` draws the passes of `expected` areas: the scene,
/// the first step of the two-step pass and the second step, which takes the color to the canvas.
fn check_first_frame<B: FrameBuilder>(
    world: &mut World<B>,
    scale: u32,
    sharpen: Option<f32>,
    expected: [Option<[u32; 4]>; 3],
) {
    if let Some(strength) = sharpen {
        world.renderer.settings_mut().set_sharpen(Some(strength));
    }
    world.frame = 1;
    world.render_scale = RenderScale::from_thousandths(scale);
    world.record(true);
    assert_eq!(render_areas(&world.commands()), expected, "scale {scale}");
}

/// The layout that a frame's `CreateBindGroup` gave each group, by the group's id.
fn group_layouts(commands: &[(Op, Vec<u32>)]) -> std::collections::HashMap<u32, u32> {
    operands(commands, Op::CreateBindGroup)
        .iter()
        .map(|o| (o[0], o[1]))
        .collect()
}

/// Checks that each render pass of a frame binds groups of the layouts that its own pipeline takes.
/// A real device drops the whole command buffer of a pass that binds a group other than its
/// pipeline's layout, and draws nothing, while the mock backend accepts the pair: R-02 was exactly
/// that pair drawn wrong, so the pairs are checked here. `created` holds the pipelines the frame's
/// passes draw with, and `layouts` the groups it binds, which a frame makes and makes again when
/// what a group binds changes. `expected` gives the layout that each template's pass binds.
fn check_groups_fit(
    commands: &[(Op, Vec<u32>)],
    created: &[Vec<u32>],
    layouts: &std::collections::HashMap<u32, u32>,
    expected: &[(u32, u32)],
) {
    let mut template = 0;
    let mut in_pass = false;
    for (op, o) in commands {
        match op {
            Op::BeginRenderPass => in_pass = true,
            Op::EndRenderPass => in_pass = false,
            Op::SetPipeline if in_pass => {
                template = created
                    .iter()
                    .find(|c| c[0] == o[0])
                    .expect("a pass draws with a pipeline the frame made")[1];
            }
            Op::SetBindGroup if in_pass => {
                let Some((_, want)) = expected.iter().find(|(t, _)| *t == template) else {
                    continue;
                };
                let layout = layouts
                    .get(&o[1])
                    .expect("a pass binds a group the frame made");
                assert_eq!(
                    layout, want,
                    "the pass of template {template} binds a group of layout {layout}, not {want}"
                );
            }
            _ => {}
        }
    }
}

/// The texture that the bind group `group`, made in a frame's `commands`, binds as the color that
/// a full-screen pass reads.
fn color_read(commands: &[(Op, Vec<u32>)], group: u32) -> u32 {
    let made = operands(commands, Op::CreateBindGroup);
    let operands = made.iter().rev().find(|o| o[0] == group).unwrap();
    let entry = operands[3..]
        .chunks(5)
        .find(|entry| entry[0] == 1)
        .expect("the group binds a color");
    assert_eq!(entry[1], resource_kind::TEXTURE);
    entry[2]
}

/// The bind groups that each render pass of a frame binds, in pass order.
fn groups_bound(commands: &[(Op, Vec<u32>)]) -> Vec<Vec<u32>> {
    let mut passes = Vec::new();
    let mut in_render_pass = false;
    for (op, o) in commands {
        match op {
            Op::BeginRenderPass => {
                passes.push(Vec::new());
                in_render_pass = true;
            }
            Op::EndRenderPass => in_render_pass = false,
            Op::SetBindGroup if in_render_pass => passes.last_mut().unwrap().push(o[1]),
            _ => {}
        }
    }
    passes
}

/// Checks the two steps of the 8-bit path: the scene's render pass resolves into a texture of the
/// canvas's format, which the first step reads into a target of its own at the render size, and the
/// second step scales that target up into the canvas. Until the second step's pipeline is built,
/// the final pass scales the image up by itself.
fn check_eight_bit_scaling<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    let first = frame_at(&mut world, &mut device, 500);
    assert_eq!(operands(&first, Op::BeginRenderPass).len(), 2);
    let commands = frame_at(&mut world, &mut device, 500);
    let passes = operands(&commands, Op::BeginRenderPass);
    let [scene_pass, first_step, final_pass] = &passes[..] else {
        panic!("three render passes: {passes:?}");
    };
    let (resolved, output) = (scene_pass[1], first_step[0]);
    assert_eq!(final_pass[0], 0, "the final pass draws into the canvas");
    // The first frame made the targets and both steps' bind groups.
    let made = operands(&first, Op::CreateTexture);
    for target in [resolved, output] {
        let texture = made.iter().find(|o| o[0] == target).unwrap();
        assert_eq!((texture[4], texture[6]), (format::CANVAS, 1));
        assert_ne!(texture[5] & texture_usage::TEXTURE_BINDING, 0);
    }
    // Each step binds one group, which reads the color before it.
    let groups = groups_bound(&commands);
    let reads: Vec<u32> = groups[1..]
        .iter()
        .map(|groups| {
            let [group] = groups[..] else {
                panic!("one group: {groups:?}");
            };
            color_read(&first, group)
        })
        .collect();
    assert_eq!(reads, [resolved, output]);
    assert_eq!(operands(&commands, Op::Draw), vec![vec![3, 1, 0, 0]; 2]);
    // The first step and the second step both draw with the plain final pass's layout.
    let created = operands(&first, Op::CreateRenderPipeline);
    check_groups_fit(
        &commands,
        &created,
        &group_layouts(&first),
        &[(template::FINAL, layout::FINAL)],
    );
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
    // The frame that lets the scale drop makes the second step's pipeline, the final pass's only
    // build with the upscale, and draws the whole canvas until it is built.
    let commands = frame_at(&mut world, &mut device, 500);
    assert_eq!(render_areas(&commands), [None, None]);
    assert_eq!(common::count(&commands, Op::CreateRenderPipeline), 1);
    let commands = frame_at(&mut world, &mut device, 500);
    let corner = Some([0, 0, 320, 180]);
    assert_eq!(render_areas(&commands), [corner, corner, None]);
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

/// The template of the pipeline that each render pass of a frame draws with, in pass order, by the
/// templates that `created` made.
fn templates(commands: &[(Op, Vec<u32>)], created: &[Vec<u32>]) -> Vec<u32> {
    let mut passes = Vec::new();
    for (op, o) in commands {
        match op {
            Op::BeginRenderPass => passes.push(0),
            Op::SetPipeline => {
                let pipeline = created.iter().find(|c| c[0] == o[0]).unwrap();
                *passes.last_mut().unwrap() = pipeline[1];
            }
            _ => {}
        }
    }
    passes
}

/// Checks that bloom draws in the final pass at the whole canvas's scale while the render scale
/// can drop, and in the first step below it, and that crossing the whole canvas's scale either
/// way makes no bind group.
fn check_bloom_while_scaling<B: FrameBuilder>(mut world: World<B>) {
    let mut device = device();
    world
        .renderer
        .settings_mut()
        .set_bloom(Some(Bloom::default()));
    let first = frame_at(&mut world, &mut device, 1000);
    let created = operands(&first, Op::CreateRenderPipeline);
    // Bloom's pipelines are built after the first frame.
    let whole = frame_at(&mut world, &mut device, 1000);
    let last = |commands: &[(Op, Vec<u32>)]| *templates(commands, &created).last().unwrap();
    assert_eq!(last(&whole), template::FINAL_BLOOM);
    // The bloom build draws with the bloom layout's group, and the plain present build with the
    // plain one: a group of the other layout leaves a real device drawing nothing.
    let fits = [
        (template::FINAL_BLOOM, layout::FINAL_BLOOM),
        (template::FINAL, layout::FINAL),
    ];
    // A group is made again when what it binds changes, so each frame's groups are added to the
    // ones before it, and the last of a group's ids is the one its pass binds.
    let mut layouts = group_layouts(&first);
    layouts.extend(group_layouts(&whole));
    check_groups_fit(&whole, &created, &layouts, &fits);
    for _ in 0..2 {
        let below = frame_at(&mut world, &mut device, 500);
        let drawn = templates(&below, &created);
        assert_eq!(
            drawn[drawn.len() - 2..],
            [template::FINAL_BLOOM, template::FINAL]
        );
        assert_eq!(common::count(&below, Op::CreateBindGroup), 0);
        check_groups_fit(&below, &created, &layouts, &fits);
        let whole = frame_at(&mut world, &mut device, 1000);
        assert_eq!(last(&whole), template::FINAL_BLOOM);
        assert_eq!(common::count(&whole, Op::CreateBindGroup), 0);
        layouts.extend(group_layouts(&whole));
        check_groups_fit(&whole, &created, &layouts, &fits);
    }
}

#[test]
fn bloom_draws_at_the_whole_canvas_and_in_the_first_step_below_it() {
    let (webgpu, webgl2) = worlds(format::RGBA16_FLOAT);
    check_bloom_while_scaling(webgpu);
    check_bloom_while_scaling(webgl2);
}
