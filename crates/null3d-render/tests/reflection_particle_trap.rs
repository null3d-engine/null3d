//! A second view and a mirror view each draw a particle system beside a blended mesh on the WebGL2
//! frame builder, with a ground whose material samples the view's target: the camera's view, the
//! view, the ground, a blended plane and one particle system, recorded and replayed through the
//! mock backend, which rejects what a real GPU would. The transparent pass writes each view's draw
//! records in blocks, and a call that writes none, as a particle system's does, must not size the
//! block.

mod common;

use std::collections::HashMap;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, decode, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::Geometry;
use null3d_render::materials::{CustomShading, MapSlot, Shading, feature};
use null3d_render::mirror::Mirror;
use null3d_render::particles::PARAM_FLOATS;
use null3d_render::view::{View, ViewId};

/// The shading of a custom material built on the standard template, with `textures` textures.
fn surface(textures: u32) -> Shading {
    Shading::Custom(CustomShading {
        template: template::INSTANCED_LIT,
        attributes: 0,
        base_color: true,
        textures,
        transmission: false,
        row_values: false,
        caster: false,
        object_ids: false,
    })
}

/// Adds an object that draws `mesh` with `material`, at `z`, and returns it.
fn add_object<B: FrameBuilder>(
    world: &mut World<B>,
    mesh: &Geometry,
    material: u32,
    z: f32,
    radius: f32,
) -> Handle {
    let mesh = world
        .renderer
        .settings_mut()
        .meshes_mut()
        .add(mesh)
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_position(object, [0.0, 0.0, z]).unwrap();
    world.scene.set_local_radius(object, radius).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    object
}

