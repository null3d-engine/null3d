//! Reflection probes on both frame builders: a probe adds the six capture views, captures once
//! the thread that draws holds the filter's generator, and filters in the same frame, between the
//! capture views' passes and the camera's. Checked through the mock backend, which also checks
//! that the probes' textures and the filter's command are valid on both paths.

mod common;

use common::World;
use null3d_gpu::drawlist::Op;
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::probes::ProbeSettings;

/// The filter commands that a frame records, with the place of each among the frame's commands.
fn filters(commands: &[(Op, Vec<u32>)]) -> Vec<(usize, Vec<u32>)> {
    commands
        .iter()
        .enumerate()
        .filter(|(_, (op, _))| *op == Op::ProbeFilter)
        .map(|(k, (_, o))| (k, o.clone()))
        .collect()
}

fn check_probes<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    world.step(&mut mock, true);
    let views = world.renderer.settings().views().len();
    let probe = ProbeSettings {
        low: [-5.0, -5.0, -5.0],
        high: [5.0, 5.0, 5.0],
        capture: [0.0, 1.0, 0.0],
        ..ProbeSettings::default()
    };
    let settings = world.renderer.settings_mut();
    settings.set_probe(0, probe).unwrap();
    assert_eq!(
        settings.views().len(),
        views + 6,
        "a probe adds six capture views"
    );
    let generator = settings.textures_mut().take_image_id();
    settings.probes_mut().set_generator(generator);

    // Until the thread that draws holds the filter's generator, no probe captures.
    let commands = world.step(&mut mock, true);
    assert!(filters(&commands).is_empty());
    assert!(world.renderer.settings().probes().waiting());

    // Once it arrived, the probe captures as soon as its views' targets exist: on WebGPU, once
    // the pipeline that copies a view's image into its target is built. It filters in the frame
    // that captures, before the camera's passes, so that frame's surfaces read it.
    mock.provide_generator(generator);
    let taken = world.frame - 1;
    world
        .renderer
        .settings_mut()
        .textures_mut()
        .sync(generator, taken);
    let mut commands = Vec::new();
    let mut found = Vec::new();
    for _ in 0..3 {
        commands = world.step(&mut mock, false);
        found = filters(&commands);
        if !found.is_empty() {
            break;
        }
        assert!(world.renderer.settings().probes().waiting());
    }
    assert_eq!(found.len(), 1, "one filter in the frame that captures");
    let (place, words) = &found[0];
    assert_eq!((words[2], words[3]), (0, generator));
    let passes_before = commands[..*place]
        .iter()
        .filter(|(op, _)| *op == Op::BeginRenderPass)
        .count();
    let passes_after = commands[*place..]
        .iter()
        .filter(|(op, _)| *op == Op::BeginRenderPass)
        .count();
    assert!(
        passes_before >= 6,
        "the capture views draw before the filter"
    );
    assert!(passes_after >= 1, "the camera draws after it");
    assert!(!world.renderer.settings().probes().waiting());

    // A probe that captures once records no filter after.
    assert!(filters(&world.step(&mut mock, false)).is_empty());

    // A probe that captured once captures again on request, as after an object around it moved,
    // and the frame that captures filters before the camera's passes.
    world.renderer.settings_mut().probes_mut().capture(0);
    let mut found = Vec::new();
    for _ in 0..3 {
        commands = world.step(&mut mock, false);
        found = filters(&commands);
        if !found.is_empty() {
            break;
        }
    }
    assert_eq!(
        found.len(),
        1,
        "a probe that captures once captures again on request"
    );
    let (place, words) = &found[0];
    assert_eq!((words[2], words[3]), (0, generator));
    let passes_after = commands[*place..]
        .iter()
        .filter(|(op, _)| *op == Op::BeginRenderPass)
        .count();
    assert!(
        passes_after >= 1,
        "the camera draws after the filter of a capture on request"
    );
    assert!(!world.renderer.settings().probes().waiting());

    // The last probe takes its views with it, and the frames after still replay.
    world.renderer.settings_mut().remove_probe(0);
    assert_eq!(world.renderer.settings().views().len(), views + 6);
    assert!(
        world.renderer.settings().views()[views..]
            .iter()
            .all(|view| view.is_removed())
    );
    world.step(&mut mock, true);
    world.step(&mut mock, false);
}

#[test]
fn a_probe_captures_when_made_and_again_on_request_on_both_paths() {
    check_probes(World::new());
    check_probes(World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    })));
}
