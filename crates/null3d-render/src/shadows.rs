//! Directional light shadows: the cascades that split the camera's view by distance, each drawn
//! from the light into one layer of the shadow map.
//!
//! # Cascades
//!
//! The camera's view, from its near plane out to the shadow distance, splits into slices along its
//! view axis. A perspective camera's near slices are short and its far slices long, so each slice
//! covers about the same share of the screen: the split distances blend a logarithmic spread with
//! an even one. An orthographic camera's slices are even, as each covers the same width. Each slice
//! is a cascade: an orthographic view along the light's direction whose square box holds the
//! sphere around the slice's eight corners.
//!
//! # Stable cascades
//!
//! A slice's sphere depends only on the lens and the split distances, so a box keeps its size as
//! the camera turns, and so do its texels. The box's center snaps to whole texels of a grid that
//! the world's origin fixes, along the light's axes. As the camera moves, a box then moves in
//! whole texels, every caster covers the same texels, and shadow edges stay still instead of
//! shimmering. The snap works in 64-bit floats from the camera's cell, so it holds far from the
//! origin.
//!
//! Every matrix takes positions relative to the camera, as every shader works, so cascades keep
//! their precision far from the origin.
//!
//! # Casters in front of a cascade
//!
//! The box reaches toward the light past the slice by a margin, so casters between the light and
//! the slice draw into the cascade. Casters beyond the margin draw too: a cascade's culling has no
//! plane on the light's side, and the depth-only vertex shader flattens such casters onto the
//! box's face toward the light, where they hide everything behind them. The depth range grows with
//! the margin, but receivers sit near depth 0 of reversed depth, where floats are most precise.
//!
//! # Update schedule
//!
//! The nearest cascade draws in every frame. The far cascades draw once every few frames, in turn,
//! and keep their layers of the map in between ([`CascadeSchedule`]). A cascade that skips a
//! frame keeps the box it last drew with, fixed in the world, and its matrix follows the camera
//! from that box. Receivers therefore read each layer with the matrix it was drawn with. A kept box
//! that no longer holds its fresh slice, as after a camera cut, draws out of turn, so no part of
//! the view is left without a cascade.
//!
//! A kept layer holds its casters where they stood when it drew, so a caster that moves in every
//! frame would leave its shadow behind. A far cascade therefore draws in every frame while a
//! moving caster ([`MovingCasters`]) touches its box, or touched the box when its layer drew. Only
//! far cascades whose boxes hold still casters alone keep their layers.
//!
//! # Receivers
//!
//! Behind a perspective camera, a receiver finds its cascade by its distance from the camera, which
//! stays the same while the camera turns on the spot, so a point keeps its cascade and its shadow.
//! Behind an orthographic camera it uses its distance along the camera's view. The camera's scaled
//! forward axis gives both from a position relative to the camera. A box that skipped frames may
//! not hold a receiver after the camera turned, and the receiver then takes the next cascade whose
//! box holds it. It moves its point along its normal by [`ShadowSettings::normal_bias`] and toward
//! the light by [`ShadowSettings::bias`], both in meters, up to one texel of its cascade, and both
//! scaled by its angle to the light. Offsets in meters keep their size from one cascade to the next.
//! It then compares its depth with the shadow map's over a square of [`ShadowSettings::filter`]
//! texels on each side.
//! Past the shadow distance, in meters whatever the camera's scale, nothing is shadowed, and
//! shadows fade out over the last tenth of the distance.
//!
//! A point near a perspective view's side lies further from the camera than along its view. So a
//! slice's sphere holds every point of the view whose distance from the camera falls in the slice:
//! it starts along the view where the view's corners reach the slice's start.
//!
//! # Blending between cascades
//!
//! Over a band at the far end of each cascade but the last, a receiver blends its cascade's shadow
//! with the next one's, so no line shows where one cascade hands over to the next. The band is a
//! share of the cascade's length ([`ShadowSettings::blend`]). Each cascade's slice starts at the
//! band of the cascade before it, so its box holds the band's receivers too.

use null3d_core::cells::{CELL_SIZE, CellPosition};
use null3d_core::culling::Frustum;
use null3d_core::scene::{NO_PARENT, SceneStorage, flags};
use null3d_gpu::drawlist::sizes::SHADOW_UNIFORM_BYTES;
use null3d_gpu::drawlist::{DrawList, Op, address, buffer_usage, compare, filter, format};

use crate::camera::{Affine, Lens, Mat4, ViewDepth};
use crate::frame::{RecordError, UploadArena};
use crate::frame_data::FrameUniform;
use crate::pipelines::PassTargets;
use crate::view::ViewFrame;

/// The most cascades a directional light's shadow map has.
pub const MAX_CASCADES: usize = 4;

/// The longest far cascade update interval, in frames.
pub const MAX_INTERVAL: u32 = 8;

/// How far the split distances lean from an even spread toward a logarithmic one, from 0 to 1: the
/// practical split of Zhang et al. A higher value gives the ground just in front of the camera
/// finer texels, which a camera at eye height needs, and the middle distance coarser ones, where a
/// camera high above the ground sees most of it. The value sits a little past halfway, where
/// three.js's cascaded shadows split: halfway made the shadows at eye height visibly coarse, and
/// this value gives the middle distance most of halfway's texels. The shadows docs page gives the
/// texel sizes behind the choice.
const SPLIT_LAMBDA: f32 = 0.65;

/// The share of each cascade's length over which it blends into the next cascade, by default.
pub const DEFAULT_BLEND: f32 = 0.1;

/// The largest share of a cascade's length that blends into the next cascade.
pub const MAX_BLEND: f32 = 0.5;

/// The steps that a box's radius rounds up to, as a share of the radius: fine enough to waste no
/// texels, and coarse enough that rounding in the camera's scale never changes the radius.
const RADIUS_STEPS: f32 = 1024.0;

/// A directional light's shadow settings, as its options and the quality settings give them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowSettings {
    /// The cascades, from 1 to [`MAX_CASCADES`].
    pub cascades: u32,
    /// Texels on each side of each cascade's layer of the shadow map.
    pub map_size: u32,
    /// How far each receiver's point moves toward the light before the lookup, in meters, up to one
    /// texel of its cascade.
    pub bias: f32,
    /// How far each receiver's point moves along its normal before the lookup, in meters, up to one
    /// texel of its cascade.
    pub normal_bias: f32,
    /// The distance along the camera's view, in meters, out to which shadows fall, whatever the
    /// camera's scale. The camera's far plane ends them sooner.
    pub distance: f32,
    /// The texels on each side of the square of comparisons that blend into each receiver's
    /// shadow: 3 or 5. A smaller value gives the hardware's blend of the four nearest texels.
    pub filter: u32,
    /// The share of each cascade's length, at its far end, over which receivers blend its shadow
    /// with the next cascade's, from 0 to [`MAX_BLEND`]. 0 hands over at once.
    pub blend: f32,
}

/// The shadow settings that the quality settings give every light: the filter's size, how often
/// far cascades draw, whether moving casters make them draw in every frame, and the band over which
/// one cascade blends into the next.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowQuality {
    /// The texels on each side of the square of comparisons that blend into each receiver's
    /// shadow: 3 or 5.
    pub filter: u32,
    /// Far cascades draw once in this many frames, from 1 to [`MAX_INTERVAL`].
    pub far_interval: u32,
    /// True when a far cascade draws in every frame while a moving caster touches it, so moving
    /// shadows follow their casters. False keeps every far cascade to its turns, and a moving
    /// caster's shadow there stays where the layer last drew it until the next turn.
    pub follow_movers: bool,
    /// The share of each cascade's length over which it blends into the next cascade
    /// ([`ShadowSettings::blend`]).
    pub blend: f32,
}

impl Default for ShadowQuality {
    fn default() -> Self {
        Self {
            filter: 3,
            far_interval: 1,
            follow_movers: true,
            blend: DEFAULT_BLEND,
        }
    }
}

impl ShadowSettings {
    /// The number of cascades, within 1 to [`MAX_CASCADES`].
    pub fn cascade_count(&self) -> usize {
        (self.cascades as usize).clamp(1, MAX_CASCADES)
    }
}

/// A cascade's box, fixed in the world: a square across the light around the sphere of its slice,
/// which reaches toward the light past the sphere by a margin.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CascadeBox {
    /// The light's axes: x and y across its view, and z toward the light.
    pub axes: [[f32; 3]; 3],
    /// The sphere's center along each of the light's axes, from the world's origin, with x and y
    /// on whole texels.
    pub center: [f64; 3],
    /// The sphere's radius: half the box's side.
    pub radius: f32,
    /// How far the box reaches toward the light past the sphere.
    pub margin: f32,
}

impl CascadeBox {
    /// True when a sphere at `center` from the world's origin, of radius `radius`, draws into the
    /// box: it reaches into the box across the light, and is not wholly beyond its far face.
    /// Spheres past the face toward the light count, as they draw flattened onto that face.
    pub fn touches(&self, center: [f64; 3], radius: f32) -> bool {
        let reach = f64::from(self.radius) + f64::from(radius);
        let along = |k: usize| dot_far(center, self.axes[k]) - self.center[k];
        along(0).abs() <= reach && along(1).abs() <= reach && along(2) >= -reach
    }
}

