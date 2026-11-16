//! Levels of detail: the buckets that a mesh's levels add on WebGPU, with their fading builds, and
//! the level that each object draws on the WebGL2 path, by its distance from the camera.

mod common;

use common::{World, base_sphere, count, grid};
use null3d_core::jobs::JobSystem;
use null3d_core::levels::{
    DrawRange, LEAST_DISTANCE, LEVEL_NEAREST_SHARE, LEVEL_RADIUS_SHARE, LevelLink, LevelRule,
    LightLens, NO_LINK, Picked, Switch, fade_values,
};
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, permutation, template};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, LevelQuality};
use null3d_render::geometry::Geometry;
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
fn give_levels<B: FrameBuilder>(world: &mut World<B>, flags: u32) -> [u32; 2] {
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
            flags,
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

/// The largest size of each compacted buffer, and the draws' ranges in them, from a frame's commands.
fn instance_ranges(commands: &[(Op, Vec<u32>)]) -> Vec<(u32, u32, u32)> {
    commands
        .iter()
        .filter(|(op, o)| *op == Op::SetVertexBuffer && o[0] == 1)
        .map(|(_, o)| (o[1], o[2], o[3]))
        .collect()
}

#[test]
fn a_slice_that_a_moving_source_outgrows_moves_with_its_draws() {
    let mut world = World::counting();
    give_levels(&mut world, 0b110);
    ball_at(&mut world, 20.0);
    world.record(true);
    let settled = copies(&world)[0];
    // A still scene keeps its slices, and records no draw of the instances again.
    world.frame += 1;
    world.record(false);
    assert!(instance_ranges(&world.commands()).is_empty());
    assert_eq!(copies(&world)[0], settled);
    // The ball moves into a band, so two fade slices grow past their room: the frame must name the
    // new places in draws recorded this frame, in a buffer that holds them. Draws that kept the old
    // places read other rows' matrices, as crowns over the sea, or fail on the GPU past the buffer.
    ball_at(&mut world, 16.8);
    world.frame += 1;
    world.record(false);
    let commands = world.commands();
    let moved = instance_ranges(&commands);
    assert!(!moved.is_empty(), "the moved slices need new draws");
    let size = copies(&world)[0];
    for (_, offset, bytes) in moved {
        assert!(offset + bytes <= size, "{offset} + {bytes} is past {size}");
    }
    // Back at its first place the ball fits the room it left, so nothing moves.
    ball_at(&mut world, 20.0);
    world.frame += 1;
    world.record(false);
    assert!(instance_ranges(&world.commands()).is_empty());
    assert_eq!(copies(&world)[0], size);
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
    give_levels(&mut crisp, 0b110 << 16);
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
    give_levels(&mut crisp, 0b110 << 16);
    assert!(indirect_draws(&mut crisp) < fading);
}

#[test]
fn a_measured_level_fades_only_above_the_governed_threshold() {
    // The quality settings report a rebuild only where the governed threshold crosses the point
    // where a measured switch shows.
    let mut world = World::new();
    give_levels(&mut world, 0);
    let settings = world.renderer.settings_mut();
    assert!(settings.set_level_quality(LevelQuality {
        threshold: 4.0,
        ..LevelQuality::default()
    }));
    assert!(!settings.set_level_quality(LevelQuality {
        threshold: 2.0,
        ..LevelQuality::default()
    }));
    assert!(settings.set_level_quality(LevelQuality {
        threshold: 1.0,
        ..LevelQuality::default()
    }));
    // Above it, a measured set draws the buckets of a set that names its fades, and at the default
    // threshold it draws none of them.
    let mut measured = World::new();
    give_levels(&mut measured, 0b110 << 16);
    measured
        .renderer
        .settings_mut()
        .set_level_quality(LevelQuality {
            threshold: 4.0,
            ..LevelQuality::default()
        });
    let mut named = World::new();
    give_levels(&mut named, 0b110);
    let mut crisp = World::new();
    give_levels(&mut crisp, 0b110 << 16);
    let above = indirect_draws(&mut measured);
    let naming = indirect_draws(&mut named);
    let at_once_gpu = indirect_draws(&mut crisp);
    assert_eq!(above, naming);
    assert!(at_once_gpu < naming);
    // The WebGL2 path draws the hand-over buckets only where a source lies in a band: at the
    // raised threshold the ball sits in level 1's band, and at the default one it does not.
    let mut cpu = cpu_world();
    give_levels(&mut cpu, 0b110 << 16);
    ball_at(&mut cpu, 1.3);
    cpu.record(true);
    let at_once = draws(&cpu).len();
    cpu.renderer.settings_mut().set_level_quality(LevelQuality {
        threshold: 4.0,
        ..LevelQuality::default()
    });
    cpu.record(true);
    assert!(draws(&cpu).len() > at_once);
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
    // The world's ball has a local radius of 0.9, and the rule measures an error to its center
    // less half that radius. A bias of 2 halves the first switch, which is 0.05 times 311.8 over
    // 2, 7.795 m of that distance: a ball at 95% of it draws the base level, and one at 103% draws
    // level 1.
    let place = |world: &mut World<CpuCulledRenderer>, distance: f32| {
        let ball = world.objects[2];
        world
            .scene
            .set_position(ball, [0.0, 0.0, 20.0 - (distance + 0.45)])
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
fn give_levels_of<B: FrameBuilder>(world: &mut World<B>, errors: &[f32], flags: u32) -> Vec<u32> {
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
            flags,
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
fn ball_at<B: FrameBuilder>(world: &mut World<B>, distance: f32) {
    let ball = world.objects[2];
    world
        .scene
        .set_position(ball, [0.0, 0.0, 20.0 - distance])
        .unwrap();
}

/// A small set of levels keeps a slot for each of its sources in every level, as the build sizes
/// it, so no frame counts its copies and its slices never move while its copies switch levels. A
/// counted set's slices follow the copies, and move when a copy picks a level whose slice is
/// empty.
#[test]
fn a_small_sets_slices_hold_every_copy_in_every_level_and_never_move() {
    let mut fixed = World::new();
    let mut counted = World::counting();
    for world in [&mut fixed, &mut counted] {
        give_levels(world, 0b110);
        world.record(true);
    }
    let (fixed_start, counted_start) = (copies(&fixed)[0], copies(&counted)[0]);
    // Three plain and three fade buckets each keep a slot for both balls of the set.
    assert_eq!(fixed_start, counted_start + 11 * 64);
    for distance in [1.0, 5.0, 12.0, 16.5, 30.0, 1.0] {
        for world in [&mut fixed, &mut counted] {
            world.frame += 1;
            ball_at(world, distance);
            world.record(false);
        }
        assert_eq!(copies(&fixed)[0], fixed_start, "at {distance} m");
    }
    assert_ne!(copies(&counted)[0], counted_start);
}

#[test]
fn a_meshs_levels_take_the_room_of_the_copy_that_draws_not_of_a_level_each() {
    let mut plain = World::counting();
    plain.record(true);
    let without = copies(&plain);
    let mut world = World::counting();
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
    let mut world = World::counting();
    give_levels(&mut world, 0b110);
    ball_at(&mut world, 20.0);
    world.record(true);
    let picked = copies(&world)[0];
    // Inside level 2's band the ball draws both levels' fade buckets, so it takes two copies, one
    // in each. Its plain bucket keeps the place of the copy that the ball drew there, because the
    // frame's draws name each slice's place, and a slice that shrank would move at the next change.
    ball_at(&mut world, 16.8);
    world.frame += 1;
    world.record(false);
    let band = copies(&world)[0];
    assert_eq!(band, picked + 2 * 64, "{band} {picked}");
}

/// A source that a frame shows without rebuilding the layout reaches the culling shader in that
/// frame, so its level's slice must hold it in that frame too. The ball that the world hides
/// stands as far from the camera as the one it shows, so both pick the coarsest level, whose slice
/// held one copy before.
#[test]
fn a_ball_shown_without_a_rebuild_takes_room_in_its_levels_slice_at_once() {
    let mut world = World::counting();
    give_levels(&mut world, 0);
    world.record(true);
    let one = copies(&world)[0];
    world.frame += 1;
    world
        .scene
        .apply_commands(&[Command::set_visible(world.objects[3], true)], world.frame)
        .unwrap();
    world.record(false);
    assert_eq!(copies(&world)[0], one + 64, "the shown ball has no room");
}

/// Rows that a new active count adds reach the culling shader in the frame that adds them, so
/// their level's slices must hold them in that frame.
#[test]
fn rows_added_without_a_rebuild_take_room_in_their_levels_slices_at_once() {
    let rows = 16;
    let mut world = World::counting();
    give_levels(&mut world, 0);
    let slot = world.scene.slots().resolve(world.objects[0]).unwrap() as usize;
    let material = world.scene.materials()[slot];
    let batch = world
        .batches
        .create(rows, false, false, BALL, material, 0.9)
        .unwrap();
    let set_active = |world: &mut World, count: u32| {
        let rows = world.batches.get_mut(batch).unwrap();
        rows.set_active_count(count).unwrap();
    };
    set_active(&mut world, 0);
    world.record(true);
    let none = copies(&world)[0];
    world.frame += 1;
    set_active(&mut world, rows);
    world.record(false);
    // The slice that outgrows its room takes spare room past its count.
    let added = copies(&world)[0];
    assert!(
        added >= none + rows * 64,
        "the added rows have no room: {added} {none}"
    );
}

#[test]
fn a_coarse_level_takes_no_more_room_than_the_finest_one() {
    let mut fine = World::counting();
    give_levels(&mut fine, 0);
    ball_at(&mut fine, 1.0);
    fine.record(true);
    let mut coarse = World::counting();
    give_levels(&mut coarse, 0);
    ball_at(&mut coarse, 100.0);
    coarse.record(true);
    // The ball draws its base mesh at 1 m and its coarsest level at 100 m: the level set takes
    // the copy of the ball that draws, whatever level the distance picks.
    assert_eq!(copies(&fine), copies(&coarse));
    let mut hidden = World::counting();
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
    let mut without = World::counting();
    without.record(true);
    let mut plain = copies(&without)[0];
    let mut sized = World::counting();
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
/// cascades share the casters' bucket table, so a level's slice holds the most copies that any
/// cascade places in it. Each cascade picks a caster's level in its own texels, and counts only
/// the casters that its frustum holds.
#[test]
fn forty_thousand_casters_of_four_cascades_take_a_copy_for_each_level_that_a_cascade_picks() {
    let rows: u32 = 40_000;
    let mut measured = Vec::new();
    for (with_levels, far) in [(false, false), (true, false), (true, true)] {
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
            // Far past the shadow distance, no cascade's box holds the trees.
            if far {
                for row in batch.positions_mut().as_chunks_mut::<3>().0 {
                    *row = [5_000.0, 0.0, 0.0];
                }
            }
        }
        world.record(true);
        measured.push(copies(&world)[1]);
    }
    // Without levels, the list takes one copy for each of the 40,000 trees: 2.56 MB. With levels,
    // the trees stand together inside every cascade, and each cascade picks one level for all of
    // them, so the list takes a copy for each level that some cascade picks: at least one and at
    // most four. Here the four cascades pick two levels, 5.12 MB, against the 10.24 MB of a slice
    // for every copy in every one of four levels.
    // Trees that no cascade holds take no copy.
    let per_copy = rows * 64;
    assert!(
        measured[0] >= per_copy && measured[0] < per_copy + 128,
        "{measured:?}"
    );
    assert!(
        measured[1] >= per_copy && measured[1] < 4 * per_copy + 128,
        "{measured:?}"
    );
    assert!(measured[2] < 128 * 64, "{measured:?}");
    assert_eq!(4 * per_copy, 10_240_000);
}

/// The count of each level's copies runs on the job workers. A forest whose rows spread over every
/// level, every fading band and past the hide distance takes the same room, counted by four job
/// workers and by the calling thread alone, in the camera's list and in the casters'.
#[test]
fn job_workers_count_the_same_copies_of_each_level_as_one_thread() {
    let rows: u32 = 40_000;
    let forest = |workers: Option<&'static JobSystem>| {
        let mut world = World::new();
        world.cast_sun_shadows(4);
        give_levels_of(&mut world, &[0.01, 0.05, 0.2], 0b1110);
        world.workers = workers;
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
            // Rows from the camera out to 4 km in front of it, over a strip 97 m wide.
            for (row, position) in batch
                .positions_mut()
                .as_chunks_mut::<3>()
                .0
                .iter_mut()
                .enumerate()
            {
                let row = row as f32;
                *position = [(row % 97.0) - 48.0, 0.0, 20.0 - 0.1 * row];
            }
        }
        world.record(true);
        world.frame += 1;
        world.record(false);
        let [camera, casters, ..] = copies(&world);
        (camera, casters)
    };
    let jobs: &'static JobSystem = Box::leak(Box::new(JobSystem::new(4)));
    let measured = std::thread::scope(|scope| {
        for i in 0..4 {
            scope.spawn(move || jobs.worker_loop(i));
        }
        let measured = [forest(None), forest(Some(jobs))];
        jobs.shutdown();
        measured
    });
    assert_eq!(measured[0], measured[1], "{measured:?}");
    // The forest's fading bands and its hidden rows make its counts differ from one copy a row.
    let (camera, _) = measured[0];
    assert_ne!(camera, rows * 64, "{measured:?}");
}

/// A copy list that reserves room for more copies than the device's binding holds is refused, so
/// the frame asks for no buffer the device cannot bind. The buffer's room to grow was rounded up
/// and then down to the need, which asked for more than the binding.
#[test]
fn a_copy_list_past_the_binding_is_refused_rather_than_sized_over_it() {
    use common::{BATCH_ROWS, SCENE_CAPACITY};
    use null3d_gpu::drawlist::sizes;
    use null3d_render::frame::RecordError;
    use null3d_render::gpu_driven::RendererConfig;

    // A batch whose rows name no local radius reserves room in every bucket of its levels, so its
    // copies pass the sources that the binding holds.
    let rows = 64;
    let sources = SCENE_CAPACITY + 1 + BATCH_ROWS + rows;
    let binding = sources * sizes::INSTANCE_STRIDE;
    let mut world = World::with_config(RendererConfig {
        storage_binding_bytes: binding,
        ..RendererConfig::default()
    });
    give_levels_of(&mut world, &[0.01, 0.05, 0.2], 0b1110);
    let slot = world.scene.slots().resolve(world.objects[0]).unwrap() as usize;
    let material = world.scene.materials()[slot];
    let batch = world
        .batches
        .create(rows, false, false, BALL, material, 0.0)
        .unwrap();
    world
        .batches
        .get_mut(batch)
        .unwrap()
        .set_active_count(rows)
        .unwrap();
    assert_eq!(
        world.try_record(true),
        Err(RecordError::BufferFull { bytes: binding })
    );
}

#[test]
fn a_bias_on_an_object_makes_its_levels_switch_nearer() {
    let mut world = cpu_world();
    let [fine, coarse] = give_levels(&mut world, 0);
    // Level 2 switches in past 15.6 m, so the ball whose level distance, to its center less half
    // its radius, is 9.05 m draws level 1.
    let ball = world.objects[2];
    world.scene.set_position(ball, [0.0, 0.0, 10.5]).unwrap();
    world.record(true);
    let drawn = draws(&world);
    assert!(drawn.contains(&(indices_of(&world, fine), 1)), "{drawn:?}");
    // A bias of 2 halves every switch distance, so the same ball draws its coarsest level past
    // 7.8 m.
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
    // Level 1 switches at 0.01 times the factor, 3.12 m. At 1.606 m it is over the threshold and
    // the base level draws; a bias of 2 halves its switch to 1.56 m, so the same distance draws
    // the level.
    assert!(matches!(
        rule.pick(&links, 0, 1.0, 0.5, 1.606, 1.0, DrawRange::NONE),
        Picked::One(0)
    ));
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

#[test]
fn the_direct_path_draws_a_trees_whole_levels_rather_than_its_patches() {
    use null3d_render::gpu_driven::RendererConfig;
    let mut world = World::with_config(RendererConfig {
        direct_draws: true,
        ..RendererConfig::default()
    });
    // One object draws this mesh, so the two-copy rule cannot keep its levels by itself.
    let mesh = world.add_object(&base_sphere(0.5, [6, 4]), Shading::Lit);
    let settings = world.renderer.settings_mut();
    let lower = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(mesh, &lower, &[0.01, 0.05], &[Switch::Error; 2], &[0, 0], 0)
        .unwrap();
    world
        .renderer
        .set_mesh_patches(mesh, Some(one_patch_tree()))
        .unwrap();
    world.record(true);
    let drawn: Vec<(u32, u32)> = world
        .commands()
        .iter()
        .filter(|(op, _)| *op == Op::DrawIndexed)
        .map(|(_, o)| (o[0], o[1]))
        .collect();
    // The direct path runs no cluster pass, so the tree leaves the whole levels in place.
    assert!(
        drawn.contains(&(indices_of(&world, lower[1]), 1)),
        "{drawn:?}"
    );
    assert!(
        world
            .commands()
            .iter()
            .all(|(op, o)| !(*op == Op::CreateComputePipeline && o[1] == template::CLUSTER))
    );
}

/// A tree of one patch over the first three indices of a mesh: the smallest tree the GPU path
/// accepts.
fn one_patch_tree() -> null3d_render::patches::PatchTree {
    null3d_render::patches::PatchTree::new(
        vec![0, 1, 2],
        vec![[0.0, 0.0, 0.0, 1.0]],
        vec![[0, 3, 0, 0]],
        0,
        4,
    )
    .unwrap()
}

/// Gives mesh `mesh` two lower levels, for the GPU path's tests of a tree.
fn give_levels_to<B: FrameBuilder>(world: &mut World<B>, mesh: u32, levels: [Geometry; 2]) {
    let settings = world.renderer.settings_mut();
    let lower = levels.map(|level| settings.meshes_mut().add(&level).unwrap() + 1);
    settings
        .set_mesh_levels(mesh, &lower, &[0.01, 0.05], &[Switch::Error; 2], &[0, 0], 0)
        .unwrap();
}

#[test]
fn the_gpu_path_keeps_a_trees_levels_when_two_objects_draw_the_mesh() {
    let mut plain = World::new();
    give_levels_to(
        &mut plain,
        BALL,
        [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])],
    );
    let without = indirect_draws(&mut plain);
    let mut world = World::new();
    give_levels_to(
        &mut world,
        BALL,
        [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])],
    );
    world
        .renderer
        .set_mesh_patches(BALL, Some(one_patch_tree()))
        .unwrap();
    // Two ball objects share the mesh's bucket, so the pass has no single copy to pick patches
    // for. Its levels stay, and no cluster pipeline is made.
    assert_eq!(indirect_draws(&mut world), without);
    assert!(
        world
            .commands()
            .iter()
            .all(|(op, o)| !(*op == Op::CreateComputePipeline && o[1] == template::CLUSTER))
    );
}

