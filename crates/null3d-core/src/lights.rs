//! Lights: the light table, and the pass that finds each frame's lights for a view.
//!
//! # The table
//!
//! Every light is a scene object (see [`crate::scene`]), so it moves, turns, has a parent, hides
//! and joins layers as other objects do. Its row in the [`LightTable`] holds what the object does
//! not: the light's [`kind`], its object's handle, its linear color and intensity, and the values
//! of its kind (see [`value`] and [`color`]). Rows count from 1, so 0 names no light, and a
//! destroyed light's row goes to the next light created. The table grows when a light is created,
//! never during a frame.
//!
//! Directional and spot lights send their light along their object's -Z axis, the way a camera
//! looks. The sky of a hemisphere light lies along its object's +Y axis. A light's range and cone
//! ignore its object's scale, as three.js's do.
//!
//! # Each frame
//!
//! [`LightTable::gather`] reads the world output of the frame's parity, after the transform
//! update. It skips a light whose object is not created yet, is hidden by its own visibility or
//! an ancestor's, or shares no layer with the view. Of the others:
//!
//! - The directional light created first gives the frame's main light: the direction its light
//!   travels and its color times its intensity.
//! - Ambient lights add up.
//! - Each point or spot light is culled with its range sphere against the view's frustum, at its
//!   position relative to the view's camera. The offset from the camera to the light's grid cell
//!   is computed in 64-bit floats, so lights far from the origin keep their precision. Each light
//!   that survives writes a [`VisibleLight`] record to the visible list, in row order.
//!
//! Hemisphere lights are stored, and the frame does not read them yet.
//!
//! # Shadows
//!
//! The main directional light casts shadows when its object has the cast-shadows flag. The frame
//! then reports the light's shadow numbers (see [`value`]) and its layer mask, which selects the
//! casters. Point and spot lights store the flag, and cast no shadows yet.

use std::f32::consts::FRAC_PI_3;

use crate::cells::CellPosition;
use crate::culling::Frustum;
use crate::error::CoreError;
use crate::handle::Handle;
use crate::layers::{ALL_LAYERS, shares_layer};
use crate::scene::{SceneStorage, flags};
use crate::world::HIDDEN_RADIUS;

/// Kinds of light. A free row has kind [`kind::NONE`].
pub mod kind {
    /// A free row.
    pub const NONE: u32 = 0;
    /// Parallel light from one direction, as the sun gives.
    pub const DIRECTIONAL: u32 = 1;
    /// Light from a point in every direction, out to its range.
    pub const POINT: u32 = 2;
    /// Light from a point in a cone, out to its range.
    pub const SPOT: u32 = 3;
    /// Light from the sky above and the ground below.
    pub const HEMISPHERE: u32 = 4;
    /// The same light on every surface.
    pub const AMBIENT: u32 = 5;
}

/// The colors of a light, which [`LightTable::set_color`] writes.
pub mod color {
    /// The light's color: the sky color of a hemisphere light.
    pub const MAIN: u32 = 0;
    /// The ground color of a hemisphere light.
    pub const GROUND: u32 = 1;
}

/// The numbers of a light, which [`LightTable::set_value`] writes.
pub mod value {
    /// The factor that scales the color. The default is 1.
    pub const INTENSITY: u32 = 0;
    /// The distance in meters where a point or spot light ends.
    pub const RANGE: u32 = 1;
    /// How fast a point or spot light fades with distance: 2, the default, is the physical rate.
    pub const DECAY: u32 = 2;
    /// The angle in radians from a spot light's direction to the edge of its cone. The default is
    /// a third of pi, as in three.js.
    pub const ANGLE: u32 = 3;
    /// The part of a spot light's cone, from 0 to 1, over which its light fades out toward the
    /// edge. The default is 0.
    pub const PENUMBRA: u32 = 4;
    /// How far a receiver's depth moves toward a directional light before its shadow test, in
    /// texels of its cascade. The default is 0.5.
    pub const SHADOW_BIAS: u32 = 5;
    /// How far a receiver's point moves along its normal before its shadow test, in texels of its
    /// cascade. The default is 1.
    pub const SHADOW_NORMAL_BIAS: u32 = 6;
    /// The cascades of a directional light's shadows, from 1 to 4. The default is 3.
    pub const SHADOW_CASCADES: u32 = 7;
    /// Texels on each side of each cascade's shadow map. The default is 2,048.
    pub const SHADOW_MAP_SIZE: u32 = 8;
    /// The distance in meters from the camera, along its view, out to which a directional light's
    /// shadows fall. The default is 200.
    pub const SHADOW_DISTANCE: u32 = 9;
    /// The last number.
    pub const LAST: u32 = SHADOW_DISTANCE;
}