/// One cascade in one frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cascade {
    /// The matrix from positions relative to the camera into the cascade's clip space. Depth is
    /// reversed: 1 at the box's face toward the light, 0 at its far face.
    pub view_proj: Mat4,
    /// The frustum that culls the cascade's casters, relative to the camera: the box's four sides
    /// and its far face. It has no plane on the light's side.
    pub frustum: Frustum,
    /// The distance along the camera's view where the cascade's slice ends.
    pub end: f32,
    /// Where the cascade's band starts, as receivers measure their distance to pick a cascade:
    /// past it, a receiver blends this cascade's shadow with the next one's. The last cascade's
    /// band starts at its end, as it has none.
    pub band: f32,
    /// The corners of the part of the camera's view that the cascade's box must hold, relative to
    /// the camera that draws: four where the slice starts along the view, then four where it ends.
    pub corners: [[f32; 3]; 8],
    /// The size in meters of one texel of the cascade's layer.
    pub texel: f32,
    /// The change in depth over one meter along the light's direction.
    pub depth_per_meter: f32,
    /// The box in the world that the matrix maps.
    pub bounds: CascadeBox,
}

impl Default for Cascade {
    fn default() -> Self {
        Self {
            view_proj: [0.0; 16],
            frustum: Frustum::from_planes([[0.0; 4]; 6]),
            end: 0.0,
            band: 0.0,
            corners: [[0.0; 3]; 8],
            texel: 0.0,
            depth_per_meter: 0.0,
            bounds: CascadeBox::default(),
        }
    }
}

/// The cascades of one frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Cascades {
    /// The cascades in use, nearest first.
    pub count: usize,
    pub cascades: [Cascade; MAX_CASCADES],
    /// The vector whose dot product with a position relative to the camera gives the position's
    /// distance along the camera's view.
    pub forward: [f32; 3],
    /// True when receivers pick their cascade by their distance from the camera, as behind a
    /// perspective camera, and false when by their distance along its view.
    pub by_distance: bool,
    /// The camera that draws, relative to the camera that fitted the cascades. A position relative
    /// to the camera that draws plus this vector is the position relative to the fitting camera,
    /// whose distances pick each receiver's cascade. It is 0 unless another camera fitted them
    /// (see [`Cascades::seen_from`]).
    pub origin: [f32; 3],
}

impl Cascades {
    /// The cascades in use, nearest first.
    pub fn used(&self) -> &[Cascade] {
        &self.cascades[..self.count]
    }

    /// Moves cascades that a camera at `fitted` from the world's origin fitted to the camera that
    /// draws, at `position`, with `map_size` texels on each side of each layer. Each cascade keeps
    /// its box, fixed in the world, and its matrix takes positions relative to the camera that
    /// draws. Receivers still find their cascade by their distance from the fitting camera, or
    /// along its view, so the cascades fall where they fall in that camera's own frames. The debug
    /// API's shadow camera draws them this way, so a still camera can watch how they move.
    pub fn seen_from(&mut self, fitted: [f64; 3], position: [f64; 3], map_size: u32) {
        let map_size = map_size.max(1) as f32;
        self.origin = std::array::from_fn(|k| (position[k] - fitted[k]) as f32);
        for cascade in &mut self.cascades[..self.count] {
            let bounds = cascade.bounds;
            cascade.place(&bounds, position, map_size);
            for corner in &mut cascade.corners {
                *corner = std::array::from_fn(|k| corner[k] - self.origin[k]);
            }
        }
    }
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/// The dot product of a position from the world's origin with an axis, in 64-bit floats.
fn dot_far(a: [f64; 3], b: [f32; 3]) -> f64 {
    a[0] * f64::from(b[0]) + a[1] * f64::from(b[1]) + a[2] * f64::from(b[2])
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let length = dot(v, v).sqrt();
    v.map(|x| x / length)
}

/// The light's axes: x and y across its view, and z toward the light, against the direction its
/// light travels. `direction` has length 1.
fn light_axes(direction: [f32; 3]) -> [[f32; 3]; 3] {
    let z = direction.map(|v| -v);
    // Any axis across the light works; the world's up keeps it steady while the light turns, and
    // the world's x stands in when the light shines straight up or down.
    let up = if z[1].abs() < 0.99 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let x = normalize(cross(up, z));
    let y = cross(z, x);
    [x, y, z]
}

/// The distances along a perspective camera's view where each of `count` slices from `near` to
/// `end` ends. `near` is above 0. `lambda` leans them from an even spread, at 0, toward a
/// logarithmic one, at 1.
pub fn split_distances(near: f32, end: f32, count: usize, lambda: f32) -> [f32; MAX_CASCADES] {
    let mut splits = [end; MAX_CASCADES];
    for (i, split) in splits.iter_mut().enumerate().take(count) {
        let share = (i + 1) as f32 / count as f32;
        let even = near + (end - near) * share;
        let logarithmic = if lambda > 0.0 {
            near * (end / near).powf(share)
        } else {
            even
        };
        *split = lambda * logarithmic + (1.0 - lambda) * even;
    }
    // The last slice ends exactly at the shadow distance, whatever the rounding.
    splits[count - 1] = end;
    splits
}

/// The view-space x and y of the corner (`sx`, `sy`) of a lens's view at `distance` along it, for
/// a target of `aspect`: -1 and 1 are the view's edges.
fn view_corner(lens: &Lens, aspect: f32, distance: f32, sx: f32, sy: f32) -> (f32, f32) {
    match lens {
        Lens::Perspective(lens) => {
            let tan_y = (lens.fov_degrees.to_radians() / 2.0).tan();
            (sx * tan_y * aspect * distance, sy * tan_y * distance)
        }
        Lens::Orthographic(lens) => {
            let half_height = lens.height / 2.0;
            let half_width = lens.width.unwrap_or(lens.height * aspect) / 2.0;
            let [x, y] = lens.center;
            (x + sx * half_width, y + sy * half_height)
        }
    }
}

/// The smallest sphere around the slice of a lens's view from `start` to `end` along it, for a
/// target of `aspect`, in the view's own units: its center's x, y and distance along the view, and
/// its radius. It depends on nothing but the lens, so it keeps its size as the camera turns.
fn slice_sphere(lens: &Lens, aspect: f32, start: f32, end: f32) -> ([f32; 3], f32) {
    let (x, y) = view_corner(lens, aspect, end, 1.0, 1.0);
    match lens {
        Lens::Perspective(_) => {
            // The corners at each end lie on a circle around the view's axis, whose radius is the
            // distance times k. The center sits on the axis where the near and far corners are
            // equally far away, or at the far end when the far corners alone set the radius.
            let k2 = (x * x + y * y) / (end * end);
            let along = ((end + start) * (1.0 + k2) / 2.0).min(end);
            let radius = ((end - along) * (end - along) + end * end * k2).sqrt();
            ([0.0, 0.0, along], radius)
        }
        Lens::Orthographic(_) => {
            // The slice is a box, and the sphere passes through its corners.
            let (left, bottom) = view_corner(lens, aspect, end, -1.0, -1.0);
            let center = [(x + left) / 2.0, (y + bottom) / 2.0, (start + end) / 2.0];
            let half = [(x - left) / 2.0, (y - bottom) / 2.0, (end - start) / 2.0];
            (center, dot(half, half).sqrt())
        }
    }
}

/// `radius` rounded up to a step of about a thousandth of itself, on a power of two.
fn round_radius(radius: f32) -> f32 {
    let step = (radius / RADIUS_STEPS).max(f32::MIN_POSITIVE);
    let step = 2f32.powi(step.log2().floor() as i32);
    (radius / step).ceil() * step
}

/// The cascades of a camera at `position` from the world's origin, with world transform `camera`
/// and `lens`, drawing into a target of `aspect`, for a directional light whose light travels
/// along `direction`, which has length 1.
pub fn fit_cascades(
    camera: &Affine,
    position: [f64; 3],
    lens: &Lens,
    aspect: f32,
    direction: [f32; 3],
    settings: &ShadowSettings,
) -> Cascades {
    let count = settings.cascade_count();
    // The camera's axes with their scale: a point at (x, y, z) in its view is x * right + y * up +
    // z * back, relative to the camera.
    let right = [camera[0], camera[4], camera[8]];
    let up = [camera[1], camera[5], camera[9]];
    let back = [camera[2], camera[6], camera[10]];
    // The distance along the view is minus the view's z, the third row of the axes' inverse.
    let normal = cross(right, up);
    let determinant = dot(normal, back);
    let forward = normal.map(|v| -v / determinant);
    // A sphere in the view's units grows by the camera's largest scale in the world.
    let scale = [right, up, back]
        .map(|axis| dot(axis, axis))
        .into_iter()
        .fold(0.0, f32::max)
        .sqrt();
    // The shadow distance is in meters; the lens and the slices are in the view's units, which the
    // camera's scale stretches. The forward axis's length gives the view's units per meter.
    let distance = settings.distance * dot(forward, forward).sqrt();

    let (near, ends) = match lens {
        Lens::Perspective(lens) => {
            let near = lens.near.max(f32::MIN_POSITIVE);
            let end = distance.min(lens.far).max(near * 1.001);
            (near, split_distances(near, end, count, SPLIT_LAMBDA))
        }
        Lens::Orthographic(lens) => {
            let end = distance.min(lens.far);
            let end = end.max(lens.near + (lens.far - lens.near).abs() * 1e-3);
            (lens.near, split_distances(lens.near, end, count, 0.0))
        }
    };
    // Behind a perspective camera, a receiver picks its cascade by its distance from the camera,
    // which is up to this many times its distance along the view, at the view's corners.
    let reach = match lens {
        Lens::Perspective(_) => {
            let (x, y) = view_corner(lens, aspect, 1.0, 1.0, 1.0);
            (1.0 + x * x + y * y).sqrt()
        }
        Lens::Orthographic(_) => 1.0,
    };
    let blend = settings.blend.clamp(0.0, MAX_BLEND);
    let axes = light_axes(direction);
    let map_size = settings.map_size.max(1) as f32;

    let mut out = Cascades {
        count,
        forward,
        by_distance: matches!(lens, Lens::Perspective(_)),
        ..Cascades::default()
    };
    // Where the slice starts as receivers pick, and where its fitted part of the view starts along
    // the view: the band of the cascade before it, at the view's corners.
    let (mut start, mut from) = (near, near);
    for (k, (cascade, &end)) in out.cascades.iter_mut().zip(&ends).take(count).enumerate() {
        let band = if k + 1 < count {
            end - blend * (end - start)
        } else {
            end
        };
        let ([x, y, along], radius) = slice_sphere(lens, aspect, from, end);
        let radius = round_radius(radius * scale);
        let texel = f64::from(2.0 * radius / map_size);
        let relative: [f32; 3] =
            std::array::from_fn(|k| x * right[k] + y * up[k] - along * back[k]);
        let center = std::array::from_fn(|k| {
            let center = dot_far(position, axes[k]) + f64::from(dot(relative, axes[k]));
            if k < 2 {
                (center / texel).round() * texel
            } else {
                center
            }
        });
        let bounds = CascadeBox {
            axes,
            center,
            radius,
            margin: (2.0 * radius).max(settings.distance),
        };
        let corner = |at: f32, k: usize| -> [f32; 3] {
            let (sx, sy) = ([-1.0, 1.0][k & 1], [-1.0, 1.0][k >> 1]);
            let (x, y) = view_corner(lens, aspect, at, sx, sy);
            std::array::from_fn(|i| x * right[i] + y * up[i] - at * back[i])
        };
        *cascade = Cascade {
            end,
            band,
            corners: std::array::from_fn(|k| corner(if k < 4 { from } else { end }, k & 3)),
            ..Cascade::default()
        };
        cascade.place(&bounds, position, map_size);
        start = end;
        from = band / reach;
    }
    out
}

impl Cascade {
    /// Gives the cascade the box `bounds`, for a camera at `position` from the world's origin, with
    /// `map_size` texels on each side of its layer: its matrix, its culling frustum and its texel.
    /// Its slice keeps its ends, its band and its corners.
    fn place(&mut self, bounds: &CascadeBox, position: [f64; 3], map_size: f32) {
        let (view_proj, frustum, depth_per_meter) = box_view(bounds, position);
        self.view_proj = view_proj;
        self.frustum = frustum;
        self.texel = 2.0 * bounds.radius / map_size;
        self.depth_per_meter = depth_per_meter;
        self.bounds = *bounds;
    }

