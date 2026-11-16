//! The depth prepass of both frame builders, checked through the mock backend and by decoding the
//! lists they record: each camera view draws its opaque objects' depth first, in the render pass
//! that then shades them, and the pairs whose depth the prepass cannot draw the same way shade as
//! they would without it. WebGPU replays a bundle of the depth template's prepass builds. WebGL2
//! draws the same calls twice, first with each shading pipeline's own build and the prepass bit.

mod common;

use std::collections::HashMap;

use common::{World, grid};
use null3d_gpu::drawlist::{Op, permutation, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::ao::Ao;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::{Shading, feature};

/// A frame's operations with their operands.
type Commands = Vec<(Op, Vec<u32>)>;

/// What a pipeline draws, from the operands of the command that creates it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// The depth template's prepass build.
    Depth,
    /// A shading template's build with the prepass bit, which WebGL2 draws with that build's
    /// vertex shader alone.
    OwnVertexShader,
    /// A shading pipeline that draws only where the prepass found its depth.
    AfterPrepass,
    /// A shading pipeline that tests and writes depth as it would without the prepass.
    Shading,
}

/// Each pipeline that the commands create, by id.
fn pipelines(commands: &[(Op, Vec<u32>)]) -> HashMap<u32, Kind> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| {
            let (template, bits, state) = (o[1], o[2], o[6]);
            let kind = if bits & permutation::PREPASS != 0 {
                assert_eq!(
                    state & (state_flags::NO_COLOR_WRITE | state_flags::DEPTH_EQUAL),
                    state_flags::NO_COLOR_WRITE
                );
                if template == template::SHADOW_DEPTH {
                    Kind::Depth
                } else {
                    Kind::OwnVertexShader
                }
            } else if state & state_flags::DEPTH_EQUAL != 0 {
                assert_eq!(
                    state & state_flags::NO_DEPTH_WRITE,
                    state_flags::NO_DEPTH_WRITE
                );
                Kind::AfterPrepass
            } else {
                Kind::Shading
            };
            (o[0], kind)
        })
        .collect()
}

/// The world, with a masked object and a blended object besides its own, drawn by a builder with
/// the prepass or without it, after a first frame and a steady one that replay on the mock.
struct Frames {
    /// The pipelines that the first frame created.
    kinds: HashMap<u32, Kind>,
    /// The kinds of the pipelines that each bundle sets, by bundle id.
    bundles: HashMap<u32, Vec<Kind>>,
    /// The steady frame's commands.
    steady: Commands,
}

/// The test world, with a masked object and a blended object besides its own, drawn by
/// `renderer`.
fn world_with<B: FrameBuilder>(renderer: B) -> World<B> {
    let mut world = World::build(renderer);
    world.add_object_with(&grid(1, 1), Shading::Lit, feature::ALPHA_MASK);
    world.add_object_with(&grid(1, 1), Shading::Unlit, feature::BLEND);
    world
}

fn frames(depth_prepass: bool) -> Frames {
    let config = RendererConfig {
        depth_prepass,
        ..RendererConfig::default()
    };
    frames_of(world_with(GpuDrivenRenderer::new(config)))
}

/// The first frame and a steady frame of `world`, which is drawn by its builder.
fn frames_of<B: FrameBuilder>(mut world: World<B>) -> Frames {
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    let kinds = pipelines(&first);
    let mut bundles: HashMap<u32, Vec<Kind>> = HashMap::new();
    let mut recording = None;
    for (op, o) in &first {
        match op {
            Op::BeginBundle => recording = Some(o[0]),
            Op::EndBundle => recording = None,
            Op::SetPipeline if recording.is_some() => bundles
                .entry(recording.unwrap())
                .or_default()
                .push(kinds[&o[0]]),
            _ => {}
        }
    }
    let steady = world.step(&mut mock, false);
    Frames {
        kinds,
        bundles,
        steady,
    }
}

/// A world of a second camera view with ambient occlusion on, which makes the camera's view draw
/// a depth prepass while the builder leaves it off for the other view.
fn two_views_with_ao<B: FrameBuilder>(mut world: World<B>) -> Frames {
    world.add_view([0.0, 0.0, 4.0]);
    world.renderer.settings_mut().set_ao(Some(Ao::default()));
    frames_of(world)
}

/// The commands of the first render pass of a list.
fn first_render_pass(commands: &[(Op, Vec<u32>)]) -> &[(Op, Vec<u32>)] {
    let begin = commands
        .iter()
        .position(|(op, _)| *op == Op::BeginRenderPass)
        .unwrap();
    let end = begin
        + commands[begin..]
            .iter()
            .position(|(op, _)| *op == Op::EndRenderPass)
            .unwrap();
    &commands[begin..end]
}

