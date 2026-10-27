//! The light table's frame pass: which lights light a view, the main directional light, the sum
//! of the ambient lights, and the culled list of point and spot lights at positions relative to
//! the camera, near the origin and far from it.

mod common;

use std::f32::consts::{FRAC_PI_2, FRAC_PI_4, FRAC_PI_8};

use common::perspective;
use null3d_core::cells::{self, CellPosition};
use null3d_core::culling::Frustum;
use null3d_core::handle::Handle;
use null3d_core::jobs::JobSystem;
use null3d_core::layers::DEFAULT_LAYERS;
use null3d_core::lights::{
    FillLight, FrameLights, LightShadow, LightTable, LightView, NOT_VISIBLE, POINT_CONE,
    VisibleLight, color, farthest_receiver_distance, kind, ladder_distance, value,
};
use null3d_core::scene::{Command, SceneStorage, flags};

/// A rotation of `angle` radians about a unit axis, as a quaternion (x, y, z, w).
fn turn(axis: [f32; 3], angle: f32) -> [f32; 4] {
    let (sin, cos) = (angle / 2.0).sin_cos();
    [axis[0] * sin, axis[1] * sin, axis[2] * sin, cos]
}

/// A scene with lights, and the commands that create its objects in the next frame.
struct World {
    scene: SceneStorage,
    lights: LightTable,
    commands: Vec<Command>,
    frame: u32,
    jobs: JobSystem,
    /// The exposure that each frame's gather multiplies into every color.
    exposure: f32,
}

impl World {
    fn new() -> Self {
        Self {
            scene: SceneStorage::with_capacity(64),
            lights: LightTable::new(),
            commands: Vec::new(),
            frame: 0,
            jobs: JobSystem::new(0),
            exposure: 1.0,
        }
    }

    /// An object at `position`, turned by `rotation`, under `parent`, with `flags`.
    fn object(
        &mut self,
        position: [f32; 3],
        rotation: [f32; 4],
        parent: Handle,
        flags: u32,
    ) -> Handle {
        let h = self.scene.reserve().unwrap();
        self.scene.set_position(h, position).unwrap();
        self.scene.set_rotation(h, rotation).unwrap();
        self.commands.push(Command::create(h, parent, 0, flags));
        h
    }

    /// A visible light of `light_kind` at `position`, turned by `rotation`, and its row.
    fn light(&mut self, light_kind: u32, position: [f32; 3], rotation: [f32; 4]) -> (Handle, u32) {
        let h = self.object(position, rotation, Handle::NONE, flags::VISIBLE);
        (h, self.lights.create(h, light_kind).unwrap())
    }

    /// A point or spot light with a range, and its row.
    fn ranged(&mut self, light_kind: u32, position: [f32; 3], range: f32) -> u32 {
        let (_, row) = self.light(light_kind, position, [0.0, 0.0, 0.0, 1.0]);
        self.lights.set_value(row, value::RANGE, range).unwrap();
        row
    }

    /// Runs a frame's commands and transform update, then gathers the lights for `view`.
    fn frame(&mut self, view: Option<&LightView>) -> FrameLights {
        self.frame += 1;
        self.scene
            .apply_commands(&std::mem::take(&mut self.commands), self.frame)
            .unwrap();
        self.scene.update_transforms(&self.jobs);
        self.lights
            .gather(&self.scene, self.scene.parity(), view, self.exposure)
    }

    /// The rows of the visible list.
    fn visible_rows(&self) -> Vec<u32> {
        self.lights.visible().iter().map(|l| l.light).collect()
    }
}

/// A view from `camera`, looking down -Z, that sees from 0.5 m to 500 m, on the default layer.
fn view_from(camera: CellPosition) -> LightView {
    LightView {
        camera,
        frustum: Frustum::from_view_projection(&perspective(1.2, 1.0, 0.5, 500.0)),
        layers: DEFAULT_LAYERS,
    }
}

/// A view from the origin.
fn origin_view() -> LightView {
    view_from(CellPosition::default())
}

const NO_TURN: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

fn assert_close(actual: [f32; 3], expected: [f32; 3]) {
    for k in 0..3 {
        assert!(
            (actual[k] - expected[k]).abs() < 1e-5,
            "{actual:?} is not {expected:?}"
        );
    }
}

#[test]
fn point_and_spot_lights_are_culled_by_their_range_spheres() {
    let mut world = World::new();
    let ahead = world.ranged(kind::POINT, [0.0, 0.0, -10.0], 1.0);
    let _behind = world.ranged(kind::POINT, [0.0, 0.0, 10.0], 1.0);
    let reaching = world.ranged(kind::POINT, [0.0, 0.0, 10.0], 20.0);
    let _aside = world.ranged(kind::POINT, [100.0, 0.0, -10.0], 5.0);
    let _past_far = world.ranged(kind::SPOT, [0.0, 0.0, -600.0], 50.0);
    let spot = world.ranged(kind::SPOT, [0.0, 3.0, -20.0], 2.0);
    world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [ahead, reaching, spot]);
    let visible = world.lights.visible();
    assert_eq!(visible[0].position, [0.0, 0.0, -10.0]);
    assert_eq!(visible[0].range, 1.0);
    assert_eq!(visible[2].position, [0.0, 3.0, -20.0]);
    assert_eq!(visible[2].kind, kind::SPOT);

    // Without a view, no light is culled in, and nothing else changes.
    world.frame(None);
    assert!(world.lights.visible().is_empty());
}

