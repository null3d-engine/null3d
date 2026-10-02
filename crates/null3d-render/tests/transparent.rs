//! The transparent pass on both frame builders: objects and batch rows whose material blends leave
//! the opaque pass, and draw after it in the camera's render pass, farthest first, with a lower
//! render order before a higher one. Rows of a batch sort one by one, and neighbors in the sorted
//! order that share a bucket draw together. Checked through the mock backend, which rejects what a
//! real GPU would, and by decoding the lists: each blended mesh has its own index count, so the
//! order of the draws shows the order of the objects.

mod common;

use std::collections::HashMap;

use common::World;
use common::blended::{BOX, GRID, PLANE, add_scene};
use null3d_core::scene::Command;
use null3d_gpu::drawlist::{Op, state_flags};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;

/// The pipelines' state flags, by pipeline id, which the lists create.
#[derive(Default)]
struct States(HashMap<u32, u32>);

impl States {
    /// Notes the pipelines that a list creates, and returns each draw of a blended pipeline in the
    /// camera's render pass, outside bundles: its index count and its instances, in order.
    fn blended_draws(&mut self, commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32)> {
        let mut draws = Vec::new();
        let (mut pass, mut in_bundle, mut blended) = (0, false, false);
        for (op, o) in commands {
            match op {
                Op::CreateRenderPipeline => {
                    self.0.insert(o[0], o[6]);
                }
                Op::BeginRenderPass => pass += 1,
                Op::BeginBundle => in_bundle = true,
                Op::EndBundle => in_bundle = false,
                Op::SetPipeline if !in_bundle => {
                    blended = self.0[&o[0]] & state_flags::BLEND != 0;
                }
                Op::DrawIndexed if !in_bundle && blended && pass == 1 => draws.push((o[0], o[1])),
                _ => {}
            }
        }
        draws
    }

    /// True when a bundle sets a blended pipeline, which only the transparent pass may.
    fn bundles_blend(&self, commands: &[(Op, Vec<u32>)]) -> bool {
        let mut in_bundle = false;
        commands.iter().any(|(op, o)| match op {
            Op::BeginBundle => {
                in_bundle = true;
                false
            }
            Op::EndBundle => {
                in_bundle = false;
                false
            }
            Op::SetPipeline => in_bundle && self.0[&o[0]] & state_flags::BLEND != 0,
            _ => false,
        })
    }
}

/// Records a frame and replays it through the mock backend.
fn step<B: FrameBuilder>(world: &mut World<B>, mock: &mut MockBackend, structure_changed: bool) {
    world.record(structure_changed);
    mock.replay(world.renderer.list(world.frame).words())
        .unwrap();
    world.frame += 1;
}

fn check<B: FrameBuilder>(mut world: World<B>, name: &str) {
    let blended = add_scene(&mut world);
    let mut mock = MockBackend::default();
    let mut states = States::default();
    world.record(true);
    mock.replay(world.renderer.list(1).words()).unwrap();
    let commands = world.commands();
    let sphere = blended.sphere;
    // The far grid row, the box, the sphere, the two near grid rows together, then the plane.
    assert_eq!(
        states.blended_draws(&commands),
        [(GRID, 1), (BOX, 1), (sphere, 1), (GRID, 2), (PLANE, 1)],
        "{name}"
    );
    assert!(!states.bundles_blend(&commands), "{name}");
    let made: Vec<u32> = states.0.values().map(|&s| s & state_flags::BLEND).collect();
    for mode in [
        state_flags::BLEND_NORMAL,
        state_flags::BLEND_ADDITIVE,
        state_flags::BLEND_MULTIPLY,
    ] {
        assert!(made.contains(&mode), "{name}: blend {mode}");
    }
    world.frame = 2;

    // A higher render order draws the box last, at any depth.
    world
        .scene
        .apply_commands(
            &[Command::set_render_order(blended.box_object, 1.0)],
            world.frame,
        )
        .unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(
        states.blended_draws(&world_commands(&world)),
        [(GRID, 1), (sphere, 1), (GRID, 2), (PLANE, 1), (BOX, 1)],
        "{name}: render order"
    );

    // A grid row moved behind the camera leaves the pass, and the other near row draws alone.
    let rows = world.batches.get_mut(blended.batch).unwrap();
    rows.positions_mut()[5] = 40.0;
    rows.mark_dirty(1, 1).unwrap();
    step(&mut world, &mut mock, false);
    assert_eq!(
        states.blended_draws(&world_commands(&world)),
        [(GRID, 1), (sphere, 1), (GRID, 1), (PLANE, 1), (BOX, 1)],
        "{name}: culled row"
    );

    // Once the last blended object and batch are gone, the pass sorts no rows, and keeps none of
    // the frame before.
    let gone = blended.objects.map(Command::destroy);
    world.scene.apply_commands(&gone, world.frame).unwrap();
    world
        .batches
        .destroy(blended.batch, world.frame, world.scene.cell_table_mut())
        .unwrap();
    step(&mut world, &mut mock, true);
    assert_eq!(
        states.blended_draws(&world_commands(&world)),
        [],
        "{name}: nothing blends"
    );
}

/// The commands of the frame that recorded last.
fn world_commands<B: FrameBuilder>(world: &World<B>) -> Vec<(Op, Vec<u32>)> {
    let frame = world.frame - 1;
    null3d_gpu::drawlist::decode(world.renderer.list(frame).words())
        .map(|c| {
            let c = c.unwrap();
            (c.op, c.operands.to_vec())
        })
        .collect()
}

#[test]
fn blended_objects_draw_back_to_front_after_the_opaque_ones_on_webgpu() {
    check(World::new(), "WebGPU");
}

#[test]
fn blended_objects_draw_back_to_front_after_the_opaque_ones_on_webgl2() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    check(World::build(CpuCulledRenderer::new(config)), "WebGL2");
}

#[test]
fn multi_draw_joins_the_sorted_draws_of_one_pipeline_in_one_call() {
    let config = CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    add_scene(&mut world);
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let commands = world.commands();
    // Each run draws with another pipeline than its neighbors', so each is a call of its own.
    let mut states = States::default();
    states.blended_draws(&commands);
    let mut blended = false;
    let calls = commands
        .iter()
        .filter(|(op, o)| {
            if *op == Op::SetPipeline {
                blended = states.0[&o[0]] & state_flags::BLEND != 0;
            }
            *op == Op::MultiDrawIndexed && blended
        })
        .count();
    assert_eq!(calls, 5);
}
