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
    FrameLights, LightShadow, LightTable, LightView, NOT_VISIBLE, POINT_CONE, VisibleLight, color,
    kind, value,
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
}

impl World {
    fn new() -> Self {
        Self {
            scene: SceneStorage::with_capacity(64),
            lights: LightTable::new(),
            commands: Vec::new(),
            frame: 0,
            jobs: JobSystem::new(0),
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
        self.lights.gather(&self.scene, self.scene.parity(), view)
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
    assert_eq!((s.bias, s.normal_bias), (2.0, 1.0));
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
            bias: 0.5,
            normal_bias: 1.0,
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
        }
    );
    // A quarter turn back about X points the spot light straight down.
    assert_close(s.direction, [0.0, -1.0, 0.0]);
    assert_eq!(s.color, [2.0, 1.0, 4.0]);
    assert_eq!((s.range, s.decay), (6.0, 1.0));
    assert!((s.cone_cos - FRAC_PI_4.cos()).abs() < 1e-6);
    assert!((s.penumbra_cos - FRAC_PI_8.cos()).abs() < 1e-6);
    assert_eq!(size_of::<VisibleLight>(), 64);
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
fn ambient_lights_add_up() {
    let mut world = World::new();
    let (_, a) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    let (_, b) = world.light(kind::AMBIENT, [0.0; 3], NO_TURN);
    world.light(kind::HEMISPHERE, [0.0; 3], NO_TURN);
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
        (0.5, 1.0, 200.0)
    );

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
