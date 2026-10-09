//! The light of three.js's sky on the CPU: the model of the shaders' `null3d::atmosphere`, in the
//! same order and with the same constants, and the nine spherical harmonics coefficients of its
//! diffuse light, which a sky map's environment lights surfaces with.
//!
//! The coefficients project the light onto the real spherical harmonics of bands 0 to 2 in
//! three.js's order and scale, as the asset tool's and the panorama reader's do: they hold light,
//! and the shaders' `sh_irradiance` applies the cosine. The projection reads the sky at the
//! centers of a grid on each face of a cube, each weighed by the solid angle of its square, so it
//! keeps no table and allocates nothing.

use crate::background::Sky;

/// The squares across each face of the grid that the coefficients sum over. Diffuse light keeps
/// only the sky's broad shape. With the squares near the sun split, 6 x 8 x 8 squares keep each
/// coefficient within 2% of the first coefficient's value on a grid of 192, in about 0.1 ms on
/// the Mac (D-118).
const GRID: usize = 8;

const PI: f32 = std::f32::consts::PI;
const TOTAL_RAYLEIGH: [f32; 3] = [5.804_543e-6, 1.356_291_1e-5, 3.026_590_2e-5];
const MIE_CONST: [f32; 3] = [1.839_991_9e14, 2.779_802_4e14, 4.079_048e14];
const CUTOFF_ANGLE: f32 = 1.610_731_6;
const STEEPNESS: f32 = 1.5;
const EE: f32 = 1000.0;
const RAYLEIGH_ZENITH_LENGTH: f32 = 8.4e3;
const MIE_ZENITH_LENGTH: f32 = 1.25e3;
const THREE_OVER_SIXTEEN_PI: f32 = 0.059_683_104;
const ONE_OVER_FOUR_PI: f32 = 0.079_577_47;

type Vec3 = [f32; 3];

/// The values of the whole sky that three.js's vertex shader finds once.
struct Whole {
    sun_direction: Vec3,
    beta_r: Vec3,
    beta_m: Vec3,
    sun_e: f32,
    low_sun: f32,
    day: f32,
}

fn map(v: Vec3, f: impl Fn(f32) -> f32) -> Vec3 {
    [f(v[0]), f(v[1]), f(v[2])]
}

fn zip(a: Vec3, b: Vec3, f: impl Fn(f32, f32) -> f32) -> Vec3 {
    [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2])]
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a * (1.0 - t) + b * t
}

fn fract(x: f32) -> f32 {
    x - x.floor()
}

fn whole(sky: &Sky) -> Whole {
    let p = sky.sun_position;
    let length = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
    let sun_direction = map(p, |c| c / length);
    let c = sun_direction[1].clamp(-1.0, 1.0);
    let sun_e =
        EE * (1.0 - std::f32::consts::E.powf(-((CUTOFF_ANGLE - c.acos()) / STEEPNESS))).max(0.0);
    let low_sun = (1.0 - sun_direction[1]).powf(5.0).clamp(0.0, 1.0);
    let sun_fade = 1.0 - (1.0 - (p[1] / 450_000.0).exp()).clamp(0.0, 1.0);
    let rayleigh = sky.rayleigh - (1.0 - sun_fade);
    let mie = 0.434 * (0.2 * sky.turbidity) * 10e-18;
    Whole {
        sun_direction,
        beta_r: map(TOTAL_RAYLEIGH, |c| c * rayleigh),
        beta_m: map(MIE_CONST, |c| mie * c * sky.mie_coefficient),
        sun_e,
        low_sun,
        day: smoothstep(-0.08, 0.3, sun_direction[1]),
    }
}

fn cloud_gradient(i: [f32; 2]) -> [f32; 2] {
    let mut p = [
        fract(i[0] * 0.1031),
        fract(i[1] * 0.1030),
        fract(i[0] * 0.0973),
    ];
    let d = p[0] * (p[1] + 33.33) + p[1] * (p[2] + 33.33) + p[2] * (p[0] + 33.33);
    p = map(p, |c| c + d);
    [
        fract((p[0] + p[1]) * p[2]) * 2.0 - 1.0,
        fract((p[0] + p[2]) * p[1]) * 2.0 - 1.0,
    ]
}

fn cloud_noise(p: [f32; 2]) -> f32 {
    let i = [p[0].floor(), p[1].floor()];
    let f = [p[0] - i[0], p[1] - i[1]];
    let u = f.map(|f| f * f * f * (f * (f * 6.0 - 15.0) + 10.0));
    let corner = |dx: f32, dy: f32| {
        let g = cloud_gradient([i[0] + dx, i[1] + dy]);
        g[0] * (f[0] - dx) + g[1] * (f[1] - dy)
    };
    let (a, b, c, d) = (
        corner(0.0, 0.0),
        corner(1.0, 0.0),
        corner(0.0, 1.0),
        corner(1.0, 1.0),
    );
    mix(mix(a, b, u[0]), mix(c, d, u[0]), u[1]) * 1.6
}

