//! Sprites: rows of an instance batch that draw as quads facing the camera, each with its own
//! size, rotation, color and frame of a texture atlas.
//!
//! A sprite batch is an [`InstanceBatch`](crate::instances::InstanceBatch) whose update packs each
//! row's sprite into the 3 × 4 world matrix that every other row gets. Culling, the transparent
//! pass's sort, grid cells, layers and uploads then treat sprites as they treat any row, on both
//! GPU paths, and the sprite template's vertex shader unpacks the matrix again.
//!
//! # The packed matrix
//!
//! By rows, as [`Affine`] holds it:
//!
//! | Row | x | y | z | w |
//! | --- | --- | --- | --- | --- |
//! | 0 | width | rotation × [`SMALL`] | frame bits × [`BITS`] | x |
//! | 1 | red × [`SMALL`] | height | 0 | y |
//! | 2 | green × [`SMALL`] | blue × [`SMALL`] | alpha × [`SMALL`] | z |
//!
//! The translation is the position relative to the row's cell, as for any row, so the culling
//! shader and the WebGL2 vertex shader move it by the cell's offset from the camera unchanged.
//! Culling takes a row's radius from the longest column of the matrix. The width and the height sit
//! on the diagonal, and every packed value is scaled down to a few thousandths at most, so the
//! longest column is the larger side, as for a quad scaled by the size. The local radius of the
//! batch's quad then bounds the sprite whatever its rotation. The scale factors are powers of two,
//! so the shader multiplies each value back exactly.
//!
//! The frame bits hold the frame's column in the atlas, its row counted from the bottom of the
//! image, and a bit for sprites whose size is in pixels of the screen. Such a sprite's world size
//! changes with its distance, so its sphere is unbounded, and culling never rejects it.

use crate::math::Affine;
use crate::world::UNBOUNDED_RADIUS;

/// The factor of the colors and the rotation in the packed matrix: 2^-20.
pub const SMALL: f32 = 1.0 / 1_048_576.0;
/// The factor of the frame bits in the packed matrix: 2^-32.
pub const BITS: f32 = 1.0 / 4_294_967_296.0;
/// The largest color component a sprite keeps: brighter ones are clamped to it.
pub const MAX_COLOR: f32 = 1024.0;
/// Columns and rows of an atlas at most: each frame's column and row take 11 bits.
pub const MAX_ATLAS_SIDE: u32 = 1 << FRAME_SHIFT;
/// The bit shift of the frame's row in the frame bits.
const FRAME_SHIFT: u32 = 11;
/// The frame bit of a sprite whose size is in pixels of the screen.
pub const SCREEN_SIZE_BIT: u32 = 1 << (2 * FRAME_SHIFT);

/// What every sprite of a batch shares: the atlas's grid, and whether sizes are in pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpriteLook {
    /// Columns of frames in the atlas, from 1 to [`MAX_ATLAS_SIDE`].
    pub columns: u32,
    /// Rows of frames in the atlas, from 1 to [`MAX_ATLAS_SIDE`].
    pub rows: u32,
    /// True when sizes are in CSS pixels of the screen, false when they are in world units.
    pub screen_size: bool,
}

impl SpriteLook {
    /// A look with the atlas clamped to the sides the frame bits can hold.
    pub fn new(columns: u32, rows: u32, screen_size: bool) -> Self {
        Self {
            columns: columns.clamp(1, MAX_ATLAS_SIDE),
            rows: rows.clamp(1, MAX_ATLAS_SIDE),
            screen_size,
        }
    }

    /// The frame bits of frame `frame`, counted from the atlas's top left, row by row. A frame past
    /// the last one wraps around.
    pub fn frame_bits(&self, frame: u32) -> u32 {
        let frame = frame % (self.columns * self.rows);
        let column = frame % self.columns;
        let row = self.rows - 1 - frame / self.columns;
        let screen = if self.screen_size { SCREEN_SIZE_BIT } else { 0 };
        column | (row << FRAME_SHIFT) | screen
    }
}

/// A rotation in radians wrapped into `-π..=π`, where its packed value stays small.
#[inline(always)]
fn wrapped(rotation: f32) -> f32 {
    use std::f32::consts::{PI, TAU};
    if (-PI..=PI).contains(&rotation) {
        rotation
    } else if rotation.is_finite() {
        rotation - TAU * (rotation / TAU).round()
    } else {
        0.0
    }
}

/// A color component clamped to what a sprite keeps, with NaN as 0.
#[inline(always)]
fn component(value: f32, max: f32) -> f32 {
    if value > 0.0 { value.min(max) } else { 0.0 }
}