#[test]
fn the_gpu_path_draws_the_tree_of_a_mesh_that_fills_several_parts() {
    let mut world = World::new();
    let mesh = world.add_object(&grid(256, 256), Shading::Lit);
    give_levels_to(&mut world, mesh, [grid(2, 2), grid(1, 1)]);
    let settings = world.renderer.settings();
    let parts = settings
        .meshes()
        .parts(settings.meshes().mesh(mesh - 1).unwrap(), false)
        .len();
    assert!(parts > 1, "the mesh of the test fills {parts} parts");
    let without = indirect_draws(&mut world);
    world
        .renderer
        .set_mesh_patches(mesh, Some(one_patch_tree()))
        .unwrap();
    world.frame += 1;
    // The parts lie one after another in one shared buffer, so the tree's 32-bit indices reach
    // them all: one draw of the chosen patches replaces the parts' draws and the whole levels'.
    let with = indirect_draws(&mut world);
    assert!(
        with < without,
        "{with} draws with the tree, {without} without"
    );
    assert!(
        world
            .commands()
            .iter()
            .any(|(op, o)| *op == Op::CreateComputePipeline && o[1] == template::CLUSTER)
    );
}

/// `geometry` with every position moved by `offset`, as a quantized file stores a mesh from a
/// corner of its box rather than around its center.
fn moved(mut geometry: Geometry, offset: [f32; 3]) -> Geometry {
    let stride = geometry.stride();
    for v in 0..geometry.vertex_count() {
        for (k, shift) in offset.iter().enumerate() {
            let at = v * stride + k * 4;
            let bytes: [u8; 4] = geometry.vertices[at..at + 4].try_into().unwrap();
            let value = f32::from_le_bytes(bytes) + shift;
            geometry.vertices[at..at + 4].copy_from_slice(&value.to_le_bytes());
        }
    }
    geometry
}

