//! Blended objects for the transparent pass's tests: a box, a sphere and a plane on the camera's
//! axis, each with a blend mode of its own, and a static batch of blended grids between them.

use null3d_core::handle::Handle;
use null3d_core::scene::{Command, flags};
use null3d_render::frame::FrameBuilder;
use null3d_render::geometry::{Geometry, box_geometry};
use null3d_render::materials::{Shading, feature};

use super::{World, base_format, base_sphere, grid};

/// The index counts of the blended meshes: a box, a sphere, a plane and a grid of four quads.
pub const BOX: u32 = 36;
pub const PLANE: u32 = 6;
pub const GRID: u32 = 24;

/// The blended objects of a world: a box far back, a sphere, and a plane near the camera, the
/// sphere's index count, and the batch of grids.
pub struct Blended {
    pub box_object: Handle,
    pub sphere: u32,
    pub batch: Handle,
}

/// Adds a mesh and a blended unlit material of `blend` bits, and returns their engine ids.
fn blended_pair<B: FrameBuilder>(world: &mut World<B>, mesh: &Geometry, blend: u32) -> (u32, u32) {
    let settings = world.renderer.settings_mut();
    let mesh = settings.meshes_mut().add(mesh).unwrap() + 1;
    let material = settings
        .materials_mut()
        .create(Shading::Unlit, feature::BLEND | blend, [1.0, 1.0, 1.0, 0.5])
        .unwrap()
        + 1;
    (mesh, material)
}

/// Adds a blended object at `z` on the camera's axis.
fn add_blended<B: FrameBuilder>(world: &mut World<B>, mesh: u32, material: u32, z: f32) -> Handle {
    let object = world.scene.reserve().unwrap();
    world.scene.set_position(object, [0.0, 0.0, z]).unwrap();
    world.scene.set_local_radius(object, 1.0).unwrap();
    let commands = [
        Command::create(object, Handle::NONE, mesh, flags::VISIBLE),
        Command::set_material(object, material),
    ];
    world.scene.apply_commands(&commands, world.frame).unwrap();
    object
}

/// Adds the blended objects: a box at z = -5, a sphere at 0 and a plane at 5, each with a blend
/// mode of its own, and a static batch of three blended grids, one behind every object and two
/// between the sphere and the plane. The camera stands at z = 20 and looks down -z.
pub fn add_scene<B: FrameBuilder>(world: &mut World<B>) -> Blended {
    let box_mesh = base_format(box_geometry(1.0, 1.0, 1.0, [1, 1, 1]).unwrap());
    let sphere_mesh = base_sphere(0.5, [8, 6]);
    let sphere = sphere_mesh.indices.len() as u32;
    let (mesh, material) = blended_pair(world, &box_mesh, 0);
    let box_object = add_blended(world, mesh, material, -5.0);
    let (mesh, material) = blended_pair(world, &sphere_mesh, feature::ADDITIVE);
    add_blended(world, mesh, material, 0.0);
    let (mesh, material) = blended_pair(world, &grid(1, 1), feature::MULTIPLY);
    add_blended(world, mesh, material, 5.0);
    let (mesh, material) = blended_pair(world, &grid(2, 2), 0);
    let batch = world
        .batches
        .create(3, false, false, mesh, material, 1.5)
        .unwrap();
    let rows = world.batches.get_mut(batch).unwrap();
    rows.positions_mut()
        .copy_from_slice(&[0.0, 0.0, -7.0, 0.0, 0.0, 2.0, 0.0, 0.0, 3.0]);
    rows.set_active_count(3).unwrap();
    Blended {
        box_object,
        sphere,
        batch,
    }
}