/// The numbers of a new light, by [`value`].
const DEFAULT_VALUES: [f32; value::LAST as usize + 1] =
    [1.0, 0.0, 2.0, FRAC_PI_3, 0.0, 0.5, 1.0, 3.0, 2048.0, 200.0];

/// The cone cosines of a point light's [`VisibleLight`] record. Every direction's cosine is above
/// both, so a shader that fades spot lights with a smooth step between them lets a point light's
/// light through in full.
pub const POINT_CONE: [f32; 2] = [-2.0, -1.0];

/// A visible point or spot light, as one frame's list holds it: 64 bytes, four groups of four
/// 32-bit values, ready for the GPU.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VisibleLight {
    /// The light's position relative to the view's camera.
    pub position: [f32; 3],
    /// The distance in meters where its light ends.
    pub range: f32,
    /// Its linear color times its intensity.
    pub color: [f32; 3],
    /// How fast its light fades with distance.
    pub decay: f32,
    /// The direction a spot light's light travels, of length 1; zero for a point light.
    pub direction: [f32; 3],
    /// The cosine of a spot light's cone angle, where its light ends ([`POINT_CONE`] for a point
    /// light).
    pub cone_cos: f32,
    /// The cosine of the angle where a spot light's penumbra starts, inside which its light is
    /// full.
    pub penumbra_cos: f32,
    /// The light's [`kind`].
    pub kind: u32,
    /// The light's row in the table.
    pub light: u32,
    /// Unused, so the record fills four groups of four values.
    pub unused: u32,
}

/// The view a frame's lights are gathered for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LightView {
    /// The view's camera: its cell, and its position in the cell.
    pub camera: CellPosition,
    /// The view's frustum, relative to its camera.
    pub frustum: Frustum,
    /// The view's layer mask: a light lights the view when its mask shares a layer with it.
    pub layers: u32,
}

/// What the directional and ambient lights give one frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameLights {
    /// The direction the main directional light's light travels, of length 1. Straight down when
    /// there is no main light.
    pub sun_direction: [f32; 3],
    /// The main directional light's linear color times its intensity: black when there is none.
    pub sun_color: [f32; 3],
    /// The sum of the ambient lights' linear colors times their intensities.
    pub ambient: [f32; 3],
    /// The main directional light's shadows, or `None` when it casts none or there is no main
    /// light.
    pub sun_shadow: Option<SunShadow>,
}

impl Default for FrameLights {
    fn default() -> Self {
        Self {
            sun_direction: [0.0, -1.0, 0.0],
            sun_color: [0.0; 3],
            ambient: [0.0; 3],
            sun_shadow: None,
        }
    }
}

/// The shadows of the main directional light, in a frame in which it casts them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SunShadow {
    /// Its cascades, from 1 to 4.
    pub cascades: u32,
    /// Texels on each side of each cascade's shadow map, at least 1.
    pub map_size: u32,
    /// Its bias, in texels of each cascade.
    pub bias: f32,
    /// Its normal bias, in texels of each cascade.
    pub normal_bias: f32,
    /// The distance along the camera's view out to which its shadows fall.
    pub distance: f32,
    /// The light's layer mask: its cascades draw the casters whose masks share a bit with it.
    pub layers: u32,
}

impl SunShadow {
    /// The shadows of a light with `values`, by [`value`], and the layer mask `layers`.
    fn of(values: &[f32; value::LAST as usize + 1], layers: u32) -> Self {
        let whole = |code: u32, low: f32, high: f32| values[code as usize].clamp(low, high) as u32;
        Self {
            cascades: whole(value::SHADOW_CASCADES, 1.0, 4.0),
            map_size: whole(value::SHADOW_MAP_SIZE, 1.0, 16_384.0),
            bias: values[value::SHADOW_BIAS as usize],
            normal_bias: values[value::SHADOW_NORMAL_BIAS as usize],
            distance: values[value::SHADOW_DISTANCE as usize],
            layers,
        }
    }
}

/// One light's row: see the module documentation.
#[derive(Clone, Copy, Debug)]
struct Row {
    kind: u32,
    object: Handle,
    /// The order in which the light was created, which picks the main directional light.
    order: u32,
    /// Linear colors, by [`color`].
    colors: [[f32; 3]; 2],
    /// Numbers, by [`value`].
    values: [f32; value::LAST as usize + 1],
}