/// True when the world's visible ball, given a mesh whose positions lie `offset` from its origin
/// with two lower levels, and turned by `rotation`, draws its first lower level. The ball stands
/// so that the shape's center lies on the camera's axis, with its level distance, to the shape's
/// sphere's center less half its radius, at `distance` meters.
fn off_origin_ball_draws_level_1(offset: [f32; 3], rotation: [f32; 4], distance: f32) -> bool {
    let mut world = cpu_world();
    let settings = world.renderer.settings_mut();
    let base = settings
        .meshes_mut()
        .add(&moved(base_sphere(0.5, [8, 6]), offset))
        .unwrap()
        + 1;
    let levels = [base_sphere(0.5, [6, 4]), base_sphere(0.5, [4, 3])]
        .map(|level| settings.meshes_mut().add(&moved(level, offset)).unwrap() + 1);
    settings
        .set_mesh_levels(
            base,
            &levels,
            &[0.01, 0.05],
            &[Switch::Error; 2],
            &[0, 0],
            0,
        )
        .unwrap();
    let slot = settings.meshes().mesh(base - 1).unwrap();
    let (center, radius) = (slot.center, slot.radius);
    assert!(
        (0..3).all(|k| (center[k] - offset[k]).abs() < 1e-5) && radius < 0.51,
        "the mesh's sphere lies on its shape: {center:?} {radius}"
    );
    let ball = world.objects[2];
    // The page gives an object its mesh's sphere, as `createMesh` and `setMesh` do.
    world.scene.set_local_sphere(ball.slot(), center, radius);
    world.scene.set_rotation(ball, rotation).unwrap();
    // A half turn about y takes the shape's center to the other side of the origin.
    let [x, y, z, w] = rotation;
    let turned = [
        (1.0 - 2.0 * (y * y + z * z)) * center[0],
        0.0,
        2.0 * (x * z - y * w) * center[0],
    ];
    world
        .scene
        .set_position(
            ball,
            [
                -turned[0],
                -turned[1],
                20.0 - (distance + 0.5 * radius) - turned[2],
            ],
        )
        .unwrap();
    world
        .scene
        .apply_commands(&[Command::set_mesh(ball, base)], world.frame)
        .unwrap();
    world.record(true);
    let fine = indices_of(&world, levels[0]);
    draws(&world).iter().any(|&(indices, _)| indices == fine)
}

