//! Nine spherical harmonics coefficients of an environment's light, for diffuse light.
//!
//! The coefficients project the light onto the real spherical harmonics of bands 0 to 2 in
//! three.js's order and scale (`SphericalHarmonics3.getBasisAt`). They hold light, not
//! irradiance: the engine's `sh_irradiance` applies the cosine's factors, as three.js's
//! `shGetIrradianceAt` does for a `LightProbe`.

use super::cube::{Cube, FACES};
use super::vector::Vec3;

/// The nine basis functions at a unit direction.
pub fn basis(d: Vec3) -> [f32; 9] {
    let [x, y, z] = d;
    [
        0.282_095,
        0.488_603 * y,
        0.488_603 * z,
        0.488_603 * x,
        1.092_548 * x * y,
        1.092_548 * y * z,
        0.315_392 * (3.0 * z * z - 1.0),
        1.092_548 * x * z,
        0.546_274 * (x * x - y * y),
    ]
}

/// The solid angle that the part of a cube face from its center to (x, y) covers, in face
/// coordinates from -1 to 1.
fn area(x: f64, y: f64) -> f64 {
    (x * y).atan2((x * x + y * y + 1.0).sqrt())
}

/// The coefficients of a cube map's light: nine RGB triples.
pub fn project(cube: &Cube) -> [Vec3; 9] {
    let size = cube.size;
    let step = 2.0 / size as f64;
    let mut sums = [[0.0f64; 3]; 9];
    for face in 0..FACES {
        for y in 0..size {
            let (y0, y1) = (y as f64 * step - 1.0, (y + 1) as f64 * step - 1.0);
            for x in 0..size {
                let (x0, x1) = (x as f64 * step - 1.0, (x + 1) as f64 * step - 1.0);
                let solid_angle = area(x0, y0) - area(x0, y1) - area(x1, y0) + area(x1, y1);
                let light = cube.texel(face, x, y);
                let d = Cube::texel_direction(size, face, x, y);
                for (sum, b) in sums.iter_mut().zip(basis(d)) {
                    for c in 0..3 {
                        sum[c] += f64::from(light[c]) * f64::from(b) * solid_angle;
                    }
                }
            }
        }
    }
    sums.map(|s| s.map(|c| c as f32))
}

/// The irradiance at a unit normal from the coefficients, as the engine's `sh_irradiance`
/// computes it.
#[cfg(test)]
pub fn irradiance(sh: &[Vec3; 9], n: Vec3) -> Vec3 {
    let [x, y, z] = n;
    let weights = [
        0.886_227,
        2.0 * 0.511_664 * y,
        2.0 * 0.511_664 * z,
        2.0 * 0.511_664 * x,
        2.0 * 0.429_043 * x * y,
        2.0 * 0.429_043 * y * z,
        0.743_125 * z * z - 0.247_708,
        2.0 * 0.429_043 * x * z,
        0.429_043 * (x * x - y * y),
    ];
    let mut out = [0.0; 3];
    for (c, w) in sh.iter().zip(weights) {
        for i in 0..3 {
            out[i] += c[i] * w;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::f32::consts::PI;

    use super::*;

    fn close(a: f32, b: f32, tolerance: f32) {
        assert!((a - b).abs() < tolerance, "{a} is not {b}");
    }

    #[test]
    fn a_constant_environment_has_only_the_first_coefficient() {
        let sh = project(&Cube::from_fn(16, 1, |_| [1.0, 2.0, 0.5]));
        close(sh[0][0], 0.282_095 * 4.0 * PI, 1e-4);
        close(sh[0][1], 2.0 * 0.282_095 * 4.0 * PI, 1e-4);
        for c in &sh[1..] {
            for v in c {
                close(*v, 0.0, 1e-4);
            }
        }
        // The irradiance of light 1 from every side is pi.
        close(irradiance(&sh, [0.0, 0.0, 1.0])[0], PI, 1e-3);
    }

    #[test]
    fn a_sky_from_above_matches_its_integrals() {
        // Light max(0, y): the integrals over the upper hemisphere are pi for y, 2 pi / 3 for
        // y squared, pi / 2 for y cubed and pi / 4 for y times x squared or z squared.
        let sh = project(&Cube::from_fn(64, 2, |d| [d[1].max(0.0), 0.0, 0.0]));
        let expected = [
            0.282_095 * PI,
            0.488_603 * 2.0 * PI / 3.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0.315_392 * (3.0 * PI / 4.0 - PI),
            0.0,
            0.546_274 * (PI / 4.0 - PI / 2.0),
        ];
        for (c, e) in sh.iter().zip(expected) {
            close(c[0], e, 2e-3);
        }
    }
}
