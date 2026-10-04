//! Lines: rows of an instance batch that draw as wide line segments, as three.js's `Line2` and
//! `LineSegments2` draw them with a `LineMaterial`.
//!
//! A line batch owns points, with a linear color each, and draws one row per segment between two
//! of them. The [`LineMode`] says which points each segment joins. The batch's update packs each
//! segment into the 3 × 4 world matrix that every other row gets, so culling, the transparent
//! pass's sort, grid cells, layers and uploads treat segments as they treat any row, on both GPU
//! paths, and the line template's vertex shader unpacks the matrix again.
//!
//! # The packed matrix
//!
//! By rows, as [`Affine`] holds it:
//!
//! | Row | x | y | z | w |
//! | --- | --- | --- | --- | --- |
//! | 0 | half segment x | start color × [`TINY`] | width × [`TINY`] | middle x |
//! | 1 | half segment y | end color × [`TINY`] | look bits × [`TINY`] | middle y |
//! | 2 | half segment z | start distance × [`TINY`] | reach | middle z |
//!
//! The translation is the segment's middle relative to the row's cell, as for any row, so the
//! culling shader and the WebGL2 vertex shader move it by the cell's offset from the camera
//! unchanged. The first column runs from the middle to the end point. The colors are the end
//! points' colors in sRGB, 8 bits a channel, as a 24-bit whole number each. The start distance is
//! the length of the line before the segment, which dashes follow. The width is in CSS pixels, or
//! in world units with [`WORLD_UNITS_BIT`].
//!
//! Culling takes a row's radius from the longest column of the matrix, times the radius of the
//! batch's mesh. The reach makes the third column long enough that the sphere holds the segment
//! and its width in the world: half the segment's length, plus half the width when the width is in
//! world units, divided by the mesh's radius. The segment mesh's corners lie within one unit of
//! its origin, so the first column, half the segment, never makes the sphere larger. A width in pixels has no size in the world, so such a
//! segment culls by its center line alone, as three.js culls a `Line2` by its points. Every other
//! packed value is scaled down to a tiny fraction, and the factor is a power of two, so the shader
//! multiplies each value back exactly.

use std::ops::Range;
use std::sync::OnceLock;

use crate::math::Affine;

/// The factor of the colors, the distance, the width and the look bits in the packed matrix:
/// 2^-32.
pub const TINY: f32 = 1.0 / 4_294_967_296.0;
/// The look bit of a line whose width is in world units rather than CSS pixels.
pub const WORLD_UNITS_BIT: u32 = 1;
/// The look bit of a dashed line.
pub const DASHED_BIT: u32 = 2;

/// Which points each segment of a line batch joins.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineMode {
    /// Each pair of points is a segment of its own, as three.js's `LineSegments` draws them.
    Segments = 0,
    /// One line through every point in turn, as three.js's `Line` and `Line2` draw it.
    Strip = 1,
    /// One line through every point in turn and back to the first, as three.js's `LineLoop` draws
    /// it.
    Loop = 2,
}

impl LineMode {
    /// The mode of a code, as [`LineMode`]'s values number them.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Segments),
            1 => Some(Self::Strip),
            2 => Some(Self::Loop),
            _ => None,
        }
    }

    /// The segments that `points` points make.
    pub const fn rows(self, points: u32) -> u32 {
        match self {
            Self::Segments => points / 2,
            Self::Strip => points.saturating_sub(1),
            Self::Loop if points >= 2 => points,
            Self::Loop => 0,
        }
    }

    /// The points that segment `row` joins, of a line of `points` points.
    #[inline(always)]
    pub const fn ends(self, row: u32, points: u32) -> (u32, u32) {
        match self {
            Self::Segments => (row * 2, row * 2 + 1),
            Self::Strip => (row, row + 1),
            Self::Loop if row + 1 >= points => (row, 0),
            Self::Loop => (row, row + 1),
        }
    }

    /// The segments that use any of the points `points.start..points.end`, of a line of `active`
    /// points, before the closing segment of a loop. A loop's closing segment also uses point 0.
    pub fn rows_of_points(self, points: Range<u32>, active: u32) -> Range<u32> {
        let rows = self.rows(active);
        let range = match self {
            Self::Segments => points.start / 2..points.end.div_ceil(2),
            Self::Strip | Self::Loop => points.start.saturating_sub(1)..points.end,
        };
        range.start.min(rows)..range.end.min(rows)
    }
}

