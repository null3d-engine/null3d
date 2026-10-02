//! Debug views on both frame builders, checked through the mock backend and by decoding the lists
//! they record: each view draws every mesh with the debug view template, in the variant and the
//! pipeline state of the view, the wireframe view draws each part's edge list, and the lit view
//! draws with the materials again.

mod common;

use common::World;
use null3d_gpu::drawlist::{Op, permutation, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_view::DebugView;
use null3d_render::frame::FrameBuilder;

type Commands = [(Op, Vec<u32>)];

const LOW: u32 = permutation::DEBUG_VIEW_LOW;
const HIGH: u32 = permutation::DEBUG_VIEW_HIGH;

/// The permutation, without the bits that the device fixes, and the state flags of each debug view
/// pipeline that a frame's list creates.
fn debug_pipelines(commands: &Commands) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::DEBUG_VIEW)
        .map(|(_, o)| (o[2] & !permutation::DEVICE, o[6]))
        .collect()
}

/// The index counts of the frame's single indexed draws.
fn indexed_counts(commands: &Commands) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::DrawIndexed)
        .map(|(_, o)| o[0])
        .collect()
}

fn check<B: FrameBuilder>(mut world: World<B>, name: &str) {
    let mut mock = MockBackend::default();
    let lit = world.step(&mut mock, true);
    assert!(debug_pipelines(&lit).is_empty(), "{name}");
    let lit_draws = mock.draws;
    assert!(lit_draws > 0, "{name}");
    let lit_counts = indexed_counts(&lit);
    assert!(
        !world.renderer.settings_mut().set_debug_view(DebugView::Lit),
        "{name}: the scene draws lit already"
    );

    // The scene's materials are lit and unlit, both culling back faces.
    for (view, bits, state) in [
        (DebugView::Normals, 0, 0),
        (DebugView::Depth, LOW, 0),
        (
            DebugView::Overdraw,
            HIGH,
            state_flags::NO_DEPTH_TEST | state_flags::BLEND_ADDITIVE,
        ),
        (DebugView::Wireframe, LOW | HIGH, state_flags::LINE_LIST),
    ] {
        assert!(world.renderer.settings_mut().set_debug_view(view), "{name}");
        let draws = mock.draws;
        let commands = world.step(&mut mock, true);
        let made = debug_pipelines(&commands);
        assert!(!made.is_empty(), "{name}: {view:?} makes its pipeline");
        for pipeline in made {
            assert_eq!(pipeline, (bits, state), "{name}: {view:?}");
        }
        assert!(mock.draws > draws, "{name}: {view:?} draws");
        if view == DebugView::Wireframe && !lit_counts.is_empty() {
            // Single draws take each part's edge list: two indices for each one of its triangles.
            let doubled: Vec<u32> = lit_counts.iter().map(|count| count * 2).collect();
            let mut counts = indexed_counts(&commands);
            counts.sort_unstable();
            let mut expected = doubled;
            expected.sort_unstable();
            assert_eq!(counts, expected, "{name}");
        }
    }

    // The lit view draws with the materials' pipelines again, which the GPU still has.
    assert!(
        world.renderer.settings_mut().set_debug_view(DebugView::Lit),
        "{name}"
    );
    let commands = world.step(&mut mock, true);
    assert!(debug_pipelines(&commands).is_empty(), "{name}");
    assert_eq!(indexed_counts(&commands), lit_counts, "{name}");
}

#[test]
fn each_view_draws_every_mesh_with_its_own_pipelines() {
    check(World::new(), "WebGPU");
    for multi_draw in [true, false] {
        let renderer = CpuCulledRenderer::new(CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        });
        check(
            World::build(renderer),
            &format!("WebGL2, multi-draw {multi_draw}"),
        );
    }
}

#[test]
fn debug_views_clear_to_black_and_draw_without_tone_mapping_or_a_background() {
    let mut world = World::new();
    let settings = world.renderer.settings_mut();
    settings.set_background([0.5, 0.25, 0.125]);
    let output = settings.output();
    settings.set_debug_view(DebugView::Depth);
    let shown = settings.drawn_output();
    assert_eq!(shown.exposure, 1.0);
    assert_eq!(shown.tone_mapping, null3d_render::output::ToneMapping::None);
    assert_eq!(settings.output(), output, "the scene keeps its own output");
    settings.set_debug_view(DebugView::Lit);
    assert_eq!(settings.drawn_output(), output);
}