/// Each render pass's commands, in the order that the frame records them.
fn render_passes(commands: &[(Op, Vec<u32>)]) -> Vec<&[(Op, Vec<u32>)]> {
    let mut passes = Vec::new();
    let mut from = None;
    for (at, (op, _)) in commands.iter().enumerate() {
        match op {
            Op::BeginRenderPass => from = Some(at),
            Op::EndRenderPass => {
                if let Some(begin) = from.take() {
                    passes.push(&commands[begin..=at]);
                }
            }
            _ => {}
        }
    }
    passes
}

/// The kinds of the pipelines that a frame sets in one render pass.
fn pass_kinds(pass: &[(Op, Vec<u32>)], kinds: &HashMap<u32, Kind>) -> Vec<Kind> {
    pass.iter()
        .filter(|(op, _)| *op == Op::SetPipeline)
        .map(|(_, o)| kinds[&o[0]])
        .collect()
}

/// The bundles that a frame executes in one render pass.
fn executed_bundles(pass: &[(Op, Vec<u32>)]) -> Vec<u32> {
    pass.iter()
        .filter(|(op, _)| *op == Op::ExecuteBundles)
        .map(|(_, o)| o[1])
        .collect()
}

#[test]
fn the_camera_replays_its_depth_bundle_before_its_opaque_bundle_in_one_render_pass() {
    let Frames {
        kinds,
        bundles,
        steady,
    } = frames(true);
    let pass = first_render_pass(&steady);
    let executed: Vec<u32> = pass
        .iter()
        .filter(|(op, _)| *op == Op::ExecuteBundles)
        .map(|(_, o)| o[1])
        .collect();
    assert_eq!(
        executed.len(),
        2,
        "the depth bundle, then the opaque bundle"
    );
    // The depth bundle draws with depth pipelines alone. The opaque bundle shades the lit and
    // unlit buckets after the prepass, and the masked one as without it.
    let depth = &bundles[&executed[0]];
    assert!(!depth.is_empty() && depth.iter().all(|&kind| kind == Kind::Depth));
    let opaque = &bundles[&executed[1]];
    assert!(opaque.contains(&Kind::AfterPrepass));
    assert!(opaque.contains(&Kind::Shading));
    assert!(!opaque.contains(&Kind::Depth));
    // The blended object draws after both bundles, with a shading pipeline that tests depth as
    // it would without the prepass.
    let last_bundle = pass
        .iter()
        .rposition(|(op, _)| *op == Op::ExecuteBundles)
        .unwrap();
    let blended: Vec<Kind> = pass[last_bundle..]
        .iter()
        .filter(|(op, _)| *op == Op::SetPipeline)
        .map(|(_, o)| kinds[&o[0]])
        .collect();
    assert_eq!(blended, [Kind::Shading]);
}

#[test]
fn without_the_prepass_no_pipeline_draws_depth_alone_or_tests_for_equal_depth() {
    let Frames { kinds, steady, .. } = frames(false);
    assert!(kinds.values().all(|&kind| kind == Kind::Shading));
    let pass = first_render_pass(&steady);
    let executed = pass
        .iter()
        .filter(|(op, _)| *op == Op::ExecuteBundles)
        .count();
    assert_eq!(executed, 1);
}

#[test]
fn a_second_view_shades_without_the_prepass_while_the_camera_shades_after_it() {
    let Frames {
        kinds: _,
        bundles,
        steady,
    } = two_views_with_ao(world_with(
        GpuDrivenRenderer::new(RendererConfig::default()),
    ));
    let passes = render_passes(&steady);
    // The second view draws before the camera's opaque pass, which reads its target.
    let second = executed_bundles(passes[0]);
    assert_eq!(second.len(), 1, "the second view draws no prepass bundle");
    let second = &bundles[&second[0]];
    assert!(
        !second.is_empty() && second.iter().all(|&kind| kind == Kind::Shading),
        "the second view tests and writes the depth that it shades: {second:?}"
    );
    // The camera's view draws its prepass, and shades only where it found the depth.
    let executed: Vec<&Vec<Kind>> = passes
        .iter()
        .flat_map(|pass| executed_bundles(pass))
        .map(|id| &bundles[&id])
        .collect();
    assert!(
        executed
            .iter()
            .any(|bundle| bundle.iter().all(|&kind| kind == Kind::Depth)),
        "the camera draws a prepass bundle"
    );
    assert!(
        executed
            .iter()
            .any(|bundle| bundle.contains(&Kind::AfterPrepass)),
        "the camera shades after its prepass"
    );
    assert_eq!(
        executed
            .iter()
            .filter(|bundle| bundle.contains(&Kind::AfterPrepass))
            .count(),
        1,
        "only the camera's view shades after a prepass"
    );
}