#[test]
fn a_ball_off_its_origin_keeps_its_switch_when_it_turns_half_round() {
    // The ball's positions lie 4 m along x from its origin, as a mesh from a quantized file starts
    // at a corner. Its sphere sits on the shape, so the level that it draws follows the shape's
    // distance whichever way it faces. A sphere around the origin would reach 4.5 m, and its
    // center would move 8 m as the object turns. Level 1 switches in past 0.01 times 311.8,
    // 3.118 m of level distance, to the sphere's center less half its radius.
    let offset = [4.0, 0.0, 0.0];
    for rotation in [[0.0, 0.0, 0.0, 1.0], [0.0, 1.0, 0.0, 0.0]] {
        assert!(
            !off_origin_ball_draws_level_1(offset, rotation, 0.95 * 3.118),
            "{rotation:?}: before the switch, the base level"
        );
        assert!(
            off_origin_ball_draws_level_1(offset, rotation, 1.05 * 3.118),
            "{rotation:?}: past the switch, level 1"
        );
    }
}

/// The shader's decision for one source, as `level_of` and `append` make it in `cull.wgsl`: one
/// bucket, a fading pair, a band at a range's edge, or nothing.
#[derive(Clone, Copy, Debug, PartialEq)]
enum ShaderPick {
    One(u32),
    Fade { new: u32, old: u32, t: f32 },
    FadeIn { bucket: u32, t: f32 },
    FadeOut { bucket: u32, t: f32 },
    Hidden,
}