/// What every segment of a line batch shares.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineLook {
    /// Which points each segment joins.
    pub mode: LineMode,
    /// The width: CSS pixels, or world units with `world_units`.
    pub width: f32,
    /// True when the width is in world units, false when it is in CSS pixels.
    pub world_units: bool,
    /// True when the line draws dashes, whose distances along the line the update keeps.
    pub dashed: bool,
}

impl LineLook {
    /// A look with a width that is not a positive number taken as 0, which draws nothing.
    pub fn new(mode: LineMode, width: f32, world_units: bool, dashed: bool) -> Self {
        Self {
            mode,
            width: valid_width(width),
            world_units,
            dashed,
        }
    }

    /// The look bits that the shader reads.
    pub const fn bits(&self) -> u32 {
        (if self.world_units { WORLD_UNITS_BIT } else { 0 })
            | (if self.dashed { DASHED_BIT } else { 0 })
    }
}

/// A width that is not a positive finite number taken as 0.
pub fn valid_width(width: f32) -> f32 {
    if width > 0.0 && width.is_finite() {
        width
    } else {
        0.0
    }
}

/// The linear values where each 8-bit sRGB code ends: code `k` holds the values from entry
/// `k - 1` up to entry `k`, which is the linear value of `(k + 0.5) / 255` in sRGB.
fn srgb_bounds() -> &'static [f32; 255] {
    static BOUNDS: OnceLock<[f32; 255]> = OnceLock::new();
    BOUNDS.get_or_init(|| {
        std::array::from_fn(|k| {
            let encoded = (k as f64 + 0.5) / 255.0;
            let linear = if encoded <= 0.040_45 {
                encoded / 12.92
            } else {
                ((encoded + 0.055) / 1.055).powf(2.4)
            };
            linear as f32
        })
    })
}

/// The 8-bit sRGB code of a linear value, rounded to the nearest code, as encoding the value and
/// rounding it gives. Values from 1 up take 255, and values from 0 down and NaN take 0. A binary
/// search over the codes' bounds needs no power function.
#[inline(always)]
fn srgb_code(bounds: &[f32; 255], value: f32) -> u32 {
    let mut code = 0usize;
    let mut step = 128;
    while step > 0 {
        // The bound after the codes up to `code + step - 1`.
        let next = code + step - 1;
        if next < 255 && bounds[next] <= value {
            code += step;
        }
        step /= 2;
    }
    code as u32
}

/// A linear color as three 8-bit sRGB codes in one whole number: red in the low byte, then green,
/// then blue.
#[inline(always)]
pub fn srgb8(color: [f32; 3]) -> u32 {
    let bounds = srgb_bounds();
    srgb_code(bounds, color[0])
        | (srgb_code(bounds, color[1]) << 8)
        | (srgb_code(bounds, color[2]) << 16)
}

/// One segment, as the update reads it from the batch's points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    /// The middle relative to the row's cell.
    pub middle: [f32; 3],
    /// From the middle to the end point.
    pub half: [f32; 3],
    /// The start and end colors, as [`srgb8`] packs them.
    pub colors: [u32; 2],
    /// The length of the line before the segment.
    pub distance: f32,
}