#[test]
fn a_second_view_shades_without_the_prepass_on_the_direct_draw_path() {
    let Frames { kinds, steady, .. } =
        two_views_with_ao(world_with(GpuDrivenRenderer::new(RendererConfig {
            direct_draws: true,
            ..RendererConfig::default()
        })));
    let passes = render_passes(&steady);
    // The second view draws before the camera's opaque pass, which reads its target.
    let second = pass_kinds(passes[0], &kinds);
    assert!(
        !second.is_empty() && second.iter().all(|&kind| kind == Kind::Shading),
        "the second view tests and writes the depth that it shades: {second:?}"
    );
    // The camera's view draws its prepass, and shades only where it found the depth.
    assert!(
        passes
            .iter()
            .any(|pass| pass_kinds(pass, &kinds).contains(&Kind::Depth)),
        "the camera draws a prepass"
    );
    assert!(
        pass_kinds(passes.last().unwrap(), &kinds).contains(&Kind::AfterPrepass),
        "the camera shades after its prepass"
    );
}

/// The first frame and a steady frame of the WebGL2 builder, with the prepass or without it.
fn webgl2_frames(depth_prepass: bool, multi_draw: bool) -> (Commands, Commands) {
    let mut world = world_with(CpuCulledRenderer::new(CpuCulledConfig {
        depth_prepass,
        multi_draw,
        ..CpuCulledConfig::default()
    }));
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    (first, world.step(&mut mock, false))
}

#[test]
fn webgl2_draws_the_depth_of_each_opaque_draw_with_its_own_vertex_shader_first() {
    for multi_draw in [true, false] {
        let (first, steady) = webgl2_frames(true, multi_draw);
        let kinds = pipelines(&first);
        let created: HashMap<u32, &[u32]> = first
            .iter()
            .filter(|(op, _)| *op == Op::CreateRenderPipeline)
            .map(|(_, o)| (o[0], o.as_slice()))
            .collect();
        let set: Vec<u32> = first_render_pass(&steady)
            .iter()
            .filter(|(op, _)| *op == Op::SetPipeline)
            .map(|(_, o)| o[0])
            .collect();
        let order: Vec<Kind> = set.iter().map(|id| kinds[id]).collect();
        // The prepass draws first. The opaque pass then shades the lit and unlit draws after it,
        // and the masked one as without it.
        let shading = order
            .iter()
            .position(|&kind| kind != Kind::OwnVertexShader)
            .unwrap();
        assert!(shading > 0, "{order:?}");
        assert!(order[shading..].contains(&Kind::AfterPrepass));
        assert!(order[shading..].contains(&Kind::Shading));
        assert!(!order[shading..].contains(&Kind::OwnVertexShader));
        assert!(!order.contains(&Kind::Depth));
        // Each prepass pipeline is a build of a shading pipeline that draws after it, with the
        // prepass bit: the same template, bits and vertex format, so the same vertex shader.
        for id in &set[..shading] {
            let depth = created[id];
            let twin = set[shading..].iter().map(|id| created[id]).any(|o| {
                o[1] == depth[1]
                    && o[2] | permutation::PREPASS == depth[2]
                    && o[7] == depth[7]
                    && o[6] & state_flags::DEPTH_EQUAL != 0
            });
            assert!(twin, "no shading pipeline follows prepass pipeline {id}");
        }
    }
}

#[test]
fn webgl2_without_the_prepass_draws_each_opaque_draw_once() {
    let (first, _) = webgl2_frames(false, true);
    assert!(
        pipelines(&first)
            .values()
            .all(|&kind| kind == Kind::Shading)
    );
}

#[test]
fn webgl2_a_second_view_shades_without_the_prepass_while_the_camera_shades_after_it() {
    let world = world_with(CpuCulledRenderer::new(CpuCulledConfig {
        depth_prepass: false,
        ..CpuCulledConfig::default()
    }));
    let Frames { kinds, steady, .. } = two_views_with_ao(world);
    let passes = render_passes(&steady);
    // The second view draws before the camera's opaque pass, which reads its target.
    let second = pass_kinds(passes[0], &kinds);
    assert!(
        !second.is_empty() && second.iter().all(|&kind| kind == Kind::Shading),
        "the second view tests and writes the depth that it shades: {second:?}"
    );
    // The camera's view draws its prepass, and shades only where it found the depth.
    let camera = pass_kinds(passes.last().unwrap(), &kinds);
    assert!(
        camera.contains(&Kind::AfterPrepass),
        "the camera shades after its prepass"
    );
    assert!(
        passes[..passes.len() - 1]
            .iter()
            .all(|pass| !pass_kinds(pass, &kinds).contains(&Kind::AfterPrepass)),
        "no view shades after a prepass before the camera's opaque pass"
    );
    // The camera's prepass draws each opaque pair's depth before it.
    assert!(
        passes
            .iter()
            .any(|pass| pass_kinds(pass, &kinds).contains(&Kind::OwnVertexShader))
    );
}
