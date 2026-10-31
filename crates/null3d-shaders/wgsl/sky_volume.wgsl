// The analytic sky's volumetric clouds, the High tier and above: a second draw over the sky, in the
// same pass, place and depth state, which marches null3d::cloud_volume's field and blends its light
// over the sky's. The sky itself draws the flat layer only on the lighter tiers, and the renderer
// then draws this shader's own passes in its place, from the same cloud settings, so a page's
// settings keep their meaning on every tier.
//
// The noise field and the shader load on the tier's first use, so a page that draws the flat layer
// downloads neither. The shader binds the background's own uniform block, whose second layer value
// carries the march's step count.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::{Backdrop, box_corner}
#import null3d::atmosphere::{PI, SkySettings, SkyWhole, sky_whole}
#import null3d::cloud_volume::{CloudField, CloudLight, cloud_march}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> backdrop: Backdrop;

struct CloudOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
    /// The march's step count.
    @location(1) @interpolate(flat, either) steps: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> CloudOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: CloudOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    out.steps = u32(backdrop.layer.y);
    return out;
}

/// The air's transmittance along the unit `direction`, as the sky's model gives it.
fn through_air(direction: vec3f, whole: SkyWhole, settings: SkySettings) -> vec3f {
    let zenith_cos = max(0.0, direction.y);
    let zenith_angle = acos(zenith_cos);
    let inverse =
        1.0 / (zenith_cos + 0.15 * pow(93.885 - ((zenith_angle * 180.0) / PI), -1.253));
    return exp(-(whole.beta_r * 8.4e-3 * inverse + whole.beta_m * 1.25e-3 * inverse));
}

/// The sky's own light where no cloud stands, before the intensity and the exposure, which the
/// clouds take as their ambient light.
fn clear_sky(direction: vec3f, whole: SkyWhole, settings: SkySettings) -> vec3f {
    let zenith_cos = max(0.0, direction.y);
    let zenith_angle = acos(zenith_cos);
    let inverse =
        1.0 / (zenith_cos + 0.15 * pow(93.885 - ((zenith_angle * 180.0) / PI), -1.253));
    let s_r = 8.4e-3 * inverse;
    let s_m = 1.25e-3 * inverse;
    let fex = exp(-(whole.beta_r * s_r + whole.beta_m * s_m));
    let cos_theta = dot(direction, whole.sun_direction);
    let beta_r_theta = whole.beta_r * (0.05968310365946075 * (2.0 + 2.0 * cos_theta * cos_theta));
    let g = settings.scattering.w;
    let base = 1.0 - 2.0 * g * cos_theta + g * g;
    let beta_m_theta = whole.beta_m * ((0.07957747154594767 * (1.0 - g * g)) / (base * sqrt(base)));
    let scattered = whole.sun.x * ((beta_r_theta + beta_m_theta) / (whole.beta_r + whole.beta_m));
    var lin = scattered * (1.0 - fex);
    lin = lin * sqrt(lin);
    lin *= mix(vec3f(1.0), sqrt(scattered * fex), whole.sun.y);
    let night = vec3f(0.1) * fex;
    return (lin + night) * 0.04 + vec3f(0.0, 0.0003, 0.00075);
}

@fragment
fn fs(in: CloudOut) -> @location(0) vec4f {
    let direction = normalize(in.direction);
    let whole = sky_whole(backdrop.sun.xyz, backdrop.scattering);
    let settings =
        SkySettings(backdrop.sun, backdrop.scattering, backdrop.clouds, backdrop.cloud_place);
    let through = through_air(direction, whole, settings);
    let clear = clear_sky(direction, whole, settings);
    // The sun's light reaches the clouds dimmed by the air along the view, as the flat layer's
    // light is, and its own brightness scales by how much daylight the sky holds.
    let sun = vec3f(whole.sun.x * 0.0088) * through * max(whole.sun.z, 0.03);
    let light = CloudLight(
        whole.sun_direction,
        sun,
        -whole.sun_direction,
        vec3f(0.0),
        clear * max(whole.sun.z, 0.03),
    );
    let field = CloudField(
        vec4f(backdrop.clouds.x, backdrop.clouds.y, backdrop.clouds.z, backdrop.clouds.w),
        backdrop.cloud_place.xy,
    );
    // The jitter's seed is the pixel, which stays put from frame to frame, so the steps show no
    // moving pattern.
    let seed = bitcast<u32>(in.clip.x) ^ (bitcast<u32>(in.clip.y) << 16u);
    let clouds = cloud_march(direction, light, field, in.steps, seed);
    let scale = backdrop.params.x * frame.output.exposure;
    let color =
        null3d::tonemap::finish(
            clouds.rgb * scale,
            in.clip.xy,
            frame.output,
            frame.target_size.xy,
            frame.vignette,
        );
    // Blending adds the premultiplied light over the sky and keeps the rest of the sky.
    return vec4f(color.rgb * clouds.w, clouds.w);
}