    /// True when the box `bounds` holds every corner of the cascade's part of the view, for a camera
    /// at `position` from the world's origin. The view's far corners lie on the slice's sphere, so
    /// a corner counts as held up to the box's edge, past the filter's reach that receivers keep
    /// inside it. A camera that moves a little then keeps its far cascades to their turns.
    fn held_by(&self, bounds: &CascadeBox, position: [f64; 3]) -> bool {
        let radius = f64::from(bounds.radius);
        self.corners.iter().all(|corner| {
            let along = |k: usize| {
                let axis = bounds.axes[k];
                dot_far(position, axis) + f64::from(dot(*corner, axis)) - bounds.center[k]
            };
            along(0).abs() <= radius && along(1).abs() <= radius && along(2) >= -radius
        })
    }
}

/// The view of the box `bounds` for a camera at `position` from the world's origin: its matrix
/// from positions relative to the camera into its clip space, its culling frustum, and the change
/// in depth over one meter along the light's direction.
fn box_view(bounds: &CascadeBox, position: [f64; 3]) -> (Mat4, Frustum, f32) {
    let [x, y, z] = bounds.axes;
    // The box's center relative to the camera, along the light's axes.
    let [cx, cy, cz]: [f32; 3] =
        std::array::from_fn(|k| (bounds.center[k] - dot_far(position, bounds.axes[k])) as f32);
    let radius = bounds.radius;
    let (far_face, light_face) = (cz - radius, cz + radius + bounds.margin);
    let depth = light_face - far_face;
    let (s, sz) = (1.0 / radius, 1.0 / depth);
    let (tx, ty, tz) = (-cx * s, -cy * s, -far_face * sz);
    // Column-major: each column holds one axis's share of x, y and depth in clip space.
    let view_proj = [
        s * x[0],
        s * y[0],
        sz * z[0],
        0.0,
        s * x[1],
        s * y[1],
        sz * z[1],
        0.0,
        s * x[2],
        s * y[2],
        sz * z[2],
        0.0,
        tx,
        ty,
        tz,
        1.0,
    ];
    // The fifth plane of the frustum is the depth-1 face, toward the light: casters beyond it
    // still draw, flattened onto it.
    let mut planes = *Frustum::from_view_projection(&view_proj).planes();
    planes[5] = [0.0; 4];
    (view_proj, Frustum::from_planes(planes), sz)
}

/// The frames in the schedule's cycle: a multiple of every interval from 1 to [`MAX_INTERVAL`].
const CYCLE: u32 = 840;

const _: () = assert!(MAX_INTERVAL == 8 && CYCLE.is_multiple_of(3 * 5 * 7 * 8));

/// Which cascades draw in each frame, and the box that each layer of the shadow map holds.
///
/// The nearest cascade draws in every frame. Each far cascade draws once every few frames, and
/// neighboring far cascades take their turns in different frames, so the frames share the cost. A
/// cascade draws at once when its layer holds nothing yet: when the shadows start, when the
/// cascade count or the map size changes, and when the GPU objects are made again. A far cascade
/// also draws in every frame where a moving caster touches the box its layer holds, or touched it
/// when the layer drew, so moving shadows follow their casters. It draws out of turn too when the
/// box its layer holds no longer holds the cascade's part of the view, as after a camera cut, so
/// no receiver is left without a cascade.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CascadeSchedule {
    /// The box that each cascade's layer holds, or `None` before it draws.
    drawn: [Option<CascadeBox>; MAX_CASCADES],
    /// True for each layer that drew with a moving caster in its box.
    moving: [bool; MAX_CASCADES],
    /// The cascade count and the map size that the layers hold.
    shape: (usize, u32),
    /// The frame's place in the schedule's cycle.
    frame: u32,
}

impl CascadeSchedule {
    /// True when `cascade`, from 0 for the nearest, takes its turn in the frame at `frame` of the
    /// cycle, while far cascades draw every `interval` frames.
    pub fn due(frame: u32, cascade: usize, interval: u32) -> bool {
        cascade == 0 || frame % interval == (cascade as u32 - 1) % interval
    }

    /// Picks the cascades of `cascades` that draw in this frame, for a camera at `position` from
    /// the world's origin, with `map_size` texels on each side of each layer and far cascades that
    /// draw every `interval` frames. `moving` tells whether a moving caster touches a box. Returns
    /// the cascades that draw as a mask with one bit per cascade, the nearest in bit 0. Each
    /// cascade that does not draw takes the box that its layer holds, relative to the camera, so
    /// receivers read the layer as it was drawn.
    pub fn plan(
        &mut self,
        cascades: &mut Cascades,
        position: [f64; 3],
        map_size: u32,
        interval: u32,
        moving: impl Fn(&CascadeBox) -> bool,
    ) -> u32 {
        let shape = (cascades.count, map_size);
        if shape != self.shape {
            *self = Self {
                shape,
                ..Self::default()
            };
        }
        let frame = self.frame;
        self.frame = (frame + 1) % CYCLE;
        let interval = interval.clamp(1, MAX_INTERVAL);
        let map_size = map_size.max(1) as f32;
        let mut drawn = 0;
        for (k, cascade) in cascades.cascades[..cascades.count].iter_mut().enumerate() {
            match self.drawn[k] {
                Some(bounds)
                    if !Self::due(frame, k, interval)
                        && !self.moving[k]
                        && cascade.held_by(&bounds, position)
                        && !moving(&bounds) =>
                {
                    cascade.place(&bounds, position, map_size);
                }
                _ => {
                    self.drawn[k] = Some(cascade.bounds);
                    // A layer that draws in every frame anyway needs no test.
                    self.moving[k] = k > 0 && interval > 1 && moving(&cascade.bounds);
                    drawn |= 1 << k;
                }
            }
        }
        drawn
    }

