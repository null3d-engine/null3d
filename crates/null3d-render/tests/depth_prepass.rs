//! The depth prepass of the WebGPU frame builder, checked through the mock backend and by decoding
//! the lists it records: each camera view replays a bundle of its opaque objects' depth first, in
//! the render pass that then shades them, and the pairs whose depth the depth template cannot
//! draw the same way shade as they would without the prepass.

mod common;

use std::collections::HashMap;

use common::{World, grid};
use null3d_gpu::drawlist::{Op, permutation, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::materials::{Shading, feature};

/// A frame's operations with their operands.
type Commands = Vec<(Op, Vec<u32>)>;

/// What a pipeline draws, from the operands of the command that creates it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// The depth template's prepass build.
    Depth,
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
            let kind = if template == template::SHADOW_DEPTH && bits & permutation::PREPASS != 0 {
                assert_eq!(
                    state & state_flags::NO_COLOR_WRITE,
                    state_flags::NO_COLOR_WRITE
                );
                Kind::Depth
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

fn frames(depth_prepass: bool) -> Frames {
    let config = RendererConfig {
        depth_prepass,
        ..RendererConfig::default()
    };
    let mut world = World::build(GpuDrivenRenderer::new(config));
    world.add_object_with(&grid(1, 1), Shading::Lit, feature::ALPHA_MASK);
    world.add_object_with(&grid(1, 1), Shading::Unlit, feature::BLEND);
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