#[test]
fn point_and_spot_lights_that_cast_shadows_list_where_they_stand_in_view_or_not() {
    let mut world = World::new();
    let shadowed = flags::VISIBLE | flags::CAST_SHADOWS;
    let quarter_back = turn([1.0, 0.0, 0.0], -FRAC_PI_2);
    let spot_object = world.object([0.0, 3.0, -20.0], quarter_back, Handle::NONE, shadowed);
    let spot = world.lights.create(spot_object, kind::SPOT).unwrap();
    world.lights.set_value(spot, value::RANGE, 8.0).unwrap();
    world.lights.set_value(spot, value::ANGLE, 0.5).unwrap();
    world
        .lights
        .set_value(spot, value::SHADOW_BIAS, 2.0)
        .unwrap();
    world.commands.push(Command::set_layers(spot_object, 0b11));
    // A point light behind the camera casts too, but the view does not see it.
    let behind_object = world.object([0.0, 0.0, 30.0], NO_TURN, Handle::NONE, shadowed);
    let behind = world.lights.create(behind_object, kind::POINT).unwrap();
    world.lights.set_value(behind, value::RANGE, 1.0).unwrap();
    // Lights without the flag, and directional lights with it, list nothing here.
    let plain = world.ranged(kind::POINT, [0.0, 0.0, -5.0], 2.0);
    let sun = world.object([0.0; 3], NO_TURN, Handle::NONE, shadowed);
    world.lights.create(sun, kind::DIRECTIONAL).unwrap();
    world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [spot, plain]);
    let [s, b] = world.lights.shadows() else {
        panic!("two lights cast shadows")
    };
    assert_eq!(s.light, spot);
    assert_eq!((s.kind, s.visible), (kind::SPOT, 0));
    assert_eq!(s.at.local, [0.0, 3.0, -20.0]);
    assert_close(s.direction, [0.0, -1.0, 0.0]);
    assert_eq!((s.angle, s.range), (0.5, 8.0));
    assert_eq!((s.bias, s.normal_bias), (2.0, 0.02));
    assert_eq!(s.layers, 0b11);
    assert_eq!(
        *b,
        LightShadow {
            light: behind,
            kind: kind::POINT,
            visible: NOT_VISIBLE,
            at: CellPosition {
                cell: [0, 0, 0],
                local: [0.0, 0.0, 30.0],
            },
            direction: [0.0; 3],
            angle: 0.0,
            range: 1.0,
            bias: 0.01,
            normal_bias: 0.02,
            intensity: 1.0,
            layers: DEFAULT_LAYERS,
        }
    );
    // The core leaves every light without a tile.
    assert!(world.lights.visible().iter().all(|l| l.shadow == 0.0));

    // Without a view, the list is empty.
    world.frame(None);
    assert!(world.lights.shadows().is_empty());
}

#[test]
fn records_hold_colors_times_intensities_and_the_cones_of_spot_lights() {
    let mut world = World::new();
    let point = world.ranged(kind::POINT, [1.0, 0.0, -5.0], 4.0);
    let (_, spot) = world.light(
        kind::SPOT,
        [0.0, 0.0, -5.0],
        turn([1.0, 0.0, 0.0], -FRAC_PI_2),
    );
    let lights = &mut world.lights;
    lights.set_value(spot, value::RANGE, 6.0).unwrap();
    lights.set_value(spot, value::ANGLE, FRAC_PI_4).unwrap();
    lights.set_value(spot, value::PENUMBRA, 0.5).unwrap();
    lights.set_value(spot, value::DECAY, 1.0).unwrap();
    lights.set_value(spot, value::INTENSITY, 4.0).unwrap();
    lights
        .set_color(spot, color::MAIN, [0.5, 0.25, 1.0])
        .unwrap();
    world.frame(Some(&origin_view()));
    let [p, s] = world.lights.visible() else {
        panic!("two lights are visible")
    };
    assert_eq!(
        *p,
        VisibleLight {
            position: [1.0, 0.0, -5.0],
            range: 4.0,
            color: [1.0; 3],
            decay: 2.0,
            direction: [0.0; 3],
            cone_cos: POINT_CONE[0],
            penumbra_cos: POINT_CONE[1],
            kind: kind::POINT,
            light: point,
            shadow: 0.0,
            up: [0.0; 3],
            image: 0.0,
        }
    );
    // A quarter turn back about X points the spot light straight down.
    assert_close(s.direction, [0.0, -1.0, 0.0]);
    assert_eq!(s.color, [2.0, 1.0, 4.0]);
    assert_eq!((s.range, s.decay), (6.0, 1.0));
    assert!((s.cone_cos - FRAC_PI_4.cos()).abs() < 1e-6);
    assert!((s.penumbra_cos - FRAC_PI_8.cos()).abs() < 1e-6);
    assert_eq!(size_of::<VisibleLight>(), 80);
}