impl Row {
    /// A row that holds no light.
    const FREE: Row = Row {
        kind: kind::NONE,
        object: Handle::NONE,
        order: 0,
        colors: [[0.0; 3]; 2],
        values: [0.0; value::LAST as usize + 1],
    };
}

/// The scene's lights, one row each. See the module documentation.
#[derive(Debug)]
pub struct LightTable {
    /// Row 0 holds no light, so no light has the id 0.
    rows: Vec<Row>,
    free: Vec<u32>,
    created: u32,
    visible: Vec<VisibleLight>,
}

impl Default for LightTable {
    fn default() -> Self {
        Self::new()
    }
}

impl LightTable {
    /// An empty table.
    pub fn new() -> Self {
        Self {
            rows: vec![Row::FREE],
            free: Vec::new(),
            created: 0,
            visible: Vec::new(),
        }
    }

    /// One past the highest row: loops over rows stop here.
    pub fn rows(&self) -> u32 {
        self.rows.len() as u32
    }

    /// The number of lights.
    pub fn len(&self) -> u32 {
        self.rows() - 1 - self.free.len() as u32
    }

    /// True when the table holds no light.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Adds a light of `kind` for the scene object `object`, white with an intensity of 1 and the
    /// defaults of [`value`], and returns its row. Fails with [`CoreError::OutOfRange`] for a kind
    /// that [`kind`] does not name, and with [`CoreError::OutOfMemory`] when memory cannot grow.
    pub fn create(&mut self, object: Handle, light_kind: u32) -> Result<u32, CoreError> {
        if light_kind == kind::NONE || light_kind > kind::AMBIENT {
            return Err(CoreError::OutOfRange {
                value: light_kind,
                limit: kind::AMBIENT,
            });
        }
        let row = match self.free.pop() {
            Some(row) => row,
            None => {
                self.grow()?;
                self.rows() - 1
            }
        };
        self.rows[row as usize] = Row {
            kind: light_kind,
            object,
            order: self.created,
            colors: [[1.0; 3]; 2],
            values: DEFAULT_VALUES,
        };
        self.created = self.created.wrapping_add(1);
        Ok(row)
    }

    /// Adds a free row at the end, with room in the free list and the visible list for every row.
    fn grow(&mut self) -> Result<(), CoreError> {
        let rows = self.rows.len() + 1;
        let out_of_memory = |_| CoreError::OutOfMemory {
            bytes: u32::try_from(rows * (size_of::<Row>() + size_of::<VisibleLight>()))
                .unwrap_or(u32::MAX),
        };
        self.free
            .try_reserve(rows - self.free.len())
            .map_err(out_of_memory)?;
        self.visible
            .try_reserve(rows - self.visible.len())
            .map_err(out_of_memory)?;
        self.rows.try_reserve(1).map_err(out_of_memory)?;
        self.rows.push(Row::FREE);
        Ok(())
    }

    /// The row of a light, or [`CoreError::InvalidHandle`] for a row that holds none.
    fn row(&self, light: u32) -> Result<&Row, CoreError> {
        self.rows
            .get(light as usize)
            .filter(|row| row.kind != kind::NONE)
            .ok_or(CoreError::InvalidHandle { raw: light })
    }

    fn row_mut(&mut self, light: u32) -> Result<&mut Row, CoreError> {
        self.rows
            .get_mut(light as usize)
            .filter(|row| row.kind != kind::NONE)
            .ok_or(CoreError::InvalidHandle { raw: light })
    }

    /// Frees a light's row, for the next light created.
    pub fn destroy(&mut self, light: u32) -> Result<(), CoreError> {
        *self.row_mut(light)? = Row::FREE;
        // The table reserved room for every row when it grew.
        self.free.push(light);
        Ok(())
    }

    /// The kind of a light, or [`kind::NONE`] for a row that holds none.
    pub fn kind(&self, light: u32) -> u32 {
        self.rows
            .get(light as usize)
            .map_or(kind::NONE, |row| row.kind)
    }

    /// The scene object of a light.
    pub fn object(&self, light: u32) -> Result<Handle, CoreError> {
        Ok(self.row(light)?.object)
    }

    /// Sets one of a light's linear colors, by [`color`].
    pub fn set_color(&mut self, light: u32, which: u32, rgb: [f32; 3]) -> Result<(), CoreError> {
        let colors = &mut self.row_mut(light)?.colors;
        *colors
            .get_mut(which as usize)
            .ok_or(past(which, color::GROUND))? = rgb;
        Ok(())
    }

    /// A light's linear color, by [`color`].
    pub fn color(&self, light: u32, which: u32) -> Result<[f32; 3], CoreError> {
        let colors = &self.row(light)?.colors;
        colors
            .get(which as usize)
            .copied()
            .ok_or(past(which, color::GROUND))
    }

