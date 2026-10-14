//! The physical sky's light on the CPU: the model of the shaders' `null3d::sky_scattering`, with
//! coarser tables, for what the core works out itself (D-143):
//!
//! - the light of the sun and the moon at the camera, and the multiple scattering there, which
//!   the aerial perspective's values of each frame take ([`crate::physical_sky::AerialUniform`]);
//! - the nine spherical harmonics coefficients of the sky's diffuse light, for a sky map;
//! - the sky's mean light, which matches the analytic sky's brightness to it on the Low preset.
//!
//! The model keeps its two tables in boxes that it makes once, and works them out again in place
//! when the air changes, so frames allocate nothing.

use crate::background::Sky;
use crate::physical_sky::{Air, Atmosphere, BOTTOM_RADIUS, TOP_RADIUS, unit};
use crate::sky_light::{Sh, Vec3, cloud_fbm, cloud_noise, project, project_coarse};

const PI: f32 = std::f32::consts::PI;

/// The CPU tables' sizes: angles by heights.
const TRANSMITTANCE: (usize, usize) = (64, 16);
const MULTISCATTER: (usize, usize) = (16, 16);
/// The steps of the transmittance table's march, and of each direction of the multiple
/// scattering table's.
const TRANSMITTANCE_STEPS: usize = 30;
const MULTISCATTER_STEPS: usize = 12;
/// The directions a side of the multiple scattering table's sum.
const MULTISCATTER_SIDE: usize = 4;
/// The steps of the march along each direction of the sky.
const SKY_STEPS: usize = 16;

fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn mul(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

fn scale(a: Vec3, s: f32) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Rayleigh's phase function.
fn rayleigh_phase(cos_theta: f32) -> f32 {
    3.0 / (16.0 * PI) * (1.0 + cos_theta * cos_theta)
}

/// The Cornette-Shanks phase function of Mie scattering.
fn mie_phase(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let base = (1.0 + g2 - 2.0 * g * cos_theta).max(1e-4);
    3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + cos_theta * cos_theta)
        / ((2.0 + g2) * base * base.sqrt())
}

/// The air at one height: Rayleigh's and Mie's scattering, and the extinction.
struct Medium {
    rayleigh: Vec3,
    mie: f32,
    extinction: Vec3,
}

fn medium_at(air: &Air, height: f32) -> Medium {
    let h = height.max(0.0);
    let rayleigh_density = (air.rayleigh[3] * h).exp();
    let mie_density = (air.mie[2] * h).exp();
    let ozone_density = (1.0 - (h - 25.0).abs() / 15.0).max(0.0);
    let rayleigh =
        [air.rayleigh[0], air.rayleigh[1], air.rayleigh[2]].map(|c| c * rayleigh_density);
    let extinction = std::array::from_fn(|c| {
        rayleigh[c] + air.mie[1] * mie_density + air.ozone[c] * ozone_density
    });
    Medium {
        rayleigh,
        mie: air.mie[0] * mie_density,
        extinction,
    }
}

/// The distance along the unit ray from `origin` to the sphere of `radius`: the far hit from
/// inside, or 0 for none.
fn to_sphere(origin: Vec3, direction: Vec3, radius: f32) -> f32 {
    let b = dot(origin, direction);
    let c = dot(origin, origin) - radius * radius;
    let discriminant = b * b - c;
    if discriminant < 0.0 {
        return 0.0;
    }
    (-b + discriminant.sqrt()).max(0.0)
}

/// The distance to the ground along the ray, or none where it misses.
fn to_ground(origin: Vec3, direction: Vec3) -> Option<f32> {
    let b = dot(origin, direction);
    let c = dot(origin, origin) - BOTTOM_RADIUS * BOTTOM_RADIUS;
    let discriminant = b * b - c;
    (discriminant >= 0.0 && b <= 0.0).then(|| (-b - discriminant.sqrt()).max(0.0))
}

