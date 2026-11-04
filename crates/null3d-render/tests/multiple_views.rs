//! Views that draw into rectangles of the canvas: a split screen or a picture in picture. Each
//! view draws the scene from its own camera, after the camera's passes, into the camera's scene
//! color through the viewport and the scissor, with a depth target of its own. Both frame builders
//! draw them, and the image reaches the canvas through the resolve pass or the final pass.

mod common;

use common::{LENS, World, count};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::Op;
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::gpu_driven::RendererConfig;
use null3d_render::graph::{ALL_LAYERS, RenderScale};
use null3d_render::view::{CanvasRect, View, ViewId, ViewTarget};

/// Adds a camera at `position` that looks down -z, and a view that draws it into `rect`.
fn add_view<B: FrameBuilder>(world: &mut World<B>, position: [f32; 3], rect: CanvasRect) -> ViewId {
    let camera = world.scene.reserve().unwrap();
    world.scene.set_position(camera, position).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::create(
                camera,
                Handle::NONE,
                NO_MESH,
                flags::VISIBLE,
            )],
            world.frame,
        )
        .unwrap();
    let view = View::new(camera, LENS, ALL_LAYERS).with_target(ViewTarget {
        rect: Some(rect),
        ..ViewTarget::default()
    });
    world.renderer.settings_mut().add_view(view).unwrap()
}

/// The names of the passes of each step of the compiled plan.
fn steps<B: FrameBuilder>(
    world: &World<B>,
    graph: impl Fn(&B) -> &null3d_render::graph::RenderGraph,
) -> Vec<Vec<String>> {
    let graph = graph(&world.renderer);
    let plan = graph.plan().expect("the graph compiled");
    plan.steps()
        .iter()
        .map(|step| {
            plan.passes(step)
                .iter()
                .map(|&pass| graph.pass_name(pass).to_owned())
                .collect()
        })
        .collect()
}

/// The viewport that each render pass sets, in pass order: a pass that draws its whole targets
/// sets none.
fn viewports(commands: &[(Op, Vec<u32>)]) -> Vec<Option<[u32; 4]>> {
    let mut areas = Vec::new();
    let mut area = None;
    for (op, operands) in commands {
        match op {
            Op::BeginRenderPass => area = None,
            Op::SetViewport => area = Some([operands[0], operands[1], operands[2], operands[3]]),
            Op::EndRenderPass => areas.push(area.take()),
            _ => {}
        }
    }
    areas
}

/// The scissor that each render pass sets, in pass order.
fn scissors(commands: &[(Op, Vec<u32>)]) -> Vec<Option<[u32; 4]>> {
    let mut areas = Vec::new();
    let mut area = None;
    for (op, operands) in commands {
        match op {
            Op::BeginRenderPass => area = None,
            Op::SetScissor => area = Some([operands[0], operands[1], operands[2], operands[3]]),
            Op::EndRenderPass => areas.push(area.take()),
            _ => {}
        }
    }
    areas
}

/// The draw commands of each render pass that sets the viewport `area`.
fn draws_in_pass(commands: &[(Op, Vec<u32>)], area: [u32; 4]) -> usize {
    let mut viewport = None;
    let mut draws = 0;
    for (op, operands) in commands {
        match op {
            Op::BeginRenderPass => viewport = None,
            Op::SetViewport => {
                viewport = Some([operands[0], operands[1], operands[2], operands[3]])
            }
            Op::Draw | Op::DrawIndexed | Op::MultiDrawIndexed if viewport == Some(area) => {
                draws += 1
            }
            _ => {}
        }
    }
    draws
}

/// The right half of the tests' 320 x 180 canvas.
const RIGHT: CanvasRect = CanvasRect {
    x: 0.5,
    y: 0.0,
    width: 0.5,
    height: 1.0,
};

#[test]
fn a_view_draws_after_the_camera_into_the_right_half_of_the_canvas() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let view = add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    world.renderer.check_graph().unwrap();
    let commands = world.step(&mut mock, true);
    let steps = steps(&world, |r| r.render_graph());
    let camera = steps
        .iter()
        .position(|step| step.iter().any(|name| name == "Opaque"))
        .expect("the camera draws");
    let drawn = steps
        .iter()
        .position(|step| step.first().is_some_and(|name| name == "Opaque1"))
        .expect("the view draws in a render pass of its own");
    assert!(
        drawn > camera,
        "the view draws after the camera's passes: {steps:?}"
    );
    // The rectangle reaches the canvas as its viewport and its scissor, and the camera's passes
    // keep their whole target.
    let areas = viewports(&commands);
    assert!(
        areas.contains(&Some([320, 0, 320, 360])),
        "the view draws into the right half: {areas:?}"
    );
    assert!(
        areas.iter().any(|area| area.is_none()),
        "the camera draws its whole target: {areas:?}"
    );
    assert_eq!(
        scissors(&commands),
        areas,
        "each viewport scissors the same rectangle"
    );
    assert!(world.renderer.settings().view_draws(view));
    // WebGPU runs each view's draws as a bundle, so the frame makes one bundle for each view.
    assert!(
        count(&commands, Op::BeginBundle) >= 2,
        "each view records its own bundle"
    );
}