#[test]
fn hidden_lights_uncreated_lights_and_lights_off_the_view_layers_do_not_light() {
    let mut world = World::new();
    let shown = world.ranged(kind::POINT, [0.0, 0.0, -10.0], 1.0);
    let hidden = world.object([0.0, 0.0, -10.0], NO_TURN, Handle::NONE, 0);
    let row = world.lights.create(hidden, kind::POINT).unwrap();
    world.lights.set_value(row, value::RANGE, 1.0).unwrap();
    let group = world.object([0.0; 3], NO_TURN, Handle::NONE, flags::VISIBLE);
    let child = world.object([0.0, 0.0, -10.0], NO_TURN, group, flags::VISIBLE);
    world.lights.create(child, kind::AMBIENT).unwrap();
    let (layered, layered_row) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    world.commands.push(Command::set_layers(layered, 1 << 3));
    // A light whose object is reserved but not created yet.
    let reserved = world.scene.reserve().unwrap();
    world.lights.create(reserved, kind::AMBIENT).unwrap();
    let lit = world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [shown]);
    assert_eq!(
        lit.ambient, [1.0; 3],
        "the light under the group adds its white"
    );

    // Hiding the group hides the light under it; a view on layer 3 sees the layered light.
    world.commands.push(Command::set_visible(group, false));
    let view = LightView {
        layers: 1 << 3,
        ..origin_view()
    };
    let lit = world.frame(Some(&view));
    assert!(world.visible_rows().is_empty());
    assert_eq!(
        lit.ambient, [1.0; 3],
        "only the layered light adds its white"
    );
    world
        .lights
        .set_value(layered_row, value::INTENSITY, 0.5)
        .unwrap();
    assert_eq!(world.frame(Some(&view)).ambient, [0.5; 3]);

    // A destroyed light's row lights nothing, and its object may live on.
    world.lights.destroy(layered_row).unwrap();
    assert_eq!(world.frame(Some(&view)).ambient, [0.0; 3]);
}

#[test]
fn the_first_directional_light_created_that_is_shown_is_the_main_light() {
    let mut world = World::new();
    // Straight down, and turned a quarter about Y under a group: its -Z points along -X.
    let (first, first_row) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([1.0, 0.0, 0.0], -FRAC_PI_2),
    );
    let group = world.object(
        [5.0, 0.0, 0.0],
        turn([0.0, 1.0, 0.0], FRAC_PI_2),
        Handle::NONE,
        3,
    );
    let second = world.object([0.0; 3], NO_TURN, group, flags::VISIBLE);
    let second_row = world.lights.create(second, kind::DIRECTIONAL).unwrap();
    world
        .lights
        .set_value(first_row, value::INTENSITY, 3.0)
        .unwrap();
    world
        .lights
        .set_color(second_row, color::MAIN, [0.2, 0.4, 0.6])
        .unwrap();

    let lit = world.frame(Some(&origin_view()));
    assert_close(lit.sun_direction, [0.0, -1.0, 0.0]);
    assert_eq!(lit.sun_color, [3.0; 3]);

    world.commands.push(Command::set_visible(first, false));
    let lit = world.frame(Some(&origin_view()));
    assert_close(lit.sun_direction, [-1.0, 0.0, 0.0]);
    assert_eq!(lit.sun_color, [0.2, 0.4, 0.6]);

    // A light created later in the first light's old row does not come first.
    world.lights.destroy(first_row).unwrap();
    let (_, third_row) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    assert_eq!(third_row, first_row);
    let lit = world.frame(Some(&origin_view()));
    assert_eq!(lit.sun_color, [0.2, 0.4, 0.6]);

    // No directional light: no sun.
    world.lights.destroy(second_row).unwrap();
    world.lights.destroy(third_row).unwrap();
    assert_eq!(world.frame(None), FrameLights::default());
}