    /// Forgets what the layers hold, so every cascade draws in the next frame.
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// The scene objects that cast shadows and move in every frame: each dynamic object, and each
/// object under a dynamic one, that has a mesh and casts shadows. The list follows the scene's
/// structure, so it changes only in frames where the structure changed.
#[derive(Debug, Default)]
pub struct MovingCasters {
    slots: Vec<u32>,
    /// True once the list matches the scene's structure.
    built: bool,
}

impl MovingCasters {
    /// Lists the scene's moving casters again when its structure changed, or when the list was
    /// never built. Allocates only when the list grows past its largest size so far.
    pub fn update(&mut self, scene: &SceneStorage, structure_changed: bool) {
        if self.built && !structure_changed {
            return;
        }
        self.built = true;
        self.slots.clear();
        let (parents, slot_flags, meshes) = (scene.parents(), scene.flags(), scene.meshes());
        let moves = |slot: usize| {
            let mut at = slot;
            loop {
                if slot_flags[at] & flags::DYNAMIC != 0 {
                    return true;
                }
                match parents[at] {
                    NO_PARENT => return false,
                    parent => at = parent as usize,
                }
            }
        };
        let high = scene.slots().high_water() as usize;
        for slot in 0..high {
            if meshes[slot] != 0 && slot_flags[slot] & flags::CAST_SHADOWS != 0 && moves(slot) {
                self.slots.push(slot as u32);
            }
        }
    }

    /// Forgets the list, so the next update builds it again.
    pub fn forget(&mut self) {
        self.built = false;
    }

    /// True when a visible moving caster on the layers `layers` touches `bounds`, in the world
    /// output of frame parity `parity`. Casters beyond the box's face toward the light count, as
    /// they draw into it flattened onto that face.
    pub fn touch(
        &self,
        scene: &SceneStorage,
        parity: usize,
        layers: u32,
        bounds: &CascadeBox,
    ) -> bool {
        let spheres = scene.world(parity).spheres();
        let (slot_flags, slot_layers, cells) = (scene.flags(), scene.layers(), scene.cells());
        let table = scene.cell_table();
        let size = f64::from(CELL_SIZE);
        self.slots.iter().any(|&slot| {
            let s = slot as usize;
            if slot_flags[s] & flags::VISIBLE == 0 || slot_layers[s] & layers == 0 {
                return false;
            }
            let cell = table.coords(cells[s]);
            let local = [spheres.xs[s], spheres.ys[s], spheres.zs[s]];
            let center = std::array::from_fn(|k| f64::from(cell[k]) * size + f64::from(local[k]));
            bounds.touches(center, spheres.radii[s])
        })
    }
}

/// The main directional light's shadows in one frame: its cascades, fitted to the camera's view,
/// and what its shadow passes need.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowFrame {
    pub cascades: Cascades,
    pub settings: ShadowSettings,
    /// The camera's cell, and its position in the cell: the cascades' matrices take positions
    /// relative to it.
    pub camera: CellPosition,
    /// The light's layer mask, which selects the casters.
    pub layers: u32,
    /// The cascades that draw in this frame, one bit each, the nearest in bit 0. The others keep
    /// what their layers hold.
    pub drawn: u32,
}

impl ShadowFrame {
    /// True when `cascade` draws its layer in this frame.
    pub fn draws(&self, cascade: usize) -> bool {
        cascade < self.cascades.count && self.drawn & (1 << cascade) != 0
    }

    /// The values of a cascade's view: its matrix, its culling frustum, which has no plane on the
    /// light's side, and its depth, which runs from the box's face toward the light. Its culling
    /// moves sources by the offsets from the camera, as the camera's view does. Its camera is the
    /// light, far away, so its position is the direction toward the light, and its target is the
    /// layer, whose texels the casters' offset counts.
    pub fn view_frame(&self, cascade: usize) -> ViewFrame {
        let cascade = &self.cascades.cascades[cascade];
        // Clip depth falls from 1 at the light's face to 0 over the box's length in meters.
        let m = &cascade.view_proj;
        let length = 1.0 / cascade.depth_per_meter;
        let depth = ViewDepth {
            row: [-m[2], -m[6], -m[10], 1.0 - m[14]].map(|v| v * length),
            near: 0.0,
            far: length,
            perspective: false,
        };
        let [x, y, z] = [m[2], m[6], m[10]].map(|v| v * length);
        let size = self.settings.map_size.max(1) as f32;
        ViewFrame {
            uniform: FrameUniform {
                view_proj: cascade.view_proj,
                camera_position: [x, y, z, 0.0],
                target_size: [size, size, 1.0 / size, 1.0 / size],
                ..FrameUniform::default()
            },
            frustum: cascade.frustum,
            camera: self.camera,
            depth,
            layers: self.layers,
        }
    }

    /// The uniform block that receivers read.
    pub fn uniform(&self) -> ShadowUniform {
        ShadowUniform::new(&self.cascades, &self.settings)
    }
}

/// What the shadow passes draw into: a depth texture of one sample, with no color.
pub const TARGETS: PassTargets = PassTargets {
    color_format: format::NONE,
    depth_format: format::DEPTH32_FLOAT,
    samples: 1,
    permutation: 0,
};

/// Records the creation of the cascades' uniform block under `uniform`, of the comparison sampler
/// of the shadow atlas under `sampler`, and of the sampler that reads four texels of the shadow
/// map at once under `texels`, where the frame builder's shaders have such reads. Every scene
/// view's frame group binds them.
pub(crate) fn create_objects(
    list: &mut DrawList,
    uniform: u32,
    sampler: u32,
    texels: Option<u32>,
) -> Result<(), RecordError> {
    list.push(
        Op::CreateBuffer,
        &[
            uniform,
            SHADOW_UNIFORM_BYTES,
            buffer_usage::UNIFORM | buffer_usage::COPY_DST,
        ],
    )?;
    // Reversed depth: a point is lit where its depth is at least the caster's, nearer the light.
    // The linear filters blend the comparisons of the four nearest texels.
    let clamp = address::CLAMP_TO_EDGE;
    list.push(
        Op::CreateSampler,
        &[
            sampler,
            clamp,
            clamp,
            clamp,
            filter::LINEAR,
            filter::LINEAR,
            filter::NEAREST,
            0f32.to_bits(),
            0f32.to_bits(),
            compare::GREATER_EQUAL,
            1,
        ],
    )?;
    // The receivers compare each texel of the shadow map with a depth of their own, so they read
    // the texels' depths unfiltered.
    if let Some(texels) = texels {
        let nearest = filter::NEAREST;
        list.push(
            Op::CreateSampler,
            &[
                texels,
                clamp,
                clamp,
                clamp,
                nearest,
                nearest,
                nearest,
                0f32.to_bits(),
                0f32.to_bits(),
                compare::NONE,
                1,
            ],
        )?;
    }
    Ok(())
}

/// Uploads a frame's cascades into the uniform block `uniform`.
pub(crate) fn upload(
    list: &mut DrawList,
    arena: &mut UploadArena,
    uniform: u32,
    shadow: &ShadowFrame,
) -> Result<(), RecordError> {
    let (at, bytes) = arena.push(shadow.uniform().as_bytes())?;
    list.push(Op::WriteBuffer, &[uniform, 0, at, bytes])?;
    Ok(())
}

/// The share of the shadow distance over which shadows fade out.
pub const FADE_SHARE: f32 = 0.1;

/// The cascades as receivers read them, laid out as the shaders' `ShadowCascades` structure.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ShadowUniform {
    /// Each cascade's matrix from positions relative to the camera into its clip space.
    pub view_proj: [Mat4; MAX_CASCADES],
    /// Where each cascade's slice ends along the camera's view. Past the last, nothing is
    /// shadowed.
    pub ends: [f32; MAX_CASCADES],
    /// The camera's scaled forward axis, then the cascade count.
    pub forward: [f32; 4],
    /// The size in meters of one texel of each cascade's layer.
    pub texels: [f32; MAX_CASCADES],
    /// The light's bias toward the light and its normal bias, in meters, then 1 when receivers pick
    /// their cascade by their distance from the camera, or 0 by their distance along its view, and
    /// 0.
    pub biases: [f32; 4],
    /// The texels on each side of each layer and the size of one texel in texture coordinates,
    /// then the texels on each side of the filter's square, and 0.
    pub kernel: [f32; 4],
    /// The camera that draws, relative to the camera that fitted the cascades
    /// ([`Cascades::origin`]), then 0.
    pub origin: [f32; 4],
    /// Where each cascade's band starts ([`Cascade::band`]). Past it, a receiver blends the
    /// cascade's shadow with the next one's.
    pub bands: [f32; MAX_CASCADES],
}

