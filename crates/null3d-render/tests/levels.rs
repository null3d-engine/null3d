//! Levels of detail: the buckets that a mesh's levels add on WebGPU, with their fading builds, and
//! the level that each object draws on the WebGL2 path, by its distance from the camera.

mod common;

use common::{World, base_sphere, count};
use null3d_core::scene::Command;
use null3d_gpu::drawlist::{Op, permutation, template};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, LevelQuality};
use null3d_render::levels::LevelError;
use null3d_render::materials::{Shading, feature};

/// The masked pipelines that a frame of `world` created.
fn masked_pipelines(world: &World) -> usize {
    world
        .commands()
        .iter()
        .filter(|(op, o)| *op == Op::CreateRenderPipeline && o[2] & permutation::ALPHA_MASK != 0)
        .count()
}

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
        .set_mesh_levels(BALL, &meshes, &[0.01, 0.05], &[0, 0], fades)
        .unwrap();
    meshes
}

/// The indices that a mesh draws, by engine id: those of its first part.
fn indices_of<B: FrameBuilder>(world: &World<B>, mesh: u32) -> u32 {
    let meshes = world.renderer.settings().meshes();
    meshes.parts(meshes.mesh(mesh - 1).unwrap(), false)[0].index_count
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
        settings.set_mesh_levels(BALL, &[99], &[0.1], &[0], true),
        Err(LevelError::Mesh)
    );
    assert_eq!(
        settings.set_mesh_levels(BALL, &[mapped], &[0.1], &[0], true),
        Err(LevelError::Format)
    );
    assert_eq!(
        settings.set_mesh_levels(BALL, &[level, level], &[0.1, 0.05], &[0, 0], true),
        Err(LevelError::Errors)
    );
    settings
        .set_mesh_levels(BALL, &[level], &[0.1], &[0], true)
        .unwrap();
    assert!(settings.levels().any());
    // A removed level takes the levels away from its base mesh.
    world.renderer.remove_meshes(&[level - 1]);
    assert!(!world.renderer.settings().levels().any());
}

