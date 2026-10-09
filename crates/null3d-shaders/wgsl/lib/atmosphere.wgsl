#define_import_path null3d::atmosphere

// three.js's sky: its `Sky` object (examples/jsm/objects/Sky.js, r186), the Preetham daylight model
// with a sun disc and drifting clouds. Every constant and formula follows three.js's, in its
// order, so a port keeps its look. The sky background draws it, and the environment generator
// draws it into the cube of the sky's environment, so both show the same sky. The renderer's
// `sky_light` module computes the same light on the CPU for the environment's diffuse light.

const E: f32 = 2.718281828459045;
const PI: f32 = 3.141592653589793;
/// The Rayleigh coefficients of the primaries' wavelengths, after Preetham.
const TOTAL_RAYLEIGH: vec3f = vec3f(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
/// pi ((2 pi) / lambda)^(v - 2) K for the primaries.
const MIE_CONST: vec3f = vec3f(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
/// The earth's shadow: pi / 1.95.
const CUTOFF_ANGLE: f32 = 1.6110731556870734;
const STEEPNESS: f32 = 1.5;
const EE: f32 = 1000.0;
/// The optical lengths at the zenith of molecules and of haze.
const RAYLEIGH_ZENITH_LENGTH: f32 = 8.4e3;
const MIE_ZENITH_LENGTH: f32 = 1.25e3;
/// The cosine of the sun's angular diameter, 66 arc seconds.
const SUN_ANGULAR_DIAMETER_COS: f32 = 0.9999566769464484;
const THREE_OVER_SIXTEEN_PI: f32 = 0.05968310365946075;
const ONE_OVER_FOUR_PI: f32 = 0.07957747154594767;

/// The sky's settings, as the background's block and the environment generator's block hold them.
struct SkySettings {
    /// The sun's position in `xyz`, as three.js's `sunPosition`, and 1 where the sky shows the
    /// sun's disc, else 0.
    sun: vec4f,
    /// The turbidity, Rayleigh coefficient, Mie coefficient and Mie directional g.
    scattering: vec4f,
    /// The cloud scale, cloud speed, cloud coverage and cloud density.
    clouds: vec4f,
    /// The cloud elevation, the time in seconds, and two spares.
    cloud_place: vec4f,
}

/// The values of the whole sky that three.js's vertex shader finds once.
struct SkyWhole {
    sun_direction: vec3f,
    beta_r: vec3f,
    beta_m: vec3f,
    /// The sun's light, how low the sun stands (as three.js's `pow(1 - sunDirection.y, 5)`), and
    /// how much daylight the clouds take.
    sun: vec3f,
}

/// `x` to the power 1.5, without the logarithm and exponential of `pow`.
fn pow_three_halves(x: vec3f) -> vec3f {
    return x * sqrt(x);
}

/// The sun's light at the zenith angle whose cosine is `zenith_cos`, fading as the sun sinks
/// below the horizon.
fn sun_intensity(zenith_cos: f32) -> f32 {
    let c = clamp(zenith_cos, -1.0, 1.0);
    return EE * max(0.0, 1.0 - pow(E, -((CUTOFF_ANGLE - acos(c)) / STEEPNESS)));
}

/// The Mie coefficients of haze of turbidity `t`.
fn total_mie(t: f32) -> vec3f {
    let c = (0.2 * t) * 10e-18;
    return 0.434 * c * MIE_CONST;
}

/// The values of the whole sky of the sun at `sun_position`, with the sky's `scattering`.
fn sky_whole(sun_position: vec3f, scattering: vec4f) -> SkyWhole {
    var out: SkyWhole;
    out.sun_direction = normalize(sun_position);
    let sun_e = sun_intensity(out.sun_direction.y);
    let low_sun = clamp(pow(1.0 - out.sun_direction.y, 5.0), 0.0, 1.0);
    out.sun = vec3f(sun_e, low_sun, smoothstep(-0.08, 0.3, out.sun_direction.y));
    let sun_fade = 1.0 - clamp(1.0 - exp(sun_position.y / 450000.0), 0.0, 1.0);
    let rayleigh_coefficient = scattering.y - (1.0 - sun_fade);
    out.beta_r = TOTAL_RAYLEIGH * rayleigh_coefficient;
    out.beta_m = total_mie(scattering.x) * scattering.z;
    return out;
}

/// Rayleigh's phase function.
fn rayleigh_phase(cos_theta: f32) -> f32 {
    return THREE_OVER_SIXTEEN_PI * (1.0 + cos_theta * cos_theta);
}

/// The Henyey-Greenstein phase function of directional factor `g`.
fn hg_phase(cos_theta: f32, g: f32) -> f32 {
    let g_squared = g * g;
    let base = 1.0 - 2.0 * g * cos_theta + g_squared;
    let inverse = 1.0 / (base * sqrt(base));
    return ONE_OVER_FOUR_PI * ((1.0 - g_squared) * inverse);
}

/// The gradient at a lattice corner, from a hash without sines, so every GPU makes the same
/// clouds.
fn cloud_gradient(i: vec2f) -> vec2f {
    var p = fract(i.xyx * vec3f(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}

/// 2D gradient noise, from about -1 to 1.
fn cloud_noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let a = dot(cloud_gradient(i), f);
    let b = dot(cloud_gradient(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0));
    let c = dot(cloud_gradient(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0));
    let d = dot(cloud_gradient(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}

/// Four octaves of the noise, each drifting on its own, so clouds billow as they move.
fn cloud_fbm(start: vec2f, drift: f32) -> f32 {
    var p = start;
    var result = 0.0;
    var amplitude = 1.0;
    for (var i = 0u; i < 4u; i++) {
        result += amplitude * cloud_noise(p);
        amplitude *= 0.5;
        p = p * 2.0 + drift;
    }
    return result;
}

/// The sky's light in the unit `direction`, before its intensity and the exposure, with the sun's
/// disc where `sun_disc` is 1.
fn sky_light(direction: vec3f, whole: SkyWhole, settings: SkySettings, sun_disc: f32) -> vec3f {
    let sun_direction = whole.sun_direction;
    let beta_r = whole.beta_r;
    let beta_m = whole.beta_m;
    let sun_e = whole.sun.x;

    // The optical length, with the zenith angle cut off at 90 degrees, where the formula has a
    // singularity. The cosine of the angle is the direction's height.
    let zenith_cos = max(0.0, direction.y);
    let zenith_angle = acos(zenith_cos);
    let inverse =
        1.0 / (zenith_cos + 0.15 * pow(93.885 - ((zenith_angle * 180.0) / PI), -1.253));
    let s_r = RAYLEIGH_ZENITH_LENGTH * inverse;
    let s_m = MIE_ZENITH_LENGTH * inverse;

    // The extinction, and the light scattered in.
    let fex = exp(-(beta_r * s_r + beta_m * s_m));
    let cos_theta = dot(direction, sun_direction);
    let beta_r_theta = beta_r * rayleigh_phase(cos_theta * 0.5 + 0.5);
    let beta_m_theta = beta_m * hg_phase(cos_theta, settings.scattering.w);
    let scattered = sun_e * ((beta_r_theta + beta_m_theta) / (beta_r + beta_m));
    var lin = pow_three_halves(scattered * (1.0 - fex));
    lin *= mix(vec3f(1.0), sqrt(scattered * fex), whole.sun.y);

    // The night sky, and the sun's disc.
    let night = vec3f(0.1) * fex;
    let disc = clamp((cos_theta - SUN_ANGULAR_DIAMETER_COS) * 50000.0, 0.0, 1.0) * sun_disc;
    let sun_disc_color = (760.0 * disc) * min(sun_e * fex, vec3f(80.0));
    var color = (lin + night) * 0.04 + sun_disc_color + vec3f(0.0, 0.0003, 0.00075);

    let cloud_scale = settings.clouds.x;
    let cloud_speed = settings.clouds.y;
    let cloud_coverage = settings.clouds.z;
    let cloud_density = settings.clouds.w;
    let cloud_elevation = settings.cloud_place.x;
    let time = settings.cloud_place.y;
    if direction.y > 0.0 && cloud_coverage > 0.0 {
        // The cloud plane: a higher elevation brings the clouds lower and closer.
        let elevation = mix(1.0, 0.1, cloud_elevation);
        let cloud_uv = direction.xz / (direction.y * elevation) * cloud_scale + time * cloud_speed;

        // The density field, with large gaps beside dense banks.
        let evolve = time * cloud_speed * 300.0;
        let density = clamp(cloud_fbm(cloud_uv * 1000.0, evolve) * 0.7 + 0.5, 0.0, 1.0);
        let region = cloud_noise(cloud_uv * 300.0) * 0.37 + 0.5;
        let coverage = clamp(cloud_coverage + (region - 0.5) * 0.6, 0.0, 1.0);

        // Clouds where the density rises above the coverage's threshold, faded at the horizon.
        let threshold = 1.0 - coverage;
        let horizon_fade = smoothstep(0.0, 0.03 + 0.06 * cloud_elevation, direction.y);
        let mask = smoothstep(threshold, threshold + 0.3, density) * horizon_fade;

        // Light from the sky itself, a self shadow, and a silver lining toward the sun.
        let day = whole.sun.z;
        let sun_color = sun_e * fex * 0.22 * 0.04;
        let sky_ambient = lin * 0.04 + vec3f(0.0, 0.0003, 0.00075);
        let depth = max(0.0, density - threshold);
        let beer = exp(depth * -4.0);
        let powder = 1.0 - beer * beer;
        let shade = mix(0.45, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));
        let silver_base = 1.49 - cos_theta * 1.4;
        let silver = clamp(0.51 / (silver_base * sqrt(silver_base)), 0.0, 3.0);
        let edge = mask * (1.0 - mask) * 4.0;
        var cloud_color = sky_ambient + sun_color * shade;
        cloud_color += sun_color * silver * edge * 0.6;
        cloud_color *= max(day, 0.03);

        // The clouds' opacity, which hides the sun behind them, seen through the air.
        let alpha = (1.0 - exp(depth * cloud_density * -12.0)) * horizon_fade;
        color -= night * 0.04 * alpha;
        let aerial = mix(color, cloud_color, fex);
        color = mix(color, aerial, alpha);
    }
    return color;
}
