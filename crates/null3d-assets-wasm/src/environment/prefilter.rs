//! The reflection levels: the environment's light filtered by the GGX distribution of
//! glTF's metallic-roughness model, one roughness per level.
//!
//! Each texel takes the split-sum view: the normal, the view and the reflection all point along the
//! texel's direction (Karis, "Real Shading in Unreal Engine 4", 2013). Directions come from GGX
//! importance sampling of half vectors, weighted by the cosine of the light's angle, and each one
//! reads a smaller level of the source as its sample covers more of the sphere (Křivánek and
//! Colbert, "Real-time Shading with Filtered Importance Sampling", 2008). The samples form a
//! Hammersley set, the same for every texel, so the output does not depend on chance.

use std::f32::consts::PI;

use super::cube::{Chain, Cube, FACES};
use super::vector::{Vec3, add, frame, scale};

/// One direction of the filter, in the frame of the texel's direction.
struct Tap {
    /// The direction of the light, with the texel's direction as +Z.
    direction: Vec3,
    /// The weight: the cosine between the light and the texel's direction.
    weight: f32,
    /// The source level that covers the sample's share of the sphere.
    lod: f32,
}

/// Van der Corput's radical inverse in base 2.
fn radical_inverse(i: u32) -> f32 {
    i.reverse_bits() as f32 * (1.0 / 4_294_967_296.0)
}

/// The filter's directions for a perceptual roughness, for a source whose largest faces are
/// `source_size` texels wide.
fn taps(roughness: f32, count: u32, source_size: usize) -> Vec<Tap> {
    let alpha = roughness * roughness;
    let alpha2 = alpha * alpha;
    let texel_solid_angle = 4.0 * PI / (FACES * source_size * source_size) as f32;
    (0..count)
        .filter_map(|i| {
            let u = i as f32 / count as f32;
            let phi = 2.0 * PI * radical_inverse(i);
            let cos2 = (1.0 - u) / (1.0 + (alpha2 - 1.0) * u);
            let cos = cos2.sqrt();
            let sin = (1.0 - cos2).max(0.0).sqrt();
            let half = [sin * phi.cos(), sin * phi.sin(), cos];
            let light = [2.0 * cos * half[0], 2.0 * cos * half[1], 2.0 * cos2 - 1.0];
            if light[2] <= 0.0 {
                return None;
            }
            // With the view along the normal, the light's density is D / 4.
            let d = alpha2 / (PI * (cos2 * (alpha2 - 1.0) + 1.0).powi(2));
            let solid_angle = 4.0 / (count as f32 * d);
            let lod = (0.5 * (solid_angle / texel_solid_angle).log2() + 1.0).max(0.0);
            Some(Tap {
                direction: light,
                weight: light[2],
                lod,
            })
        })
        .collect()
}

/// A level of `size` texels per face side, filtered for `roughness` from `source`.
pub fn level(source: &Chain, size: usize, roughness: f32, count: u32) -> Cube {
    let taps = taps(roughness, count, source.size());
    let total: f32 = taps.iter().map(|t| t.weight).sum();
    let mut texels = Vec::with_capacity(FACES * size * size);
    for face in 0..FACES {
        for y in 0..size {
            for x in 0..size {
                let n = Cube::texel_direction(size, face, x, y);
                let (t, b) = frame(n);
                let mut sum = [0.0; 3];
                for tap in &taps {
                    let [lx, ly, lz] = tap.direction;
                    let d = add(add(scale(t, lx), scale(b, ly)), scale(n, lz));
                    sum = add(sum, scale(source.sample(d, tap.lod), tap.weight));
                }
                texels.push(scale(sum, 1.0 / total));
            }
        }
    }
    Cube { size, texels }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_constant_environment_stays_constant() {
        let cube = Cube::from_fn(16, 1, |_| [2.0, 1.0, 0.5]);
        let out = level(&Chain::new(&cube), 8, 0.6, 128);
        for t in &out.texels {
            assert!(
                (t[0] - 2.0).abs() < 1e-4 && (t[2] - 0.5).abs() < 1e-4,
                "{t:?}"
            );
        }
    }

    #[test]
    fn full_roughness_gives_the_cosine_weighted_hemisphere() {
        // With a roughness of 1 the GGX lobe reflects light evenly over the hemisphere, so the
        // level holds the irradiance over pi. Light that grows with y: the mean over the
        // hemisphere around +Y, weighted by the cosine, is 1 + 2/3.
        let cube = Cube::from_fn(32, 2, |d| [1.0 + d[1], 0.0, 0.0]);
        let out = level(&Chain::new(&cube), 8, 1.0, 1024);
        let up = out.texel(2, 4, 4)[0];
        assert!((up - (1.0 + 2.0 / 3.0)).abs() < 0.03, "{up}");
        let down = out.texel(3, 4, 4)[0];
        assert!((down - (1.0 - 2.0 / 3.0)).abs() < 0.03, "{down}");
    }

    #[test]
    fn rougher_levels_spread_a_bright_spot_further() {
        let spot = |d: Vec3| {
            if d[2] > 0.99 {
                [100.0, 0.0, 0.0]
            } else {
                [0.0; 3]
            }
        };
        let chain = Chain::new(&Cube::from_fn(64, 2, spot));
        let side = |r: f32| {
            let out = level(&chain, 16, r, 256);
            // A texel about 25 degrees from the spot.
            out.nearest(crate::environment::vector::normalize([0.47, 0.0, 1.0]))[0]
        };
        assert!(side(0.2) < side(0.5));
        assert!(side(0.5) > 0.0);
    }
}