/// Bruneton's mapping of a height `r` from the center and the cosine `mu` of an angle from
/// straight up onto 0 to 1 each way, as the shaders' transmittance table maps them.
fn transmittance_coords(r: f32, mu: f32) -> (f32, f32) {
    let h = (TOP_RADIUS * TOP_RADIUS - BOTTOM_RADIUS * BOTTOM_RADIUS).sqrt();
    let rho = (r * r - BOTTOM_RADIUS * BOTTOM_RADIUS).max(0.0).sqrt();
    let discriminant = r * r * (mu * mu - 1.0) + TOP_RADIUS * TOP_RADIUS;
    let d = (-r * mu + discriminant.max(0.0).sqrt()).max(0.0);
    let d_min = TOP_RADIUS - r;
    let d_max = rho + h;
    (
        ((d - d_min) / (d_max - d_min).max(1e-6)).clamp(0.0, 1.0),
        (rho / h).clamp(0.0, 1.0),
    )
}

/// The height and angle that `transmittance_coords` maps to `(x_mu, x_r)`.
fn transmittance_point(x_mu: f32, x_r: f32) -> (f32, f32) {
    let h = (TOP_RADIUS * TOP_RADIUS - BOTTOM_RADIUS * BOTTOM_RADIUS).sqrt();
    let rho = h * x_r;
    let r = (rho * rho + BOTTOM_RADIUS * BOTTOM_RADIUS).sqrt();
    let d_min = TOP_RADIUS - r;
    let d_max = rho + h;
    let d = d_min + x_mu * (d_max - d_min);
    let mu = if d == 0.0 {
        1.0
    } else {
        (h * h - rho * rho - d * d) / (2.0 * r * d)
    };
    (r, mu.clamp(-1.0, 1.0))
}

/// A table of colors, read with a linear filter at coordinates from 0 to 1 that reach the
/// centers of its edge texels.
fn sample<const N: usize>(
    table: &[Vec3; N],
    (columns, rows): (usize, usize),
    x: f32,
    y: f32,
) -> Vec3 {
    let fx = x.clamp(0.0, 1.0) * (columns - 1) as f32;
    let fy = y.clamp(0.0, 1.0) * (rows - 1) as f32;
    let (x0, y0) = (fx.floor() as usize, fy.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(columns - 1), (y0 + 1).min(rows - 1));
    let (tx, ty) = (fx - x0 as f32, fy - y0 as f32);
    let at = |x: usize, y: usize| table[y * columns + x];
    let top = add(scale(at(x0, y0), 1.0 - tx), scale(at(x1, y0), tx));
    let bottom = add(scale(at(x0, y1), 1.0 - tx), scale(at(x1, y1), tx));
    add(scale(top, 1.0 - ty), scale(bottom, ty))
}

const TRANSMITTANCE_TEXELS: usize = TRANSMITTANCE.0 * TRANSMITTANCE.1;
const MULTISCATTER_TEXELS: usize = MULTISCATTER.0 * MULTISCATTER.1;

/// The air's model on the CPU, with its tables for one air.
#[derive(Debug)]
pub struct AirModel {
    air: Air,
    transmittance: Box<[Vec3; TRANSMITTANCE_TEXELS]>,
    multiscatter: Box<[Vec3; MULTISCATTER_TEXELS]>,
}

impl AirModel {
    /// The model of `air`, with its tables worked out.
    pub fn new(air: Air) -> Self {
        let mut model = Self {
            air,
            transmittance: Box::new([[0.0; 3]; TRANSMITTANCE_TEXELS]),
            multiscatter: Box::new([[0.0; 3]; MULTISCATTER_TEXELS]),
        };
        model.work_out();
        model
    }

    /// Takes `air`, working the tables out again in place when it changed.
    pub fn set_air(&mut self, air: Air) {
        if self.air != air {
            self.air = air;
            self.work_out();
        }
    }