const _: () = assert!(std::mem::size_of::<ShadowUniform>() == SHADOW_UNIFORM_BYTES as usize);

impl ShadowUniform {
    /// The uniform of a frame's cascades, with the biases and the filter of `settings`.
    pub fn new(cascades: &Cascades, settings: &ShadowSettings) -> Self {
        let map_size = settings.map_size.max(1) as f32;
        let mut uniform = ShadowUniform {
            forward: [
                cascades.forward[0],
                cascades.forward[1],
                cascades.forward[2],
                cascades.count as f32,
            ],
            biases: [
                settings.bias,
                settings.normal_bias,
                f32::from(u8::from(cascades.by_distance)),
                0.0,
            ],
            kernel: [map_size, 1.0 / map_size, settings.filter as f32, 0.0],
            origin: [
                cascades.origin[0],
                cascades.origin[1],
                cascades.origin[2],
                0.0,
            ],
            ..Self::default()
        };
        let last = cascades.used().last().map_or(0.0, |c| c.end);
        uniform.ends = [last; MAX_CASCADES];
        uniform.bands = [last; MAX_CASCADES];
        for (k, cascade) in cascades.used().iter().enumerate() {
            uniform.view_proj[k] = cascade.view_proj;
            uniform.ends[k] = cascade.end;
            uniform.bands[k] = cascade.band;
            uniform.texels[k] = cascade.texel;
        }
        uniform
    }

