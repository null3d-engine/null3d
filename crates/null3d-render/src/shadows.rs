//! Directional light shadows: the cascades that split the camera's view by distance, each drawn
//! from the light into one layer of the shadow map.
//!
//! # Cascades
//!
//! The camera's view, from its near plane out to the shadow distance, splits into slices along its
//! view axis. Near slices are short and far slices long, so each slice covers about the same share
//! of the screen: the split distances blend a logarithmic spread with an even one. Each slice is a
//! cascade: an orthographic view along the light's direction whose box holds the slice's eight
//! corners. The box fits the slice again every frame, so its texels change size as the camera
//! turns.
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
//! # Receivers
//!
//! A receiver finds its cascade by its distance along the camera's view, which the camera's scaled
//! forward axis gives from a position relative to the camera. It moves its point along its normal
//! by [`ShadowSettings::normal_bias`] texels of that cascade, and its depth toward the light by
//! [`ShadowSettings::bias`] texels, then compares its depth with the shadow map's. Past the shadow
//! distance nothing is shadowed, and shadows fade out over the last tenth of the distance.

use null3d_core::culling::Frustum;

use crate::camera::{Affine, Mat4, Perspective};

/// The most cascades a directional light's shadow map has.
pub const MAX_CASCADES: usize = 4;

/// How far the split distances lean from an even spread toward a logarithmic one, from 0 to 1.
const SPLIT_LAMBDA: f32 = 0.8;

/// A directional light's shadow settings, as its options give them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShadowSettings {
    /// The cascades, from 1 to [`MAX_CASCADES`].
    pub cascades: u32,
    /// Texels on each side of each cascade's layer of the shadow map.
    pub map_size: u32,
    /// How far each receiver's depth moves toward the light before the comparison, in texels of
    /// its cascade.
    pub bias: f32,
    /// How far each receiver's point moves along its normal before the lookup, in texels of its
    /// cascade.
    pub normal_bias: f32,
    /// The distance along the camera's view, in meters, out to which shadows fall. The camera's far
    /// plane ends them sooner.
    pub distance: f32,
}

