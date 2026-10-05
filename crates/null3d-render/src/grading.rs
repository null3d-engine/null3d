//! Color grading and the vignette, which the final pass applies: the vignette to HDR color before
//! the tone mapping, and the table to the canvas color after the tone mapping and the sRGB
//! encoding, as three.js's `LUTPass` does after its `OutputPass`.
//!
//! A color grading table is a 3D texture of the texture store (see [`crate::textures`]): a lookup
//! table whose texel at (r, g, b) holds the graded color of that display color. The final pass
//! reads it with a linear filter between texel centers, as `LUTPass` does, and blends the result
//! with the color by the table's intensity. A table's file may name the range of colors that it
//! covers, its domain, which `LUTPass` leaves out; the final pass maps the color into it.
//!
//! The vignette multiplies each pixel's HDR color by a factor that falls from 1 at the canvas's
//! center toward its edges, as Filament, URP, Bevy and Babylon.js do: darkening before the tone
//! curve keeps bright corners from turning gray. Its default falloff, a power of 2, darkens linear
//! color about as three.js's `VignetteShader` darkens display color toward black, so a port maps
//! `offset` to the size and `darkness` to the intensity.
//!
//! Both are values of the final pass's settings, not builds of its shader: the pass binds a blank
//! table of one texel while the sketch sets none, and its flags say what to apply. So turning
//! either on builds no pipeline. The 8-bit path's scene shaders tone map and encode color
//! themselves, so there the final pass grades display color, and multiplies the vignette's factor
//! into the linear value of the display color.

use null3d_core::handle::Handle;

/// A color grading table as the sketch sets it: its texture, how much of its color replaces the
/// pixel's, and the colors that its first and last texels stand for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lut {
    /// The table's 3D texture in the texture store.
    pub texture: Handle,
    /// The share of the graded color, from 0 for none to 1 for all of it, as `LUTPass`'s
    /// intensity.
    pub intensity: f32,
    /// The color that the table's first texel along each axis stands for, red first.
    pub domain_min: [f32; 3],
    /// The color that its last texel along each axis stands for.
    pub domain_max: [f32; 3],
}

impl Lut {
    /// The scale and the offset that place a display color in a table of `size` texels along each
    /// axis, as texture coordinates from 0 to 1: the domain's ends land on the centers of the first
    /// and last texels, as `LUTPass` pulls each sample in by half a texel. The scale's last value
    /// holds the intensity. An axis whose domain gives no finite placement that spreads colors, such
    /// as an empty domain or one too wide or too narrow for 32-bit floats, takes the domain from 0
    /// to 1, so no pixel samples at NaN.
    pub(crate) fn placement(&self, size: [u32; 3]) -> ([f32; 4], [f32; 4]) {
        let mut scale = [0.0, 0.0, 0.0, self.intensity];
        let mut offset = [0.0; 4];
        for axis in 0..3 {
            let texels = size[axis].max(1) as f32;
            let span = self.domain_max[axis] - self.domain_min[axis];
            let inner = 1.0 - 1.0 / texels;
            scale[axis] = inner / span;
            offset[axis] = 0.5 / texels - self.domain_min[axis] * scale[axis];
            let placed = scale[axis] > 0.0 && scale[axis].is_finite() && offset[axis].is_finite();
            if !placed {
                scale[axis] = inner;
                offset[axis] = 0.5 / texels;
            }
        }
        (scale, offset)
    }
}

/// The vignette: at a place `d` from the canvas's center, in canvas widths and heights scaled by
/// the size, the factor is `mix(1 - intensity, 1, (1 - |d|²)^falloff)`, at least 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vignette {
    /// How dark the edges turn: 0 leaves them as they are, and 1 darkens them to black where the
    /// falloff reaches 0. Above 1 they reach black sooner.
    pub intensity: f32,
    /// How much of the picture the darkening covers: it scales the distance from the center. From
    /// the square root of 2, the corners take the full intensity.
    pub size: f32,
    /// The power of the falloff from the center, above 0: higher values darken more of the
    /// picture.
    pub falloff: f32,
    /// The shape: 0 follows the canvas's shape, as three.js's does, and 1 makes a circle.
    pub roundness: f32,
}

impl Vignette {
    /// The vignette's four values as the final pass's settings hold them.
    pub(crate) fn uniform(self) -> [f32; 4] {
        [self.intensity, self.size, self.falloff, self.roundness]
    }
}

/// What the final pass grades a frame with: the table, once its texels are on the GPU, and the
/// vignette.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Grading {
    /// The table's GPU texture id, with its scale and offset (see [`Lut::placement`]).
    pub(crate) lut: Option<(u32, [f32; 4], [f32; 4])>,
    pub(crate) vignette: Option<Vignette>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lut(min: f32, max: f32) -> Lut {
        Lut {
            texture: Handle::NONE,
            intensity: 0.75,
            domain_min: [min; 3],
            domain_max: [max; 3],
        }
    }

    /// Where a color lands in a table of `size` texels, as texture coordinates.
    fn place(lut: &Lut, size: u32, color: f32) -> f32 {
        let (scale, offset) = lut.placement([size; 3]);
        color * scale[0] + offset[0]
    }

    #[test]
    fn the_domain_s_ends_land_on_the_first_and_last_texel_centers() {
        let size = 33;
        let half = 0.5 / size as f32;
        for (min, max) in [(0.0, 1.0), (-0.25, 2.0)] {
            let table = lut(min, max);
            assert!((place(&table, size, min) - half).abs() < 1e-6);
            assert!((place(&table, size, max) - (1.0 - half)).abs() < 1e-6);
            assert_eq!(table.placement([size; 3]).0[3], 0.75);
        }
    }

    #[test]
    fn a_domain_past_32_bit_floats_places_colors_as_the_unit_domain() {
        let size = 17;
        let unit = lut(0.0, 1.0).placement([size; 3]);
        for (min, max) in [
            (f32::NEG_INFINITY, 1.0),
            (0.0, 1e-40),
            (-3e38, 3e38),
            (1.0, 1.0),
        ] {
            assert_eq!(lut(min, max).placement([size; 3]), unit, "{min} to {max}");
        }
    }

    #[test]
    fn the_unit_domain_matches_three_js_lut_pass() {
        // LUTPass reads halfPixelWidth + color * (1 - pixelWidth).
        let size = 17;
        let table = lut(0.0, 1.0);
        for color in [0.0, 0.3, 0.5, 1.0] {
            let three = 0.5 / size as f32 + color * (1.0 - 1.0 / size as f32);
            assert!((place(&table, size, color) - three).abs() < 1e-6);
        }
    }
}
