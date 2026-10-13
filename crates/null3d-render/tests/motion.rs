//! The motion pass (decision record D-140) on the WebGL2 frame builder, checked through the mock
//! backend by decoding the lists it records: a scene object that moved draws its motion in the
//! next frame, and a frame where it stands still leaves it out.

mod common;

use common::World;
use null3d_gpu::caps::Capabilities;
use null3d_gpu::drawlist::{Op, permutation, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_view::DebugView;
use null3d_render::frame::FrameBuilder;

type Commands = [(Op, Vec<u32>)];

/// The draw calls of the frame's motion pass: the draws after each motion pipeline is set.
fn motion_draws(commands: &Commands, motion: &mut Vec<u32>) -> usize {
    let mut draws = 0;
    let mut drawing = false;
    for (op, operands) in commands {
        match op {
            Op::CreateRenderPipeline
                if operands[1] == template::MOTION || operands[2] & permutation::MOTION != 0 =>
            {
                motion.push(operands[0]);
            }
            Op::SetPipeline => drawing = motion.contains(&operands[0]),
            Op::EndRenderPass => drawing = false,
            Op::DrawIndexed | Op::MultiDrawIndexed | Op::DrawIndexedIndirect if drawing => {
                draws += 1
            }
            _ => {}
        }
    }
    draws
}

fn world(hold: bool) -> World<CpuCulledRenderer> {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    world.renderer.allow_motion(true, true);
    world
        .renderer
        .settings_mut()
        .set_debug_view(DebugView::Motion);
    if hold {
        // Hold mode records the frame before the held one and the held one before the thread
        // that draws has drawn any frame.
        world.pipelines_built = 0;
    }
    world
}

fn check(hold: bool) {
    let mut world = world(hold);
    let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
    let mut motion = Vec::new();
    let object = world.objects[0];
    // Still frames first, while the motion view's pipeline builds and the motion pass fills its
    // copies of the last frame's data; then one frame that moves the object, then still ones.
    let mut draws = Vec::new();
    for frame in 0..8 {
        if frame == 4 {
            world.scene.set_position(object, [-3.0, 1.0, 0.0]).unwrap();
        }
        let commands = world.step(&mut mock, frame == 0);
        draws.push(motion_draws(&commands, &mut motion));
    }
    eprintln!("hold {hold}: motion pipelines {motion:?}, draws by frame {draws:?}");
    assert!(
        draws[4] > draws[3] && draws[7] == draws[3],
        "hold {hold}: the moved object draws its motion in its frame alone, beside the world's calls that always move ({draws:?})"
    );
}

#[test]
fn a_moved_scene_object_draws_its_motion_in_the_next_frame() {
    check(false);
}

#[test]
fn a_moved_scene_object_draws_its_motion_in_hold_mode() {
    check(true);
}

#[test]
fn webgpu_motion_tables_exist_when_the_first_use_pipelines_finish() {
    for late in [false, true] {
        let mut world = World::new();
        let mut mock = MockBackend::with_capabilities(Capabilities::MSAA_FLOAT16);
        world.renderer.allow_motion(true, true);
        if late {
            for frame in 0..4 {
                world.step(&mut mock, frame == 0);
            }
        }
        world
            .renderer
            .settings_mut()
            .set_debug_view(DebugView::Motion);
        let mut pipelines = Vec::new();
        let mut draws = 0;
        for frame in 0..8 {
            let commands = world.step(&mut mock, !late && frame == 0);
            draws += motion_draws(&commands, &mut pipelines);
        }
        assert!(
            draws > 0,
            "motion must draw after its pipelines finish, late={late}"
        );
    }
}