/// The packed matrix of one segment (see the module documentation), with the look of its batch,
/// whose mesh has `local_radius` around its origin.
#[inline(always)]
pub fn pack(segment: &Segment, look: &LineLook, local_radius: f32) -> Affine {
    let Segment {
        middle: [x, y, z],
        half,
        colors,
        distance,
    } = *segment;
    let length = (half[0] * half[0] + half[1] * half[1] + half[2] * half[2]).sqrt();
    let world_width = if look.world_units { look.width } else { 0.0 };
    let reach = (length + 0.5 * world_width) / local_radius.max(f32::MIN_POSITIVE);
    [
        half[0],
        colors[0] as f32 * TINY,
        look.width * TINY,
        x,
        half[1],
        colors[1] as f32 * TINY,
        look.bits() as f32 * TINY,
        y,
        half[2],
        distance * TINY,
        reach,
        z,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::world_sphere;

    /// The exact sRGB code of a linear value, with the power function.
    fn exact(value: f32) -> u32 {
        let v = f64::from(value).clamp(0.0, 1.0);
        let encoded = if v <= 0.003_130_8 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        };
        (encoded * 255.0).round() as u32
    }

    #[test]
    fn colors_encode_as_rounding_the_srgb_value_gives() {
        for step in 0..=4096 {
            let value = step as f32 / 4096.0;
            assert_eq!(srgb_code(srgb_bounds(), value), exact(value), "{value}");
        }
        // Every 8-bit sRGB color comes back as itself.
        for code in 0..=255u32 {
            let encoded = f64::from(code) / 255.0;
            let linear = if encoded <= 0.040_45 {
                encoded / 12.92
            } else {
                ((encoded + 0.055) / 1.055).powf(2.4)
            };
            assert_eq!(srgb_code(srgb_bounds(), linear as f32), code);
        }
        assert_eq!(srgb8([1.0, 0.0, 2.0]), 0xff_00ff);
        assert_eq!(srgb8([-1.0, f32::NAN, 0.5]), exact(0.5) << 16);
    }

    #[test]
    fn modes_join_their_points() {
        assert_eq!(LineMode::Segments.rows(5), 2);
        assert_eq!(LineMode::Strip.rows(5), 4);
        assert_eq!(LineMode::Loop.rows(5), 5);
        assert_eq!(LineMode::Loop.rows(1), 0);
        assert_eq!(LineMode::Strip.rows(0), 0);
        assert_eq!(LineMode::Segments.ends(1, 6), (2, 3));
        assert_eq!(LineMode::Strip.ends(3, 5), (3, 4));
        assert_eq!(LineMode::Loop.ends(4, 5), (4, 0));
        assert_eq!(LineMode::Loop.ends(2, 3), (2, 0));
        assert_eq!(LineMode::Segments.rows_of_points(3..4, 8), 1..2);
        assert_eq!(LineMode::Strip.rows_of_points(3..5, 8), 2..5);
        assert_eq!(LineMode::Strip.rows_of_points(0..8, 8), 0..7);
        assert_eq!(LineMode::Loop.rows_of_points(0..1, 8), 0..1);
        assert_eq!(LineMode::Loop.rows_of_points(7..8, 8), 6..8);
        for code in 0..3 {
            assert_eq!(LineMode::from_code(code).map(|m| m as u32), Some(code));
        }
        assert_eq!(LineMode::from_code(3), None);
    }

    /// The shader's unpacking: each value multiplied back by its factor.
    fn unpack(m: &Affine) -> (Segment, f32, u32) {
        let back = |v: f32| (v / TINY) as u32;
        let segment = Segment {
            middle: [m[3], m[7], m[11]],
            half: [m[0], m[4], m[8]],
            colors: [back(m[1]), back(m[5])],
            distance: m[9] / TINY,
        };
        (segment, m[2] / TINY, back(m[6]))
    }

    #[test]
    fn a_packed_segment_unpacks_exactly() {
        let segment = Segment {
            middle: [1.0, 2.0, 3.0],
            half: [0.5, -0.25, 4.0],
            colors: [0xff_ffff, 0x12_3456],
            distance: 1234.567,
        };
        let look = LineLook::new(LineMode::Strip, 7.5, false, true);
        let (unpacked, width, bits) = unpack(&pack(&segment, &look, 2.0));
        assert_eq!(unpacked, segment);
        assert_eq!(width, 7.5);
        assert_eq!(bits, DASHED_BIT);
    }

    #[test]
    fn the_sphere_holds_the_segment_and_a_width_in_world_units() {
        let segment = Segment {
            middle: [0.0; 3],
            half: [3.0, 4.0, 0.0],
            colors: [0xff_ffff; 2],
            distance: 1.0e6,
        };
        // The segment mesh's corners lie within one unit of its origin.
        let radius = 1.0;
        for (world_units, reach) in [(false, 5.0), (true, 6.0)] {
            let look = LineLook::new(LineMode::Segments, 2.0, world_units, true);
            let sphere = world_sphere(&pack(&segment, &look, radius), radius);
            assert!((sphere[3] - reach).abs() < 1e-4, "{sphere:?}");
        }
        // A segment of no length keeps a sphere of half its width.
        let short = Segment {
            half: [0.0, 0.0, 0.0],
            ..segment
        };
        let look = LineLook::new(LineMode::Segments, 2.0, true, false);
        assert!(world_sphere(&pack(&short, &look, radius), radius)[3] > 0.999);
        assert_eq!(
            LineLook::new(LineMode::Strip, -1.0, false, false).width,
            0.0
        );
        assert_eq!(
            LineLook::new(LineMode::Strip, f32::NAN, false, false).width,
            0.0
        );
    }
}
