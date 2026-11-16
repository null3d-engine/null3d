// The physical sky's sky map on the cloud tier: the generator's `panorama` step draws the sky
// that the physical pass filled, which on this tier carries no flat layer, and adds the volumetric
// clouds over it, packed as the other steps pack their texels. The map therefore takes the clouds
// as it took the flat layer.
//
// The clouds take their light from the panorama itself: the sky's color where they stand, and a
// brighter share of it as their light. A reflected sky is filtered for a roughness before anyone
// sees it, so the simpler light costs nothing that a viewer can see.
#import null3d::fullscreen::{triangle}
#import null3d::cubemap::{face_direction, pack}
#import null3d::atmosphere::{PI, SkySettings}
#import null3d::cloud_volume::{CloudField, CloudLight, cloud_march}

struct Step {
    size: u32,
    samples: u32,
    source_size: u32,
    row: u32,
    value: f32,
    gain: f32,
    cloud_steps: f32,
    spare_c: f32,
}

@group(0) @binding(0) var<uniform> params: Step;
@group(0) @binding(3) var panorama: texture_2d<f32>;
@group(0) @binding(4) var panorama_sampler: sampler;
/// The sky's values, of which the physical map fills the clouds and their place: the physical
/// sky's cloud settings, in the same block that the analytic map's settings fill.
@group(0) @binding(5) var<uniform> sky_settings: SkySettings;

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

struct FaceTexel {
    face: u32,
    texel: vec2f,
}

fn face_texel(position: vec2f) -> FaceTexel {
    let column = floor(position);
    let face = min(u32(column.x) / params.size, 5u);
    return FaceTexel(face, vec2f(column.x - f32(face * params.size), column.y - f32(params.row)));
}

/// The panorama's light in a unit direction, filtered linearly.
fn panorama_light(d: vec3f) -> vec3f {
    let u = atan2(d.z, d.x) * (0.5 / PI) + 0.5;
    let v = asin(clamp(d.y, -1.0, 1.0)) * (1.0 / PI) + 0.5;
    return textureSampleLevel(panorama, panorama_sampler, vec2f(u, 1.0 - v), 0.0).rgb;
}

@fragment
fn fs_panorama(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let at = face_texel(position.xy);
    let count = params.samples;
    let spacing = 2.0 / (f32(params.size) * f32(count));
    var sum = vec3f(0.0);
    for (var j = 0u; j < count; j++) {
        let tc = (at.texel.y * f32(count) + f32(j) + 0.5) * spacing - 1.0;
        for (var i = 0u; i < count; i++) {
            let sc = (at.texel.x * f32(count) + f32(i) + 0.5) * spacing - 1.0;
            sum += panorama_light(normalize(face_direction(at.face, sc, tc)));
        }
    }
    let base = sum * (1.0 / f32(count * count));
    let center = (2.0 * at.texel + 1.0) / f32(params.size) - 1.0;
    let direction = normalize(face_direction(at.face, center.x, center.y));
    // The clouds' light is the sky's own color, brighter as their light, and the sky overhead
    // lights them as it does the core sky's flat layer.
    let light =
        CloudLight(vec3f(0.0, 1.0, 0.0), base * 1.4, vec3f(0.0, 1.0, 0.0), vec3f(0.0), base);
    let field = CloudField(sky_settings.clouds, sky_settings.cloud_place.xy);
    let seed = bitcast<u32>(position.x) ^ (bitcast<u32>(position.y) << 16u);
    let clouds = cloud_march(direction, light, field, min(u32(params.cloud_steps), 16u), seed);
    return pack((base * (1.0 - clouds.w) + clouds.rgb) * params.gain);
}
