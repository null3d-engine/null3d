//! Light objects reach the frame: the main directional light and the ambient and hemisphere lights
//! become the lighting of each view's uniform block, and the point lights the camera sees fill the light
//! table's visible list, on both frame builders.

mod common;

use std::f32::consts::FRAC_PI_2;

use common::World;
use null3d_core::handle::Handle;
use null3d_core::lights::{LightTable, color, kind, value};
use null3d_core::scene::{Command, flags};
use null3d_gpu::drawlist::{Op, format, layout};
use null3d_render::cpu_culled::{CpuCulledConfig, CpuCulledRenderer};
use null3d_render::debug_view::DebugView;
use null3d_render::fog::{self, Fog};
use null3d_render::frame::{FrameBuilder, NO_MESH};
use null3d_render::frame_data::FrameUniform;
use null3d_render::gpu_driven::{GpuDrivenRenderer, RendererConfig};
use null3d_render::graph::RenderScale;
use null3d_render::light_tables::FIRST_IMAGE_LAYER;
use null3d_render::output::{Output, ToneMapping};
use null3d_render::probes;
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
    let built = if world.pipelines_built == u32::MAX {
        world.frame
    } else {
        world.pipelines_built
    };
    world
        .renderer
        .settings_mut()
        .gather_lights(lights, &world.scene, parity, world.canvas, built);
    world.record(true);
}

/// The camera view's uniform block.
fn camera_uniform<B: FrameBuilder>(world: &World<B>) -> FrameUniform {
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
    frame.uniform
}

/// The lighting of the camera view's uniform block: the sun's direction and color, and the
/// ambient color.
fn uniform<B: FrameBuilder>(world: &World<B>) -> [[f32; 4]; 3] {
    let u = camera_uniform(world);
    [u.sun_direction, u.sun_color, u.ambient]
}

/// The fog color of the camera view's uniform block.
fn fog_color<B: FrameBuilder>(world: &World<B>) -> [f32; 3] {
    camera_uniform(world).fog.color
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
    // An upright hemisphere light, from an orange sky to a blue ground: half their sum joins the
    // ambient light, and half their difference lies along +Y.
    let (hemisphere, hemisphere_row) =
        light(&mut world, &mut lights, kind::HEMISPHERE, [0.0; 3], 0.0);
    lights
        .set_color(hemisphere_row, color::MAIN, [1.0, 0.5, 0.0])
        .unwrap();
    lights
        .set_color(hemisphere_row, color::GROUND, [0.0, 0.5, 1.0])
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
    assert_eq!(ambient_color, [0.75, 1.0, 1.5, 0.0]);
    let up = [[0.0; 4], [0.5, 0.0, -0.5, 0.0], [0.0; 4]];
    assert_eq!(camera_uniform(&world).hemisphere, up);
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
    let fog = Fog::from_code(
        fog::curve::EXP2,
        [0.5, 0.5, 1.0],
        [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 8.0],
    );
    settings.set_fog(fog);
    record(&mut world, &mut lights);
    let [_, sun_color, ambient_color] = uniform(&world);
    assert_eq!(sun_color, [1.0, 1.0, 1.0, 0.0]);
    assert_eq!(ambient_color, [0.375, 0.5, 0.75, 0.0]);
    assert_eq!(
        camera_uniform(&world).hemisphere,
        up.map(|axis| axis.map(|v| v * 0.5))
    );
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

    // A hidden sun and a hidden hemisphere light light nothing in the next frame.
    world.frame += 1;
    let hide = [
        Command::set_visible(sun, false),
        Command::set_visible(hemisphere, false),
    ];
    world.scene.apply_commands(&hide, world.frame).unwrap();
    record(&mut world, &mut lights);
    let [_, sun_color, ambient_color] = uniform(&world);
    assert_eq!(sun_color, [0.0; 4]);
    assert_eq!(ambient_color, [0.125, 0.25, 0.5, 0.0]);
    assert_eq!(camera_uniform(&world).hemisphere, [[0.0; 4]; 3]);
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

/// A frame that finds the area lights' tables lists a rectangle light, when no pipeline of the
/// device has been built yet: such a frame waits for every pipeline its own list creates, so the
/// renderer's area shading is on for it however early in the frame its light list is made. Hold
/// mode draws just such a frame, because the thread that draws waits for the one frame the sketch
/// publishes, so a held frame of a rectangle or tube light scene shades with its area lights.
fn a_frame_that_finds_the_area_tables_lists_its_area_light<B: FrameBuilder>(mut world: World<B>) {
    let mut lights = LightTable::new();
    let (_, rect) = light(&mut world, &mut lights, kind::RECT, [0.0, 3.0, 0.0], 0.0);
    for (which, number) in [
        (value::RANGE, 20.0),
        (value::WIDTH, 4.0),
        (value::HEIGHT, 2.0),
        (value::INTENSITY, 3.0),
    ] {
        lights.set_value(rect, which, number).unwrap();
    }
    // The camera stands at z = 20 and looks down -Z, so the light above the origin is in view. No
    // frame has drawn on this device, as in hold mode, where the thread that draws waits for the
    // frame that the sketch publishes.
    world.pipelines_built = 0;

    // Before the tables arrive the light stays out of the list, whatever the device has drawn.
    record(&mut world, &mut lights);
    assert!(lights.visible().is_empty());

    // The frame that finds them shades with them. It draws them with its builds that hold their
    // code, because it waits for its own pipelines.
    let tables = world.renderer.settings_mut().light_tables_mut();
    assert!(tables.area_texels_mut().is_some());
    tables.finish_area();
    world.frame += 1;
    record(&mut world, &mut lights);
    let visible = lights.visible();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].kind, kind::RECT);
    assert_eq!(visible[0].position, [0.0, 3.0, -20.0]);
    assert_eq!(visible[0].range, 20.0);
}

