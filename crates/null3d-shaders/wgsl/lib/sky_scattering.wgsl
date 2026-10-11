#define_import_path null3d::sky_scattering
#import null3d::fog::{fog_height_ratio}

// The physical sky's air: Rayleigh and Mie scattering and ozone over a round planet, after
// Hillaire's "A Scalable and Production Ready Sky and Atmosphere Rendering Technique" (2020), as
// Unreal Engine and Bevy draw it. Lengths are in kilometres, and positions are relative to the
// planet's center, with +Y up at the camera.
//
// Three tables hold what each pixel would otherwise march for. The transmittance table gives the
// share of light that passes from a height to the top of the air, along each angle. The multiple
// scattering table gives the light that scatters more than once, for each height and sun angle.
// The sky view table gives the light of the whole sky seen from the camera's height. This module
// holds the model and the tables' mappings. The shaders that draw and read the tables bind them
// in their own groups. The renderer's `physical_sky_light` module holds a CPU copy of the model.
// The aerial perspective, the air between the camera and each surface, needs no table: the mesh
// shaders' fog step finds it from the values of each frame.


const PI: f32 = 3.141592653589793;

/// The air's settings, as the renderer's `physical_sky` module writes them.
struct Air {
    /// Rayleigh's scattering per kilometre at the ground, which is also its extinction, and the
    /// fall of its density per kilometre up: the density is exp(w × height).
    rayleigh: vec4f,
    /// Mie's scattering and extinction per kilometre at the ground, the fall of its density per
    /// kilometre up, and its directional g.
    mie: vec4f,
    /// Ozone's absorption per kilometre at its densest, 25 km up, and a spare.
    ozone: vec4f,
    /// The ground's albedo, and the planet's radius.
    ground: vec4f,
}

/// The values that the physical sky's shaders share, in one uniform block.
struct SkyValues {
    air: Air,
    /// The camera's distance from the planet's center, the radius of the air's top, the factor of
    /// the background's light, and a spare.
    view: vec4f,
    /// The unit direction toward the sun, and its light above the air.
    sun: vec4f,
    /// The unit direction toward the moon, and its light above the air, 0 for no moon.
    moon: vec4f,
    /// The cosines of the sun's and the moon's angular radii, 1 where the sky shows the sun's
    /// disc, else 0, and the stars' brightness, 0 for none.
    discs: vec4f,
    /// The cloud scale, speed, coverage and density, as the analytic sky takes them.
    clouds: vec4f,
    /// The cloud elevation, the time in seconds, and two spares.
    cloud_place: vec4f,
}

/// The air at one height: its scattering and its extinction.
struct Medium {
    rayleigh: vec3f,
    mie: f32,
    extinction: vec3f,
}

/// The air at `height` kilometres above the ground.
fn medium_at(air: Air, height: f32) -> Medium {
    let h = max(height, 0.0);
    let rayleigh_density = exp(air.rayleigh.w * h);
    let mie_density = exp(air.mie.z * h);
    // Ozone lies in a layer 30 km thick about 25 km up, densest at its middle.
    let ozone_density = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
    var out: Medium;
    out.rayleigh = air.rayleigh.xyz * rayleigh_density;
    out.mie = air.mie.x * mie_density;
    out.extinction = out.rayleigh + air.mie.y * mie_density + air.ozone.xyz * ozone_density;
    return out;
}

/// The distance along the unit ray from `origin` to the sphere of `radius` about the planet's
/// center: the far hit from inside, the near one from outside, or -1 for none.
fn ray_sphere(origin: vec3f, direction: vec3f, radius: f32) -> f32 {
    let b = dot(origin, direction);
    let c = dot(origin, origin) - radius * radius;
    let discriminant = b * b - c;
    if discriminant < 0.0 {
        return -1.0;
    }
    let root = sqrt(discriminant);
    let near = -b - root;
    let far = -b + root;
    if near >= 0.0 {
        return near;
    }
    return select(-1.0, far, far >= 0.0);
}

/// The distance to the ground along the ray, or -1 where it misses or meets the ground behind.
fn ground_hit(origin: vec3f, direction: vec3f, bottom: f32) -> f32 {
    let b = dot(origin, direction);
    let c = dot(origin, origin) - bottom * bottom;
    let discriminant = b * b - c;
    if discriminant < 0.0 || b > 0.0 {
        return -1.0;
    }
    return max(-b - sqrt(discriminant), 0.0);
}

/// A texture coordinate from 0 to 1 that reaches the centers of the edge texels of a table
/// `size` texels long, and the reverse.
fn to_texels(x: f32, size: f32) -> f32 {
    return 0.5 / size + x * (1.0 - 1.0 / size);
}

fn from_texels(u: f32, size: f32) -> f32 {
    return (u - 0.5 / size) / (1.0 - 1.0 / size);
}