    fn work_out(&mut self) {
        let (columns, rows) = TRANSMITTANCE;
        for row in 0..rows {
            for column in 0..columns {
                let x_mu = column as f32 / (columns - 1) as f32;
                let x_r = row as f32 / (rows - 1) as f32;
                let (r, mu) = transmittance_point(x_mu, x_r);
                self.transmittance[row * columns + column] = self.march_transmittance(r, mu);
            }
        }
        let (columns, rows) = MULTISCATTER;
        for row in 0..rows {
            for column in 0..columns {
                let mu = column as f32 / (columns - 1) as f32 * 2.0 - 1.0;
                let r =
                    BOTTOM_RADIUS + row as f32 / (rows - 1) as f32 * (TOP_RADIUS - BOTTOM_RADIUS);
                self.multiscatter[row * columns + column] = self.march_multiscatter(r, mu);
            }
        }
    }

    fn march_transmittance(&self, r: f32, mu: f32) -> Vec3 {
        let origin = [0.0, r, 0.0];
        let direction = [(1.0 - mu * mu).max(0.0).sqrt(), mu, 0.0];
        // To the top of the air: the table's angles stop at the horizon, and the planet's shadow
        // is apart.
        let span = to_sphere(origin, direction, TOP_RADIUS);
        let dt = span / TRANSMITTANCE_STEPS as f32;
        let mut depth = [0.0; 3];
        for i in 0..TRANSMITTANCE_STEPS {
            let p = scale(direction, (i as f32 + 0.5) * dt);
            let height = dot(add(origin, p), add(origin, p)).sqrt() - BOTTOM_RADIUS;
            depth = add(depth, scale(medium_at(&self.air, height).extinction, dt));
        }
        depth.map(|d| (-d).exp())
    }

    fn march_multiscatter(&self, r: f32, mu: f32) -> Vec3 {
        let origin = [0.0, r.max(BOTTOM_RADIUS + 0.01), 0.0];
        let sun = [(1.0 - mu * mu).max(0.0).sqrt(), mu, 0.0];
        let isotropic = 1.0 / (4.0 * PI);
        let mut light = [0.0; 3];
        let mut scattered = [0.0; 3];
        let side = MULTISCATTER_SIDE;
        for j in 0..side {
            for k in 0..side {
                let theta = 2.0 * PI * (j as f32 + 0.5) / side as f32;
                let cos_phi = 1.0 - 2.0 * (k as f32 + 0.5) / side as f32;
                let sin_phi = (1.0 - cos_phi * cos_phi).max(0.0).sqrt();
                let direction = [theta.cos() * sin_phi, cos_phi, theta.sin() * sin_phi];
                let ground = to_ground(origin, direction);
                let span = ground.unwrap_or_else(|| to_sphere(origin, direction, TOP_RADIUS));
                let dt = span / MULTISCATTER_STEPS as f32;
                let mut through = [1.0; 3];
                for i in 0..MULTISCATTER_STEPS {
                    let p = add(origin, scale(direction, (i as f32 + 0.3) * dt));
                    let pr = dot(p, p).sqrt();
                    let m = medium_at(&self.air, pr - BOTTOM_RADIUS);
                    let scattering = add(m.rayleigh, [m.mie; 3]);
                    let step: Vec3 = m.extinction.map(|e| (-e * dt).exp());
                    let share: Vec3 =
                        std::array::from_fn(|c| (1.0 - step[c]) / m.extinction[c].max(1e-9));
                    let lit = self.light_at(pr, dot(scale(p, 1.0 / pr), sun), 1.0);
                    let source = scale(mul(lit, scattering), isotropic);
                    light = add(light, mul(mul(through, source), share));
                    scattered = add(scattered, mul(mul(through, scattering), share));
                    through = mul(through, step);
                }
                if let Some(t) = ground {
                    let p = add(origin, scale(direction, t));
                    let pr = dot(p, p).sqrt();
                    let n_dot_l = (dot(p, sun) / pr).max(0.0);
                    let albedo = self.air.ground[0];
                    let lit = self.light_at(pr, dot(scale(p, 1.0 / pr), sun), 1.0);
                    light = add(light, scale(mul(through, lit), n_dot_l * albedo / PI));
                }
            }
        }
        let weight = 4.0 * PI / (side * side) as f32 * isotropic;
        std::array::from_fn(|c| light[c] * weight / (1.0 - scattered[c] * weight).max(1e-3))
    }