/// One bucket as the shader reads it: the next coarser level's place plus one, its switch code and
/// value, and its fade bucket plus one.
struct ShaderBucket {
    next: u32,
    switch: u32,
    value: f32,
    fade: u32,
}

/// The shader's level rule, line for line as `level_of` and `append` in `cull.wgsl` apply it. The
/// copy exists so that a change to either side of the rule fails a test: the shader's own lines are
/// pinned beside it, and the two answers are compared over random sources and views.
#[allow(clippy::too_many_arguments)]
fn shader_pick(
    buckets: &[ShaderBucket],
    home: u32,
    center: [f32; 3],
    radius: f32,
    scale: f32,
    range: DrawRange,
    bias: f32,
    whole: f32,
    orthographic: bool,
    band: f32,
    p11: f32,
    measure: [f32; 4],
) -> ShaderPick {
    let length = |v: [f32; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    let bias = if bias > 0.0 { bias } else { 1.0 };
    let factor = whole / bias;
    let nearest = (length(center) - radius).max(LEAST_DISTANCE);
    // A distance level, a coverage level and a distance band measure to the nearest point in
    // every view, an orthographic camera included.
    let distance = nearest;
    let half = (length(center) - LEVEL_RADIUS_SHARE * radius).max(LEAST_DISTANCE);
    let toward = half.min(LEVEL_NEAREST_SHARE * nearest);
    let error_camera = if orthographic { 1.0 } else { toward };
    let error = if measure[3] > 1.5 {
        (length([
            center[0] - measure[0],
            center[1] - measure[1],
            center[2] - measure[2],
        ]) - radius)
            .max(LEAST_DISTANCE)
    } else if measure[3] > 0.5 {
        1.0
    } else {
        error_camera
    };
    let switch = |bucket: &ShaderBucket| -> f32 {
        if bucket.switch == 1 {
            return bucket.value * scale / bias;
        }
        if bucket.switch == 2 {
            return if bucket.value <= 0.0 || p11 <= 0.0 {
                f32::INFINITY
            } else {
                radius * p11 / (bucket.value * bias)
            };
        }
        bucket.value * scale * factor
    };
    let distance_for =
        |bucket: &ShaderBucket| -> f32 { if bucket.switch == 0 { error } else { distance } };
    let mut before = home;
    let mut level = home;
    let mut next = buckets[home as usize].next;
    let mut past = 0.0;
    if next != 0 && whole > 0.0 {
        while next != 0 {
            let candidate = &buckets[next as usize - 1];
            // The same comparison as the core's walk: a switch distance that is not a number
            // stops both walks here, as it stops the shader's.
            if switch(candidate).partial_cmp(&distance_for(candidate))
                != Some(std::cmp::Ordering::Less)
            {
                break;
            }
            before = level;
            level = next - 1;
            next = buckets[level as usize].next;
        }
        if level != home {
            past = distance_for(&buckets[level as usize]) / switch(&buckets[level as usize]) - 1.0;
        }
    }
    let hide = 2.0 * radius * factor;
    let small = buckets[home as usize].next != 0 && hide > 0.0 && hide < error;
    let hidden = small || distance < range.start || distance > range.end;
    let hide_past = if small { error / hide - 1.0 } else { 0.0 };
    let new_fade = buckets[level as usize].fade;
    let old_fade = buckets[before as usize].fade;
    if distance < range.start || distance > range.end {
        return ShaderPick::Hidden;
    }
    if band > 0.0 && new_fade != 0 {
        if range.start > 0.0 && distance < range.start * (1.0 + band) {
            let t = (distance / range.start - 1.0) / band;
            return ShaderPick::FadeIn {
                bucket: new_fade - 1,
                t: t.max(1e-6),
            };
        }
        if distance > range.end / (1.0 + band) {
            let inner = range.end / (1.0 + band);
            let t = (distance - inner) / (range.end - inner);
            return ShaderPick::FadeOut {
                bucket: new_fade - 1,
                t: t.max(0.0),
            };
        }
    }
    if level != home && band > 0.0 && new_fade != 0 && old_fade != 0 {
        let t = past / band;
        if t < 1.0 {
            return ShaderPick::Fade {
                new: new_fade - 1,
                old: old_fade - 1,
                t: t.max(1e-6),
            };
        }
    }
    if hidden {
        if band > 0.0 && new_fade != 0 && hide_past < band {
            return ShaderPick::FadeOut {
                bucket: new_fade - 1,
                t: (hide_past / band).max(0.0),
            };
        }
        return ShaderPick::Hidden;
    }
    ShaderPick::One(level)
}

/// The core's answer in the shader copy's shape.
fn core_pick(picked: Picked) -> ShaderPick {
    match picked {
        Picked::One(bucket) => ShaderPick::One(bucket),
        Picked::Fade { new, old, t } => ShaderPick::Fade { new, old, t },
        Picked::FadeIn { bucket, t } => ShaderPick::FadeIn { bucket, t },
        Picked::FadeOut { old, t } => ShaderPick::FadeOut { bucket: old, t },
        Picked::Hidden => ShaderPick::Hidden,
    }
}

/// A small deterministic generator, so a failed case can be written down and run again.
struct Rng(u64);

impl Rng {
    fn word(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) as u32
    }

    fn unit(&mut self) -> f32 {
        self.word() as f32 / u32::MAX as f32
    }

    fn range(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.unit()
    }
}