    /// Sets one of a light's numbers, by [`value`].
    pub fn set_value(&mut self, light: u32, which: u32, number: f32) -> Result<(), CoreError> {
        let values = &mut self.row_mut(light)?.values;
        *values
            .get_mut(which as usize)
            .ok_or(past(which, value::LAST))? = number;
        Ok(())
    }

    /// One of a light's numbers, by [`value`].
    pub fn value(&self, light: u32, which: u32) -> Result<f32, CoreError> {
        let values = &self.row(light)?.values;
        values
            .get(which as usize)
            .copied()
            .ok_or(past(which, value::LAST))
    }

    /// The point and spot lights that the last [`LightTable::gather`] found visible, in row order.
    pub fn visible(&self) -> &[VisibleLight] {
        &self.visible
    }

    /// Gathers the lights of the frame whose world output is `parity`'s, for `view`, or for no
    /// view: then every layer counts, and the visible list stays empty. See the module
    /// documentation. It allocates nothing.
    pub fn gather(
        &mut self,
        scene: &SceneStorage,
        parity: usize,
        view: Option<&LightView>,
    ) -> FrameLights {
        let mut frame = FrameLights::default();
        let mut main_order = None;
        self.visible.clear();
        let layers = view.map_or(ALL_LAYERS, |v| v.layers);
        let world = scene.world(parity);
        for (index, row) in self.rows.iter().enumerate().skip(1) {
            if row.kind == kind::NONE {
                continue;
            }
            let Some(slot) = lit_slot(scene, row.object) else {
                continue;
            };
            let s = slot as usize;
            if world.radii()[s] == HIDDEN_RADIUS || !shares_layer(scene.layers()[s], layers) {
                continue;
            }
            let [intensity, range, decay, angle, penumbra, ..] = row.values;
            let lit = row.colors[color::MAIN as usize].map(|c| c * intensity);
            match row.kind {
                kind::AMBIENT => {
                    for (sum, add) in frame.ambient.iter_mut().zip(lit) {
                        *sum += add;
                    }
                }
                kind::DIRECTIONAL => {
                    if main_order.is_none_or(|main| row.order < main) {
                        main_order = Some(row.order);
                        frame.sun_direction = forward(world.matrix(s));
                        frame.sun_color = lit;
                        let casts = scene.flags()[s] & flags::CAST_SHADOWS != 0;
                        frame.sun_shadow =
                            casts.then(|| SunShadow::of(&row.values, scene.layers()[s]));
                    }
                }
                kind::POINT | kind::SPOT => {
                    let Some(view) = view else {
                        continue;
                    };
                    let position = scene.cell_position(slot, parity);
                    let offset = view.camera.offset_to(position.cell);
                    let at: [f32; 3] = std::array::from_fn(|k| offset[k] + position.local[k]);
                    if !view.frustum.contains_sphere(at[0], at[1], at[2], range) {
                        continue;
                    }
                    let (direction, cone_cos, penumbra_cos) = if row.kind == kind::SPOT {
                        let inner = angle * (1.0 - penumbra);
                        (forward(world.matrix(s)), cosine(angle), cosine(inner))
                    } else {
                        ([0.0; 3], POINT_CONE[0], POINT_CONE[1])
                    };
                    // The table reserved room for every row when it grew.
                    self.visible.push(VisibleLight {
                        position: at,
                        range,
                        color: lit,
                        decay,
                        direction,
                        cone_cos,
                        penumbra_cos,
                        kind: row.kind,
                        light: index as u32,
                        unused: 0,
                    });
                }
                _ => {}
            }
        }
        frame
    }
}

/// The error for a color or number code past the last one, `limit`.
fn past(code: u32, limit: u32) -> CoreError {
    CoreError::OutOfRange { value: code, limit }
}

/// The cosine of an angle, through the 64-bit cosine that the engine's geometry already uses, so
/// the core's download carries one cosine.
fn cosine(angle: f32) -> f32 {
    f64::from(angle).cos() as f32
}

/// The slot of a light's object, or `None` before the frame that creates the object.
fn lit_slot(scene: &SceneStorage, object: Handle) -> Option<u32> {
    scene
        .is_created(object)
        .then(|| scene.resolve(object).ok())
        .flatten()
}