    /// The transmittance from `r` from the center toward `mu` to the top of the air.
    pub fn transmittance(&self, r: f32, mu: f32) -> Vec3 {
        let (x, y) = transmittance_coords(r, mu);
        sample(&self.transmittance, TRANSMITTANCE, x, y)
    }

    /// The light at `r` from the center of a light at `mu` of `light` above the air, none in the
    /// planet's shadow, which softens over about the sun's width at the horizon, as the shaders'.
    pub fn light_at(&self, r: f32, mu: f32, light: f32) -> Vec3 {
        let ratio = BOTTOM_RADIUS / r;
        let horizon = -(1.0 - ratio * ratio).max(0.0).sqrt();
        let lit = smoothstep(horizon - 0.004, horizon + 0.004, mu);
        scale(self.transmittance(r, mu), light * lit)
    }

    /// The light that scatters more than once toward a point at `r` from the center, per unit of
    /// scattering and of the light above the air, with the light at `mu`.
    pub fn multiscatter(&self, r: f32, mu: f32) -> Vec3 {
        let x = mu * 0.5 + 0.5;
        let y = (r - BOTTOM_RADIUS) / (TOP_RADIUS - BOTTOM_RADIUS);
        sample(&self.multiscatter, MULTISCATTER, x, y)
    }

    /// The sky's light in the unit direction `d` seen from `r` from the center, from the sun and
    /// the moon of `atmosphere`, without the discs, the stars and the clouds.
    pub fn sky(&self, atmosphere: &Atmosphere, r: f32, d: Vec3) -> Vec3 {
        let origin = [0.0, r, 0.0];
        let ground = to_ground(origin, d);
        let span = ground.unwrap_or_else(|| to_sphere(origin, d, TOP_RADIUS));
        let dt = span / SKY_STEPS as f32;
        let g = atmosphere.mie_directional_g;
        let lights = [
            (atmosphere.sun(), atmosphere.sun_intensity),
            (atmosphere.moon(), atmosphere.moon_intensity),
        ];
        let phases = lights.map(|(toward, _)| {
            let c = dot(d, toward);
            (rayleigh_phase(c), mie_phase(c, g))
        });
        let mut light = [0.0; 3];
        let mut through = [1.0; 3];
        for i in 0..SKY_STEPS {
            let p = add(origin, scale(d, (i as f32 + 0.3) * dt));
            let pr = dot(p, p).sqrt();
            let up = scale(p, 1.0 / pr);
            let m = medium_at(&self.air, pr - BOTTOM_RADIUS);
            let scattering = add(m.rayleigh, [m.mie; 3]);
            let mut source = [0.0; 3];
            for ((toward, intensity), (rayleigh, mie)) in lights.iter().zip(phases) {
                if *intensity <= 0.0 {
                    continue;
                }
                let mu = dot(up, *toward);
                let lit = self.light_at(pr, mu, *intensity);
                let phased = add(scale(m.rayleigh, rayleigh), [m.mie * mie; 3]);
                source = add(source, mul(lit, phased));
                source = add(
                    source,
                    mul(scale(self.multiscatter(pr, mu), *intensity), scattering),
                );
            }
            let step: Vec3 = m.extinction.map(|e| (-e * dt).exp());
            let share: Vec3 = std::array::from_fn(|c| (1.0 - step[c]) / m.extinction[c].max(1e-9));
            light = add(light, mul(mul(through, source), share));
            through = mul(through, step);
        }
        if let Some(t) = ground {
            let p = add(origin, scale(d, t));
            let pr = dot(p, p).sqrt();
            let up = scale(p, 1.0 / pr);
            for (toward, intensity) in lights {
                if intensity <= 0.0 {
                    continue;
                }
                let mu = dot(up, toward);
                let lit = self.light_at(pr, mu, intensity);
                light = add(
                    light,
                    scale(mul(through, lit), mu.max(0.0) * self.air.ground[0] / PI),
                );
            }
        }
        light
    }