/// True when a distance lies within a rounding hair of a switch, where the core and the shader may
/// divide in another order and land on either side. A drift of 0.01 per cent or more is a fault.
fn at_a_switch(
    rule: &LevelRule,
    links: &[LevelLink],
    scale: f32,
    radius: f32,
    bias: f32,
    distance: f32,
) -> bool {
    links.iter().any(|link| {
        let switch = rule.switch_distance(link, scale, radius, bias);
        switch.is_finite() && (distance / switch - 1.0).abs() < 1.0e-5
    })
}

/// True when the two answers name the same buckets and the same fade share, within a rounding hair.
fn same_pick(core: ShaderPick, shader: ShaderPick) -> bool {
    match (core, shader) {
        (ShaderPick::One(a), ShaderPick::One(b)) => a == b,
        (
            ShaderPick::Fade {
                new: an,
                old: ao,
                t: at,
            },
            ShaderPick::Fade {
                new: bn,
                old: bo,
                t: bt,
            },
        ) => an == bn && ao == bo && (at - bt).abs() <= 1.0e-5,
        (ShaderPick::FadeIn { bucket: a, t: at }, ShaderPick::FadeIn { bucket: b, t: bt }) => {
            a == b && (at - bt).abs() <= 1.0e-5
        }
        (ShaderPick::FadeOut { bucket: a, t: at }, ShaderPick::FadeOut { bucket: b, t: bt }) => {
            a == b && (at - bt).abs() <= 1.0e-5
        }
        (ShaderPick::Hidden, ShaderPick::Hidden) => true,
        _ => false,
    }
}

