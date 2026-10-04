//! Software occlusion culling in the WebGL2 frame builder: a wall that blocks the view hides the
//! objects and instance rows behind it from the camera's index list, and stops when it no longer
//! may block: switched off, hidden, on a layer that the camera does not draw, see-through, or
//! with the camera past it. Shadow cascades draw the hidden objects still.

mod common;

use common::{BATCH_ROWS, World};
use null3d_core::handle::Handle;
use null3d_core::lights::SunShadow;
use null3d_core::scene::{Command, flags};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::FrameBuilder;
use null3d_render::materials::{Shading, feature};
use null3d_render::view::ViewId;

/// The world's three shown objects, every row of its dynamic batch at the origin, and a wall of
/// the world's box mesh between them and the camera, which looks down -z from z = 20. Returns the
/// world and the wall.
fn walled() -> (World<CpuCulledRenderer>, Handle) {
    let mut world = World::build(CpuCulledRenderer::new(CpuCulledConfig::default()));
    let wall = world.scene.reserve().unwrap();
    world.scene.set_position(wall, [0.0, 0.0, 10.0]).unwrap();
    world.scene.set_scale(wall, [30.0, 20.0, 1.0]).unwrap();
    world.scene.set_local_radius(wall, 0.9).unwrap();
    let shown = flags::VISIBLE | flags::OCCLUDER;
    let commands = [
        Command::create(wall, Handle::NONE, 1, shown),
        Command::set_material(wall, 1),
    ];
    world.scene.apply_commands(&commands, 1).unwrap();
    world.renderer.set_software_occlusion(true);
    (world, wall)
}

/// Records the next frame, and returns its visible and occluded index list entries.
fn step(world: &mut World<CpuCulledRenderer>, structure_changed: bool) -> (u32, u32) {
    world.frame += 1;
    world.record(structure_changed);
    let frame = world.frame;
    (
        world.renderer.visible_entries(frame).unwrap(),
        world.renderer.occluded_entries(frame).unwrap(),
    )
}

/// Everything in front of the camera: the wall, the three shown objects, and the batch's rows.
const ALL: u32 = 1 + 3 + BATCH_ROWS;

#[test]
fn a_wall_hides_what_lies_behind_it() {
    let (mut world, _) = walled();
    world.record(true);
    assert_eq!(step(&mut world, false), (1, ALL - 1));
    world.renderer.set_software_occlusion(false);
    assert_eq!(step(&mut world, false), (ALL, 0));
    world.renderer.set_software_occlusion(true);
    assert_eq!(step(&mut world, false), (1, ALL - 1));
}

#[test]
fn a_wall_blocks_nothing_once_it_may_not() {
    let (mut world, wall) = walled();
    world.record(true);
    // Hidden, then shown again.
    let hidden = [Command::set_visible(wall, false)];
    world
        .scene
        .apply_commands(&hidden, world.frame + 1)
        .unwrap();
    assert_eq!(step(&mut world, false), (ALL - 1, 0));
    let shown = [Command::set_visible(wall, true)];
    world.scene.apply_commands(&shown, world.frame + 1).unwrap();
    assert_eq!(step(&mut world, false), (1, ALL - 1));
    // Not a blocker.
    let off = [Command::set_flags(wall, flags::OCCLUDER, 0)];
    world.scene.apply_commands(&off, world.frame + 1).unwrap();
    assert_eq!(step(&mut world, false), (ALL, 0));
    let on = [Command::set_flags(wall, flags::OCCLUDER, flags::OCCLUDER)];
    world.scene.apply_commands(&on, world.frame + 1).unwrap();
    assert_eq!(step(&mut world, false), (1, ALL - 1));
    // On a layer that the camera does not draw.
    let elsewhere = [Command::set_layers(wall, 2)];
    world
        .scene
        .apply_commands(&elsewhere, world.frame + 1)
        .unwrap();
    assert_eq!(step(&mut world, false), (ALL - 1, 0));
    let back = [Command::set_layers(wall, 1)];
    world.scene.apply_commands(&back, world.frame + 1).unwrap();
    assert_eq!(step(&mut world, false), (1, ALL - 1));
    // The camera past the wall sees everything behind it.
    world
        .scene
        .set_position(world.camera, [0.0, 0.0, 5.0])
        .unwrap();
    assert_eq!(step(&mut world, false).1, 0);
}

#[test]
fn see_through_walls_block_nothing() {
    for features in [feature::BLEND, feature::ALPHA_MASK, feature::NO_DEPTH_WRITE] {
        let (mut world, wall) = walled();
        let material = world
            .renderer
            .settings_mut()
            .materials_mut()
            .create(Shading::Lit, features, [1.0; 4])
            .unwrap()
            + 1;
        let commands = [Command::set_material(wall, material)];
        world.scene.apply_commands(&commands, 1).unwrap();
        world.record(true);
        assert_eq!(step(&mut world, false).1, 0, "features {features}");
    }
}

#[test]
fn hidden_objects_still_cast_shadows() {
    let (mut world, _) = walled();
    let casts = flags::CAST_SHADOWS;
    let commands: Vec<Command> = world
        .objects
        .iter()
        .map(|&object| Command::set_flags(object, casts, casts))
        .collect();
    world.scene.apply_commands(&commands, 1).unwrap();
    world
        .renderer
        .settings_mut()
        .set_sun_shadow(Some(SunShadow {
            cascades: 1,
            map_size: 1024,
            bias: 0.5,
            normal_bias: 1.0,
            distance: 60.0,
            layers: 1,
        }));
    world.record(true);
    let (visible, occluded) = step(&mut world, false);
    assert_eq!(
        (visible - 1, occluded),
        (0, ALL - 1),
        "the camera sees the wall alone"
    );
    // The cascade lists the objects that cast shadows.
    let cascade = world.renderer.tested(ViewId::cascade(0));
    assert!(cascade >= 3, "the cascade tested {cascade} sources");
}

#[test]
fn a_blocker_takes_the_shape_of_its_own_mesh() {
    let (mut world, wall) = walled();
    world.scene.set_scale(wall, [10.0, 6.0, 1.0]).unwrap();
    // A small ball behind the wall's corner: the wall's box hides it, and a ball of the wall's
    // size would not.
    let corner = world.scene.reserve().unwrap();
    world
        .scene
        .set_position(corner, [13.9, 8.2, -10.0])
        .unwrap();
    world.scene.set_local_radius(corner, 0.3).unwrap();
    let commands = [
        Command::create(corner, Handle::NONE, 2, flags::VISIBLE),
        Command::set_material(corner, 1),
    ];
    world.scene.apply_commands(&commands, 1).unwrap();
    world.record(true);
    let (_, with_corner) = step(&mut world, false);
    let hide = [Command::set_visible(corner, false)];
    world.scene.apply_commands(&hide, world.frame + 1).unwrap();
    let (_, without_corner) = step(&mut world, false);
    assert_eq!(with_corner, without_corner + 1, "the corner ball is hidden");
}