fn cloud_fbm(start: [f32; 2], drift: f32) -> f32 {
    let mut p = start;
    let mut result = 0.0;
    let mut amplitude = 1.0;
    for _ in 0..4 {
        result += amplitude * cloud_noise(p);
        amplitude *= 0.5;
        p = p.map(|c| c * 2.0 + drift);
    }
    result
}

/// The sky's light in the unit direction `d`, without the sun's disc, as the shaders'
/// `sky_light` gives it before the intensity and the exposure.
fn light(d: Vec3, w: &Whole, sky: &Sky) -> Vec3 {
    let zenith_cos = d[1].max(0.0);
    let zenith_angle = zenith_cos.acos();
    let inverse = 1.0 / (zenith_cos + 0.15 * (93.885 - (zenith_angle * 180.0) / PI).powf(-1.253));
    let s_r = RAYLEIGH_ZENITH_LENGTH * inverse;
    let s_m = MIE_ZENITH_LENGTH * inverse;
    let fex = zip(w.beta_r, w.beta_m, |r, m| (-(r * s_r + m * s_m)).exp());
    let cos_theta =
        d[0] * w.sun_direction[0] + d[1] * w.sun_direction[1] + d[2] * w.sun_direction[2];
    let rayleigh_phase = THREE_OVER_SIXTEEN_PI * (1.0 + (cos_theta * 0.5 + 0.5).powi(2));
    let g = sky.mie_directional_g;
    let base = 1.0 - 2.0 * g * cos_theta + g * g;
    let hg_phase = ONE_OVER_FOUR_PI * ((1.0 - g * g) / (base * base.sqrt()));
    let scattered = zip(w.beta_r, w.beta_m, |r, m| {
        w.sun_e * ((r * rayleigh_phase + m * hg_phase) / (r + m))
    });
    let mut lin = zip(scattered, fex, |s, f| {
        let x = s * (1.0 - f);
        x * x.sqrt()
    });
    lin = zip(lin, zip(scattered, fex, |s, f| (s * f).sqrt()), |l, k| {
        l * mix(1.0, k, w.low_sun)
    });
    let night = fex.map(|f| 0.1 * f);
    let tint = [0.0, 0.0003, 0.00075];
    let mut color = [0.0f32; 3];
    for c in 0..3 {
        color[c] = (lin[c] + night[c]) * 0.04 + tint[c];
    }
    let coverage = sky.cloud_coverage;
    if d[1] > 0.0 && coverage > 0.0 {
        let elevation = mix(1.0, 0.1, sky.cloud_elevation);
        let drift = sky.time * sky.cloud_speed;
        let uv = [
            d[0] / (d[1] * elevation) * sky.cloud_scale + drift,
            d[2] / (d[1] * elevation) * sky.cloud_scale + drift,
        ];
        let density =
            (cloud_fbm(uv.map(|c| c * 1000.0), drift * 300.0) * 0.7 + 0.5).clamp(0.0, 1.0);
        let region = cloud_noise(uv.map(|c| c * 300.0)) * 0.37 + 0.5;
        let cover = (coverage + (region - 0.5) * 0.6).clamp(0.0, 1.0);
        let threshold = 1.0 - cover;
        let horizon_fade = smoothstep(0.0, 0.03 + 0.06 * sky.cloud_elevation, d[1]);
        let mask = smoothstep(threshold, threshold + 0.3, density) * horizon_fade;
        let depth = (density - threshold).max(0.0);
        let beer = (depth * -4.0).exp();
        let powder = 1.0 - beer * beer;
        let shade = mix(0.45, 1.0, (beer * powder * 2.6).clamp(0.0, 1.0));
        let silver_base = 1.49 - cos_theta * 1.4;
        let silver = (0.51 / (silver_base * silver_base.sqrt())).clamp(0.0, 3.0);
        let edge = mask * (1.0 - mask) * 4.0;
        let alpha = (1.0 - (depth * sky.cloud_density * -12.0).exp()) * horizon_fade;
        for c in 0..3 {
            let sun_color = w.sun_e * fex[c] * 0.22 * 0.04;
            let ambient = lin[c] * 0.04 + tint[c];
            let cloud =
                (ambient + sun_color * shade + sun_color * silver * edge * 0.6) * w.day.max(0.03);
            color[c] -= night[c] * 0.04 * alpha;
            let aerial = mix(color[c], cloud, fex[c]);
            color[c] = mix(color[c], aerial, alpha);
        }
    }
    color
}

