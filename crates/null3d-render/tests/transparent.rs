//! The transparent pass on both frame builders: objects and batch rows whose material blends leave
//! the opaque pass, and draw after it in the camera's render pass, farthest first, with a lower
//! render order before a higher one. Rows of a batch sort one by one, and neighbors in the sorted
//! order that share a bucket draw together. Checked through the mock backend, which rejects what a
//! real GPU would, and by decoding the lists: each blended mesh has its own index count, so the
//! order of the draws shows the order of the objects.

mod common;

use std::collections::HashMap;

use common::World;
use common::blended::{BOX, GRID, PLANE, add_blended, add_scene, blended_pair};
use common::{base_format, base_sphere, grid};
use null3d_core::scene::Command;
use null3d_gpu::drawlist::{Op, state_flags};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_view::DebugView;
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::box_geometry;
use null3d_render::materials::feature;

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

    // In the normals view nothing blends, so the pass sorts no rows, and keeps none of the frame
    // before.
    assert!(
        world
            .renderer
            .settings_mut()
            .set_debug_view(DebugView::Normals)
    );
    step(&mut world, &mut mock, true);
    assert_eq!(
        states.blended_draws(&world_commands(&world)),
        [],
        "{name}: normals view"
    );

    // Once the last blended object and batch are gone, the pass sorts no rows either.
    assert!(world.renderer.settings_mut().set_debug_view(DebugView::Lit));
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

/// Each draw of the camera's transparent pass, outside bundles: its index count, its instances,
/// and the faces that its pipeline culls.
fn blended_faces(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    let faces = state_flags::CULL_NONE | state_flags::CULL_FRONT;
    let mut states = HashMap::new();
    let (mut pass, mut in_bundle, mut state) = (0, false, 0);
    let mut draws = Vec::new();
    for (op, o) in commands {
        match op {
            Op::CreateRenderPipeline => {
                states.insert(o[0], o[6]);
            }
            Op::BeginRenderPass => pass += 1,
            Op::BeginBundle => in_bundle = true,
            Op::EndBundle => in_bundle = false,
            Op::SetPipeline if !in_bundle => state = states[&o[0]],
            Op::DrawIndexed if !in_bundle && state & state_flags::BLEND != 0 && pass == 1 => {
                draws.push((o[0], o[1], state & faces));
            }
            _ => {}
        }
    }
    draws
}

/// A double-sided box that blends draws its back faces, then its front faces, as three.js draws
/// it. With `forceSinglePass` a sphere draws once with both faces, and a batch of double-sided
/// grids draws each run's back faces before its front faces.
fn check_faces<B: FrameBuilder>(mut world: World<B>, name: &str) {
    let both = feature::DOUBLE_SIDED;
    let box_mesh = base_format(box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap());
    let sphere_mesh = base_sphere(0.5, [8, 6]);
    let sphere = sphere_mesh.indices.len() as u32;
    let (mesh, material) = blended_pair(&mut world, &box_mesh, both);
    add_blended(&mut world, mesh, material, -5.0);
    let (mesh, material) = blended_pair(&mut world, &sphere_mesh, both | feature::SINGLE_PASS);
    add_blended(&mut world, mesh, material, 0.0);
    let (mesh, material) = blended_pair(&mut world, &grid(2, 2), both);
    let batch = world
        .batches
        .create(2, false, false, mesh, material, 1.5)
        .unwrap();
    let rows = world.batches.get_mut(batch).unwrap();
    rows.positions_mut()
        .copy_from_slice(&[0.0, 0.0, 2.0, 0.0, 0.0, 3.0]);
    rows.set_active_count(2).unwrap();
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let (back, front, none) = (state_flags::CULL_FRONT, 0, state_flags::CULL_NONE);
    let draws = blended_faces(&world.commands());
    let expected = [
        (BOX, 1, back),
        (BOX, 1, front),
        (sphere, 1, none),
        (GRID, 2, back),
        (GRID, 2, front),
    ];
    assert_eq!(draws, expected, "{name}");
}

#[test]
fn double_sided_blended_meshes_draw_back_faces_first_on_webgpu() {
    check_faces(World::new(), "WebGPU");
}

#[test]
fn double_sided_blended_meshes_draw_back_faces_first_on_webgl2() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    check_faces(World::build(CpuCulledRenderer::new(config)), "WebGL2");
}

/// The records offset that each draw of the camera's transparent pass binds, outside bundles.
fn blended_records(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    let mut states = HashMap::new();
    let (mut pass, mut in_bundle, mut state, mut records) = (0, false, 0, 0);
    let mut offsets = Vec::new();
    for (op, o) in commands {
        match op {
            Op::CreateRenderPipeline => {
                states.insert(o[0], o[6]);
            }
            Op::BeginRenderPass => pass += 1,
            Op::BeginBundle => in_bundle = true,
            Op::EndBundle => in_bundle = false,
            Op::SetPipeline if !in_bundle => state = states[&o[0]],
            Op::SetBindGroup if !in_bundle && o[0] == 1 && o[2] == 1 => records = o[3],
            Op::DrawIndexed if !in_bundle && state & state_flags::BLEND != 0 && pass == 1 => {
                offsets.push(records);
            }
            _ => {}
        }
    }
    offsets
}

/// On WebGL2 a run's front faces draw from the records of its back faces, so each run writes one
/// aligned block of records, not two.
#[test]
fn a_runs_front_faces_reuse_the_records_of_its_back_faces_on_webgl2() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let box_mesh = base_format(box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap());
    // Two materials, so the boxes sort into two runs.
    for z in [-5.0, 0.0] {
        let (mesh, material) = blended_pair(&mut world, &box_mesh, feature::DOUBLE_SIDED);
        add_blended(&mut world, mesh, material, z);
    }
    world.record(true);
    MockBackend::default()
        .replay(world.renderer.list(1).words())
        .unwrap();
    let offsets = blended_records(&world.commands());
    assert_eq!(offsets.len(), 4, "two runs, each in two draws");
    assert_eq!(
        offsets[0], offsets[1],
        "the far box's two draws share their records"
    );
    assert_eq!(
        offsets[2], offsets[3],
        "the near box's two draws share their records"
    );
    assert_ne!(offsets[1], offsets[2], "each run has records of its own");
}
