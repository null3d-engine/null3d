//! Light objects reach the frame: the main directional light and the ambient lights become the
//! lighting of each view's uniform block, and the point lights the camera sees fill the light
//! table's visible list, on both frame builders.

mod common;

use std::f32::consts::FRAC_PI_2;

use common::World;
use null3d_core::handle::Handle;
use null3d_core::lights::{LightTable, color, kind, value};
use null3d_core::scene::{Command, flags};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::view::ViewId;

/// Adds a light object at `position`, turned `angle` radians about X, in the world's current
/// frame, and its row in `lights`.
fn light<B: FrameBuilder>(
    world: &mut World<B>,
    lights: &mut LightTable,
    light_kind: u32,
    position: [f32; 3],
    angle: f32,
) -> (Handle, u32) {
    let object = world.scene.reserve().unwrap();
    world.scene.set_position(object, position).unwrap();
    let (sin, cos) = (angle / 2.0).sin_cos();
    world
        .scene
        .set_rotation(object, [sin, 0.0, 0.0, cos])
        .unwrap();
    let create = Command::create(object, Handle::NONE, NO_MESH, flags::VISIBLE);
    world.scene.apply_commands(&[create], world.frame).unwrap();
    (object, lights.create(object, light_kind).unwrap())
}

/// Runs the world's current frame with its lights gathered, as the engine runs it.
fn record<B: FrameBuilder>(world: &mut World<B>, lights: &mut LightTable) {
    world.scene.begin_frame(world.frame);
    world.scene.update_transforms(&world.jobs);
    let parity = world.scene.parity();
    world
        .renderer
        .settings_mut()
        .gather_lights(lights, &world.scene, parity, world.canvas);
    world.record(true);
}

/// The lighting of the camera view's uniform block: the sun's direction and color, and the
/// ambient color.
fn uniform<B: FrameBuilder>(world: &World<B>) -> [[f32; 4]; 3] {
    let parity = world.scene.parity();
    let settings = world.renderer.settings();
    let frame = settings
        .view_frame(ViewId::CAMERA, &world.scene, parity, world.canvas)
        .unwrap();
    let u = frame.uniform;
    [u.sun_direction, u.sun_color, u.ambient]
}

fn lights_reach_the_frame<B: FrameBuilder>(mut world: World<B>) {
    let mut lights = LightTable::new();
    // Straight down, half as bright as the ambient light is white.
    let (sun, sun_row) = light(
        &mut world,
        &mut lights,
        kind::DIRECTIONAL,
        [0.0; 3],
        -FRAC_PI_2,
    );
    lights.set_value(sun_row, value::INTENSITY, 2.0).unwrap();
    let (_, ambient) = light(&mut world, &mut lights, kind::AMBIENT, [0.0; 3], 0.0);
    lights
        .set_color(ambient, color::MAIN, [0.25, 0.5, 1.0])
        .unwrap();
    // The camera stands at z = 20 and looks down -Z: one light ahead of it, one behind it.
    let (_, ahead) = light(&mut world, &mut lights, kind::POINT, [1.0, 0.0, 0.0], 0.0);
    let (_, behind) = light(&mut world, &mut lights, kind::POINT, [0.0, 0.0, 40.0], 0.0);
    for row in [ahead, behind] {
        lights.set_value(row, value::RANGE, 2.0).unwrap();
    }
    record(&mut world, &mut lights);
    let [direction, sun_color, ambient_color] = uniform(&world);
    assert!(
        direction[0].abs() < 1e-6 && (direction[1] + 1.0).abs() < 1e-6 && direction[2].abs() < 1e-6
    );
    assert_eq!(sun_color, [2.0, 2.0, 2.0, 0.0]);
    assert_eq!(ambient_color, [0.25, 0.5, 1.0, 0.0]);
    let visible = lights.visible();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].light, ahead);
    assert_eq!(visible[0].position, [1.0, 0.0, -20.0]);

    // A hidden sun lights nothing in the next frame.
    world.frame += 1;
    world
        .scene
        .apply_commands(&[Command::set_visible(sun, false)], world.frame)
        .unwrap();
    record(&mut world, &mut lights);
    assert_eq!(uniform(&world)[1], [0.0; 4]);
}

#[test]
fn lights_reach_the_frame_on_webgpu() {
    lights_reach_the_frame(World::build(GpuDrivenRenderer::new(
        RendererConfig::default(),
    )));
}

#[test]
fn lights_reach_the_frame_on_webgl2() {
    lights_reach_the_frame(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}
