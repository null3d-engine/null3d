//! Levels of detail: the buckets that a mesh's levels add on WebGPU, with their fading builds, and
//! the level that each object draws on the WebGL2 path, by its distance from the camera.

mod common;

use common::{World, base_sphere, count};
use null3d_core::levels::Switch;
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
fn give_levels<B: FrameBuilder>(world: &mut World<B>, fades: u8) -> [u32; 2] {
    let settings = world.renderer.settings_mut();
    let meshes = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(
            BALL,
            &meshes,
            &[0.01, 0.05],
            &[Switch::Error; 2],
            &[0, 0],
            fades,
        )
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
        settings.set_mesh_levels(BALL, &[99], &[0.1], &[Switch::Error], &[0], 0b10),
        Err(LevelError::Mesh)
    );
    assert_eq!(
        settings.set_mesh_levels(BALL, &[mapped], &[0.1], &[Switch::Error], &[0], 0b10),
        Err(LevelError::Format)
    );
    assert_eq!(
        settings.set_mesh_levels(
            BALL,
            &[level, level],
            &[0.1, 0.05],
            &[Switch::Error; 2],
            &[0, 0],
            0b110
        ),
        Err(LevelError::Errors)
    );
    settings
        .set_mesh_levels(BALL, &[level], &[0.1], &[Switch::Error], &[0], 0b10)
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
    give_levels(&mut plain, 0b110);
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
        .set_mesh_levels(
            BALL,
            &meshes,
            &[0.01, 0.05],
            &[Switch::Error; 2],
            &[0, masked],
            0b110,
        )
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
    give_levels(&mut world, 0b110);
    let fading = indirect_draws(&mut world);
    let mut crisp = World::new();
    give_levels(&mut crisp, 0);
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
fn a_level_that_switches_at_once_adds_no_fade_bucket() {
    let mut world = World::new();
    give_levels(&mut world, 0b110);
    let fading = indirect_draws(&mut world);
    // A level measured by the asset tool changes the picture by under a pixel at its switch, so
    // it hands over at once and takes no fade bucket.
    let mut crisp = World::new();
    give_levels(&mut crisp, 0);
    assert!(indirect_draws(&mut crisp) < fading);
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
    let [_, coarse] = give_levels(&mut world, 0);
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
fn a_biased_ball_draws_the_level_that_half_its_distance_switch_picks() {
    // The world's ball has a local radius of 0.9, so its nearest point is 0.9 m before its centre.
    // A bias of 2 halves the first switch, which is 0.05 times 311.8 over 2, 7.795 m of nearest
    // point: a ball at 95% of it draws the base level, and one at 103% draws level 1.
    let place = |world: &mut World<CpuCulledRenderer>, nearest: f32| {
        let ball = world.objects[2];
        world
            .scene
            .set_position(ball, [0.0, 0.0, 20.0 - (nearest + 0.9)])
            .unwrap();
        world
            .scene
            .apply_commands(&[Command::set_level_bias(ball, 2.0)], world.frame)
            .unwrap();
    };
    let mut before = cpu_world();
    let levels = give_levels_of(&mut before, &[0.05, 0.1, 0.2], 0);
    place(&mut before, 0.95 * 7.795);
    before.record(true);
    let drawn = draws(&before);
    assert!(
        drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&before, BALL)),
        "a biased ball at 95% of its switch draws its base level {levels:?}: {drawn:?}"
    );
    let mut after = cpu_world();
    let levels = give_levels_of(&mut after, &[0.05, 0.1, 0.2], 0);
    place(&mut after, 1.03 * 7.795);
    after.record(true);
    let drawn = draws(&after);
    let fine = indices_of(&after, levels[0]);
    assert!(
        drawn.iter().any(|&(indices, _)| indices == fine),
        "a biased ball at 103% of its switch draws level 1 {fine} {levels:?}: {drawn:?}"
    );
}