    /// The sky's light in the unit direction `d` with its clouds, as the shaders' panorama draws
    /// it.
    fn sky_with_clouds(&self, atmosphere: &Atmosphere, r: f32, d: Vec3, lit: &Lit) -> Vec3 {
        let sky = self.sky(atmosphere, r, d);
        if d[1] <= 0.0 || atmosphere.cloud_coverage <= 0.0 {
            return sky;
        }
        let through = self.transmittance(r, d[1]);
        clouds(atmosphere, d, sky, lit, through)
    }

    /// The nine coefficients of the diffuse light of `atmosphere`'s sky with its clouds, seen from
    /// `r` from the center.
    pub fn sh(&self, atmosphere: &Atmosphere, r: f32) -> Sh {
        let lit = Lit::of(self, atmosphere, r);
        project(
            |d| self.sky_with_clouds(atmosphere, r, d, &lit),
            atmosphere.sun(),
        )
    }

    /// The mean luminance of the sky's light from the sun of `atmosphere` alone and from its moon
    /// alone, over a coarse grid of directions, without clouds.
    pub fn mean_luminance(&self, atmosphere: &Atmosphere, r: f32) -> (f32, f32) {
        let alone = |sun: bool| Atmosphere {
            sun_intensity: if sun { atmosphere.sun_intensity } else { 0.0 },
            moon_intensity: if sun { 0.0 } else { atmosphere.moon_intensity },
            ..*atmosphere
        };
        let mean = |a: &Atmosphere| mean_over_sphere(|d| luminance(self.sky(a, r, d)));
        (mean(&alone(true)), mean(&alone(false)))
    }
}

/// The analytic sky that stands in for `atmosphere`'s physical sky where the quality settings
/// turn the physical sky off, and the factor of its light. It takes the same sun, moon, air and
/// clouds. Its sun stays above 1.2 degrees under the horizon, where the analytic sky keeps its
/// sunset's glow, and the moon's sky adds its light as a second sky. The factor and the second
/// sky's weight match each sky's mean light to the physical sky's, from `model`.
pub fn analytic_stand_in(atmosphere: &Atmosphere, model: &AirModel) -> (Sky, f32) {
    let a = atmosphere;
    let [x, y, z] = a.sun();
    let lowest = (-1.2f32).to_radians().sin();
    let sun = if y < lowest {
        let across = (x * x + z * z).sqrt().max(1e-6);
        let keep = (1.0 - lowest * lowest).sqrt() / across;
        [x * keep, lowest, z * keep]
    } else {
        [x, y, z]
    };
    let sky = Sky {
        sun_position: sun,
        turbidity: 2.0 * a.haze.max(0.0),
        rayleigh: a.rayleigh,
        mie_coefficient: 0.005 * a.haze,
        mie_directional_g: a.mie_directional_g,
        cloud_scale: a.cloud_scale,
        cloud_speed: a.cloud_speed,
        cloud_coverage: a.cloud_coverage,
        cloud_density: a.cloud_density,
        cloud_elevation: a.cloud_elevation,
        time: a.time,
        sun_disc: a.sun_disc,
        second_sun_position: a.moon(),
        second_sky_weight: 0.0,
    };
    let r = BOTTOM_RADIUS + a.height_of(0.0);
    let (sun_light, moon_light) = model.mean_luminance(a, r);
    let sun_share = sun_light / crate::sky_light::mean_luminance(&sky).max(1e-9);
    if a.moon_intensity <= 0.0 {
        return (sky, sun_share);
    }
    let moon_sky = Sky {
        sun_position: a.moon(),
        ..sky
    };
    let moon_share = moon_light / crate::sky_light::mean_luminance(&moon_sky).max(1e-9);
    // Under a dark enough sun, the moon's sky is the first sky.
    if sun_light < 1e-3 * moon_light {
        return (moon_sky, moon_share);
    }
    (
        Sky {
            second_sky_weight: moon_share / sun_share,
            ..sky
        },
        sun_share,
    )
}

