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
use null3d_render::debug_view::DebugView;
use null3d_render::fog::Fog;
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::output::{Output, ToneMapping};
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
        .view_frame(
            ViewId::CAMERA,
            &world.scene,
            parity,
            world.canvas,
            world.render_scale,
        )
        .unwrap();
    let u = frame.uniform;
    [u.sun_direction, u.sun_color, u.ambient]
}

/// The fog color of the camera view's uniform block.
fn fog_color<B: FrameBuilder>(world: &World<B>) -> [f32; 3] {
    let parity = world.scene.parity();
    let settings = world.renderer.settings();
    let frame = settings
        .view_frame(
            ViewId::CAMERA,
            &world.scene,
            parity,
            world.canvas,
            world.render_scale,
        )
        .unwrap();
    frame.uniform.fog.color
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

    // The exposure scales every light at its source, the fog with them, and a debug view, which
    // draws without the exposure, takes the lights as they are.
    world.frame += 1;
    let settings = world.renderer.settings_mut();
    settings.set_output(Output {
        tone_mapping: ToneMapping::Aces,
        exposure: 0.5,
    });
    settings.set_fog(Fog::Exp2 {
        color: [0.5, 0.5, 1.0],
        density: 0.1,
    });
    record(&mut world, &mut lights);
    let [_, sun_color, ambient_color] = uniform(&world);
    assert_eq!(sun_color, [1.0, 1.0, 1.0, 0.0]);
    assert_eq!(ambient_color, [0.125, 0.25, 0.5, 0.0]);
    assert_eq!(lights.visible()[0].color, [0.5; 3]);
    assert_eq!(fog_color(&world), [0.25, 0.25, 0.5]);
    world.frame += 1;
    world
        .renderer
        .settings_mut()
        .set_debug_view(DebugView::Normals);
    record(&mut world, &mut lights);
    assert_eq!(uniform(&world)[1], [2.0, 2.0, 2.0, 0.0]);
    world.renderer.settings_mut().set_debug_view(DebugView::Lit);

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

/// The frame reports the cascades of the main directional light's shadows, which the quality
/// governor lightens, and 0 once the light casts none.
#[test]
fn the_sun_reports_its_shadow_cascades() {
    let mut world = World::new();
    let mut lights = LightTable::new();
    record(&mut world, &mut lights);
    assert_eq!(world.renderer.settings().sun_shadow_cascades(), 0);
    let (sun, row) = light(
        &mut world,
        &mut lights,
        kind::DIRECTIONAL,
        [0.0; 3],
        -FRAC_PI_2,
    );
    lights.set_value(row, value::SHADOW_CASCADES, 3.0).unwrap();
    world.frame += 1;
    let casts = Command::set_flags(sun, flags::CAST_SHADOWS, flags::CAST_SHADOWS);
    world.scene.apply_commands(&[casts], world.frame).unwrap();
    record(&mut world, &mut lights);
    assert_eq!(world.renderer.settings().sun_shadow_cascades(), 3);
    world.frame += 1;
    let stops = Command::set_flags(sun, flags::CAST_SHADOWS, 0);
    world.scene.apply_commands(&[stops], world.frame).unwrap();
    record(&mut world, &mut lights);
    assert_eq!(world.renderer.settings().sun_shadow_cascades(), 0);
}

/// The clock, the camera's place in the world and the target's size reach each view's uniform
/// block, for the built-in values of custom materials. The target's size is the render size, so
/// it shrinks with the render scale while the projection keeps the canvas's shape.
#[test]
fn the_clock_the_camera_and_the_target_reach_the_frame() {
    let mut world = World::new();
    world.renderer.settings_mut().set_clock(1.5, 0.25, 90);
    world.record(true);
    let parity = world.scene.parity();
    let frame = |scale| {
        world
            .renderer
            .settings()
            .view_frame(ViewId::CAMERA, &world.scene, parity, world.canvas, scale)
            .unwrap()
            .uniform
    };
    let u = frame(RenderScale::FULL);
    assert_eq!(u.clock, [1.5, 0.25, f32::from_bits(90), 0.0]);
    assert_eq!(u.camera_world, [0.0, 0.0, 20.0, 0.0]);
    assert_eq!(u.target_size, [640.0, 360.0, 1.0 / 640.0, 1.0 / 360.0]);
    let half = frame(RenderScale::from_thousandths(500));
    assert_eq!(half.target_size, [320.0, 180.0, 1.0 / 320.0, 1.0 / 180.0]);
    assert_eq!(half.view_proj, u.view_proj);
}