#[test]
fn a_larger_threshold_or_no_threshold_moves_the_switches() {
    let mut world = cpu_world();
    let [_, coarse] = give_levels(&mut world, 0);
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
    let [fine, coarse] = give_levels(&mut world, 0b110);
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
fn give_levels_of<B: FrameBuilder>(world: &mut World<B>, errors: &[f32], fades: u8) -> Vec<u32> {
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
        .set_mesh_levels(
            BALL,
            &meshes,
            errors,
            &vec![Switch::Error; errors.len()],
            &vec![0; errors.len()],
            fades,
        )
        .unwrap();
    meshes
}

/// Gives the world's ball one lower level for each distance, each simpler than the one before.
/// Returns their engine mesh ids.
fn give_distance_levels<B: FrameBuilder>(world: &mut World<B>, distances: &[f32]) -> Vec<u32> {
    let finest = [[6, 4], [4, 3], [3, 2], [2, 1]];
    let settings = world.renderer.settings_mut();
    let meshes: Vec<u32> = distances
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
        .set_mesh_levels(
            BALL,
            &meshes,
            distances,
            &vec![Switch::Distance; distances.len()],
            &vec![0; distances.len()],
            0,
        )
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
    give_levels(&mut world, 0b110);
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
    give_levels(&mut world, 0b110);
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
    give_levels(&mut fine, 0);
    ball_at(&mut fine, 1.0);
    fine.record(true);
    let mut coarse = World::new();
    give_levels(&mut coarse, 0);
    ball_at(&mut coarse, 100.0);
    coarse.record(true);
    // The ball draws its base mesh at 1 m and its coarsest level at 100 m: the level set takes
    // the copy of the ball that draws, whatever level the distance picks.
    assert_eq!(copies(&fine), copies(&coarse));
    let mut hidden = World::new();
    give_levels(&mut hidden, 0);
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
    give_levels_of(&mut sized, &[0.01, 0.05, 0.2], 0b1110);
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

/// The same forest as the test above, but its trees cast the sun's shadows in four cascades. The
/// casters' layout is one copy list that every cascade draws, so the four cascades must not
/// multiply the list.
#[test]
fn forty_thousand_casters_of_four_cascades_take_one_copy_each() {
    let rows: u32 = 40_000;
    let mut measured = Vec::new();
    for with_levels in [false, true] {
        let mut world = World::new();
        world.cast_sun_shadows(4);
        if with_levels {
            give_levels_of(&mut world, &[0.01, 0.05, 0.2], 0b1110);
        }
        let slot = world.scene.slots().resolve(world.objects[0]).unwrap() as usize;
        let material = world.scene.materials()[slot];
        let batch = world
            .batches
            .create(rows, false, false, BALL, material, 0.9)
            .unwrap();
        {
            let batch = world.batches.get_mut(batch).unwrap();
            batch.set_active_count(rows).unwrap();
            batch.set_shadows(null3d_core::scene::flags::CAST_SHADOWS);
        }
        world.record(true);
        measured.push(copies(&world)[1]);
    }
    // `measured[0]` is the casters' list without levels, and `measured[1]` with them. The four
    // cascades draw one copy list, so the list takes one copy for each of the 40,000 trees, and
    // the levels add nothing to it: 2.56 MB. The removed rule kept a slice for every copy in every
    // level, and the casters' list has four levels and no fading band, because its shadow
    // pipelines take no fading build: 10.24 MB.
    let per_copy = rows * 64;
    assert_eq!(measured[1], measured[0], "{measured:?}");
    for bytes in measured {
        assert!(bytes >= per_copy && bytes < per_copy + 128, "{bytes}");
    }
    assert_eq!(4 * per_copy, 10_240_000);
}

#[test]
fn a_bias_on_an_object_makes_its_levels_switch_nearer() {
    let mut world = cpu_world();
    let [fine, coarse] = give_levels(&mut world, 0);
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
fn a_level_given_by_distance_switches_at_that_distance() {
    let mut world = cpu_world();
    let [near, far] = give_distance_levels(&mut world, &[10.0, 30.0])[..] else {
        panic!("two levels");
    };
    let ball = world.objects[2];
    // The ball's nearest point lies 4 m from the camera: the base level draws.
    world.scene.set_position(ball, [0.0, 0.0, 15.5]).unwrap();
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, BALL), 1)), "{drawn:?}");
    // At 15 m of nearest point, the first level draws, whatever the screen's height.
    world.scene.set_position(ball, [0.0, 0.0, 4.5]).unwrap();
    world.frame += 1;
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, near), 1)), "{drawn:?}");
    // Past 30 m, the second.
    world.scene.set_position(ball, [0.0, 0.0, -11.5]).unwrap();
    world.frame += 1;
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, far), 1)), "{drawn:?}");
}

