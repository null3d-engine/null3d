//! Particle systems, drawn by both frame builders: a system's object draws its records with one
//! instanced draw of six vertices per record in the transparent pass, with the particle pipeline
//! and the system's own groups. While a system fades softly, the camera's view copies its opaque
//! depth, and the camera's depth group binds the copy; otherwise the frame records none of it.
//! Checked through the mock backend, which rejects what a real GPU would, and by decoding the lists.

mod common;

use common::{World, grid};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, layout, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{Shading, feature};
use null3d_render::particles::PARAM_FLOATS;

/// The place of the soft fade's distance among a system's values.
const SOFTNESS: usize = 15;

/// Adds an object with the particle shading and a system of `capacity` records for it, whose
/// frame draws `drawn` records. Returns the system's id.
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
    world.scene.set_local_radius(object, 1.0).unwrap();
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

/// The templates of the render pipelines that the commands create.
fn templates(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, _)| *op == Op::CreateRenderPipeline)
        .map(|(_, o)| o[1])
        .collect()
}

/// The textures that the commands' groups of the depth layout bind.
fn depth_textures(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::CreateBindGroup && o[1] == layout::PARTICLE_SCENE_DEPTH)
        .map(|(_, o)| o[5])
        .collect()
}

fn check<B: FrameBuilder>(mut world: World<B>) {
    let mut mock = MockBackend::default();
    let id = add_system(&mut world, 64, 10);
    let frames: Vec<_> = (0..3).map(|k| world.step(&mut mock, k == 0)).collect();
    let all = frames.concat();
    assert!(templates(&all).contains(&template::PARTICLE));
    assert!(
        !templates(&all)
            .iter()
            .any(|&t| t == template::PARTICLE_DEPTH || t == template::PARTICLE_DEPTH_MS)
    );
    let last = frames.last().unwrap();
    assert!(
        last.iter()
            .any(|(op, o)| *op == Op::Draw && o[..2] == [6, 10]),
        "the system draws its records"
    );
    let blank = depth_textures(&all);
    assert!(
        !blank.is_empty(),
        "the camera's depth group binds the blank texel"
    );

    // A soft system: the camera copies its opaque depth, and its depth group binds the copy.
    let particles = world.renderer.settings_mut().particles_mut();
    particles.values_mut(id).unwrap()[SOFTNESS] = 0.5;
    particles.mark_values(id);
    let soft: Vec<_> = (0..3).map(|_| world.step(&mut mock, false)).collect();
    let all = soft.concat();
    // A multisampled depth's copy reads its first sample.
    assert!(
        templates(&all)
            .iter()
            .any(|&t| t == template::PARTICLE_DEPTH || t == template::PARTICLE_DEPTH_MS)
    );
    assert!(
        depth_textures(&all).iter().any(|t| !blank.contains(t)),
        "the camera binds the depth copy"
    );

    // Once the system is gone, its object draws nothing.
    world.renderer.settings_mut().particles_mut().destroy(id);
    let gone: Vec<_> = (0..2).map(|_| world.step(&mut mock, false)).collect();
    assert!(
        !gone
            .last()
            .unwrap()
            .iter()
            .any(|(op, o)| *op == Op::Draw && o[..2] == [6, 10])
    );
}

#[test]
fn particle_systems_draw_and_copy_depth_while_soft_on_webgpu() {
    check(World::new());
}

#[test]
fn particle_systems_draw_and_copy_depth_while_soft_on_webgl2() {
    for multi_draw in [true, false] {
        let config = CpuCulledConfig {
            multi_draw,
            ..CpuCulledConfig::default()
        };
        check(World::build(CpuCulledRenderer::new(config)));
    }
}