#[test]
fn directional_lights_after_the_first_fill_the_frame_in_creation_order() {
    let mut world = World::new();
    // The main light points straight down, and the others along -X, +X, +Y and -Z.
    let (_, main) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([1.0, 0.0, 0.0], -FRAC_PI_2),
    );
    world.lights.set_value(main, value::INTENSITY, 2.0).unwrap();
    let (_, left) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([0.0, 1.0, 0.0], FRAC_PI_2),
    );
    world
        .lights
        .set_color(left, color::MAIN, [0.25, 0.5, 1.0])
        .unwrap();
    let (_, right) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([0.0, 1.0, 0.0], -FRAC_PI_2),
    );
    world
        .lights
        .set_color(right, color::MAIN, [1.0, 0.5, 0.25])
        .unwrap();

    let lit = world.frame(Some(&origin_view()));
    assert_close(lit.sun_direction, [0.0, -1.0, 0.0]);
    assert_eq!(lit.sun_color, [2.0; 3]);
    assert_eq!(lit.fill_count, 2);
    assert_close(lit.fills[0].direction, [-1.0, 0.0, 0.0]);
    assert_eq!(lit.fills[0].color, [0.25, 0.5, 1.0]);
    assert_close(lit.fills[1].direction, [1.0, 0.0, 0.0]);
    assert_eq!(lit.fills[1].color, [1.0, 0.5, 0.25]);
    assert_eq!(lit.fills[2], FillLight::NONE);

    // Two more directional lights fill the remaining slot, and the one created last gives no
    // light.
    let (up, _) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([1.0, 0.0, 0.0], FRAC_PI_2),
    );
    let (_, back) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    let lit = world.frame(Some(&origin_view()));
    assert_eq!(lit.fill_count, 3);
    assert_close(lit.fills[2].direction, [0.0, 1.0, 0.0]);
    assert_eq!(lit.fills[2].color, [1.0; 3]);
    // The fifth directional light gives no light.
    assert!(
        lit.fills
            .iter()
            .all(|fill| fill.direction != [0.0, 0.0, -1.0])
    );
    assert_eq!(world.lights.value(back, value::INTENSITY).unwrap(), 1.0);

    // A hidden fill gives its slot to the light created after it.
    world.commands.push(Command::set_visible(up, false));
    let lit = world.frame(Some(&origin_view()));
    assert_eq!(lit.fill_count, 3);
    assert_close(lit.fills[2].direction, [0.0, 0.0, -1.0]);

    // A light created last in an earlier light's row keeps its creation order, so the fills stay
    // behind the lights created before it.
    world.lights.destroy(main).unwrap();
    let (_, later) = world.light(
        kind::DIRECTIONAL,
        [0.0; 3],
        turn([1.0, 0.0, 0.0], FRAC_PI_2),
    );
    assert_eq!(later, main);
    let lit = world.frame(Some(&origin_view()));
    assert_close(lit.sun_direction, [-1.0, 0.0, 0.0]);
    assert_eq!(lit.sun_color, [0.25, 0.5, 1.0]);
    assert_eq!(lit.fill_count, 3);
    assert_close(lit.fills[0].direction, [1.0, 0.0, 0.0]);
    assert_close(lit.fills[1].direction, [0.0, 0.0, -1.0]);
    assert_close(lit.fills[2].direction, [0.0, 1.0, 0.0]);

    // The exposure scales the fill's color with the main light's.
    world.exposure = 0.5;
    let lit = world.frame(Some(&origin_view()));
    assert_eq!(lit.sun_color, [0.125, 0.25, 0.5]);
    assert_eq!(lit.fills[0].color, [0.5, 0.25, 0.125]);
}

#[test]
fn ambient_lights_add_up() {
    let mut world = World::new();
    let (_, a) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    let (_, b) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    world
        .lights
        .set_color(a, color::MAIN, [0.5, 0.0, 0.25])
        .unwrap();
    world.lights.set_value(a, value::INTENSITY, 2.0).unwrap();
    world
        .lights
        .set_color(b, color::MAIN, [0.0, 0.5, 0.25])
        .unwrap();
    let lit = world.frame(None);
    assert_eq!(lit.ambient, [1.0, 0.5, 0.75]);
    assert_eq!(lit.sun_color, [0.0; 3]);
}

/// The light that the frame's ambient and hemisphere sums give a surface with unit normal `n`, as
/// the shaders add it up.
fn summed(lit: &FrameLights, n: [f32; 3]) -> [f32; 3] {
    std::array::from_fn(|c| {
        lit.ambient[c] + (0..3).map(|k| n[k] * lit.hemisphere[k][c]).sum::<f32>()
    })
}

/// three.js's light from one hemisphere light, `getHemisphereLightIrradiance`: from the ground
/// color to the sky color by the weight `0.5 * dot(n, up) + 0.5`.
fn blend(n: [f32; 3], up: [f32; 3], sky: [f32; 3], ground: [f32; 3]) -> [f32; 3] {
    let weight = 0.5 * (n[0] * up[0] + n[1] * up[1] + n[2] * up[2]) + 0.5;
    std::array::from_fn(|c| ground[c] + (sky[c] - ground[c]) * weight)
}