/// The packed matrix of one sprite (see the module documentation), at `position` relative to its
/// cell, `size` wide and high, turned by `rotation` radians, with linear color `color` and frame
/// bits `bits`.
#[inline(always)]
pub fn pack(
    position: [f32; 3],
    size: [f32; 2],
    rotation: f32,
    color: [f32; 4],
    bits: u32,
) -> Affine {
    let [x, y, z] = position;
    let [r, g, b] = [0, 1, 2].map(|k| component(color[k], MAX_COLOR) * SMALL);
    let a = component(color[3], 1.0) * SMALL;
    [
        size[0],
        wrapped(rotation) * SMALL,
        bits as f32 * BITS,
        x,
        r,
        size[1],
        0.0,
        y,
        g,
        b,
        a,
        z,
    ]
}

/// The world sphere of a packed sprite whose quad has `local_radius` around its anchor.
#[inline(always)]
pub fn sphere(matrix: &Affine, local_radius: f32, bits: u32) -> [f32; 4] {
    let radius = if bits & SCREEN_SIZE_BIT != 0 {
        UNBOUNDED_RADIUS
    } else {
        local_radius * crate::math::max_axis_scale(matrix)
    };
    [matrix[3], matrix[7], matrix[11], radius]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shader's unpacking: each value multiplied back by its factor.
    fn unpack(m: &Affine) -> ([f32; 2], f32, [f32; 4], u32) {
        let color = [m[4], m[8], m[9], m[10]].map(|v| v / SMALL);
        ([m[0], m[5]], m[1] / SMALL, color, (m[2] / BITS) as u32)
    }

    #[test]
    fn a_packed_sprite_unpacks_exactly() {
        let look = SpriteLook::new(4, 2, false);
        let bits = look.frame_bits(5);
        let color = [0.25, 0.123_456_7, 3.5, 0.5];
        let m = pack([1.0, 2.0, 3.0], [2.5, 0.75], 1.234_567, color, bits);
        let (size, rotation, unpacked, unpacked_bits) = unpack(&m);
        assert_eq!(size, [2.5, 0.75]);
        assert_eq!(rotation, 1.234_567);
        assert_eq!(unpacked, color);
        assert_eq!(unpacked_bits, bits);
        assert_eq!([m[3], m[7], m[11]], [1.0, 2.0, 3.0]);
    }

    #[test]
    fn frames_count_from_the_top_left_and_wrap() {
        let look = SpriteLook::new(4, 2, false);
        // Frame 0 is the top left: column 0 of the top row, which is row 1 from the bottom.
        assert_eq!(look.frame_bits(0), 1 << FRAME_SHIFT);
        assert_eq!(look.frame_bits(3), 3 | (1 << FRAME_SHIFT));
        // Frame 5 is column 1 of the bottom row.
        assert_eq!(look.frame_bits(5), 1);
        assert_eq!(look.frame_bits(8), look.frame_bits(0));
        let screen = SpriteLook::new(1, 1, true);
        assert_eq!(screen.frame_bits(7), SCREEN_SIZE_BIT);
    }

    #[test]
    fn the_atlas_is_clamped_to_what_the_bits_hold() {
        let look = SpriteLook::new(0, 5000, false);
        assert_eq!((look.columns, look.rows), (1, MAX_ATLAS_SIDE));
        let last = look.frame_bits(MAX_ATLAS_SIDE - 1);
        assert_eq!(last >> FRAME_SHIFT, 0);
        assert!(last < SCREEN_SIZE_BIT);
    }

    #[test]
    fn rotations_wrap_and_colors_clamp() {
        use std::f32::consts::PI;
        let m = pack(
            [0.0; 3],
            [1.0, 1.0],
            2.5 * PI,
            [-1.0, f32::NAN, 5000.0, 2.0],
            0,
        );
        let (_, rotation, color, _) = unpack(&m);
        assert!((rotation - 0.5 * PI).abs() < 1e-5);
        assert_eq!(color, [0.0, 0.0, MAX_COLOR, 1.0]);
        let m = pack([0.0; 3], [1.0, 1.0], f32::INFINITY, [1.0; 4], 0);
        assert_eq!(m[1], 0.0);
    }

    #[test]
    fn the_sphere_follows_the_larger_side_or_is_unbounded_on_screen() {
        let bits = SpriteLook::new(2048, 2048, false).frame_bits(2048 * 2048 - 1);
        let m = pack(
            [0.0; 3],
            [0.5, 2.0],
            PI_ISH,
            [MAX_COLOR, MAX_COLOR, MAX_COLOR, 1.0],
            bits,
        );
        let [_, _, _, radius] = sphere(&m, 0.75, bits);
        // The packed values add at most a few thousandths to the larger side.
        assert!((1.5..1.51).contains(&radius), "{radius}");
        let screen = SpriteLook::new(1, 1, true).frame_bits(0);
        assert_eq!(sphere(&m, 0.75, screen)[3], UNBOUNDED_RADIUS);
    }

    const PI_ISH: f32 = 3.0;
}
