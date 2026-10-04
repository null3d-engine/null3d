//! Equirectangular images of the light around a point, as Radiance and OpenEXR files hold them.

use std::f32::consts::PI;

use super::vector::{Vec3, add, scale};

/// The largest width or height the tool reads: 16,384 texels.
pub const MAX_SIDE: usize = 16_384;

/// An equirectangular image of linear RGB light. Row 0 is the top, the direction +Y. Columns run
/// as three.js maps them: the middle column faces +X, a quarter of the way faces -Z, and three
/// quarters face +Z.
pub struct Equirect {
    pub width: usize,
    pub height: usize,
    pub texels: Vec<Vec3>,
}

impl Equirect {
    /// An image of `width` by `height` texels, or why the size cannot be read.
    ///
    /// # Errors
    /// When either side is 0 or larger than [`MAX_SIDE`].
    pub fn new(width: usize, height: usize, texels: Vec<Vec3>) -> Result<Self, String> {
        if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
            return Err(format!(
                "the image is {width} x {height} texels, and the tool reads images from 1 to {MAX_SIDE} texels on each side"
            ));
        }
        debug_assert_eq!(texels.len(), width * height);
        let texels = texels
            .into_iter()
            .map(|t| t.map(|c| if c.is_finite() && c > 0.0 { c } else { 0.0 }))
            .collect();
        Ok(Self {
            width,
            height,
            texels,
        })
    }

    /// The light in a unit direction, filtered bilinearly. The image wraps around across its
    /// width and stops at its top and bottom rows.
    pub fn sample(&self, d: Vec3) -> Vec3 {
        let u = d[2].atan2(d[0]) * (0.5 / PI) + 0.5;
        let v = d[1].clamp(-1.0, 1.0).asin() * (1.0 / PI) + 0.5;
        let fx = u * self.width as f32 - 0.5;
        let fy = ((1.0 - v) * self.height as f32 - 0.5).clamp(0.0, (self.height - 1) as f32);
        let x0 = fx.floor();
        let wx = fx - x0;
        let width = self.width as isize;
        let x0 = (x0 as isize).rem_euclid(width) as usize;
        let x1 = (x0 + 1) % self.width;
        let y0 = fy as usize;
        let y1 = (y0 + 1).min(self.height - 1);
        let wy = fy - y0 as f32;
        let at = |x: usize, y: usize| self.texels[y * self.width + x];
        let row = |y: usize| add(scale(at(x0, y), 1.0 - wx), scale(at(x1, y), wx));
        add(scale(row(y0), 1.0 - wy), scale(row(y1), wy))
    }

    /// How many directions per side a cube map texel `size` texels wide averages, so that each
    /// texel covers the image's texels under it.
    pub fn samples_per_texel(&self, size: usize) -> usize {
        (self.width.div_ceil(4 * size) + 1).clamp(2, 8)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directions_land_where_three_js_puts_them() {
        // A 4 x 2 image whose columns are 0, 1, 2 and 3.
        let texels = (0..8)
            .map(|i| [(i % 4) as f32, (i / 4) as f32, 0.0])
            .collect();
        let image = Equirect::new(4, 2, texels).expect("an image");
        // u = 0.5 at +X: between columns 1 and 2.
        assert!((image.sample([1.0, 0.0, 0.0])[0] - 1.5).abs() < 1e-5);
        // u = 0.75 at +Z: between columns 2 and 3.
        assert!((image.sample([0.0, 0.0, 1.0])[0] - 2.5).abs() < 1e-5);
        // Straight up reads the top row only.
        assert_eq!(image.sample([0.0, 1.0, 0.0])[1], 0.0);
        assert_eq!(image.sample([0.0, -1.0, 0.0])[1], 1.0);
    }

    #[test]
    fn bad_values_read_as_no_light() {
        let image =
            Equirect::new(2, 1, vec![[f32::NAN, -1.0, f32::INFINITY], [1.0; 3]]).expect("an image");
        assert_eq!(image.texels[0], [0.0; 3]);
        assert!(Equirect::new(0, 1, Vec::new()).is_err());
    }
}