/// The luminance of a linear color.
pub(crate) fn luminance(c: Vec3) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/// The mean of `f` over the sphere, from 6 x 3 x 3 directions through squares of a cube's faces,
/// each weighed by its solid angle.
pub(crate) fn mean_over_sphere(f: impl Fn(Vec3) -> f32) -> f32 {
    let sh = project_coarse(|d| [f(d); 3]);
    // The first coefficient is the mean times the square root of 4 pi, over its basis value.
    sh[0][0] / (0.282_095 * 4.0 * PI)
}

/// The light that reaches the clouds: the sun's and the moon's at the camera, and the sky's
/// straight up.
struct Lit {
    sun: Vec3,
    moon: Vec3,
    zenith: Vec3,
}

impl Lit {
    fn of(model: &AirModel, atmosphere: &Atmosphere, r: f32) -> Self {
        let sun = atmosphere.sun();
        let moon = atmosphere.moon();
        let camera = |toward: Vec3, intensity: f32| {
            scale(
                model.transmittance(r, toward[1]),
                intensity * smoothstep(-0.01, 0.01, toward[1]),
            )
        };
        Self {
            sun: camera(sun, atmosphere.sun_intensity),
            moon: camera(moon, atmosphere.moon_intensity),
            zenith: model.sky(atmosphere, r, [0.0, 1.0, 0.0]),
        }
    }
}

/// The silver lining toward a light at `cos_theta` from the view.
fn silver_lining(cos_theta: f32) -> f32 {
    let base = 1.49 - cos_theta * 1.4;
    (0.51 / (base * base.sqrt())).clamp(0.0, 3.0)
}