#[test]
fn the_culling_shader_picks_the_levels_that_the_core_picks() {
    let mut rng = Rng(0x05ee_d10d);
    let mut compared = 0;
    for case in 0..20_000 {
        // A chain of up to eight lower levels, each given by an error, a distance or a coverage.
        let levels = rng.word() % 9;
        let fades = rng.word();
        let mut links = Vec::with_capacity(levels as usize + 1);
        let mut buckets = Vec::with_capacity(levels as usize + 1);
        let fade_of = |k: u32| {
            if fades & (1 << k) != 0 {
                100 + k
            } else {
                NO_LINK
            }
        };
        links.push(LevelLink {
            value: 0.0,
            switch: Switch::Error,
            next: if levels > 0 { 1 } else { NO_LINK },
            fade: fade_of(0),
        });
        buckets.push(ShaderBucket {
            next: if levels > 0 { 2 } else { 0 },
            switch: 0,
            value: 0.0,
            fade: if fades & 1 != 0 { 101 } else { 0 },
        });
        for k in 1..=levels {
            let switch = match rng.word() % 3 {
                0 => Switch::Error,
                1 => Switch::Distance,
                _ => Switch::Coverage,
            };
            let value = match switch {
                Switch::Error => rng.range(0.001, 1.0),
                Switch::Distance => rng.range(0.5, 200.0),
                Switch::Coverage => rng.range(0.0001, 1.0),
            };
            links.push(LevelLink {
                value,
                switch,
                next: if k < levels { k + 1 } else { NO_LINK },
                fade: fade_of(k),
            });
            buckets.push(ShaderBucket {
                next: if k < levels { k + 2 } else { 0 },
                switch: switch as u32,
                value,
                fade: if fades & (1 << k) != 0 {
                    100 + k + 1
                } else {
                    0
                },
            });
        }
        // A camera rule, or a light's view through a parallel or a perspective lens.
        let height = rng.range(100.0, 2_200.0);
        let p11 = rng.range(0.3, 3.0);
        let orthographic = rng.word() & 1 == 0;
        let threshold = rng.range(0.5, 4.0);
        let band = if rng.word() & 1 == 0 { 0.0 } else { 0.08 };
        let camera = LevelRule::new(height, p11, orthographic, threshold, band);
        let rule = match rng.word() % 3 {
            0 => camera,
            1 => LevelRule::for_light(
                &camera,
                LightLens::Parallel {
                    texel: rng.range(0.001, 0.1),
                },
                threshold,
            ),
            _ => LevelRule::for_light(
                &camera,
                LightLens::Point {
                    eye: [
                        rng.range(-1_000.0, 1_000.0),
                        rng.range(-1_000.0, 1_000.0),
                        rng.range(-1_000.0, 1_000.0),
                    ],
                    texel: rng.range(0.001, 0.1),
                },
                threshold,
            ),
        };
        let center = [
            rng.range(-3_000.0, 3_000.0),
            rng.range(-3_000.0, 3_000.0),
            rng.range(-3_000.0, 3_000.0),
        ];
        let radius = rng.range(0.05, 3_000.0);
        let scale = rng.range(0.01, 100.0);
        let bias = if rng.word() & 3 == 0 {
            1.0
        } else {
            rng.range(0.2, 5.0)
        };
        let range = if rng.word() & 1 == 0 {
            DrawRange::NONE
        } else {
            let start = rng.range(0.0, 50.0);
            DrawRange {
                start,
                end: start + rng.range(1.0, 4_000.0),
            }
        };
        let distance = rule.distances(center, radius);
        let core = core_pick(rule.pick(&links, 0, scale, radius, distance, bias, range));
        let shader = shader_pick(
            &buckets,
            0,
            center,
            radius,
            scale,
            range,
            bias,
            rule.factor,
            rule.orthographic,
            rule.band,
            rule.p11,
            rule.measure_uniform(),
        );
        let near = at_a_switch(
            &rule,
            &links,
            scale,
            radius,
            bias,
            distance.of(Switch::Error),
        ) || at_a_switch(&rule, &links, scale, radius, bias, distance.camera);
        if near {
            continue;
        }
        assert!(
            same_pick(core, shader),
            "case {case}: core {core:?}, shader {shader:?}"
        );
        compared += 1;
    }
    assert!(compared > 10_000, "only {compared} cases compared");
}

