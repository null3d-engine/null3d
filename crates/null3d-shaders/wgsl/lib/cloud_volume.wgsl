#define_import_path null3d::cloud_volume

// The sky's volumetric cloud tier: a ray marched through a slab of cloud noise, lit by the sky's
// own sun, moon and overhead light. The flat layer that the lighter tiers draw is a plane of the
// same two-dimensional noise; this march gives that field a height, so a cloud's top lights while
// its base stays in shade and its edges shine toward the light.
//
// The two entry shaders that draw it bind one field for both of them, so this module names the
// bindings once: group 1's binding 6 is the noise field, a 3D texture that repeats at its edges,
// and binding 7 its linear sampler. Whatever else group 1 holds, the field sits at those numbers
// in both.
//
// The field holds four different numbers at each point of a 64-cube: a low-frequency shape, a
// higher-frequency detail, billows, and a low-frequency coverage. The renderer makes it on the
// first frame that draws the tier, so no file ships and the noise is the same on every GPU.

@group(1) @binding(6) var cloud_field: texture_3d<f32>;
@group(1) @binding(7) var cloud_field_sampler: sampler;

/// The texels across a side of the noise field, which its coordinates repeat over.
const FIELD_SIZE: f32 = 64.0;

/// The lights that shade the clouds: the sun's and the moon's directions and their light at the
/// camera, and the light of the sky overhead.
struct CloudLight {
    sun_direction: vec3f,
    sun_light: vec3f,
    moon_direction: vec3f,
    moon_light: vec3f,
    ambient: vec3f,
}

/// The cloud settings, in the flat layer's names: the pattern's scale, its drift, the share of the
/// sky that clouds cover and their density, and the elevation and time.
struct CloudField {
    settings: vec4f,
    place: vec2f,
}

/// The four numbers of the noise field at `p`, whose coordinates repeat every `FIELD_SIZE`.
fn cloud_noise_at(p: vec3f) -> vec4f {
    return textureSampleLevel(cloud_field, cloud_field_sampler, p / FIELD_SIZE, 0.0);
}

/// How much of the light toward `cos_theta` from the view scatters to the camera: least away from
/// the light and most toward it, as a cloud's rim glows when a light stands behind it.
fn cloud_phase(cos_theta: f32) -> f32 {
    return 0.4 + 0.6 * pow(max(cos_theta, 0.0), 8.0);
}

/// A number from 0 to 1 for a whole-number seed, mixed so neighbouring seeds differ.
fn cloud_hash(seed: u32) -> f32 {
    var h = seed * 747796405u + 2891336453u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    return f32(((h >> 22u) ^ h) >> 8u) / 16777216.0;
}

/// The clouds that the unit ray `d` meets, as light premultiplied by their opacity in `rgb`, and
/// their opacity in `w`. `steps` is the march's step count, 0 for no clouds, and `seed` places a
/// jitter that hides the steps without moving from frame to frame.
fn cloud_march(
    d: vec3f,
    light: CloudLight,
    field: CloudField,
    steps: u32,
    seed: u32,
) -> vec4f {
    let scale = field.settings.x;
    let speed = field.settings.y;
    let cover = field.settings.z;
    let density_setting = field.settings.w;
    let elevation = mix(1.0, 0.1, field.place.x);
    let time = field.place.y;
    if steps == 0u || d.y <= 0.0 || cover <= 0.0 {
        return vec4f(0.0);
    }
    // The flat layer's plane stands where a ray through the sky meets `d.xz / (d.y * elevation)`.
    // The slab that the march crosses lies about that height, so the pattern keeps the flat
    // layer's size and the elevation setting keeps its meaning.
    let plane = 1.0 / (d.y * elevation);
    let bottom = plane * 0.55;
    let thickness = plane * 0.9;
    let count = f32(steps);
    let step_length = thickness / count;
    // The field's coordinates, in texels: a cell of its lowest octave spans one unit of the flat
    // layer's pattern, so the volume carries the flat layer's cloud sizes.
    let drift = time * speed * 8000.0;
    let horizon = smoothstep(0.0, 0.03 + 0.06 * field.place.x, d.y);
    let sun_cos = dot(d, light.sun_direction);
    let moon_cos = dot(d, light.moon_direction);
    let sun_phase = cloud_phase(sun_cos);
    let moon_phase = cloud_phase(moon_cos);
    var travelled = step_length * cloud_hash(seed);
    var transmittance = 1.0;
    var scattered = vec3f(0.0);
    var depth = 0.0;
    for (var i = 0u; i < steps; i++) {
        let t = bottom + travelled;
        let height = travelled / thickness;
        // The cloud thins at the slab's floor and ceiling, so its base and top show a soft edge.
        let profile = smoothstep(0.0, 0.22, height) * smoothstep(1.0, 0.72, height);
        if profile > 0.0 {
            let across = d.xz * t * scale * 14400.0 + vec2f(drift);
            let vertical = height * 16.0 + drift * 0.15;
            let n = cloud_noise_at(vec3f(across.x, vertical, across.y));
            let region = n.a;
            let shape = n.r * 0.65 + n.g * 0.35;
            let coverage = clamp(cover + (region - 0.5) * 0.6, 0.0, 1.0);
            let threshold = 1.0 - coverage;
            // The billows break the cloud's edge into detail, as the flat layer's second noise does.
            let body = smoothstep(threshold, threshold + 0.3, shape + n.b * 0.12);
            let amount = body * profile * density_setting;
            if amount > 0.002 {
                // The light that reaches this point: the sky overhead, and the sun and the moon,
                // each fainter as the cloud above it thickens.
                let shade = exp(depth * -3.0);
                let sun = light.sun_light * sun_phase * shade;
                let moon = light.moon_light * moon_phase * shade;
                let ambient = light.ambient * mix(1.0, 1.6, shade);
                // A cloud's edge shines toward a light behind it, as the flat layer's does.
                let edge = body * (1.0 - body) * 4.0;
                let silver = edge * 0.5;
                let lit = ambient + sun * (0.6 + silver) + moon * (0.6 + silver);
                let extinction = amount * 9.0;
                let absorbed = exp(-extinction * step_length);
                scattered += transmittance * lit * amount * step_length * 1.6;
                transmittance *= absorbed;
                depth += amount * step_length;
                if transmittance < 0.02 {
                    break;
                }
            }
        }
        travelled += step_length;
    }
    let alpha = (1.0 - transmittance) * horizon;
    return vec4f(scattered * horizon, alpha);
}