/// The sky's light `sky` in the unit direction `d` with the clouds over it, as the shaders'
/// `null3d::sky_clouds` draws them.
fn clouds(a: &Atmosphere, d: Vec3, sky: Vec3, lit: &Lit, through: Vec3) -> Vec3 {
    let elevation = 1.0 + (0.1 - 1.0) * a.cloud_elevation;
    let drift = a.time * a.cloud_speed;
    let uv = [
        d[0] / (d[1] * elevation) * a.cloud_scale + drift,
        d[2] / (d[1] * elevation) * a.cloud_scale + drift,
    ];
    let evolve = a.time * a.cloud_speed * 300.0;
    let density = (cloud_fbm([uv[0] * 1000.0, uv[1] * 1000.0], evolve) * 0.7 + 0.5).clamp(0.0, 1.0);
    let region = cloud_noise([uv[0] * 300.0, uv[1] * 300.0]) * 0.37 + 0.5;
    let coverage = (a.cloud_coverage + (region - 0.5) * 0.6).clamp(0.0, 1.0);
    let threshold = 1.0 - coverage;
    let horizon_fade = smoothstep(0.0, 0.03 + 0.06 * a.cloud_elevation, d[1]);
    let mask = smoothstep(threshold, threshold + 0.3, density) * horizon_fade;
    if mask <= 0.0 {
        return sky;
    }
    let depth = (density - threshold).max(0.0);
    let beer = (depth * -4.0).exp();
    let powder = 1.0 - beer * beer;
    let shade = 0.45 + 0.55 * (beer * powder * 2.6).clamp(0.0, 1.0);
    let edge = mask * (1.0 - mask) * 4.0;
    let toward = |light: Vec3, at: Vec3| {
        scale(
            light,
            (0.55 * shade + 0.35 * silver_lining(dot(d, at)) * edge) / PI,
        )
    };
    let cloud = add(
        add(
            scale(lit.zenith, 1.0 + 0.6 * shade),
            toward(lit.sun, a.sun()),
        ),
        toward(lit.moon, unit(a.moon_position)),
    );
    let alpha = (1.0 - (depth * a.cloud_density * -12.0).exp()) * horizon_fade;
    let seen = luminance(through);
    std::array::from_fn(|c| {
        let aerial = sky[c] + (cloud[c] - sky[c]) * seen;
        sky[c] + (aerial - sky[c]) * alpha
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model() -> (Atmosphere, AirModel) {
        let atmosphere = Atmosphere {
            cloud_coverage: 0.0,
            ..Atmosphere::default()
        };
        let model = AirModel::new(atmosphere.air());
        (atmosphere, model)
    }

    #[test]
    fn straight_up_the_air_lets_most_light_through_and_more_red_than_blue() {
        let (_, model) = model();
        let t = model.transmittance(BOTTOM_RADIUS + 0.001, 1.0);
        // Rayleigh's and Mie's optical depths straight up: 8 km and 1.2 km of their scattering.
        let expected: Vec3 = std::array::from_fn(|c| {
            (-(crate::physical_sky::RAYLEIGH_SCATTERING[c] * 8.0 + 4.40e-3 * 1.2)).exp()
        });
        for c in 0..3 {
            // Ozone takes a little more, most in green. The march's midpoint steps find a little
            // less of the air than the exact sum, about 0.3% of the depth in blue.
            assert!(
                t[c] <= expected[c] + 4e-3 && t[c] > expected[c] * 0.93,
                "{t:?} {expected:?}"
            );
        }
        assert!(t[0] > t[1] && t[1] > t[2]);
    }

    #[test]
    fn the_noon_sky_is_blue_and_darker_than_the_sunlit_ground() {
        let (mut atmosphere, model) = model();
        atmosphere.sun_position = [0.0, 1.0, -0.2];
        let sky = model.sky(&atmosphere, BOTTOM_RADIUS + 0.001, [0.0, 1.0, 0.0]);
        assert!(sky[2] > sky[1] && sky[1] > sky[0], "{sky:?}");
        // A clear sky's light straight up is a few hundredths of the sun's.
        let share = sky[2] / atmosphere.sun_intensity;
        assert!((0.01..0.15).contains(&share), "{share}");
    }

    #[test]
    fn the_sky_keeps_a_glow_after_sunset_and_darkens_at_night() {
        let (mut atmosphere, model) = model();
        let r = BOTTOM_RADIUS + 0.001;
        let mut means = Vec::new();
        for degrees in [10.0f32, 0.0, -6.0, -12.0] {
            let e = degrees.to_radians();
            atmosphere.sun_position = [e.cos(), e.sin(), 0.0];
            means.push(model.mean_luminance(&atmosphere, r).0);
        }
        assert!(means.windows(2).all(|w| w[0] > w[1]), "{means:?}");
        assert!(means[2] > 0.0, "twilight keeps some light: {means:?}");
        assert!(means[2] < 0.05 * means[0], "{means:?}");
    }

    #[test]
    fn the_diffuse_light_comes_mostly_from_above() {
        let (atmosphere, model) = model();
        let sh = model.sh(&atmosphere, BOTTOM_RADIUS + 0.001);
        // The first band's y coefficient: more light from above than from below.
        assert!(sh[1][2] > 0.0 && sh[0][2] > 0.0, "{sh:?}");
    }
}