#[test]
fn hemisphere_lights_sum_to_three_js_blends_for_every_normal() {
    let mut world = World::new();
    let (_, ambient) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    world
        .lights
        .set_color(ambient, color::MAIN, [0.1, 0.0, 0.0])
        .unwrap();
    // A blue sky over brown ground, straight up, at an intensity of 2.
    let (upright_object, upright) = world.light(kind::HEMISPHERE, [0.0; 3], NO_TURN);
    let (sky, ground) = ([0.3, 0.5, 0.9], [0.4, 0.25, 0.1]);
    world.lights.set_color(upright, color::MAIN, sky).unwrap();
    world
        .lights
        .set_color(upright, color::GROUND, ground)
        .unwrap();
    world
        .lights
        .set_value(upright, value::INTENSITY, 2.0)
        .unwrap();
    // A second light, turned a quarter turn about Z, so that its sky lies along -X; its position
    // does not matter. Its colors stay white over white, which the default gives.
    let quarter = turn([0.0, 0.0, 1.0], FRAC_PI_2);
    let (tilted_object, tilted) = world.light(kind::HEMISPHERE, [5.0, -3.0, 2.0], quarter);
    world
        .lights
        .set_color(tilted, color::GROUND, [0.0, 0.2, 0.0])
        .unwrap();
    world.exposure = 0.5;
    let lit = world.frame(Some(&origin_view()));

    let scaled = |rgb: [f32; 3], by: f32| rgb.map(|v| v * by);
    let normals = [
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.6, 0.0, 0.8],
        [0.48, -0.6, 0.64],
    ];
    for n in normals {
        let first = blend(n, [0.0, 1.0, 0.0], scaled(sky, 1.0), scaled(ground, 1.0));
        let second = blend(n, [-1.0, 0.0, 0.0], [0.5; 3], [0.0, 0.1, 0.0]);
        let expected = std::array::from_fn(|c| [0.05, 0.0, 0.0][c] + first[c] + second[c]);
        assert_close(summed(&lit, n), expected);
    }
    // No point, spot or directional light came of them.
    assert!(world.lights.visible().is_empty());
    assert_eq!(lit.sun_color, [0.0; 3]);

    // Hidden, the hemisphere lights add nothing, and the axis colors return to zero.
    world
        .commands
        .push(Command::set_visible(upright_object, false));
    world
        .commands
        .push(Command::set_visible(tilted_object, false));
    let lit = world.frame(None);
    assert_close(lit.ambient, [0.05, 0.0, 0.0]);
    assert_eq!(lit.hemisphere, [[0.0; 3]; 3]);
}

#[test]
fn the_exposure_scales_every_color_that_the_frame_gets() {
    let mut world = World::new();
    let (_, sun) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    let (_, ambient) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    let point = world.ranged(kind::POINT, [0.0, 0.0, -10.0], 5.0);
    world
        .lights
        .set_value(sun, value::INTENSITY, 100_000.0)
        .unwrap();
    world
        .lights
        .set_value(ambient, value::INTENSITY, 0.5)
        .unwrap();
    world
        .lights
        .set_color(point, color::MAIN, [1.0, 0.5, 0.25])
        .unwrap();
    world
        .lights
        .set_value(point, value::INTENSITY, 8.0)
        .unwrap();
    // The exposure of EV100 15: a sun of 100,000 lux becomes about 2.5, which a 16-bit float holds.
    world.exposure = 1.0 / (1.2 * 2f32.powi(15));
    let lit = world.frame(Some(&origin_view()));
    let e = world.exposure;
    assert_close(lit.sun_color, [100_000.0 * e; 3]);
    assert!((2.5..2.6).contains(&lit.sun_color[0]));
    assert_close(lit.ambient, [0.5 * e; 3]);
    assert_close(world.lights.visible()[0].color, [8.0 * e, 4.0 * e, 2.0 * e]);
    // The table keeps the light's own numbers.
    assert_eq!(
        world.lights.value(sun, value::INTENSITY).unwrap(),
        100_000.0
    );
}

#[test]
fn light_positions_stay_exact_relative_to_a_camera_far_from_the_origin() {
    let mut world = World::new();
    // Near a million meters out, 32-bit floats step by 1/16 m, so these places are exact. The
    // boundary between two cells lies at 999,936 m.
    let near = world.ranged(kind::POINT, [999_950.5, 2.0, -30.0], 1.0);
    let across = world.ranged(kind::POINT, [999_930.0, 0.0, -30.0], 1.0);
    let _outside = world.ranged(kind::POINT, [999_990.0, 0.0, -30.0], 1.0);
    let (cell, local) = cells::split([999_940.25, 0.0, 0.0]);
    assert_ne!(cell, cells::cell_of([999_930.0, 0.0, 0.0]));
    world.frame(Some(&view_from(CellPosition { cell, local })));
    assert_eq!(world.visible_rows(), [near, across]);
    assert_eq!(world.lights.visible()[0].position, [10.25, 2.0, -30.0]);
    assert_eq!(world.lights.visible()[1].position, [-10.25, 0.0, -30.0]);
}

