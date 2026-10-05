// three.js's sky behind every object: its `Sky` object (examples/jsm/objects/Sky.js, r186), the
// Preetham daylight model with a sun disc and drifting clouds, drawn as a box around the camera at
// the far plane, in the camera's opaque pass behind the objects. Every constant and formula follows
// three.js's, in its order, so a port keeps its look. The values that three.js's vertex shader
// finds once go to the fragments as flat values. The fragment shader writes linear color as the
// mesh shaders write theirs: into the HDR scene color, or tone mapped and encoded on the 8-bit path
// (the TONE_MAP builds). It binds the background's group as the cube map background does, and reads
// no texture.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::{Backdrop, box_corner}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> backdrop: Backdrop;

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

struct SkyOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
    @location(1) @interpolate(flat, either) sun_direction: vec3f,
    @location(2) @interpolate(flat, either) beta_r: vec3f,
    @location(3) @interpolate(flat, either) beta_m: vec3f,
    @location(4) @interpolate(flat, either) sun_e: f32,
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

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> SkyOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: SkyOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    let sun_position = backdrop.sun.xyz;
    out.sun_direction = normalize(sun_position);
    out.sun_e = sun_intensity(out.sun_direction.y);
    let sun_fade = 1.0 - clamp(1.0 - exp(sun_position.y / 450000.0), 0.0, 1.0);
    let rayleigh_coefficient = backdrop.scattering.y - (1.0 - sun_fade);
    out.beta_r = TOTAL_RAYLEIGH * rayleigh_coefficient;
    out.beta_m = total_mie(backdrop.scattering.x) * backdrop.scattering.z;
    return out;
}

/// Rayleigh's phase function.
fn rayleigh_phase(cos_theta: f32) -> f32 {
    return THREE_OVER_SIXTEEN_PI * (1.0 + cos_theta * cos_theta);
}

/// The Henyey-Greenstein phase function of directional factor `g`.
fn hg_phase(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let inverse = 1.0 / pow(1.0 - 2.0 * g * cos_theta + g2, 1.5);
    return ONE_OVER_FOUR_PI * ((1.0 - g2) * inverse);
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

/// The sky's light in the fragment's direction, times the intensity and the exposure.
@fragment
fn fs(in: SkyOut) -> @location(0) vec4f {
    let direction = normalize(in.direction);
    let sun_direction = in.sun_direction;
    let beta_r = in.beta_r;
    let beta_m = in.beta_m;
    let sun_e = in.sun_e;

    // The optical length, with the zenith angle cut off at 90 degrees, where the formula has a
    // singularity.
    let zenith_angle = acos(max(0.0, direction.y));
    let inverse =
        1.0 / (cos(zenith_angle) + 0.15 * pow(93.885 - ((zenith_angle * 180.0) / PI), -1.253));
    let s_r = RAYLEIGH_ZENITH_LENGTH * inverse;
    let s_m = MIE_ZENITH_LENGTH * inverse;

    // The extinction, and the light scattered in.
    let fex = exp(-(beta_r * s_r + beta_m * s_m));
    let cos_theta = dot(direction, sun_direction);
    let beta_r_theta = beta_r * rayleigh_phase(cos_theta * 0.5 + 0.5);
    let beta_m_theta = beta_m * hg_phase(cos_theta, backdrop.scattering.w);
    let scattered = sun_e * ((beta_r_theta + beta_m_theta) / (beta_r + beta_m));
    var lin = pow(scattered * (1.0 - fex), vec3f(1.5));
    let low_sun = clamp(pow(1.0 - sun_direction.y, 5.0), 0.0, 1.0);
    lin *= mix(vec3f(1.0), pow(scattered * fex, vec3f(0.5)), low_sun);

    // The night sky, and the sun's disc.
    let l0 = vec3f(0.1) * fex;
    let sun_disc =
        clamp((cos_theta - SUN_ANGULAR_DIAMETER_COS) * 50000.0, 0.0, 1.0) * backdrop.sun.w;
    let sun_disc_color = (760.0 * sun_disc) * min(sun_e * fex, vec3f(80.0));
    var color = (lin + l0) * 0.04 + sun_disc_color + vec3f(0.0, 0.0003, 0.00075);

    let cloud_scale = backdrop.clouds.x;
    let cloud_speed = backdrop.clouds.y;
    let cloud_coverage = backdrop.clouds.z;
    let cloud_density = backdrop.clouds.w;
    let cloud_elevation = backdrop.cloud_place.x;
    let time = backdrop.cloud_place.y;
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
        let day = smoothstep(-0.08, 0.3, sun_direction.y);
        let sun_color = sun_e * fex * 0.22 * 0.04;
        let sky_ambient = lin * 0.04 + vec3f(0.0, 0.0003, 0.00075);
        let depth = max(0.0, density - threshold);
        let beer = exp(depth * -4.0);
        let powder = 1.0 - beer * beer;
        let shade = mix(0.45, 1.0, clamp(beer * powder * 2.6, 0.0, 1.0));
        let silver = clamp(0.51 / pow(1.49 - cos_theta * 1.4, 1.5), 0.0, 3.0);
        let edge = mask * (1.0 - mask) * 4.0;
        var cloud_color = sky_ambient + sun_color * shade;
        cloud_color += sun_color * silver * edge * 0.6;
        cloud_color *= max(day, 0.03);

        // The clouds' opacity, which hides the sun behind them, seen through the air.
        let alpha = (1.0 - exp(depth * cloud_density * -12.0)) * horizon_fade;
        color -= l0 * 0.04 * alpha;
        let aerial = mix(color, cloud_color, fex);
        color = mix(color, aerial, alpha);
    }

    let scale = backdrop.params.x * frame.output.exposure;
    return null3d::tonemap::finish(color * scale, in.clip.xy, frame.output);
}