/// The transmittance table's size.
const TRANSMITTANCE_SIZE: vec2f = vec2f(256.0, 64.0);
/// The multiple scattering table's size.
const MULTISCATTER_SIZE: vec2f = vec2f(32.0, 32.0);
/// The sky view table's size.
const SKY_VIEW_SIZE: vec2f = vec2f(256.0, 128.0);

/// The transmittance table's coordinates of a point `r` from the center that looks up at
/// `mu`, the cosine of its angle from straight up (Bruneton's mapping).
fn transmittance_uv(bottom: f32, top: f32, r: f32, mu: f32) -> vec2f {
    let h = sqrt(top * top - bottom * bottom);
    let rho = sqrt(max(r * r - bottom * bottom, 0.0));
    let discriminant = r * r * (mu * mu - 1.0) + top * top;
    let d = max(0.0, -r * mu + sqrt(max(discriminant, 0.0)));
    let d_min = top - r;
    let d_max = rho + h;
    let x_mu = (d - d_min) / max(d_max - d_min, 1e-6);
    let x_r = rho / h;
    return vec2f(to_texels(x_mu, TRANSMITTANCE_SIZE.x), to_texels(x_r, TRANSMITTANCE_SIZE.y));
}

/// The height from the center and the cosine of the angle from straight up that a texel of the
/// transmittance table holds.
fn transmittance_point(bottom: f32, top: f32, uv: vec2f) -> vec2f {
    let x_mu = from_texels(uv.x, TRANSMITTANCE_SIZE.x);
    let x_r = from_texels(uv.y, TRANSMITTANCE_SIZE.y);
    let h = sqrt(top * top - bottom * bottom);
    let rho = h * x_r;
    let r = sqrt(rho * rho + bottom * bottom);
    let d_min = top - r;
    let d_max = rho + h;
    let d = d_min + x_mu * (d_max - d_min);
    let mu = select((h * h - rho * rho - d * d) / (2.0 * r * d), 1.0, d == 0.0);
    return vec2f(r, clamp(mu, -1.0, 1.0));
}

/// The multiple scattering table's coordinates at `r` from the center, with the sun at `mu`.
fn multiscatter_uv(bottom: f32, top: f32, r: f32, mu: f32) -> vec2f {
    let x = clamp(mu * 0.5 + 0.5, 0.0, 1.0);
    let y = clamp((r - bottom) / (top - bottom), 0.0, 1.0);
    return vec2f(to_texels(x, MULTISCATTER_SIZE.x), to_texels(y, MULTISCATTER_SIZE.y));
}

/// The angle from straight up of the horizon, seen from `r` from the center.
fn horizon_zenith(bottom: f32, r: f32) -> f32 {
    return PI - acos(clamp(sqrt(max(r * r - bottom * bottom, 0.0)) / r, -1.0, 1.0));
}

/// The sky view table's coordinates of the unit direction `d`, from `r` from the center. Its
/// columns run around the sky from +X toward +Z, and its rows crowd near the horizon, which lies
/// between its two halves: the sky above, the ground below.
fn sky_view_uv(bottom: f32, r: f32, d: vec3f) -> vec2f {
    let zenith_horizon = horizon_zenith(bottom, r);
    let beta = PI - zenith_horizon;
    let angle = acos(clamp(d.y, -1.0, 1.0));
    var v: f32;
    if angle < zenith_horizon {
        v = (1.0 - sqrt(max(1.0 - angle / zenith_horizon, 0.0))) * 0.5;
    } else {
        v = (sqrt(clamp((angle - zenith_horizon) / beta, 0.0, 1.0)) + 1.0) * 0.5;
    }
    let u = atan2(d.z, d.x) * (0.5 / PI);
    return vec2f(u, to_texels(v, SKY_VIEW_SIZE.y));
}

/// The unit direction that a texel of the sky view table holds, seen from `r` from the center.
fn sky_view_direction(bottom: f32, r: f32, uv: vec2f) -> vec3f {
    let zenith_horizon = horizon_zenith(bottom, r);
    let beta = PI - zenith_horizon;
    let v = from_texels(uv.y, SKY_VIEW_SIZE.y);
    var angle: f32;
    if v < 0.5 {
        let k = 1.0 - 2.0 * v;
        angle = zenith_horizon * (1.0 - k * k);
    } else {
        let k = 2.0 * v - 1.0;
        angle = zenith_horizon + beta * k * k;
    }
    let azimuth = uv.x * 2.0 * PI;
    let s = sin(angle);
    return vec3f(s * cos(azimuth), cos(angle), s * sin(azimuth));
}