/// Adds a particle system's object of `capacity` records that draws `drawn` of them.
fn add_system<B: FrameBuilder>(world: &mut World<B>, capacity: u32, drawn: u32) -> u32 {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(&grid(1, 1)).unwrap() + 1;
    let features = feature::BLEND
        | feature::ADDITIVE
        | feature::NO_DEPTH_WRITE
        | feature::DOUBLE_SIDED
        | feature::SINGLE_PASS;
    let material = settings
        .materials_mut()
        .create(Shading::Particle, features, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 2.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    let particles = world.renderer.settings_mut().particles_mut();
    let id = particles.create(object.slot(), capacity).unwrap();
    let values = particles.values_mut(id).unwrap();
    values[PARAM_FLOATS] = 1.0;
    values[PARAM_FLOATS + 1] = drawn as f32;
    id
}

/// Adds a ground that samples the view's target, and returns its material.
fn add_ground<B: FrameBuilder>(world: &mut World<B>, view: ViewId) -> u32 {
    let mirror = world.show(view);
    let settings = world.renderer.settings_mut();
    let ground = settings
        .materials_mut()
        .create(surface(1), 0, [0.3, 0.3, 0.3, 1.0])
        .unwrap();
    settings
        .materials_mut()
        .set_map(ground, MapSlot::BaseColor, mirror, false)
        .unwrap();
    add_object(world, &grid(2, 2), ground + 1, 0.0, 20.0);
    ground
}

/// Adds a blended plane at `z`.
fn add_blended<B: FrameBuilder>(world: &mut World<B>, z: f32) {
    let blended = world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(
            surface(0),
            feature::BLEND | feature::NO_DEPTH_WRITE,
            [0.6, 0.8, 1.0, 0.5],
        )
        .unwrap();
    add_object(world, &grid(1, 1), blended + 1, z, 1.0);
}

/// Records the scene for four frames and replays each list through the mock backend.
fn record_and_replay(world: &mut World<CpuCulledRenderer>, frames: u32) {
    let mut mock = MockBackend::default();
    for _ in 0..frames {
        world.try_record(false).unwrap();
        mock.replay(world.renderer.list(world.frame).words())
            .unwrap();
        world.frame += 1;
    }
}

/// A ground that samples the view's target, a blended plane and one particle system, recorded for
/// four frames. The particle call writes no records, so a view that sorts it last must not size
/// the view's record block from it.
fn record_the_scene(mut world: World<CpuCulledRenderer>, view: ViewId) {
    add_ground(&mut world, view);
    add_blended(&mut world, 5.0);
    add_system(&mut world, 64, 10);
    record_and_replay(&mut world, 4);
}

/// Two blended planes on either side of the particle system: each view sorts one of them before the
/// particle call and the other after, so the run after the particle call must take a record block
/// of its own rather than the block of the run before it.
fn check_each_run_has_its_own_records(mut world: World<CpuCulledRenderer>, view: ViewId) {
    add_ground(&mut world, view);
    for z in [10.0, -10.0] {
        add_blended(&mut world, z);
    }
    add_system(&mut world, 64, 10);
    // The first recorded list creates every pipeline, so it names each draw's pipeline state. Each
    // later frame of the same parity reuses that list, so read it after the first frame alone.
    let first = world.frame;
    record_and_replay(&mut world, 1);
    let mut by_view: HashMap<u32, Vec<u32>> = HashMap::new();
    for (group, at) in blended_record_offsets(world.renderer.list(first).words()) {
        by_view.entry(group).or_default().push(at);
    }
    assert!(!by_view.is_empty(), "the blended planes draw");
    for (group, offsets) in by_view {
        let mut unique = offsets.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(
            offsets.len(),
            unique.len(),
            "each run writes records of its own: view {group} {offsets:?}"
        );
    }
}

/// The draw-record offset that each blended mesh draw binds, filed under the group of the view's
/// draw records: two runs of one view must not share a block.
fn blended_record_offsets(words: &[u32]) -> Vec<(u32, u32)> {
    let mut states = HashMap::new();
    let (mut blended, mut pending) = (false, None);
    let mut offsets = Vec::new();
    for command in decode(words).map(|command| command.unwrap()) {
        match command.op {
            Op::CreateRenderPipeline => {
                states.insert(command.operands[0], command.operands[6]);
            }
            Op::SetPipeline => {
                blended = states
                    .get(&command.operands[0])
                    .is_some_and(|&state| state & state_flags::BLEND != 0);
                pending = None;
            }
            Op::SetBindGroup if command.operands[0] == 1 && command.operands[2] == 1 => {
                pending = Some((command.operands[1], command.operands[3]));
            }
            Op::DrawIndexed | Op::MultiDrawIndexed if blended => {
                if let Some(pair) = pending.take() {
                    offsets.push(pair);
                }
            }
            Op::Draw => pending = None,
            _ => {}
        }
    }
    offsets
}

#[test]
fn a_plain_second_view_records_particles_beside_a_blended_mesh() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let view = world.add_view([0.0, 0.0, 10.0]);
    record_the_scene(world, view);
}

#[test]
fn a_mirror_view_records_particles_beside_a_blended_mesh() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0, -2.0, 0.0]).unwrap();
    let view = world
        .renderer
        .settings_mut()
        .add_view(View::mirror(mirror, Some(1), None))
        .unwrap();
    record_the_scene(world, view);
}

#[test]
fn a_mirror_view_records_particles_beside_a_blended_mesh_with_multi_draw() {
    let config = CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0, -2.0, 0.0]).unwrap();
    let view = world
        .renderer
        .settings_mut()
        .add_view(View::mirror(mirror, Some(1), None))
        .unwrap();
    record_the_scene(world, view);
}

#[test]
fn a_mirror_view_gives_each_blended_run_its_own_records() {
    let config = CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0, -2.0, 0.0]).unwrap();
    let view = world
        .renderer
        .settings_mut()
        .add_view(View::mirror(mirror, Some(1), None))
        .unwrap();
    check_each_run_has_its_own_records(world, view);
}

#[test]
fn a_mirror_view_gives_each_blended_run_its_own_records_with_multi_draw() {
    let config = CpuCulledConfig {
        multi_draw: true,
        ..CpuCulledConfig::default()
    };
    let mut world = World::build(CpuCulledRenderer::new(config));
    let mirror = Mirror::new([0.0, 1.0, 0.0], [0.0, -2.0, 0.0]).unwrap();
    let view = world
        .renderer
        .settings_mut()
        .add_view(View::mirror(mirror, Some(1), None))
        .unwrap();
    check_each_run_has_its_own_records(world, view);
}