#[test]
fn a_draw_range_hides_an_object_outside_it_and_fades_it_at_its_edge() {
    let mut world = cpu_world();
    let [_, coarse] = give_levels(&mut world, 0);
    let ball = world.objects[2];
    // The ball's nearest point lies 19.5 m away. A band that ends at 10 m hides it.
    world
        .scene
        .apply_commands(&[Command::set_draw_range(ball, 0.0, 10.0)], world.frame)
        .unwrap();
    world.record(true);
    let drawn = draws(&world);
    assert!(
        !drawn.contains(&(indices_of(&world, coarse), 1)),
        "{drawn:?}"
    );
    // A band that ends at 20 m puts it inside the fade at the end, where the dither keeps a
    // shrinking share of its pixels through the level's fade bucket.
    world
        .scene
        .apply_commands(&[Command::set_draw_range(ball, 0.0, 20.0)], world.frame)
        .unwrap();
    world.frame += 1;
    world.record(true);
    let drawn = draws(&world);
    assert!(
        drawn.contains(&(indices_of(&world, coarse), 1)),
        "{drawn:?}"
    );
    // A band that starts at 25 m hides it too, on the near side.
    world
        .scene
        .apply_commands(&[Command::set_draw_range(ball, 25.0, 60.0)], world.frame)
        .unwrap();
    world.frame += 1;
    world.record(true);
    let drawn = draws(&world);
    assert!(
        !drawn.contains(&(indices_of(&world, coarse), 1)),
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
        .set_mesh_levels(
            BALL,
            &meshes,
            &[0.01, 0.05],
            &[Switch::Error; 2],
            &[twin, twin],
            0,
        )
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
#[test]
fn a_bias_divides_the_switch_of_one_object() {
    use null3d_core::levels::{DrawRange, LevelLink, LevelRule, NO_LINK, Picked};
    let links = [
        LevelLink {
            value: 0.0,
            switch: Switch::Error,
            next: 1,
            fade: NO_LINK,
        },
        LevelLink {
            value: 0.01,
            switch: Switch::Error,
            next: 2,
            fade: NO_LINK,
        },
        LevelLink {
            value: 0.05,
            switch: Switch::Error,
            next: NO_LINK,
            fade: NO_LINK,
        },
    ];
    let rule = LevelRule::new(360.0, 1.732, false, 1.0, 0.0);
    println!("factor {}", rule.factor);
    // Level 1 switches at 0.01 times the factor, halved by a bias of 2: 1.56 m.
    println!(
        "no bias at 1.606: {:?}",
        rule.pick(&links, 0, 1.0, 0.5, 1.606, 1.0, DrawRange::NONE)
    );
    println!(
        "bias 2 at 1.606: {:?}",
        rule.pick(&links, 0, 1.0, 0.5, 1.606, 2.0, DrawRange::NONE)
    );
    println!(
        "bias 2 at 1.481: {:?}",
        rule.pick(&links, 0, 1.0, 0.5, 1.481, 2.0, DrawRange::NONE)
    );
    assert!(matches!(
        rule.pick(&links, 0, 1.0, 0.5, 1.606, 2.0, DrawRange::NONE),
        Picked::One(1)
    ));
}

/// The GPU culling shader repeats the core rule that hides a bound under the threshold. Only a mesh
/// with levels has a last level that holds no geometry, so the shader hides that way only for a
/// bucket that links to a coarser level. A mesh without levels draws at every distance there as it
/// does on the job workers. A distance range still hides every source.
#[test]
fn the_culling_shader_hides_under_the_threshold_only_a_mesh_with_levels() {
    let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
    let decision = cull
        .split("let hide = 2.0 * s.radius * factor;")
        .nth(1)
        .and_then(|rest| rest.split("return out;").next())
        .expect("the culling shader decides whether a source hides");
    assert!(
        decision.contains("next != 0u"),
        "a mesh without levels draws at every distance, but the shader hides it: {decision}"
    );
    // A source outside its distance range draws nothing whether or not its mesh has levels.
    assert!(
        decision.contains("out.start") && decision.contains("out.end"),
        "a distance range must hide every source: {decision}"
    );
}

/// A row that carries a bound of its own, as a batch whose vertex shader moves its rows does,
/// tests that bound in the GPU culling shader's frustum, level and hide tests, where the layout
/// writes it in the source's ranges texel. A row without one keeps its bucket's sphere.
#[test]
fn the_culling_shader_culls_a_row_by_its_own_bound_where_it_has_one() {
    let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
    let from = cull
        .find("let own = out.ranges.z;")
        .expect("the shader reads the row's own local radius");
    let to = cull[from..]
        .find("out.scale = scale;")
        .expect("the shader sets the row's sphere before its scale");
    let radius = &cull[from..from + to];
    assert!(
        radius.contains("own * scale"),
        "the shader ignores the row's own radius: {radius}"
    );
}