impl ShadowSettings {
    /// The number of cascades, within 1 to [`MAX_CASCADES`].
    pub fn cascade_count(&self) -> usize {
        (self.cascades as usize).clamp(1, MAX_CASCADES)
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
    /// The size in meters of one texel of the cascade's layer, on its longer side.
    pub texel: f32,
    /// The change in depth over one meter along the light's direction.
    pub depth_per_meter: f32,
}

impl Default for Cascade {
    fn default() -> Self {
        Self {
            view_proj: [0.0; 16],
            frustum: Frustum::from_planes([[0.0; 4]; 6]),
            end: 0.0,
            texel: 0.0,
            depth_per_meter: 0.0,
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
}

impl Cascades {
    /// The cascades in use, nearest first.
    pub fn used(&self) -> &[Cascade] {
        &self.cascades[..self.count]
    }
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
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

/// The distances along the camera's view where each of `count` slices from `near` to `end` ends.
pub fn split_distances(near: f32, end: f32, count: usize) -> [f32; MAX_CASCADES] {
    let mut splits = [end; MAX_CASCADES];
    for (i, split) in splits.iter_mut().enumerate().take(count) {
        let share = (i + 1) as f32 / count as f32;
        let logarithmic = near * (end / near).powf(share);
        let even = near + (end - near) * share;
        *split = SPLIT_LAMBDA * logarithmic + (1.0 - SPLIT_LAMBDA) * even;
    }
    // The last slice ends exactly at the shadow distance, whatever the rounding.
    splits[count - 1] = end;
    splits
}

/// The cascades of a camera with world transform `camera` and `lens`, drawing into a target of
/// `aspect`, for a directional light whose light travels along `direction`, which has length 1.
pub fn fit_cascades(
    camera: &Affine,
    lens: &Perspective,
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

    let near = lens.near.max(f32::MIN_POSITIVE);
    let end = settings.distance.min(lens.far).max(near * 1.001);
    let ends = split_distances(near, end, count);
    let tan_y = (lens.fov_degrees.to_radians() / 2.0).tan();
    let tan_x = tan_y * aspect;
    let axes = light_axes(direction);
    let map_size = settings.map_size.max(1) as f32;

    let mut out = Cascades {
        count,
        forward,
        ..Cascades::default()
    };
    let mut start = near;
    for (cascade, &end) in out.cascades.iter_mut().zip(&ends).take(count) {
        let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
        for distance in [start, end] {
            for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0), (1.0, 1.0)] {
                let (x, y) = (sx * tan_x * distance, sy * tan_y * distance);
                let corner: [f32; 3] =
                    std::array::from_fn(|k| x * right[k] + y * up[k] - distance * back[k]);
                for (axis, (low, high)) in axes.iter().zip(low.iter_mut().zip(&mut high)) {
                    let along = dot(corner, *axis);
                    *low = low.min(along);
                    *high = high.max(along);
                }
            }
        }
        let (width, height) = (high[0] - low[0], high[1] - low[1]);
        let margin = width.max(height).max(settings.distance);
        let (far_face, light_face) = (low[2], high[2] + margin);
        *cascade = cascade_of(axes, low, high, far_face, light_face, end, map_size);
        start = end;
    }
    out
}

/// A cascade whose box spans `low` to `high` across the light, and from `far_face` to
/// `light_face` along it, in the light's `axes`.
fn cascade_of(
    axes: [[f32; 3]; 3],
    low: [f32; 3],
    high: [f32; 3],
    far_face: f32,
    light_face: f32,
    end: f32,
    map_size: f32,
) -> Cascade {
    let [x, y, z] = axes;
    let (width, height) = (high[0] - low[0], high[1] - low[1]);
    let depth = light_face - far_face;
    let (sx, sy, sz) = (2.0 / width, 2.0 / height, 1.0 / depth);
    let (tx, ty, tz) = (
        -(high[0] + low[0]) / width,
        -(high[1] + low[1]) / height,
        -far_face / depth,
    );
    // Column-major: each column holds one axis's share of x, y and depth in clip space.
    let view_proj = [
        sx * x[0],
        sy * y[0],
        sz * z[0],
        0.0,
        sx * x[1],
        sy * y[1],
        sz * z[1],
        0.0,
        sx * x[2],
        sy * y[2],
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
    Cascade {
        view_proj,
        frustum: Frustum::from_planes(planes),
        end,
        texel: width.max(height) / map_size,
        depth_per_meter: sz,
    }
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
    /// How far each cascade's receivers move along their normals, in meters.
    pub normal_offsets: [f32; MAX_CASCADES],
    /// How far each cascade's receivers move their depth toward the light, in depth units.
    pub depth_biases: [f32; MAX_CASCADES],
}

/// Bytes of [`ShadowUniform`].
pub const SHADOW_UNIFORM_BYTES: usize = 320;

const _: () = assert!(std::mem::size_of::<ShadowUniform>() == SHADOW_UNIFORM_BYTES);

impl ShadowUniform {
    /// The uniform of a frame's cascades, with the biases of `settings`.
    pub fn new(cascades: &Cascades, settings: &ShadowSettings) -> Self {
        let mut uniform = ShadowUniform {
            forward: [
                cascades.forward[0],
                cascades.forward[1],
                cascades.forward[2],
                cascades.count as f32,
            ],
            ..Self::default()
        };
        let last = cascades.used().last().map_or(0.0, |c| c.end);
        uniform.ends = [last; MAX_CASCADES];
        for (k, cascade) in cascades.used().iter().enumerate() {
            uniform.view_proj[k] = cascade.view_proj;
            uniform.ends[k] = cascade.end;
            uniform.normal_offsets[k] = settings.normal_bias * cascade.texel;
            uniform.depth_biases[k] = settings.bias * cascade.texel * cascade.depth_per_meter;
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

    const LENS: Perspective = Perspective {
        fov_degrees: 60.0,
        near: 0.1,
        far: 1000.0,
    };

    const SETTINGS: ShadowSettings = ShadowSettings {
        cascades: 3,
        map_size: 2048,
        bias: 1.0,
        normal_bias: 1.0,
        distance: 200.0,
    };

    /// A camera 5 m up, looking along -z and 20 degrees down, at the origin of the shaders' space.
    fn camera() -> Affine {
        let (s, c) = (-20f32).to_radians().sin_cos();
        [1.0, 0.0, 0.0, 0.0, 0.0, c, -s, 5.0, 0.0, s, c, 0.0]
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
        let tan_y = (LENS.fov_degrees.to_radians() / 2.0).tan();
        let (x, y) = (sx * tan_y * aspect * distance, sy * tan_y * distance);
        std::array::from_fn(|k| {
            x * camera[k * 4] + y * camera[k * 4 + 1] - distance * camera[k * 4 + 2]
        })
    }

    const DOWN_AND_ACROSS: [f32; 3] = [-0.408_248_3, -0.816_496_6, -0.408_248_3];

    #[test]
    fn splits_grow_with_distance_and_the_last_ends_at_the_shadow_distance() {
        for count in 1..=MAX_CASCADES {
            let splits = split_distances(0.1, 200.0, count);
            assert_eq!(splits[count - 1], 200.0);
            let mut before = 0.1;
            for &split in &splits[..count] {
                assert!(split > before, "{splits:?}");
                before = split;
            }
        }
        // Near slices are much shorter than far ones.
        let splits = split_distances(0.1, 200.0, 3);
        assert!(splits[0] < 20.0 && splits[1] < 60.0, "{splits:?}");
    }

    #[test]
    fn every_point_of_each_slice_lands_inside_its_cascade() {
        let camera = camera();
        let aspect = 16.0 / 9.0;
        let cascades = fit_cascades(&camera, &LENS, aspect, DOWN_AND_ACROSS, &SETTINGS);
        assert_eq!(cascades.count, 3);
        let mut start = LENS.near;
        for cascade in cascades.used() {
            for step in 0..=4 {
                let distance = start + (cascade.end - start) * step as f32 / 4.0;
                for sx in [-1.0, -0.3, 0.0, 1.0] {
                    for sy in [-1.0, 0.5, 1.0] {
                        let p = view_point(&camera, aspect, distance, sx, sy);
                        let [x, y, depth] = project(&cascade.view_proj, p);
                        let inside = |v: f32| (-1.0 - 1e-4..=1.0 + 1e-4).contains(&v);
                        assert!(inside(x) && inside(y), "{p:?} -> ({x}, {y})");
                        assert!((-1e-4..1.0).contains(&depth), "{p:?} -> depth {depth}");
                        assert!(cascade.frustum.contains_sphere(p[0], p[1], p[2], 1e-3));
                        // The forward axis gives the distance along the view.
                        let along = dot(p, cascades.forward);
                        assert!((along - distance).abs() < distance * 1e-4 + 1e-4);
                    }
                }
            }
            start = cascade.end;
        }
    }

    #[test]
    fn casters_toward_the_light_stay_and_casters_beside_or_behind_the_box_go() {
        let camera = camera();
        let cascades = fit_cascades(&camera, &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
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
        let near_far = Perspective { far: 50.0, ..LENS };
        for (lens, end) in [(LENS, 200.0), (near_far, 50.0)] {
            let cascades = fit_cascades(&camera, &lens, 1.0, DOWN_AND_ACROSS, &SETTINGS);
            assert_eq!(cascades.used().last().unwrap().end, end);
        }
        // Cascade counts outside 1 to 4 clamp.
        for (asked, count) in [(0, 1), (2, 2), (9, MAX_CASCADES)] {
            let settings = ShadowSettings {
                cascades: asked,
                ..SETTINGS
            };
            let cascades = fit_cascades(&camera, &LENS, 1.0, DOWN_AND_ACROSS, &settings);
            assert_eq!(cascades.count, count);
        }
    }

    #[test]
    fn a_light_straight_down_and_a_scaled_camera_fit_as_well() {
        // A camera turned a quarter about +Y and scaled by 2: its view sees twice as far.
        let camera: Affine = [0.0, 0.0, 2.0, 0.0, 0.0, 2.0, 0.0, 0.0, -2.0, 0.0, 0.0, 0.0];
        let cascades = fit_cascades(&camera, &LENS, 1.0, [0.0, -1.0, 0.0], &SETTINGS);
        for cascade in cascades.used() {
            assert!(cascade.view_proj.iter().all(|v| v.is_finite()));
        }
        // The camera looks along -x, and 10 m along its view is 20 m out.
        let p = [-20.0, 0.0, 0.0];
        assert!((dot(p, cascades.forward) - 10.0).abs() < 1e-4);
    }

    #[test]
    fn the_uniform_scales_the_biases_by_each_cascade_s_texels() {
        let cascades = fit_cascades(&camera(), &LENS, 1.5, DOWN_AND_ACROSS, &SETTINGS);
        let settings = ShadowSettings {
            bias: 2.0,
            normal_bias: 0.5,
            ..SETTINGS
        };
        let uniform = ShadowUniform::new(&cascades, &settings);
        assert_eq!(uniform.forward[3], 3.0);
        assert_eq!(uniform.as_bytes().len(), SHADOW_UNIFORM_BYTES);
        for (k, cascade) in cascades.used().iter().enumerate() {
            assert_eq!(uniform.view_proj[k], cascade.view_proj);
            assert_eq!(uniform.ends[k], cascade.end);
            assert_eq!(uniform.normal_offsets[k], 0.5 * cascade.texel);
            let depth = 2.0 * cascade.texel * cascade.depth_per_meter;
            assert!((uniform.depth_biases[k] - depth).abs() <= depth * 1e-6);
        }
        // Far cascades have larger texels.
        let texels: Vec<f32> = cascades.used().iter().map(|c| c.texel).collect();
        assert!(
            texels.windows(2).all(|pair| pair[0] < pair[1]),
            "{texels:?}"
        );
        // The unused cascade ends where the last one does.
        assert_eq!(uniform.ends[3], 200.0);
    }
}