#[test]
fn the_main_light_reports_its_shadows_when_it_casts_them() {
    let mut world = World::new();
    let (sun, sun_row) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    let (other, _) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    let casts = |object| Command::set_flags(object, flags::CAST_SHADOWS, flags::CAST_SHADOWS);
    // A second directional light that casts shadows does not: only the main light does.
    world.commands.push(casts(other));
    assert_eq!(world.frame(Some(&origin_view())).sun_shadow, None);

    world.commands.push(casts(sun));
    world.commands.push(Command::set_layers(sun, 0b11));
    let shadow = world.frame(Some(&origin_view())).sun_shadow.unwrap();
    assert_eq!(
        (shadow.cascades, shadow.map_size, shadow.layers),
        (3, 2048, 0b11)
    );
    assert_eq!(
        (shadow.bias, shadow.normal_bias, shadow.distance),
        (0.01, 0.02, 0.0)
    );
    assert!(shadow.auto, "the default distance is automatic");

    for (code, number) in [
        (value::SHADOW_CASCADES, 2.0),
        (value::SHADOW_MAP_SIZE, 1024.0),
        (value::SHADOW_BIAS, 2.0),
        (value::SHADOW_NORMAL_BIAS, 0.25),
        (value::SHADOW_DISTANCE, 80.0),
    ] {
        world.lights.set_value(sun_row, code, number).unwrap();
    }
    let shadow = world.frame(Some(&origin_view())).sun_shadow.unwrap();
    assert_eq!((shadow.cascades, shadow.map_size), (2, 1024));
    assert_eq!(
        (shadow.bias, shadow.normal_bias, shadow.distance),
        (2.0, 0.25, 80.0)
    );
    // Cascade counts outside 1 to 4 clamp.
    world
        .lights
        .set_value(sun_row, value::SHADOW_CASCADES, 9.0)
        .unwrap();
    assert_eq!(world.frame(None).sun_shadow.unwrap().cascades, 4);
}

#[test]
fn a_light_without_a_named_distance_follows_the_farthest_visible_receiver() {
    let mut world = World::new();
    let (sun, row) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    world.commands.push(Command::set_flags(
        sun,
        flags::CAST_SHADOWS,
        flags::CAST_SHADOWS,
    ));
    let receiving = flags::VISIBLE | flags::RECEIVE_SHADOWS;
    let near = world.object([0.0, 0.0, -10.0], NO_TURN, Handle::NONE, receiving);
    let far = world.object([0.0, 0.0, -30.0], NO_TURN, Handle::NONE, receiving);
    // A caster that receives nothing does not set the distance.
    world.object(
        [0.0, 0.0, -600.0],
        NO_TURN,
        Handle::NONE,
        flags::VISIBLE | flags::CAST_SHADOWS,
    );
    // A hidden receiver does not either.
    let hidden = world.object([0.0, 0.0, -700.0], NO_TURN, Handle::NONE, receiving);
    world.commands.push(Command::set_visible(hidden, false));
    world.frame(Some(&origin_view()));
    // Give each receiver an own sphere: 2 m around a point 10 m out, and 5 m around one 30 m out.
    // The farthest sphere reaches 35 m, which rounds up to the ladder step 1.25^16.
    world.scene.set_local_radius(near, 2.0).unwrap();
    world.scene.set_local_radius(far, 5.0).unwrap();
    world.frame(Some(&origin_view()));
    let view = origin_view();
    let raw = farthest_receiver_distance(&world.scene, world.scene.parity(), &view);
    assert!((raw - 35.0).abs() < 0.5, "the farthest receiver, got {raw}");
    let held = ladder_distance(0.0, raw);
    assert!(
        (held - 35.527_115).abs() < 0.01,
        "the ladder step, got {held}"
    );
    // The gathered shadow is automatic, and its distance is left for the render worker to resolve.
    let shadow = world.frame(Some(&view)).sun_shadow.unwrap();
    assert!(shadow.auto, "the light names no distance");
    assert_eq!(shadow.distance, 0.0);
    // A named distance is kept, and it is no longer automatic.
    world
        .lights
        .set_value(row, value::SHADOW_DISTANCE, 80.0)
        .unwrap();
    let shadow = world.frame(Some(&view)).sun_shadow.unwrap();
    assert!(!shadow.auto);
    assert_eq!(shadow.distance, 80.0);
}

#[test]
fn new_lights_start_with_the_tables_defaults() {
    let mut world = World::new();
    let (_, before) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    world
        .lights
        .set_default(value::SHADOW_CASCADES, 2.0)
        .unwrap();
    world
        .lights
        .set_default(value::SHADOW_MAP_SIZE, 1024.0)
        .unwrap();
    let (_, after) = world.light(kind::DIRECTIONAL, [0.0; 3], NO_TURN);
    let numbers = |lights: &LightTable, row| {
        [value::SHADOW_CASCADES, value::SHADOW_MAP_SIZE]
            .map(|code| lights.value(row, code).unwrap())
    };
    // A light that exists keeps its numbers, and a new one starts with the new defaults.
    assert_eq!(numbers(&world.lights, before), [3.0, 2048.0]);
    assert_eq!(numbers(&world.lights, after), [2.0, 1024.0]);
    // A number of its own still wins.
    world
        .lights
        .set_value(after, value::SHADOW_CASCADES, 4.0)
        .unwrap();
    assert_eq!(numbers(&world.lights, after), [4.0, 1024.0]);
    assert!(world.lights.set_default(value::LAST + 1, 1.0).is_err());
}

