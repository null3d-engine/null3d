//! The scene's material override, checked through the mock backend and by decoding the lists that
//! both frame builders record: every mesh and instance batch of the main pass draws with the
//! override's material and its one pipeline, each keeps its mesh and its instances, and the shadow
//! pass keeps each caster's own material. A material that draws a sprite, point or line batch keeps
//! its own, and an unset override leaves every material as it was.

mod common;

use common::{World, base_format};
use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, state_flags, template};
use null3d_gpu::mock::MockBackend;
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, NO_MATERIAL, drawn_material};
use null3d_render::geometry::box_geometry;
use null3d_render::materials::{MaterialTable, Shading, feature};

type Commands = [(Op, Vec<u32>)];

/// The template and state of each mesh, caster or cut-out pipeline that a frame's list creates.
fn mesh_pipelines(commands: &Commands) -> Vec<(u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| {
            *op == Op::CreateRenderPipeline
                && matches!(
                    o[1],
                    template::INSTANCED_LIT
                        | template::INSTANCED_UNLIT
                        | template::INSTANCED_UNLIT_MAP
                        | template::INSTANCED_STANDARD_MAPS
                        | template::SHADOW_DEPTH
                        | template::SHADOW_CUTOUT
                        | template::SHADOW_CUTOUT_MAP
                )
        })
        .map(|(_, o)| (o[1], o[6]))
        .collect()
}

/// A material of the test's own, which no object uses, that draws both faces: its pipeline is one
/// that a frame of the world's own materials does not make.
fn override_material<B: FrameBuilder>(world: &mut World<B>) -> u32 {
    world
        .renderer
        .settings_mut()
        .materials_mut()
        .create(Shading::Unlit, feature::DOUBLE_SIDED, [0.0, 1.0, 0.0, 1.0])
        .unwrap()
        + 1
}

fn check<B: FrameBuilder>(mut world: World<B>, name: &str) {
    let mut mock = MockBackend::default();
    let first = world.step(&mut mock, true);
    // The world's own materials draw with their lit and unlit pipelines.
    assert!(
        mesh_pipelines(&first)
            .iter()
            .any(|&(template, _)| template == template::INSTANCED_LIT),
        "{name}: the lit objects draw with a lit pipeline"
    );

    let material = override_material(&mut world);
    assert!(
        world
            .renderer
            .settings_mut()
            .set_override_material(material),
        "{name}: the override is new"
    );
    assert_eq!(
        world.renderer.settings().override_material(),
        material,
        "{name}"
    );
    let draws = mock.draws;
    let commands = world.step(&mut mock, true);
    let made = mesh_pipelines(&commands);
    // Every mesh and every batch row draws with the same material, so one pipeline serves them
    // all: an override adds no pipeline for each object.
    assert_eq!(made.len(), 1, "{name}: one pipeline draws every mesh");
    assert_eq!(made[0].0, template::INSTANCED_UNLIT, "{name}");
    assert_ne!(
        made[0].1 & state_flags::CULL_NONE,
        0,
        "{name}: the override's double-sided state"
    );
    assert!(
        mock.draws > draws,
        "{name}: the meshes draw with the override"
    );

    // Clearing the override gives each object its own material again, whose pipelines the GPU
    // already has: a frame makes none.
    assert!(
        world
            .renderer
            .settings_mut()
            .set_override_material(NO_MATERIAL),
        "{name}: the override clears"
    );
    let draws = mock.draws;
    let commands = world.step(&mut mock, true);
    assert!(
        mesh_pipelines(&commands).is_empty(),
        "{name}: the materials' pipelines are built already"
    );
    assert!(mock.draws > draws, "{name}: the meshes draw again");
    assert!(
        !world
            .renderer
            .settings_mut()
            .set_override_material(NO_MATERIAL),
        "{name}: clearing an unset override changes nothing"
    );
}

#[test]
fn every_mesh_of_the_main_pass_draws_with_the_override_on_both_paths() {
    check(World::new(), "WebGPU");
    for multi_draw in [true, false] {
        check(
            World::build(CpuCulledRenderer::new(CpuCulledConfig {
                multi_draw,
                ..CpuCulledConfig::default()
            })),
            &format!("WebGL2, multi-draw {multi_draw}"),
        );
    }
}

fn check_shadow<B: FrameBuilder>(mut world: World<B>, name: &str) {
    // A masked object that casts shadows: the override draws its surface, while its own material
    // cuts its shadow, so a shadow map drawn with the override would show no cut-out pipeline.
    let settings = world.renderer.settings_mut();
    let mesh = settings
        .meshes_mut()
        .add(&base_format(
            box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap(),
        ))
        .unwrap()
        + 1;
    let masked = settings
        .materials_mut()
        .create(Shading::Lit, feature::ALPHA_MASK, [1.0; 4])
        .unwrap()
        + 1;
    let object = world.scene.reserve().unwrap();
    world.scene.set_local_radius(object, 0.9).unwrap();
    world
        .scene
        .apply_commands(
            &[
                Command::create(
                    object,
                    Handle::NONE,
                    mesh,
                    flags::VISIBLE | flags::CAST_SHADOWS,
                ),
                Command::set_material(object, masked),
            ],
            world.frame,
        )
        .unwrap();
    world.cast_sun_shadows(1);
    let material = override_material(&mut world);
    assert!(
        world
            .renderer
            .settings_mut()
            .set_override_material(material),
        "{name}"
    );

    let mut mock = MockBackend::default();
    let commands = world.step(&mut mock, true);
    let made = mesh_pipelines(&commands);
    assert!(
        made.iter()
            .any(|&(template, _)| template == template::INSTANCED_UNLIT),
        "{name}: the surfaces draw with the override"
    );
    assert!(
        made.iter()
            .any(|&(template, _)| template == template::SHADOW_CUTOUT),
        "{name}: the caster cuts its shadow with its own material"
    );
    assert!(
        !made
            .iter()
            .any(|&(template, _)| template == template::INSTANCED_LIT),
        "{name}: no surface draws with its own material"
    );
}

#[test]
fn the_shadow_pass_keeps_each_casters_own_material() {
    check_shadow(World::new(), "WebGPU");
    check_shadow(
        World::build(CpuCulledRenderer::new(CpuCulledConfig::default())),
        "WebGL2",
    );
}

#[test]
fn a_batch_only_material_keeps_its_own_material() {
    let mut materials = MaterialTable::with_capacity(8);
    let create = |materials: &mut MaterialTable, shading: Shading| {
        materials.create(shading, 0, [1.0; 4]).unwrap() + 1
    };
    let lit = create(&mut materials, Shading::Lit);
    let sprite = create(&mut materials, Shading::Sprite);
    let line = create(&mut materials, Shading::Line);
    let particle = create(&mut materials, Shading::Particle);

    assert_eq!(drawn_material(&materials, NO_MATERIAL, lit), lit);
    assert_eq!(drawn_material(&materials, sprite, lit), sprite);
    assert_eq!(drawn_material(&materials, sprite, sprite), sprite);
    assert_eq!(drawn_material(&materials, sprite, line), line);
    assert_eq!(drawn_material(&materials, sprite, particle), particle);
}