/// The nine basis functions at a unit direction, in three.js's order and scale.
fn basis(d: Vec3) -> [f32; 9] {
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
fn area(x: f32, y: f32) -> f32 {
    (x * y).atan2((x * x + y * y + 1.0).sqrt())
}

/// The direction through face `face` at face coordinates `s` and `t`, not unit length. Any table
/// that covers the sphere once serves: the projection sums over every face.
fn face_direction(face: usize, s: f32, t: f32) -> Vec3 {
    match face {
        0 => [1.0, -t, -s],
        1 => [-1.0, -t, s],
        2 => [s, 1.0, t],
        3 => [s, -1.0, -t],
        4 => [s, -t, 1.0],
        _ => [-s, -t, -1.0],
    }
}

/// The nine coefficients of the sky's diffuse light: red, green and blue for each.
pub(crate) fn sky_sh(sky: &Sky) -> [[f32; 3]; 9] {
    integrate(sky, GRID, FINER)
}

/// The squares near the sun that the projection splits into `FINER` x `FINER` smaller ones: those
/// whose centers lie within this cosine of the sun's direction. The haze's glow around the sun is
/// narrow and bright, and a coarse grid misjudges its share of the light.
const NEAR_SUN: f32 = 0.85;
const FINER: usize = 4;

/// The coefficients summed over `n` x `n` squares a face, with the squares near the sun split
/// into `finer` x `finer`.
fn integrate(sky: &Sky, n: usize, finer: usize) -> [[f32; 3]; 9] {
    let w = whole(sky);
    let step = 2.0 / n as f32;
    let mut sums = [[0.0f32; 3]; 9];
    let mut add = |face: usize, s0: f32, t0: f32, size: f32| {
        let (s1, t1) = (s0 + size, t0 + size);
        let solid_angle = area(s0, t0) - area(s0, t1) - area(s1, t0) + area(s1, t1);
        let d = unit(face_direction(face, 0.5 * (s0 + s1), 0.5 * (t0 + t1)));
        let l = light(d, &w, sky);
        for (sum, b) in sums.iter_mut().zip(basis(d)) {
            for c in 0..3 {
                sum[c] += l[c] * b * solid_angle;
            }
        }
    };
    for face in 0..6 {
        for row in 0..n {
            let t0 = row as f32 * step - 1.0;
            for column in 0..n {
                let s0 = column as f32 * step - 1.0;
                let center = unit(face_direction(face, s0 + 0.5 * step, t0 + 0.5 * step));
                let near = dot(center, w.sun_direction) > NEAR_SUN;
                let parts = if near { finer } else { 1 };
                let size = step / parts as f32;
                for j in 0..parts {
                    for i in 0..parts {
                        add(face, s0 + i as f32 * size, t0 + j as f32 * size, size);
                    }
                }
            }
        }
    }
    sums
}

fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn unit(d: Vec3) -> Vec3 {
    let length = dot(d, d).sqrt();
    map(d, |c| c / length)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noon() -> Sky {
        Sky {
            sun_position: [0.3, 0.8, -0.5],
            ..Sky::default()
        }
    }

    #[test]
    fn the_grid_keeps_the_diffuse_light_of_a_finer_one() {
        for sky in [
            noon(),
            Sky::default(),
            Sky {
                cloud_coverage: 0.0,
                ..noon()
            },
        ] {
            let coarse = sky_sh(&sky);
            let fine = integrate(&sky, 128, 1);
            let scale = fine[0].iter().fold(0.0f32, |a, &b| a.max(b));
            for (c, f) in coarse.iter().zip(fine) {
                for k in 0..3 {
                    assert!(
                        (c[k] - f[k]).abs() < 0.02 * scale,
                        "{c:?} is not {f:?} for {sky:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_high_sun_lights_the_sky_blue() {
        let sh = sky_sh(&Sky {
            cloud_coverage: 0.0,
            ..noon()
        });
        assert!(sh[0][2] > sh[0][0]);
        assert!(sh.iter().flatten().all(|c| c.is_finite()));
        assert!(sh[0].iter().all(|c| *c > 0.0));
    }

    #[test]
    #[ignore = "prints the error of each grid; run with --ignored --nocapture"]
    fn grid_error() {
        for sky in [noon(), Sky::default()] {
            let fine = integrate(&sky, 192, 1);
            for (n, finer) in [(8, 4), (12, 1), (12, 4), (16, 4), (24, 1)] {
                let coarse = integrate(&sky, n, finer);
                let scale = fine[0].iter().fold(0.0f32, |a, &b| a.max(b));
                let worst = coarse
                    .iter()
                    .flatten()
                    .zip(fine.iter().flatten())
                    .map(|(c, f)| (c - f).abs() / scale)
                    .fold(0.0f32, f32::max);
                println!(
                    "{:?} grid {n}, finer {finer}: worst {worst:.4} of the first coefficient",
                    sky.sun_position
                );
            }
        }
    }

    #[test]
    fn a_sun_below_the_horizon_leaves_a_dim_sky() {
        let day = sky_sh(&noon());
        let night = sky_sh(&Sky {
            sun_position: [0.0, -0.4, -1.0],
            ..noon()
        });
        assert!(night[0][1] < 0.05 * day[0][1], "{night:?} against {day:?}");
        assert!(night[0][1] > 0.0);
    }
}