#[test]
fn a_frame_that_finds_the_area_tables_lists_its_area_light_on_webgpu() {
    a_frame_that_finds_the_area_tables_lists_its_area_light(World::build(GpuDrivenRenderer::new(
        RendererConfig::default(),
    )));
}

#[test]
fn a_frame_that_finds_the_area_tables_lists_its_area_light_on_webgl2() {
    a_frame_that_finds_the_area_tables_lists_its_area_light(World::build(CpuCulledRenderer::new(
        CpuCulledConfig::default(),
    )));
}

/// The operands of each command of `op`.
fn operands(commands: &[(Op, Vec<u32>)], op: Op) -> Vec<Vec<u32>> {
    commands
        .iter()
        .filter(|(o, _)| *o == op)
        .map(|(_, operands)| operands.clone())
        .collect()
}

/// The shared array of the light tables and the probes' maps that a frame makes, with `layers`.
fn shared_array(commands: &[(Op, Vec<u32>)], layers: u32) -> u32 {
    let found: Vec<u32> = operands(commands, Op::CreateTexture)
        .into_iter()
        .filter(|o| o[3] == layers && o[4] == format::RGBA16_FLOAT)
        .map(|o| o[0])
        .collect();
    let [array] = found[..] else {
        panic!("one RGBA16F array of {layers} layers, not {found:?}");
    };
    array
}

/// The array that each camera view's frame group binds.
fn bound_arrays(commands: &[(Op, Vec<u32>)]) -> Vec<u32> {
    operands(commands, Op::CreateBindGroup)
        .into_iter()
        .filter(|o| o[1] == layout::FRAME)
        .map(|o| {
            o[3..]
                .chunks(5)
                .find(|entry| entry[0] == probes::ARRAY_BINDING)
                .map_or_else(
                    || panic!("a frame group binds the shared array"),
                    |entry| entry[2],
                )
        })
        .collect()
}

/// Records a frame and returns its commands, without replaying them on the mock. The frame that
/// makes the array again copies the old layers and writes a light's image in one submit, which the
/// mock's write-after-use rule rejects although the copy and the image take different layers.
fn record_commands<B: FrameBuilder>(
    world: &mut World<B>,
    structure_changed: bool,
) -> Vec<(Op, Vec<u32>)> {
    world.record(structure_changed);
    let commands = world.commands();
    world.frame += 1;
    commands
}

/// A light's first image makes the shared array again: the frame that makes it binds it in every
/// camera view's frame group, and only the frame after that destroys the old array.
fn a_light_image_makes_the_array_again_and_the_frame_groups_bind_it<B: FrameBuilder>(
    mut world: World<B>,
) {
    let first = record_commands(&mut world, true);
    let old = shared_array(&first, FIRST_IMAGE_LAYER);

    // One image gives the array room for four, and the mip levels that the images need.
    let probe_layers = world.renderer.settings().probes().probe_layers();
    let tables = world.renderer.settings_mut().light_tables_mut();
    assert!(tables.image_texels_mut(1).is_some());
    assert_eq!(
        tables.finish_image(1, probe_layers),
        Some(FIRST_IMAGE_LAYER)
    );
    let second = record_commands(&mut world, false);
    let new = shared_array(&second, FIRST_IMAGE_LAYER + 4);
    assert_ne!(old, new, "the image makes the array again");
    let bound = bound_arrays(&second);
    assert!(!bound.is_empty(), "the camera views bind the array again");
    assert!(
        bound.iter().all(|&array| array == new),
        "every frame group binds the new array, not {old}: {bound:?}"
    );

    // The old array goes only after the frame that bound the new one drew.
    let third = record_commands(&mut world, false);
    assert!(
        operands(&third, Op::DestroyTexture).contains(&vec![old]),
        "the old array goes"
    );
    assert!(
        bound_arrays(&third).iter().all(|&array| array != old),
        "no frame group binds the old array"
    );
}

#[test]
fn a_light_image_makes_the_array_again_and_the_frame_groups_bind_it_on_webgpu() {
    a_light_image_makes_the_array_again_and_the_frame_groups_bind_it(World::build(
        GpuDrivenRenderer::new(RendererConfig::default()),
    ));
}

#[test]
fn a_light_image_makes_the_array_again_and_the_frame_groups_bind_it_on_webgl2() {
    a_light_image_makes_the_array_again_and_the_frame_groups_bind_it(World::build(
        CpuCulledRenderer::new(CpuCulledConfig::default()),
    ));
}