#[test]
fn area_lights_wait_for_their_tables_then_join_the_visible_list_by_their_range_spheres() {
    let mut world = World::new();
    let point = world.ranged(kind::POINT, [0.0, 0.0, -10.0], 1.0);
    let rect = world.ranged(kind::RECT, [0.0, 2.0, -10.0], 5.0);
    let _behind = world.ranged(kind::TUBE, [0.0, 0.0, 10.0], 1.0);
    let tube = world.ranged(kind::TUBE, [1.0, 0.0, -20.0], 5.0);
    world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [point]);
    world.lights.set_area_ready(true);
    world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [point, rect, tube]);
    let visible = world.lights.visible();
    assert_eq!((visible[1].kind, visible[2].kind), (kind::RECT, kind::TUBE));
    assert_eq!(visible[1].position, [0.0, 2.0, -10.0]);
    assert_eq!(visible[1].range, 5.0);
    // Area lights cast no shadows, so their records hold no tile.
    assert_eq!(visible[1].shadow, 0.0);
    assert!(world.lights.shadows().is_empty());
}

#[test]
fn a_rectangle_light_records_its_half_sides_along_its_turned_axes() {
    let mut world = World::new();
    // A quarter turn about Y points the light's X axis along -Z.
    let (_, rect) = world.light(
        kind::RECT,
        [0.0, 0.0, -5.0],
        turn([0.0, 1.0, 0.0], FRAC_PI_2),
    );
    for (which, number) in [
        (value::RANGE, 8.0),
        (value::WIDTH, 4.0),
        (value::HEIGHT, 2.0),
        (value::INTENSITY, 3.0),
    ] {
        world.lights.set_value(rect, which, number).unwrap();
    }
    world.lights.set_area_ready(true);
    world.frame(Some(&origin_view()));
    let record = world.lights.visible()[0];
    // Half the width along the light's X axis, where a spot light keeps its direction.
    assert_close(record.direction, [0.0, 0.0, -2.0]);
    // Half the height along its Y axis, in the places of the decay and the cone cosines.
    assert_close(
        [record.decay, record.cone_cos, record.penumbra_cos],
        [0.0, 1.0, 0.0],
    );
    assert_close(record.color, [3.0, 3.0, 3.0]);
}

#[test]
fn a_tube_light_records_half_its_axis_and_its_radius_and_ignores_its_scale() {
    let mut world = World::new();
    let h = world.object([0.0, 0.0, -5.0], NO_TURN, Handle::NONE, flags::VISIBLE);
    world.scene.set_scale(h, [3.0, 3.0, 3.0]).unwrap();
    let tube = world.lights.create(h, kind::TUBE).unwrap();
    for (which, number) in [
        (value::RANGE, 8.0),
        (value::WIDTH, 2.0),
        (value::RADIUS, 0.05),
    ] {
        world.lights.set_value(tube, which, number).unwrap();
    }
    world.lights.set_area_ready(true);
    world.frame(Some(&origin_view()));
    let record = world.lights.visible()[0];
    // The tube runs along the light's -Z axis.
    assert_close(record.direction, [0.0, 0.0, -1.0]);
    assert_close(
        [record.decay, record.cone_cos, record.penumbra_cos],
        [0.05, 0.0, 0.0],
    );
}

#[test]
fn area_lights_start_one_meter_wide_and_high_with_a_thin_tube() {
    let mut world = World::new();
    let (_, rect) = world.light(kind::RECT, [0.0; 3], NO_TURN);
    let numbers = [value::WIDTH, value::HEIGHT, value::RADIUS, value::IMAGE]
        .map(|code| world.lights.value(rect, code).unwrap());
    assert_eq!(numbers, [1.0, 1.0, 0.025, 0.0]);
}

#[test]
fn a_rectangle_light_s_record_holds_its_image_layer_and_a_tube_takes_none() {
    let mut world = World::new();
    let rect = world.ranged(kind::RECT, [0.0, 0.0, -5.0], 8.0);
    let tube = world.ranged(kind::TUBE, [0.0, 1.0, -5.0], 8.0);
    world.lights.set_value(rect, value::IMAGE, 4.0).unwrap();
    world.lights.set_value(tube, value::IMAGE, 4.0).unwrap();
    world.lights.set_area_ready(true);
    world.frame(Some(&origin_view()));
    let images: Vec<f32> = world.lights.visible().iter().map(|l| l.image).collect();
    assert_eq!(images, [4.0, 0.0]);
}

/// A spot light with a map holds the map's layer, and the up axis that the map reads with: the
/// frame that a camera looking along the light with the world's up axis holds, as three.js turns the
/// camera that projects a spot light's map.
#[test]
fn a_spot_light_s_record_holds_its_map_s_layer_and_the_up_axis_it_reads_with() {
    let mut world = World::new();
    let (_, spot) = world.light(
        kind::SPOT,
        [0.0, 0.0, -5.0],
        turn([1.0, 0.0, 0.0], -FRAC_PI_2),
    );
    world.lights.set_value(spot, value::RANGE, 8.0).unwrap();
    world.lights.set_value(spot, value::IMAGE, 6.0).unwrap();
    world.frame(Some(&origin_view()));
    let [lit] = world.lights.visible() else {
        panic!("one spot light is visible")
    };
    assert_eq!(lit.image, 6.0);
    // The light points straight down: the world's up axis would tilt the frame, as three.js does,
    // so the map's up axis runs toward -Z, with the same thousandth of a tilt.
    assert!(
        lit.up[0].abs() < 1e-3 && lit.up[1].abs() < 1e-3 && (lit.up[2] + 1.0).abs() < 1e-3,
        "{:?}",
        lit.up
    );

    // A light turned to travel along +X keeps the world's +Y as its map's up axis.
    world
        .scene
        .set_rotation(
            world.lights.object(spot).unwrap(),
            turn([0.0, 1.0, 0.0], -FRAC_PI_2),
        )
        .unwrap();
    world.frame(Some(&origin_view()));
    let [lit] = world.lights.visible() else {
        panic!("one spot light is visible")
    };
    assert_close(lit.direction, [1.0, 0.0, 0.0]);
    assert_close(lit.up, [0.0, 1.0, 0.0]);
}