/// The unit direction of a texel of the sky's panorama, as the environment generator reads a
/// panorama: the middle column faces +X, a quarter of the way faces -Z, and row 0 is the top.
fn panorama_direction(uv: vec2f) -> vec3f {
    let azimuth = (uv.x - 0.5) * 2.0 * PI;
    let elevation = (0.5 - uv.y) * PI;
    let c = cos(elevation);
    return vec3f(c * cos(azimuth), sin(elevation), c * sin(azimuth));
}

/// The light of the sun's or the moon's disc toward the unit direction `d`: its light above the
/// air spread over its disc, times `through`, the air's transmittance toward it. `cos_radius` is
/// the cosine of the disc's angular radius. The sun's edge darkens, and the edge of each disc
/// fades over a tenth of its radius, so it does not alias.
fn sun_disc(d: vec3f, toward: vec3f, light: f32, cos_radius: f32, through: vec3f) -> vec3f {
    let cos_angle = dot(d, toward);
    if cos_angle < cos_radius {
        return vec3f(0.0);
    }
    let radius = acos(cos_radius);
    let x = clamp(acos(clamp(cos_angle, -1.0, 1.0)) / radius, 0.0, 1.0);
    let edge = 1.0 - smoothstep(0.9, 1.0, x);
    let mu = sqrt(max(1.0 - x * x, 0.0));
    // Limb darkening, a common fit of the sun's: brightest at the center.
    let limb = 1.0 - 0.6 * (1.0 - mu);
    let solid_angle = 2.0 * PI * (1.0 - cos_radius);
    return through * (light / solid_angle * limb * edge / 0.8);
}

/// The air between the camera and each surface: the physical sky's aerial perspective, as the
/// engine writes it into each frame's values for the camera that draws. All zero while the scene
/// draws no physical sky. Lengths are in the scene's units, and light is exposed.
struct Aerial {
    /// Rayleigh's scattering per unit of distance at the camera's height, which is also its
    /// extinction, and Mie's scattering in `w`.
    rayleigh: vec4f,
    /// Mie's extinction per unit at the camera's height, how fast Rayleigh's and Mie's densities
    /// fall per unit of height, and Mie's directional g.
    shape: vec4f,
    /// The unit direction toward the sun, and the red of the light that scatters more than once.
    sun: vec4f,
    /// The sun's light at the camera, and the green of the light that scatters more than once.
    sun_light: vec4f,
    /// The unit direction toward the moon, and the blue of the light that scatters more than once.
    moon: vec4f,
    /// The moon's light at the camera, and 1 while the scene draws the physical sky, else 0.
    moon_light: vec4f,
}

/// Rayleigh's phase function.
fn rayleigh_phase(cos_theta: f32) -> f32 {
    return 0.05968310365946075 * (1.0 + cos_theta * cos_theta);
}

/// The Cornette-Shanks phase function of Mie scattering, of directional factor `g`.
fn mie_phase(cos_theta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let base = max(1.0 + g2 - 2.0 * g * cos_theta, 1e-4);
    return 0.11936620731892151 * (1.0 - g2) * (1.0 + cos_theta * cos_theta) / ((2.0 + g2) * base * sqrt(base));
}

/// A color `c` at `relative`, its position relative to the camera, seen through the physical
/// sky's air. The air dims it by Rayleigh's and Mie's extinction along the ray, and adds the light
/// that it scatters toward the camera from the sun, the moon and the sky. Each density falls
/// exponentially with height, so each integrates exactly along the ray, as height fog does. Over a
/// scene's distances, the light at each point of the ray is the light at the camera.
fn aerial_perspective(air: Aerial, c: vec3f, relative: vec3f) -> vec3f {
    if (air.moon_light.w == 0.0) {
        return c;
    }
    let distance = length(relative);
    let rayleigh = air.rayleigh.xyz * (distance * fog_height_ratio(air.shape.y * relative.y));
    let mie_path = distance * fog_height_ratio(air.shape.z * relative.y);
    let mie_scattering = air.rayleigh.w * mie_path;
    let depth = rayleigh + air.shape.x * mie_path;
    let through = exp(-depth);
    let view = relative / max(distance, 1e-6);
    let g = air.shape.w;
    let cos_sun = dot(view, air.sun.xyz);
    let cos_moon = dot(view, air.moon.xyz);
    let again = vec3f(air.sun.w, air.sun_light.w, air.moon.w);
    let rayleigh_light = air.sun_light.xyz * rayleigh_phase(cos_sun) + air.moon_light.xyz * rayleigh_phase(cos_moon) + again;
    let mie_light = air.sun_light.xyz * mie_phase(cos_sun, g) + air.moon_light.xyz * mie_phase(cos_moon, g) + again;
    let scattered = (rayleigh * rayleigh_light + mie_scattering * mie_light) * ((1.0 - through) / max(depth, vec3f(1e-6)));
    return c * through + scattered;
}