#[test]
fn each_view_culls_with_its_own_camera() {
    // WebGL2 records its draws in the list, so the test counts them.
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let mut mock = MockBackend::default();
    // One camera in front of the objects draws them; one far behind looks away from them.
    let facing = add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    let away = add_view(
        &mut world,
        [0.0, 0.0, 200.0],
        CanvasRect {
            x: 0.0,
            y: 0.5,
            width: 0.5,
            height: 0.5,
        },
    );
    let commands = world.step(&mut mock, true);
    assert!(world.renderer.settings().view_draws(facing));
    assert!(world.renderer.settings().view_draws(away));
    let seen = draws_in_pass(&commands, [320, 0, 320, 360]);
    let unseen = draws_in_pass(&commands, [0, 180, 320, 180]);
    assert!(
        seen > unseen,
        "the camera that faces the objects draws more than the one that looks away: {seen} and {unseen}"
    );
}

#[test]
fn each_view_draws_with_its_own_camera_and_rectangle_on_webgl2() {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    }));
    let mut mock = MockBackend::default();
    let near = add_view(&mut world, [0.0, 0.0, 4.0], RIGHT);
    let quarter = add_view(
        &mut world,
        [0.0, 0.0, 8.0],
        CanvasRect {
            x: 0.0,
            y: 0.0,
            width: 0.25,
            height: 0.25,
        },
    );
    world.renderer.check_graph().unwrap();
    let commands = world.step(&mut mock, true);
    let steps = steps(&world, |r| r.render_graph());
    assert!(
        steps
            .iter()
            .any(|step| step.first().is_some_and(|name| name == "Opaque1")),
        "{steps:?}"
    );
    assert!(
        steps
            .iter()
            .any(|step| step.first().is_some_and(|name| name == "Opaque2")),
        "each view draws in its own render pass: {steps:?}"
    );
    let areas = viewports(&commands);
    assert!(areas.contains(&Some([320, 0, 320, 360])), "{areas:?}");
    assert!(areas.contains(&Some([0, 0, 160, 90])), "{areas:?}");
    assert!(world.renderer.settings().view_draws(near));
    assert!(world.renderer.settings().view_draws(quarter));
}

#[test]
fn a_view_draws_where_the_device_draws_directly() {
    // A device that records its draws without bundles draws the view into the same rectangle.
    let mut world = World::with_config(RendererConfig {
        direct_draws: true,
        ..RendererConfig::default()
    });
    let mut mock = MockBackend::default();
    add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    let areas = viewports(&world.step(&mut mock, true));
    assert!(areas.contains(&Some([320, 0, 320, 360])), "{areas:?}");
}

#[test]
fn a_changed_rectangle_draws_at_once() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let view = add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    let areas = viewports(&world.step(&mut mock, true));
    assert!(areas.contains(&Some([320, 0, 320, 360])), "{areas:?}");

    world.renderer.settings_mut().set_view_rect(
        view,
        CanvasRect {
            x: 0.0,
            y: 0.0,
            width: 0.25,
            height: 1.0,
        },
    );
    let areas = viewports(&world.step(&mut mock, false));
    assert!(
        areas.contains(&Some([0, 0, 160, 360])),
        "the frame draws into the new rectangle: {areas:?}"
    );
    assert!(
        !areas.contains(&Some([320, 0, 320, 360])),
        "the old rectangle draws nothing: {areas:?}"
    );
}

#[test]
fn the_render_scale_shrinks_the_rectangle_at_the_render_size() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    world.renderer.settings_mut().set_render_scaling(true);
    world.step(&mut mock, true);
    // The camera's passes and the view's keep the canvas's scene color, but each draws into the
    // corner of it that the render scale gives.
    world.render_scale = RenderScale::from_thousandths(500);
    let areas = viewports(&world.step(&mut mock, false));
    assert!(
        areas.contains(&Some([160, 0, 160, 180])),
        "the rectangle follows the render scale: {areas:?}"
    );
}

#[test]
fn the_8_bit_path_resolves_the_views_into_the_canvas_too() {
    use null3d_gpu::drawlist::format;
    use null3d_render::frame::CanvasOutput;
    use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
    use null3d_render::output::{Antialias, SceneColor};
    // The scene shaders write display color on the 8-bit path, so a view writes the same color
    // into the camera's scene color, and the resolve pass that draws the canvas comes after it.
    let mut world = World::build(GpuDrivenRenderer::new(RendererConfig {
        canvas: CanvasOutput {
            scene_color: SceneColor::from_format(format::CANVAS),
            antialias: Antialias::Msaa,
            transparent: false,
        },
        ..RendererConfig::default()
    }));
    let mut mock = MockBackend::default();
    add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    let commands = world.step(&mut mock, true);
    let steps = steps(&world, |r| r.render_graph());
    let drawn = steps
        .iter()
        .position(|step| step.first().is_some_and(|name| name == "Opaque1"))
        .expect("the view draws");
    let resolve = steps
        .iter()
        .position(|step| step.iter().any(|name| name == "Resolve"))
        .expect("the path resolves the scene color into the canvas");
    assert!(
        resolve >= drawn,
        "the resolve draws the view's pixels last: {steps:?}"
    );
    assert!(viewports(&commands).contains(&Some([320, 0, 320, 360])));
}

#[test]
fn removing_a_view_draws_the_camera_alone() {
    let mut world = World::new();
    let mut mock = MockBackend::default();
    let view = add_view(&mut world, [0.0, 0.0, 8.0], RIGHT);
    world.step(&mut mock, true);
    world.renderer.settings_mut().remove_view(view);
    let areas = viewports(&world.step(&mut mock, false));
    assert!(
        !areas.contains(&Some([320, 0, 320, 360])),
        "the rectangle draws nothing: {areas:?}"
    );
}
