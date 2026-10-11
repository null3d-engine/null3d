//! Levels of detail: the buckets that a mesh's levels add on WebGPU, with their fading builds, and
//! the level that each object draws on the WebGL2 path, by its distance from the camera.

mod common;

use common::{World, base_sphere, count};
use null3d_gpu::drawlist::{Op, permutation, template};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, LevelQuality};
use null3d_render::levels::LevelError;

/// The world's ball mesh, by engine id, which its third and fourth objects draw: the third 20 m
/// from the camera, the fourth hidden.
const BALL: u32 = 2;

/// Gives the world's ball two lower levels, and returns their engine mesh ids. The world's canvas
/// is 360 pixels high and its camera 60 degrees high, so at a threshold of 1 pixel a level switches
/// in past its error times 311.8: level 1 past 3.1 m, and level 2 past 15.6 m. The ball 20 m away
/// draws level 2, past its fading band, which ends at 17.9 m.
fn give_levels<B: FrameBuilder>(world: &mut World<B>, fades: bool) -> [u32; 2] {
    let settings = world.renderer.settings_mut();
    let meshes = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(BALL, &meshes, &[0.01, 0.05], fades)
        .unwrap();
    meshes
}

/// The indices that a mesh draws, by engine id: those of its first part.
fn indices_of<B: FrameBuilder>(world: &World<B>, mesh: u32) -> u32 {
    let meshes = world.renderer.settings().meshes();
    meshes.parts(meshes.mesh(mesh - 1).unwrap())[0].index_count
}

#[test]
fn levels_take_live_meshes_with_the_base_format_and_errors_that_grow() {
    let mut world = World::new();
    let settings = world.renderer.settings_mut();
    let level = settings
        .meshes_mut()
        .add(&base_sphere(0.5, [6, 4]))
        .unwrap()
        + 1;
    let mapped = settings.meshes_mut().add(&common::grid(2, 2)).unwrap() + 1;
    assert_eq!(
        settings.set_mesh_levels(BALL, &[99], &[0.1], true),
        Err(LevelError::Mesh)
    );
    assert_eq!(
        settings.set_mesh_levels(BALL, &[mapped], &[0.1], true),
        Err(LevelError::Format)
    );
    assert_eq!(
        settings.set_mesh_levels(BALL, &[level, level], &[0.1, 0.05], true),
        Err(LevelError::Errors)
    );
    settings
        .set_mesh_levels(BALL, &[level], &[0.1], true)
        .unwrap();
    assert!(settings.levels().any());
    // A removed level takes the levels away from its base mesh.
    world.renderer.remove_meshes(&[level - 1]);
    assert!(!world.renderer.settings().levels().any());
}

/// The indexed indirect draws that a frame of `world` records in its bundles.
fn indirect_draws(world: &mut World) -> usize {
    world.record(true);
    count(&world.commands(), Op::DrawIndexedIndirect)
}

#[test]
fn each_level_has_a_bucket_and_a_fade_bucket_whose_pipelines_dither_on_webgpu() {
    let plain = indirect_draws(&mut World::new());
    // Two lower levels add two buckets, and the fading bands a fade bucket for each of the three
    // levels, each with one draw in each view that draws the scene's layout.
    let mut world = World::new();
    give_levels(&mut world, true);
    let fading = indirect_draws(&mut world);
    let mut crisp = World::new();
    give_levels(&mut crisp, false);
    let switching = indirect_draws(&mut crisp);
    assert!(switching > plain, "{plain} {switching}");
    assert_eq!(
        (fading - plain) * 2,
        (switching - plain) * 5,
        "{plain} {switching} {fading}"
    );
    // The fade buckets draw with the dithering builds of the standard material, and the other
    // buckets with the plain ones.
    let lit: Vec<u32> = world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[1] == template::INSTANCED_LIT)
        .map(|(_, o)| o[2])
        .collect();
    assert!(
        lit.iter().any(|p| p & permutation::LOD_FADE != 0),
        "{lit:?}"
    );
    assert!(
        lit.iter().any(|p| p & permutation::LOD_FADE == 0),
        "{lit:?}"
    );
}

#[test]
fn quality_without_bands_drops_the_fade_buckets() {
    let mut world = World::new();
    give_levels(&mut world, true);
    let fading = indirect_draws(&mut world);
    let rebuild = world
        .renderer
        .settings_mut()
        .set_level_quality(LevelQuality {
            fades: false,
            ..LevelQuality::default()
        });
    assert!(rebuild, "turning the bands off changes the buckets");
    world.frame += 1;
    assert!(indirect_draws(&mut world) < fading);
}

/// The world drawn by the WebGL2 frame builder, one draw per bucket.
fn cpu_world() -> World<CpuCulledRenderer> {
    World::build(CpuCulledRenderer::new(CpuCulledConfig {
        multi_draw: false,
        ..CpuCulledConfig::default()
    }))
}

/// The index count and instance count of each draw that a frame of `world` records.
fn draws(world: &World<CpuCulledRenderer>) -> Vec<(u32, u32)> {
    world
        .commands()
        .iter()
        .filter(|(op, _)| *op == Op::DrawIndexed)
        .map(|(_, o)| (o[0], o[1]))
        .collect()
}

#[test]
fn each_object_draws_the_level_that_its_distance_picks_on_the_job_workers() {
    let mut world = cpu_world();
    let [_, coarse] = give_levels(&mut world, false);
    world.record(true);
    let drawn = draws(&world);
    // The ball 20 m away draws its coarsest level, and nothing draws its base mesh.
    assert!(
        drawn.contains(&(indices_of(&world, coarse), 1)),
        "{drawn:?}"
    );
    assert!(
        !drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&world, BALL)),
        "{drawn:?}"
    );
}

#[test]
fn a_larger_threshold_or_no_threshold_moves_the_switches() {
    let mut world = cpu_world();
    let [_, coarse] = give_levels(&mut world, false);
    // At a threshold of 0 every object draws its base level.
    world
        .renderer
        .settings_mut()
        .set_level_quality(LevelQuality {
            threshold: 0.0,
            ..LevelQuality::default()
        });
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, BALL), 1)), "{drawn:?}");
    assert!(
        !drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&world, coarse)),
        "{drawn:?}"
    );
}

#[test]
fn a_ball_inside_a_fading_band_draws_both_levels_in_pairs() {
    let mut world = cpu_world();
    let [fine, coarse] = give_levels(&mut world, true);
    // 16.8 m from the camera lies inside level 2's band, from 15.6 m to 17.9 m.
    let ball = world.objects[2];
    world.scene.set_position(ball, [0.0, 0.0, 3.2]).unwrap();
    world.record(true);
    let drawn = draws(&world);
    // Both levels draw the ball once, each from a fade bucket whose entries come in pairs.
    assert!(
        drawn.contains(&(indices_of(&world, coarse), 1)),
        "{drawn:?}"
    );
    assert!(drawn.contains(&(indices_of(&world, fine), 1)), "{drawn:?}");
}