#[test]
fn a_level_that_names_a_material_draws_with_that_material() {
    // The world's materials are neither masked. A level whose material masks draws with the masked
    // builds, and one that inherits the base material's draws with none.
    let mut plain = World::new();
    give_levels(&mut plain, true);
    plain.record(true);
    assert_eq!(masked_pipelines(&plain), 0);

    let mut world = World::new();
    let settings = world.renderer.settings_mut();
    let masked = settings
        .materials_mut()
        .create(Shading::Lit, feature::ALPHA_MASK, [1.0; 4])
        .unwrap()
        + 1;
    let meshes = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(BALL, &meshes, &[0.01, 0.05], &[0, masked], true)
        .unwrap();
    world.record(true);
    assert!(masked_pipelines(&world) > 0);
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

/// The copy lists that a frame reserves for each layout, in bytes per view: the scene's, the
/// casters', the outlined objects', the scattered ones' and the moving ones'.
fn copies(world: &World) -> [u32; 5] {
    world.renderer.compacted_bytes()
}

/// Gives the world's ball one lower level for each error, each simpler than the one before, and
/// fading bands when `fades`. Returns their engine mesh ids.
fn give_levels_of<B: FrameBuilder>(world: &mut World<B>, errors: &[f32], fades: bool) -> Vec<u32> {
    let finest = [[6, 4], [4, 3], [3, 2], [2, 1]];
    let settings = world.renderer.settings_mut();
    let meshes: Vec<u32> = errors
        .iter()
        .zip(finest)
        .map(|(_, segments)| {
            settings
                .meshes_mut()
                .add(&base_sphere(0.5, segments))
                .unwrap()
                + 1
        })
        .collect();
    settings
        .set_mesh_levels(BALL, &meshes, errors, &vec![0; errors.len()], fades)
        .unwrap();
    meshes
}

/// Moves the world's visible ball `distance` metres in front of the camera, which looks down -z
/// from 20 m out.
fn ball_at(world: &mut World, distance: f32) {
    let ball = world.objects[2];
    world
        .scene
        .set_position(ball, [0.0, 0.0, 20.0 - distance])
        .unwrap();
}

#[test]
fn a_meshs_levels_take_the_room_of_the_copy_that_draws_not_of_a_level_each() {
    let mut plain = World::new();
    plain.record(true);
    let without = copies(&plain);
    let mut world = World::new();
    give_levels(&mut world, true);
    world.record(true);
    let fading = copies(&world);
    // Two balls draw the base mesh, one of them hidden, and the ball 20 m away picks the coarsest
    // level. Its three plain and three fade buckets reserve one copy between them, for that one
    // ball, where a level's bucket for each copy would reserve two in every one.
    assert_eq!(fading[0] + 64, without[0], "{fading:?} {without:?}");
}

#[test]
fn a_ball_inside_a_band_takes_one_copy_in_each_of_the_two_fade_buckets() {
    let mut world = World::new();
    give_levels(&mut world, true);
    ball_at(&mut world, 20.0);
    world.record(true);
    let picked = copies(&world)[0];
    // Inside level 2's band the ball draws both levels' fade buckets, so it takes two copies:
    // one in each, and none elsewhere.
    ball_at(&mut world, 16.8);
    world.frame += 1;
    world.record(false);
    let band = copies(&world)[0];
    assert_eq!(band, picked + 64, "{band} {picked}");
}

#[test]
fn a_coarse_level_takes_no_more_room_than_the_finest_one() {
    let mut fine = World::new();
    give_levels(&mut fine, false);
    ball_at(&mut fine, 1.0);
    fine.record(true);
    let mut coarse = World::new();
    give_levels(&mut coarse, false);
    ball_at(&mut coarse, 100.0);
    coarse.record(true);
    // The ball draws its base mesh at 1 m and its coarsest level at 100 m: the level set takes
    // the copy of the ball that draws, whatever level the distance picks.
    assert_eq!(copies(&fine), copies(&coarse));
    let mut hidden = World::new();
    give_levels(&mut hidden, false);
    ball_at(&mut hidden, 1.0e5);
    hidden.record(true);
    // Past the hide distance a bound that covers less than a pixel draws nothing.
    assert_eq!(copies(&hidden)[0] + 64, copies(&fine)[0]);
}

#[test]
fn forty_thousand_copies_of_four_levels_take_one_copy_each() {
    // A forest: a batch of 40,000 copies of a mesh that has three lower levels and fading bands.
    // The same world draws the same copies without levels.
    let rows = 40_000;
    let mut without = World::new();
    without.record(true);
    let mut plain = copies(&without)[0];
    let mut sized = World::new();
    give_levels_of(&mut sized, &[0.01, 0.05, 0.2], true);
    sized.record(true);
    let settled = copies(&sized)[0];
    for world in [&mut without, &mut sized] {
        // The material of the world's first object, which draws the lit ball.
        let slot = world.scene.slots().resolve(world.objects[0]).unwrap() as usize;
        let material = world.scene.materials()[slot];
        let batch = world
            .batches
            .create(rows, false, false, BALL, material, 0.9)
            .unwrap();
        world
            .batches
            .get_mut(batch)
            .unwrap()
            .set_active_count(rows)
            .unwrap();
        world.record(true);
        world.frame += 1;
    }
    plain = copies(&without)[0] - plain;
    let levels = copies(&sized)[0] - settled;
    // The set of four levels and four fade buckets takes one copy for each of the 40,000 copies:
    // 2.6 MB in this view, where a slice for every copy in every level and band would take 20.5 MB.
    assert_eq!(levels, rows * 64, "{levels}");
    assert_eq!(levels, plain, "{levels} {plain}");
    assert_eq!(8 * rows * 64, 20_480_000);
}

#[test]
fn a_bias_on_an_object_makes_its_levels_switch_nearer() {
    let mut world = cpu_world();
    let [fine, coarse] = give_levels(&mut world, false);
    // Level 2 switches in past 15.6 m, so the ball whose nearest point lies 8.6 m away draws
    // level 1.
    let ball = world.objects[2];
    world.scene.set_position(ball, [0.0, 0.0, 10.5]).unwrap();
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, fine), 1)), "{drawn:?}");
    // A bias of 2 halves every switch distance, so the same ball draws its coarsest level at
    // 7.8 m of nearest point.
    world
        .scene
        .apply_commands(&[Command::set_level_bias(ball, 2.0)], world.frame)
        .unwrap();
    world.frame += 1;
    world.record(true);
    let drawn = draws(&world);
    assert!(
        drawn.contains(&(indices_of(&world, coarse), 1)),
        "{drawn:?}"
    );
    assert!(
        !drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&world, fine)),
        "{drawn:?}"
    );
}

#[test]
fn the_direct_path_draws_a_level_whose_material_settings_match_the_base() {
    use null3d_render::gpu_driven::RendererConfig;
    let mut world = World::with_config(RendererConfig {
        direct_draws: true,
        ..RendererConfig::default()
    });
    let settings = world.renderer.settings_mut();
    let twin = settings
        .materials_mut()
        .create(Shading::Lit, 0, [0.0, 1.0, 0.0, 1.0])
        .unwrap()
        + 1;
    let meshes = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(BALL, &meshes, &[0.01, 0.05], &[twin, twin], false)
        .unwrap();
    ball_at(&mut world, 20.0);
    world.record(true);
    let drawn: Vec<(u32, u32)> = world
        .commands()
        .iter()
        .filter(|(op, _)| *op == Op::DrawIndexed)
        .map(|(_, o)| (o[0], o[1]))
        .collect();
    assert!(
        drawn.contains(&(indices_of(&world, meshes[1]), 1)),
        "{drawn:?}"
    );
}