#[test]
fn the_culling_shader_repeats_the_core_level_rule() {
    let cull = include_str!("../../null3d-shaders/wgsl/cull.wgsl");
    for line in [
        "const LEAST_DISTANCE: f32 = 1.0e-3;",
        "const LEVEL_RADIUS_SHARE: f32 = 0.5;",
        "const LEVEL_NEAREST_SHARE: f32 = 2.0;",
        "const SWITCH_ERROR: u32 = 0u;",
        "const SWITCH_DISTANCE: u32 = 1u;",
        "const SWITCH_COVERAGE: u32 = 2u;",
        "let nearest = max(length(s.center) - s.radius, LEAST_DISTANCE);",
        "let distance = nearest;",
        "let half = max(length(s.center) - LEVEL_RADIUS_SHARE * s.radius, LEAST_DISTANCE);",
        "let toward = min(half, LEVEL_NEAREST_SHARE * nearest);",
        "return bucket.value * scale * factor;",
        "return bucket.value * scale / bias;",
        "return radius * p11 / (bucket.value * bias);",
        "let hide = 2.0 * s.radius * factor;",
        "append_to(s, new_fade - 1u, draws_before, max(t, 1e-6), false);",
    ] {
        assert!(
            cull.contains(line),
            "the shader's level rule moved:\n{line}"
        );
    }
    assert_eq!(LEAST_DISTANCE, 1.0e-3);
    assert_eq!(LEVEL_RADIUS_SHARE, 0.5);
    assert_eq!(LEVEL_NEAREST_SHARE, 2.0);
    assert_eq!(fade_values(0.0).0, 1.0e-6);
    let levels = include_str!("../../null3d-core/src/levels.rs");
    assert!(
        levels.contains("entry(bucket, t.max(LEAST_FADE), false),"),
        "the CPU path's least fade moved"
    );
    assert_eq!(
        (
            Switch::Error as u32,
            Switch::Distance as u32,
            Switch::Coverage as u32
        ),
        (0, 1, 2)
    );
}

/// The shader's dither value for the pixel at `x`, `y` in the 4 x 4 tile, from `lod_kept` in
/// `mesh.wgsl`, with the tile moved by `phase`.
fn dither_value(x: u32, y: u32, phase: u32) -> u32 {
    let px = (x + (phase & 3)) & 3;
    let py = (y + (phase >> 2)) & 3;
    let (low_x, low_y) = (px & 1, py & 1);
    let (high_x, high_y) = (px >> 1, py >> 1);
    4 * (2 * (low_x ^ low_y) + low_y) + 2 * (high_x ^ high_y) + high_y
}

/// True when a pixel of `value` is kept at `fade`, as `lod_kept` decides it.
fn dither_kept(fade: f32, value: f32) -> bool {
    if fade > 0.0 {
        value < fade
    } else {
        value >= -fade
    }
}

#[test]
fn the_dither_keeps_every_pixel_of_a_band_once() {
    let mesh = include_str!("../../null3d-shaders/wgsl/lib/mesh.wgsl");
    for line in [
        "return pcg(source) & 15u;",
        "let p = (vec2u(pixel) + vec2u(phase & 3u, phase >> 2u)) & vec2u(3u);",
        "let cell = 4u * (2u * (low.x ^ low.y) + low.y) + 2u * (high.x ^ high.y) + high.y;",
        "let value = (f32(cell) + 0.5) / 16.0;",
        "let new_side = fade > 0.0;",
        "let kept_new = value < fade;",
        "return select(value >= -fade, kept_new, new_side);",
    ] {
        assert!(mesh.contains(line), "the dither moved:\n{line}");
    }
    // The 4 x 4 tile is a true permutation of 0 to 15, for every phase.
    for phase in 0..16 {
        let mut seen = [false; 16];
        for y in 0..4 {
            for x in 0..4 {
                seen[dither_value(x, y, phase) as usize] = true;
            }
        }
        assert!(seen.iter().all(|&one| one), "phase {phase}");
    }
    // The two sides of a band keep exactly complementary pixels at every share, from none through
    // the whole band, and the least fade keeps the new side at no pixel rather than all of them.
    for t in [0.0, 0.01, 0.25, 0.5, 31.0 / 32.0, 0.99, 1.0, 2.0] {
        let (new, old) = fade_values(t);
        for cell in 0..16 {
            let value = (cell as f32 + 0.5) / 16.0;
            assert_ne!(
                dither_kept(new, value),
                dither_kept(old, value),
                "t {t}, cell {cell}: new {new}, old {old}"
            );
        }
    }
    let (new, old) = fade_values(0.0);
    assert_eq!(new, 1.0e-6);
    assert!(old == 0.0);
}

#[test]
fn a_shadow_view_picks_a_casters_level_in_its_own_texels() {
    // A ball two metres in front of the camera draws its base level there, since level 1 switches
    // at 3.1 m. The far cascades of the sun's shadow cover about 4 cm of world per texel, so they
    // pick level 1, whose 3 cm error covers under a texel. A shadow rule that read the camera's
    // distance would draw the base level in every cascade.
    let mut world = cpu_world();
    world.cast_sun_shadows(4);
    let ball = world.objects[2];
    world.scene.set_position(ball, [0.0, 0.0, 18.0]).unwrap();
    world
        .scene
        .apply_commands(
            &[Command::set_flags(
                ball,
                flags::CAST_SHADOWS,
                flags::CAST_SHADOWS,
            )],
            world.frame,
        )
        .unwrap();
    let levels = give_levels_of(&mut world, &[0.01, 0.03], 0);
    world.record(true);
    let drawn = draws(&world);
    assert!(
        drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&world, BALL)),
        "the camera draws the base level: {drawn:?}"
    );
    assert!(
        drawn
            .iter()
            .any(|&(indices, _)| indices == indices_of(&world, levels[0])),
        "a cascade draws the first lower level: {drawn:?}"
    );
}