    /// The uniform as bytes, for an upload.
    pub fn as_bytes(&self) -> &[u8] {
        // SAFETY: the struct is `repr(C)` and made only of `f32`s, so it has no padding, and any
        // bytes of it are initialized.
        unsafe {
            std::slice::from_raw_parts(
                (self as *const Self).cast::<u8>(),
                std::mem::size_of::<Self>(),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::{Orthographic, Perspective};

    const PERSPECTIVE: Perspective = Perspective {
        fov_degrees: 60.0,
        near: 0.1,
        far: 1000.0,
    };
    const LENS: Lens = Lens::Perspective(PERSPECTIVE);

    const SETTINGS: ShadowSettings = ShadowSettings {
        cascades: 3,
        map_size: 2048,
        bias: 1.0,
        normal_bias: 1.0,
        distance: 200.0,
        filter: 3,
        blend: DEFAULT_BLEND,
    };

    /// The cascades of a camera at the world's origin.
    fn fit(
        camera: &Affine,
        lens: &Lens,
        aspect: f32,
        direction: [f32; 3],
        settings: &ShadowSettings,
    ) -> Cascades {
        fit_cascades(camera, [0.0; 3], lens, aspect, direction, settings)
    }

    /// A camera 5 m up, looking along -z and 20 degrees down, at the origin of the shaders' space.
    fn camera() -> Affine {
        turned(0.0)
    }

    /// The same camera turned by `yaw` degrees about the world's up.
    fn turned(yaw: f32) -> Affine {
        let (s, c) = (-20f32).to_radians().sin_cos();
        let (sy, cy) = yaw.to_radians().sin_cos();
        // The yaw about +Y, after the pitch about +X.
        [
            cy,
            sy * s,
            sy * c,
            0.0,
            0.0,
            c,
            -s,
            5.0,
            -sy,
            cy * s,
            cy * c,
            0.0,
        ]
    }

    /// A position relative to the camera through a column-major matrix, after the divide by w.
    fn project(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
        let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        std::array::from_fn(|row| {
            (m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]) / w
        })
    }

    /// A point of the camera's view at `distance` along it, at (`sx`, `sy`) across the view,
    /// where -1 and 1 are the view's edges.
    fn view_point(camera: &Affine, aspect: f32, distance: f32, sx: f32, sy: f32) -> [f32; 3] {
        view_point_of(&LENS, camera, aspect, distance, sx, sy)
    }

    /// The same point of a view through `lens`.
    fn view_point_of(
        lens: &Lens,
        camera: &Affine,
        aspect: f32,
        distance: f32,
        sx: f32,
        sy: f32,
    ) -> [f32; 3] {
        let (x, y) = view_corner(lens, aspect, distance, sx, sy);
        std::array::from_fn(|k| {
            x * camera[k * 4] + y * camera[k * 4 + 1] - distance * camera[k * 4 + 2]
        })
    }

    const DOWN_AND_ACROSS: [f32; 3] = [-0.408_248_3, -0.816_496_6, -0.408_248_3];

    #[test]
    fn cascades_seen_from_another_camera_keep_their_boxes_and_their_distances() {
        let fitted = [3.0, 0.0, -2.0];
        let drawing = [-10.0, 20.0, 15.0];
        let mut cascades = fit_cascades(&camera(), fitted, &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
        let own = cascades;
        cascades.seen_from(fitted, drawing, SETTINGS.map_size);
        // A point of the fitting camera's view, relative to each camera.
        let point = view_point(&camera(), 1.5, 12.0, 0.3, -0.2);
        let from_drawing: [f32; 3] =
            std::array::from_fn(|k| point[k] + (fitted[k] - drawing[k]) as f32);
        for (seen, own) in cascades.used().iter().zip(own.used()) {
            assert_eq!(seen.bounds, own.bounds);
            let [a, b] = [
                project(&own.view_proj, point),
                project(&seen.view_proj, from_drawing),
            ];
            for k in 0..3 {
                assert!((a[k] - b[k]).abs() < 1e-4, "{a:?} {b:?}");
            }
        }
        // The position relative to the fitting camera, so its distance from that camera and along
        // its view, comes out the same from either camera.
        let seen = |p: [f32; 3], origin: [f32; 3]| -> [f32; 3] {
            std::array::from_fn(|k| p[k] + origin[k])
        };
        let [a, b] = [seen(point, own.origin), seen(from_drawing, cascades.origin)];
        for k in 0..3 {
            assert!((a[k] - b[k]).abs() < 1e-4, "{a:?} {b:?}");
        }
        assert_eq!(own.origin, [0.0; 3]);
        let uniform = ShadowUniform::new(&cascades, &SETTINGS);
        assert_eq!(uniform.origin[..3], cascades.origin);
    }

    #[test]
    fn splits_grow_with_distance_and_the_last_ends_at_the_shadow_distance() {
        for count in 1..=MAX_CASCADES {
            let splits = split_distances(0.1, 200.0, count, SPLIT_LAMBDA);
            assert_eq!(splits[count - 1], 200.0);
            let mut before = 0.1;
            for &split in &splits[..count] {
                assert!(split > before, "{splits:?}");
                before = split;
            }
        }
        // Each split blends the even spread and the logarithmic one, so near slices are shorter
        // than far ones.
        for lambda in [0.0, 0.5, SPLIT_LAMBDA, 1.0] {
            let splits = split_distances(0.1, 200.0, 3, lambda);
            for (i, &split) in splits[..2].iter().enumerate() {
                let share = (i + 1) as f32 / 3.0;
                let even = 0.1 + 199.9 * share;
                let logarithmic = 0.1 * 2000f32.powf(share);
                let blend = lambda * logarithmic + (1.0 - lambda) * even;
                assert!((split - blend).abs() < 1e-3, "{lambda}: {splits:?}");
            }
        }
        let splits = split_distances(0.1, 200.0, 3, SPLIT_LAMBDA);
        assert!(splits[0] < splits[1] - splits[0], "{splits:?}");
    }

    #[test]
    fn every_point_of_each_slice_lands_inside_its_cascade() {
        let orthographic = Lens::Orthographic(Orthographic {
            height: 30.0,
            width: None,
            center: [2.0, -1.0],
            near: -10.0,
            far: 300.0,
        });
        for (lens, near) in [(LENS, PERSPECTIVE.near), (orthographic, -10.0)] {
            slices_land_inside(&lens, near);
        }
    }

    /// Checks that every point of each slice of a view through `lens`, from `near` on, lands
    /// inside its cascade.
    fn slices_land_inside(lens: &Lens, near: f32) {
        let camera = camera();
        let aspect = 16.0 / 9.0;
        let cascades = fit(&camera, lens, aspect, DOWN_AND_ACROSS, &SETTINGS);
        assert_eq!(cascades.count, 3);
        let mut start = near;
        for cascade in cascades.used() {
            for step in 0..=4 {
                let distance = start + (cascade.end - start) * step as f32 / 4.0;
                for sx in [-1.0, -0.3, 0.0, 1.0] {
                    for sy in [-1.0, 0.5, 1.0] {
                        let p = view_point_of(lens, &camera, aspect, distance, sx, sy);
                        let [x, y, depth] = project(&cascade.view_proj, p);
                        let inside = |v: f32| (-1.0 - 1e-4..=1.0 + 1e-4).contains(&v);
                        assert!(inside(x) && inside(y), "{p:?} -> ({x}, {y})");
                        assert!((-1e-4..1.0).contains(&depth), "{p:?} -> depth {depth}");
                        assert!(cascade.frustum.contains_sphere(p[0], p[1], p[2], 1e-3));
                        // The forward axis gives the distance along the view.
                        let along = dot(p, cascades.forward);
                        assert!((along - distance).abs() < distance.abs() * 1e-4 + 1e-4);
                    }
                }
            }
            start = cascade.end;
        }
    }

    #[test]
    fn casters_toward_the_light_stay_and_casters_beside_or_behind_the_box_go() {
        let camera = camera();
        let cascades = fit(&camera, &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
        let cascade = &cascades.cascades[0];
        let middle = view_point(&camera, 1.5, cascade.end / 2.0, 0.0, 0.0);
        let toward_light = |meters: f32| -> [f32; 3] {
            std::array::from_fn(|k| middle[k] - DOWN_AND_ACROSS[k] * meters)
        };
        // Between the light and the slice, however far: kept, and in front of the slice.
        for meters in [1.0, 50.0, 1.0e5] {
            let p = toward_light(meters);
            assert!(
                cascade.frustum.contains_sphere(p[0], p[1], p[2], 0.5),
                "{meters} m"
            );
        }
        let slice_depth = project(&cascade.view_proj, middle)[2];
        assert!(project(&cascade.view_proj, toward_light(1.0))[2] > slice_depth);
        // Past the far face, away from the light: culled.
        let behind = toward_light(-1.0e4);
        assert!(
            !cascade
                .frustum
                .contains_sphere(behind[0], behind[1], behind[2], 1.0)
        );
        // Beside the box, across the light: culled.
        let [x, _, _] = light_axes(DOWN_AND_ACROSS);
        let beside: [f32; 3] = std::array::from_fn(|k| middle[k] + x[k] * 1.0e3);
        assert!(
            !cascade
                .frustum
                .contains_sphere(beside[0], beside[1], beside[2], 1.0)
        );
    }

    #[test]
    fn the_shadow_distance_and_the_far_plane_end_the_last_cascade() {
        let camera = camera();
        let near_far = Lens::Perspective(Perspective {
            far: 50.0,
            ..PERSPECTIVE
        });
        for (lens, end) in [(LENS, 200.0), (near_far, 50.0)] {
            let cascades = fit(&camera, &lens, 1.0, DOWN_AND_ACROSS, &SETTINGS);
            assert_eq!(cascades.used().last().unwrap().end, end);
        }
        // Cascade counts outside 1 to 4 clamp.
        for (asked, count) in [(0, 1), (2, 2), (9, MAX_CASCADES)] {
            let settings = ShadowSettings {
                cascades: asked,
                ..SETTINGS
            };
            let cascades = fit(&camera, &LENS, 1.0, DOWN_AND_ACROSS, &settings);
            assert_eq!(cascades.count, count);
        }
    }

    #[test]
    fn a_light_straight_down_and_a_scaled_camera_fit_as_well() {
        // A camera turned a quarter about +Y and scaled by 2: its view sees twice as far.
        let camera: Affine = [0.0, 0.0, 2.0, 0.0, 0.0, 2.0, 0.0, 0.0, -2.0, 0.0, 0.0, 0.0];
        let cascades = fit(&camera, &LENS, 1.0, [0.0, -1.0, 0.0], &SETTINGS);
        for cascade in cascades.used() {
            assert!(cascade.view_proj.iter().all(|v| v.is_finite()));
        }
        // The camera looks along -x, and 10 m along its view is 20 m out.
        let p = [-20.0, 0.0, 0.0];
        assert!((dot(p, cascades.forward) - 10.0).abs() < 1e-4);
    }

    #[test]
    fn the_uniform_holds_the_biases_in_meters_and_each_cascade_s_texel() {
        let cascades = fit(&camera(), &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
        let settings = ShadowSettings {
            bias: 2.0,
            normal_bias: 0.5,
            ..SETTINGS
        };
        let uniform = ShadowUniform::new(&cascades, &settings);
        assert_eq!(uniform.forward[3], 3.0);
        assert_eq!(uniform.as_bytes().len(), SHADOW_UNIFORM_BYTES as usize);
        assert_eq!(uniform.biases, [2.0, 0.5, 1.0, 0.0]);
        for (k, cascade) in cascades.used().iter().enumerate() {
            assert_eq!(uniform.view_proj[k], cascade.view_proj);
            assert_eq!(uniform.ends[k], cascade.end);
            assert_eq!(uniform.texels[k], cascade.texel);
        }
        // Far cascades have larger texels.
        let texels: Vec<f32> = cascades.used().iter().map(|c| c.texel).collect();
        assert!(
            texels.windows(2).all(|pair| pair[0] < pair[1]),
            "{texels:?}"
        );
        // The unused cascade ends where the last one does.
        assert_eq!(uniform.ends[3], 200.0);
        // The filter's values follow the map size and the kernel.
        assert_eq!(uniform.kernel, [2048.0, 1.0 / 2048.0, 3.0, 0.0]);
    }

    #[test]
    fn each_cascade_s_pass_sees_the_light_as_its_camera_and_its_layer_as_its_target() {
        let frame = ShadowFrame {
            cascades: fit(&camera(), &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS),
            settings: SETTINGS,
            camera: CellPosition::default(),
            layers: 1,
            drawn: 0b111,
        };
        let size = SETTINGS.map_size as f32;
        for (k, cascade) in frame.cascades.used().iter().enumerate() {
            let uniform = frame.view_frame(k).uniform;
            // The direction toward the light, as an orthographic camera's position gives it.
            let [x, y, z, w] = uniform.camera_position;
            let toward = DOWN_AND_ACROSS.map(|v| -v);
            assert!((x - toward[0]).abs() + (y - toward[1]).abs() + (z - toward[2]).abs() < 1e-5);
            assert_eq!(w, 0.0);
            assert_eq!(uniform.target_size, [size, size, 1.0 / size, 1.0 / size]);
            // The shadow depth shader's texel: two clip units over the texels across, in meters.
            let m = &cascade.view_proj;
            let row = (m[0] * m[0] + m[4] * m[4] + m[8] * m[8]).sqrt();
            let texel = 2.0 * uniform.target_size[2] / row;
            assert!(
                (texel / cascade.texel - 1.0).abs() < 1e-4,
                "{texel} {}",
                cascade.texel
            );
        }
    }

    /// A camera far from the world's origin, in its own cell, as the core places it.
    const FAR_OUT: [f64; 3] = [977.0 * 1024.0 + 3.3, 5.0, -2.0e5 - 0.7];

    /// The texel of each cascade's layer that holds the world's point `point`, as fractions of
    /// texels, seen from a camera at `position` turned by `yaw` degrees, or `None` where the
    /// point is outside a cascade's box.
    fn texels_of(point: [f64; 3], position: [f64; 3], yaw: f32) -> Vec<Option<[f64; 2]>> {
        let cascades = fit_cascades(
            &turned(yaw),
            position,
            &LENS,
            16.0 / 9.0,
            DOWN_AND_ACROSS,
            &SETTINGS,
        );
        texels_in(&cascades, point, position)
    }

    /// The texel of each cascade of `cascades` that holds `point`, for a camera at `position`.
    fn texels_in(
        cascades: &Cascades,
        point: [f64; 3],
        position: [f64; 3],
    ) -> Vec<Option<[f64; 2]>> {
        let relative: [f32; 3] = std::array::from_fn(|k| (point[k] - position[k]) as f32);
        let size = f64::from(SETTINGS.map_size);
        cascades
            .used()
            .iter()
            .map(|cascade| {
                let [x, y, _] = project(&cascade.view_proj, relative);
                let inside = x.abs() < 0.99 && y.abs() < 0.99;
                inside.then(|| {
                    [
                        f64::from(x + 1.0) / 2.0 * size,
                        f64::from(y + 1.0) / 2.0 * size,
                    ]
                })
            })
            .collect()
    }

    /// Checks that each cascade puts `point` at the same place within a texel in every frame in
    /// which its box holds it, and that some cascade holds it in two frames at least.
    fn assert_still(point: [f64; 3], frames: &[Vec<Option<[f64; 2]>>]) {
        let mut compared = 0;
        for cascade in 0..SETTINGS.cascades as usize {
            let seen: Vec<[f64; 2]> = frames.iter().filter_map(|f| f[cascade]).collect();
            for texel in seen.iter().skip(1) {
                for axis in 0..2 {
                    let shift = (texel[axis] - seen[0][axis]).rem_euclid(1.0);
                    let shift = shift.min(1.0 - shift);
                    assert!(
                        shift < 2e-3,
                        "cascade {cascade}: {:?} then {texel:?}",
                        seen[0]
                    );
                }
                compared += 1;
            }
        }
        assert!(compared > 0, "no cascade held {point:?} twice");
    }

    #[test]
    fn a_turning_camera_keeps_each_box_s_size_and_its_texels_on_the_world_s_grid() {
        for position in [[0.0; 3], FAR_OUT] {
            let sizes = |yaw: f32| -> Vec<f32> {
                let camera = turned(yaw);
                let cascades =
                    fit_cascades(&camera, position, &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
                cascades.used().iter().map(|c| c.bounds.radius).collect()
            };
            let first = sizes(0.0);
            // A point on the ground 6 m ahead and one 40 m ahead, in the near and far cascades.
            for ahead in [6.0, 40.0] {
                let point = [position[0] + 1.3, position[1] - 5.0, position[2] - ahead];
                let frames: Vec<_> = (0..24)
                    .map(|step| {
                        let yaw = step as f32 * 0.37 - 4.0;
                        assert_eq!(sizes(yaw), first, "the boxes keep their size");
                        texels_of(point, position, yaw)
                    })
                    .collect();
                assert_still(point, &frames);
            }
        }
    }

    #[test]
    fn a_moving_camera_moves_each_box_in_whole_texels() {
        for start in [[0.0; 3], FAR_OUT] {
            let point = [start[0] + 2.1, start[1] - 5.0, start[2] - 12.0];
            let frames: Vec<_> = (0..24)
                .map(|step| {
                    let step = f64::from(step);
                    let position = [start[0] + step * 0.071, start[1], start[2] - step * 0.113];
                    texels_of(point, position, 10.0)
                })
                .collect();
            assert_still(point, &frames);
        }
    }

    #[test]
    fn the_near_cascade_draws_every_frame_and_far_cascades_take_turns() {
        let due = |frame: u32, interval: u32| -> Vec<usize> {
            (0..4)
                .filter(|&k| CascadeSchedule::due(frame, k, interval))
                .collect()
        };
        for frame in 0..8 {
            assert_eq!(due(frame, 1), [0, 1, 2, 3]);
        }
        // Every second frame: the first and third far cascades, then the second.
        assert_eq!(due(0, 2), [0, 1, 3]);
        assert_eq!(due(1, 2), [0, 2]);
        // Every fourth frame: each far cascade in a frame of its own.
        let turns: Vec<Vec<usize>> = (0..4).map(|frame| due(frame, 4)).collect();
        assert_eq!(turns, [vec![0, 1], vec![0, 2], vec![0, 3], vec![0]]);
        // Each far cascade draws once in every `interval` frames, for every interval.
        for interval in 1..=MAX_INTERVAL {
            for k in 1..MAX_CASCADES {
                let draws = (0..CYCLE)
                    .filter(|&f| CascadeSchedule::due(f, k, interval))
                    .count();
                assert_eq!(draws as u32, CYCLE / interval, "interval {interval}");
            }
        }
    }

    #[test]
    fn a_cascade_that_skips_a_frame_keeps_its_box_where_it_drew() {
        let settings = ShadowSettings {
            cascades: 4,
            ..SETTINGS
        };
        let fit_at = |position: [f64; 3], yaw: f32| {
            fit_cascades(
                &turned(yaw),
                position,
                &LENS,
                1.5,
                DOWN_AND_ACROSS,
                &settings,
            )
        };
        let mut schedule = CascadeSchedule::default();
        // The first frame draws every cascade, as no layer holds anything yet.
        let mut first = fit_at(FAR_OUT, 0.0);
        let fresh = first;
        assert_eq!(schedule.plan(&mut first, FAR_OUT, 2048, 4, still), 0b1111);
        assert_eq!(first, fresh);
        // The camera moves and turns a little: only the near cascade and the next in turn draw.
        let moved = [FAR_OUT[0] + 0.37, FAR_OUT[1], FAR_OUT[2] - 0.29];
        let mut second = fit_at(moved, 0.5);
        let fresh = second;
        assert_eq!(schedule.plan(&mut second, moved, 2048, 4, still), 0b0101);
        assert_eq!(second.cascades[0], fresh.cascades[0]);
        assert_eq!(second.cascades[2], fresh.cascades[2]);
        // The others keep the boxes of the first frame, with their own slices' ends, and map each
        // world point to where the first frame's matrices did.
        let point = [FAR_OUT[0] - 4.0, FAR_OUT[1] - 5.0, FAR_OUT[2] - 30.0];
        let (before, after) = (
            texels_in(&first, point, FAR_OUT),
            texels_in(&second, point, moved),
        );
        for k in [1, 3] {
            assert_eq!(second.cascades[k].bounds, first.cascades[k].bounds);
            assert_eq!(second.cascades[k].end, fresh.cascades[k].end);
            let (Some(a), Some(b)) = (before[k], after[k]) else {
                panic!("cascade {k} holds the point in both frames");
            };
            assert!(
                (a[0] - b[0]).abs() < 2e-3 && (a[1] - b[1]).abs() < 2e-3,
                "{a:?} {b:?}"
            );
        }
        // A new map size draws every cascade again, and so does a reset.
        assert_eq!(
            schedule.plan(&mut fit_at(moved, 25.0), moved, 1024, 4, still),
            0b1111
        );
        schedule.reset();
        assert_eq!(
            schedule.plan(&mut fit_at(moved, 25.0), moved, 1024, 4, still),
            0b1111
        );
    }

    /// No moving caster touches any box.
    fn still(_: &CascadeBox) -> bool {
        false
    }

    #[test]
    fn a_far_cascade_draws_in_every_frame_while_a_moving_caster_touches_it() {
        let settings = ShadowSettings {
            cascades: 4,
            ..SETTINGS
        };
        let fit = || {
            fit_cascades(
                &turned(0.0),
                FAR_OUT,
                &LENS,
                1.5,
                DOWN_AND_ACROSS,
                &settings,
            )
        };
        // A moving caster in the second cascade's box alone.
        let second = fit().cascades[1].bounds;
        let touching = std::cell::Cell::new(true);
        let moving = |bounds: &CascadeBox| touching.get() && *bounds == second;
        let mut schedule = CascadeSchedule::default();
        let mut plan = || schedule.plan(&mut fit(), FAR_OUT, 2048, 4, moving);
        assert_eq!(plan(), 0b1111);
        // The second cascade draws out of turn, beside the third, whose turn it is.
        assert_eq!(plan(), 0b0111);
        // The caster leaves, but the layer still holds its shadow: it draws once more.
        touching.set(false);
        assert_eq!(plan(), 0b1011);
        // With still casters alone, the far cascades keep their layers again.
        assert_eq!(plan(), 0b0001);
        assert_eq!(plan(), 0b0011);
    }

    #[test]
    fn a_sphere_touches_a_box_that_it_draws_into() {
        let bounds = CascadeBox {
            axes: [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]],
            center: [2048.0, 0.0, 10.0],
            radius: 20.0,
            margin: 5.0,
        };
        let box_test = |at: [f64; 3], r: f32| bounds.touches(at, r);
        // Inside, above the box toward the light, and just touching a side all count.
        assert!(box_test([2048.0, 10.0, 0.0], 1.0));
        assert!(box_test([2048.0, 500.0, 0.0], 1.0));
        assert!(box_test([2048.0 + 20.5, 10.0, 0.0], 1.0));
        // Past a side, or beyond the far face, nothing draws into the box.
        assert!(!box_test([2048.0 + 21.5, 10.0, 0.0], 1.0));
        assert!(!box_test([2048.0, -11.5, 0.0], 1.0));
    }

    /// The texels inside each edge of a cascade's layer that the shader's filter reads past a
    /// receiver, which its box must hold: the reach of the widest filter's square.
    const FILTER_REACH: f32 = 3.0;

    /// A camera at `eye` that looks at `target`, its axes scaled by `scale`.
    fn looking(eye: [f32; 3], target: [f32; 3], scale: f32) -> Affine {
        let back = normalize(std::array::from_fn(|k| eye[k] - target[k]));
        let right = normalize(cross([0.0, 1.0, 0.0], back));
        let up = cross(back, right);
        let [r, u, b] = [right, up, back].map(|axis| axis.map(|v| v * scale));
        [
            r[0], u[0], b[0], eye[0], r[1], u[1], b[1], eye[1], r[2], u[2], b[2], eye[2],
        ]
    }

    /// The cascade that a receiver at `p`, relative to the camera, reads, as the shader's
    /// `sun_shadow` picks it with no bias: the cascade whose slice holds its distance, or the next
    /// one whose box holds it with the filter's reach inside its edges. `None` past the shadow
    /// distance, and where no box holds it, so the receiver would be lit.
    fn pick(cascades: &Cascades, size: f32, p: [f32; 3]) -> Option<usize> {
        let used = cascades.used();
        if dot(p, cascades.forward) >= used.last()?.end {
            return None;
        }
        let distance = pick_distance(cascades, p);
        let first = (0..used.len() - 1)
            .filter(|&k| distance >= used[k].end)
            .count();
        (first..used.len()).find(|&k| holds(&used[k], size, p))
    }

    /// True when a cascade's box holds `p`, relative to the camera, with the filter's reach inside
    /// its edges, as the shader's `sun_holds` tests it.
    fn holds(cascade: &Cascade, size: f32, p: [f32; 3]) -> bool {
        let [x, y, _] = project(&cascade.view_proj, p);
        let inside = 1.0 - 2.0 * FILTER_REACH / size;
        x.abs() <= inside && y.abs() <= inside
    }

    /// The distance from the camera that picks a cascade for `p`, as the shader measures it.
    fn pick_distance(cascades: &Cascades, p: [f32; 3]) -> f32 {
        if cascades.by_distance {
            dot(p, p).sqrt() * dot(cascades.forward, cascades.forward).sqrt()
        } else {
            dot(p, cascades.forward)
        }
    }

    #[test]
    fn every_receiver_in_view_finds_a_box_and_band_receivers_find_the_next_box_too() {
        // Narrow views lost receivers near the screen's sides, where the point lies past its
        // slice's end by its distance from the camera, but the next box held only its own slice.
        let suns = [
            DOWN_AND_ACROSS,
            normalize([-1.0, -2.0, -1.0]),
            normalize([0.3, -0.6, -1.0]),
            normalize([1.0, -0.4, 0.2]),
        ];
        let mut checked = 0;
        for fov in [20.0, 30.0, 35.0, 40.0, 45.0, 50.0, 60.0, 75.0, 90.0] {
            let lens = Lens::Perspective(Perspective {
                fov_degrees: fov,
                ..PERSPECTIVE
            });
            for cascades in 2..=4 {
                for (aspect, sun, height) in [(16.0 / 9.0, 0, 1.7), (1.5, 1, 42.0), (0.6, 2, 6.0)]
                    .into_iter()
                    .chain([(16.0 / 9.0, 3, 20.0)])
                {
                    let settings = ShadowSettings {
                        cascades,
                        ..SETTINGS
                    };
                    let camera = looking([0.0, height, 0.0], [10.0, 0.0, -40.0], 1.0);
                    let fitted = fit(&camera, &lens, aspect, suns[sun], &settings);
                    let size = settings.map_size as f32;
                    let end = fitted.used().last().unwrap().end;
                    for step in 1..60 {
                        let along = end * step as f32 / 60.0;
                        for sx in -10..=10 {
                            for sy in -10..=10 {
                                let (sx, sy) = (sx as f32 / 10.0, sy as f32 / 10.0);
                                let p = view_point_of(&lens, &camera, aspect, along, sx, sy);
                                let Some(k) = pick(&fitted, size, p) else {
                                    panic!("fov {fov}, {cascades} cascades: {p:?} is lit");
                                };
                                let cascade = &fitted.cascades[k];
                                let distance = pick_distance(&fitted, p);
                                if k + 1 < fitted.count && distance > cascade.band {
                                    let next = &fitted.cascades[k + 1];
                                    assert!(
                                        holds(next, size, p),
                                        "fov {fov}, {cascades} cascades: the band's {p:?} \
                                         falls outside cascade {}",
                                        k + 1
                                    );
                                }
                                checked += 1;
                            }
                        }
                    }
                }
            }
        }
        assert!(checked > 1_000_000, "{checked}");
    }

    #[test]
    fn each_band_is_a_share_of_its_cascade_and_the_last_cascade_has_none() {
        for blend in [0.0, DEFAULT_BLEND, 0.3, 2.0] {
            let settings = ShadowSettings { blend, ..SETTINGS };
            let cascades = fit(&camera(), &LENS, 1.5, DOWN_AND_ACROSS, &settings);
            let share = blend.min(MAX_BLEND);
            let mut start = PERSPECTIVE.near;
            for (k, cascade) in cascades.used().iter().enumerate() {
                let expected = if k + 1 < cascades.count {
                    cascade.end - share * (cascade.end - start)
                } else {
                    cascade.end
                };
                assert!(
                    (cascade.band - expected).abs() < 1e-4,
                    "{blend}: {cascade:?}"
                );
                start = cascade.end;
            }
            let uniform = ShadowUniform::new(&cascades, &settings);
            let bands: Vec<f32> = cascades.used().iter().map(|c| c.band).collect();
            assert_eq!(uniform.bands[..3], bands[..]);
            assert_eq!(uniform.bands[3], 200.0);
        }
    }

    #[test]
    fn the_shadow_distance_stays_in_meters_under_a_scaled_camera() {
        // The camera's far plane, 1,000 units out, stays past the distance at each scale.
        for scale in [0.25, 1.0, 2.0] {
            let camera = looking([0.0, 5.0, 0.0], [0.0, 0.0, -30.0], scale);
            let cascades = fit(&camera, &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
            // The last cascade ends 200 m along the view, in the view's units.
            let end = cascades.used().last().unwrap().end;
            assert!((end * scale - 200.0).abs() < 1e-2, "{scale}: {end}");
            let p = view_point_of(&LENS, &camera, 1.5, end * 0.5, 0.0, 0.0);
            let meters = dot(p, p).sqrt();
            assert!((meters - 100.0).abs() < 1e-2, "{scale}: {meters}");
        }
    }

    #[test]
    fn a_kept_far_cascade_draws_out_of_turn_after_a_camera_cut() {
        let settings = ShadowSettings {
            cascades: 4,
            ..SETTINGS
        };
        let fit_at = |position: [f64; 3], yaw: f32| {
            fit_cascades(
                &turned(yaw),
                position,
                &LENS,
                1.5,
                DOWN_AND_ACROSS,
                &settings,
            )
        };
        let mut schedule = CascadeSchedule::default();
        assert_eq!(
            schedule.plan(&mut fit_at(FAR_OUT, 0.0), FAR_OUT, 2048, 4, still),
            0b1111
        );
        // A small step keeps the far cascades to their turns.
        let step = [FAR_OUT[0] + 0.2, FAR_OUT[1], FAR_OUT[2] - 0.2];
        assert_eq!(
            schedule.plan(&mut fit_at(step, 0.1), step, 2048, 4, still),
            0b0101
        );
        // A cut 500 m away draws every cascade at once, as no kept box holds the new view.
        let cut = [FAR_OUT[0] + 500.0, FAR_OUT[1], FAR_OUT[2]];
        let mut cascades = fit_at(cut, 0.1);
        assert_eq!(schedule.plan(&mut cascades, cut, 2048, 4, still), 0b1111);
        // Every receiver of the new view finds a box.
        let size = settings.map_size as f32;
        for along in [5.0, 30.0, 90.0, 180.0] {
            for sx in [-1.0, 0.0, 1.0] {
                let p = view_point(&turned(0.1), 1.5, along, sx, -0.5);
                assert!(pick(&cascades, size, p).is_some(), "{p:?}");
            }
        }
        // A camera that turns about as far as the far cascades' boxes reach draws them too.
        let mut turned_away = fit_at(cut, 120.0);
        assert_eq!(
            schedule.plan(&mut turned_away, cut, 2048, 4, still) & 0b1110,
            0b1110
        );
    }

    /// The frames, as a share of all, in which a far cascade draws out of its turn while a camera
    /// follows S4's path at `rate` frames per second with the cascades of a preset.
    fn s4_out_of_turn_share(cascades: u32, map_size: u32, interval: u32, rate: f32) -> f32 {
        let settings = ShadowSettings {
            cascades,
            map_size,
            ..SETTINGS
        };
        let sun = normalize([-1.0, -2.0, -1.0]);
        let mut schedule = CascadeSchedule::default();
        let frames = (60.0 * rate) as u32;
        let mut out_of_turn = 0;
        for frame in 0..frames {
            let angle = std::f32::consts::TAU * frame as f32 / frames as f32;
            let eye = [95.0 * angle.cos(), 42.0, -95.0 * angle.sin()];
            let target = [50.0 * (angle + 0.9).cos(), 0.0, -50.0 * (angle + 0.9).sin()];
            let camera = looking(eye, target, 1.0);
            let position = eye.map(f64::from);
            let mut fitted = fit_cascades(&camera, position, &LENS, 1.5, sun, &settings);
            let drawn = schedule.plan(&mut fitted, position, map_size, interval, still);
            let due = (0..fitted.count)
                .filter(|&k| CascadeSchedule::due(frame % CYCLE, k, interval))
                .fold(0, |mask, k| mask | 1 << k);
            if frame > 0 && drawn & !due != 0 {
                out_of_turn += 1;
            }
        }
        out_of_turn as f32 / frames as f32
    }

    #[test]
    fn s4_s_camera_path_keeps_far_cascades_to_their_turns() {
        // Low draws 2 cascades every 4 frames on phones at 30 to 60 frames a second; Medium 3
        // every 3 frames; High 3 and Ultra 4 every 2 frames.
        for rate in [30.0, 60.0] {
            for (preset, cascades, map_size, interval) in [
                ("Low", 2, 1024, 4),
                ("Medium", 3, 2048, 3),
                ("High", 3, 2048, 2),
                ("Ultra", 4, 4096, 2),
            ] {
                let share = s4_out_of_turn_share(cascades, map_size, interval, rate);
                assert_eq!(share, 0.0, "{preset} at {rate}");
            }
        }
    }
}