#[test]
fn another_view_gathers_the_lights_it_sees_and_leaves_the_camera_s_lists_alone() {
    let mut world = World::new();
    let ahead = world.ranged(kind::POINT, [0.0, 0.0, -10.0], 1.0);
    let behind = world.ranged(kind::POINT, [0.0, 0.0, 10.0], 1.0);
    let (layered, layered_row) = world.light(kind::POINT, [1.0, 0.0, 15.0], NO_TURN);
    world
        .lights
        .set_value(layered_row, value::RANGE, 1.0)
        .unwrap();
    world.commands.push(Command::set_layers(layered, 1 << 3));
    let (_, spot_row) = world.light(
        kind::SPOT,
        [0.0, 0.0, 5.0],
        turn([1.0, 0.0, 0.0], -FRAC_PI_2),
    );
    world.lights.set_value(spot_row, value::RANGE, 2.0).unwrap();
    world
        .lights
        .set_value(spot_row, value::ANGLE, FRAC_PI_4)
        .unwrap();
    world
        .lights
        .set_value(spot_row, value::INTENSITY, 3.0)
        .unwrap();
    world.exposure = 0.5;
    world.frame(Some(&origin_view()));
    assert_eq!(world.visible_rows(), [ahead]);

    // A second camera 20 m behind the first sees every light in front of it on its layers, at
    // positions relative to itself, as the camera's own gather would list them.
    let (cell, local) = cells::split([0.0, 0.0, 20.0]);
    let second = view_from(CellPosition { cell, local });
    let mut seen = Vec::with_capacity(world.lights.rows() as usize);
    let scene = &world.scene;
    world
        .lights
        .gather_view(scene, scene.parity(), &second, world.exposure, &mut seen);
    let rows: Vec<u32> = seen.iter().map(|l| l.light).collect();
    assert_eq!(rows, [ahead, behind, spot_row]);
    assert_close(seen[0].position, [0.0, 0.0, -30.0]);
    assert_close(seen[1].position, [0.0, 0.0, -10.0]);
    assert_close(seen[2].direction, [0.0, -1.0, 0.0]);
    assert_eq!(seen[2].color, [1.5; 3]);
    assert!((seen[2].cone_cos - FRAC_PI_4.cos()).abs() < 1e-6);
    assert!(seen.iter().all(|l| l.shadow == 0.0));
    // The camera's lists stay as its gather left them.
    assert_eq!(world.visible_rows(), [ahead]);

    // On layer 3, the second camera sees only the layered light.
    let layered_view = LightView {
        layers: 1 << 3,
        ..second
    };
    seen.clear();
    world
        .lights
        .gather_view(scene, scene.parity(), &layered_view, 1.0, &mut seen);
    let rows: Vec<u32> = seen.iter().map(|l| l.light).collect();
    assert_eq!(rows, [layered_row]);
}

#[test]
fn another_view_gathers_area_lights_once_their_tables_arrive() {
    let mut world = World::new();
    let rect = world.ranged(kind::RECT, [0.0, 2.0, 10.0], 4.0);
    let tube = world.ranged(kind::TUBE, [1.0, 0.0, 12.0], 4.0);
    world.lights.set_value(rect, value::IMAGE, 3.0).unwrap();
    world.frame(Some(&origin_view()));
    // A second camera 20 m behind the first, which sees both lights in front of it.
    let (cell, local) = cells::split([0.0, 0.0, 20.0]);
    let second = view_from(CellPosition { cell, local });
    let mut seen = Vec::with_capacity(world.lights.rows() as usize);
    let scene = &world.scene;
    world
        .lights
        .gather_view(scene, scene.parity(), &second, 1.0, &mut seen);
    assert!(seen.is_empty());

    world.lights.set_area_ready(true);
    let scene = &world.scene;
    world
        .lights
        .gather_view(scene, scene.parity(), &second, 1.0, &mut seen);
    let rows: Vec<u32> = seen.iter().map(|l| l.light).collect();
    assert_eq!(rows, [rect, tube]);
    assert_eq!((seen[0].kind, seen[1].kind), (kind::RECT, kind::TUBE));
    assert_close(seen[0].position, [0.0, 2.0, -10.0]);
    // The rectangle keeps its image's layer, and the tube its radius in the decay's place.
    assert_eq!((seen[0].image, seen[1].image), (3.0, 0.0));
    assert_eq!(seen[1].decay, 0.025);
}
