//! Levels of detail: the buckets that a mesh's levels add on WebGPU, with their fading builds, and
//! the level that each object draws on the WebGL2 path, by its distance from the camera.

mod common;

use common::{World, base_sphere, count, grid};
use null3d_core::jobs::JobSystem;
use null3d_core::levels::Switch;
use null3d_core::scene::Command;
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
fn give_levels<B: FrameBuilder>(world: &mut World<B>, fades: u16) -> [u32; 2] {
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
fn give_levels_of<B: FrameBuilder>(world: &mut World<B>, errors: &[f32], fades: u16) -> Vec<u32> {
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