/// The direction of a world matrix's -Z axis, of length 1: the way a light points. Straight down
/// when the matrix flattens the axis.
fn forward(m: &[f32; 12]) -> [f32; 3] {
    let axis = [-m[2], -m[6], -m[10]];
    let length = axis.iter().map(|v| v * v).sum::<f32>().sqrt();
    if length > 0.0 && length.is_finite() {
        axis.map(|v| v / length)
    } else {
        [0.0, -1.0, 0.0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rows_count_from_one_and_come_back_after_a_destroy() {
        let mut table = LightTable::new();
        assert!(table.is_empty());
        let a = table.create(Handle::new(4, 0), kind::POINT).unwrap();
        let b = table.create(Handle::new(5, 0), kind::SPOT).unwrap();
        assert_eq!((a, b), (1, 2));
        assert_eq!((table.len(), table.rows()), (2, 3));
        table.destroy(a).unwrap();
        assert_eq!(table.kind(a), kind::NONE);
        assert_eq!(table.len(), 1);
        let c = table.create(Handle::new(6, 0), kind::AMBIENT).unwrap();
        assert_eq!(c, a);
        assert_eq!(table.object(c).unwrap(), Handle::new(6, 0));
        assert_eq!(table.kind(c), kind::AMBIENT);
    }

    #[test]
    fn a_new_light_is_white_with_three_js_defaults() {
        let mut table = LightTable::new();
        let spot = table.create(Handle::new(1, 0), kind::SPOT).unwrap();
        assert_eq!(table.color(spot, color::MAIN).unwrap(), [1.0; 3]);
        assert_eq!(table.color(spot, color::GROUND).unwrap(), [1.0; 3]);
        assert_eq!(table.value(spot, value::INTENSITY).unwrap(), 1.0);
        assert_eq!(table.value(spot, value::DECAY).unwrap(), 2.0);
        assert_eq!(table.value(spot, value::ANGLE).unwrap(), FRAC_PI_3);
        assert_eq!(table.value(spot, value::PENUMBRA).unwrap(), 0.0);
    }

    #[test]
    fn values_and_colors_land_in_their_fields() {
        let mut table = LightTable::new();
        let light = table.create(Handle::new(1, 0), kind::HEMISPHERE).unwrap();
        table
            .set_color(light, color::MAIN, [0.1, 0.2, 0.3])
            .unwrap();
        table
            .set_color(light, color::GROUND, [0.4, 0.5, 0.6])
            .unwrap();
        for (which, number) in [(0, 2.5), (1, 12.0), (2, 1.5), (3, 0.4), (4, 0.25)] {
            table.set_value(light, which, number).unwrap();
        }
        assert_eq!(table.color(light, color::MAIN).unwrap(), [0.1, 0.2, 0.3]);
        assert_eq!(table.color(light, color::GROUND).unwrap(), [0.4, 0.5, 0.6]);
        for (which, number) in [(0, 2.5), (1, 12.0), (2, 1.5), (3, 0.4), (4, 0.25)] {
            assert_eq!(table.value(light, which).unwrap(), number);
        }
    }

    #[test]
    fn calls_on_rows_without_a_light_fail() {
        let mut table = LightTable::new();
        let light = table.create(Handle::new(1, 0), kind::POINT).unwrap();
        assert_eq!(
            table.create(Handle::new(2, 0), 9),
            Err(CoreError::OutOfRange { value: 9, limit: 5 })
        );
        assert_eq!(
            table.create(Handle::new(2, 0), kind::NONE),
            Err(CoreError::OutOfRange { value: 0, limit: 5 })
        );
        assert_eq!(
            table.set_value(light, 10, 1.0),
            Err(CoreError::OutOfRange {
                value: 10,
                limit: 9
            })
        );
        assert_eq!(
            table.set_color(light, 2, [1.0; 3]),
            Err(CoreError::OutOfRange { value: 2, limit: 1 })
        );
        table.destroy(light).unwrap();
        for bad in [0, light, 7] {
            let invalid = Err(CoreError::InvalidHandle { raw: bad });
            assert_eq!(table.destroy(bad), invalid);
            assert_eq!(table.set_value(bad, value::RANGE, 1.0), invalid);
            assert_eq!(table.set_color(bad, color::MAIN, [1.0; 3]), invalid);
        }
    }

    #[test]
    fn forward_is_the_minus_z_axis_of_length_one() {
        // A quarter turn back about X points -Z straight down; a scale of 3 does not lengthen it.
        let m = [
            3.0, 0.0, 0.0, 5.0, //
            0.0, 0.0, 3.0, 6.0, //
            0.0, -3.0, 0.0, 7.0,
        ];
        assert_eq!(forward(&m), [0.0, -1.0, 0.0]);
        assert_eq!(forward(&[0.0; 12]), [0.0, -1.0, 0.0]);
    }
}
