// The analytic sky map's volumetric clouds: the environment generator's `sky` step on the cloud
// tier, which draws the clear sky of its settings and then the volumetric clouds over it, packed as
// the other steps pack their texels. The map therefore takes the clouds as it took the flat layer,
// and its reflections show them.
//
// The step's spare value carries the march's step count. The noise field, which group 1 binds,
// loads with this shader at the tier's first use.
#import null3d::fullscreen::{triangle}
#import null3d::cubemap::{face_direction, pack}
#import null3d::atmosphere::{PI, SkySettings, SkyWhole, sky_light, sky_whole}
#import null3d::cloud_volume::{CloudField, CloudLight, cloud_march}

struct Step {
    /// The texels across a side of each face at the level that the draw fills.
    size: u32,
    /// The directions that each texel averages, or the panorama's directions a side of each texel.
    samples: u32,
    /// The texels across a side of the source's largest level.
    source_size: u32,
    /// The first row of the level in the target.
    row: u32,
    /// The blur's sigma, the source level, or the prefilter's roughness.
    value: f32,
    /// The factor of the light that the draw stores.
    gain: f32,
    /// The cloud march's step count, and a spare.
    cloud_steps: f32,
    spare_c: f32,
}

@group(0) @binding(0) var<uniform> params: Step;
@group(0) @binding(5) var<uniform> sky_settings: SkySettings;

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

/// The face of the texel under the fragment, from 0 to 5, and the texel's column and row on it.
struct FaceTexel {
    face: u32,
    texel: vec2f,
}

fn face_texel(position: vec2f) -> FaceTexel {
    let column = floor(position);
    let face = min(u32(column.x) / params.size, 5u);
    return FaceTexel(face, vec2f(column.x - f32(face * params.size), column.y - f32(params.row)));
}

@fragment
fn fs_sky(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let at = face_texel(position.xy);
    let whole = sky_whole(sky_settings.sun.xyz, sky_settings.scattering);
    // The flat layer gives way to the march, so the sky that the clouds cover carries no clouds.
    let clear =
        SkySettings(
            sky_settings.sun,
            sky_settings.scattering,
            vec4f(sky_settings.clouds.x, sky_settings.clouds.y, 0.0, sky_settings.clouds.w),
            sky_settings.cloud_place,
        );
    let count = params.samples;
    let spacing = 2.0 / (f32(params.size) * f32(count));
    var sum = vec3f(0.0);
    for (var j = 0u; j < count; j++) {
        let tc = (at.texel.y * f32(count) + f32(j) + 0.5) * spacing - 1.0;
        for (var i = 0u; i < count; i++) {
            let sc = (at.texel.x * f32(count) + f32(i) + 0.5) * spacing - 1.0;
            sum += sky_light(normalize(face_direction(at.face, sc, tc)), whole, clear, 0.0);
        }
    }
    let base = sum * (1.0 / f32(count * count));
    let center = (2.0 * at.texel + 1.0) / f32(params.size) - 1.0;
    let direction = normalize(face_direction(at.face, center.x, center.y));
    let light = CloudLight(
        whole.sun_direction,
        sky_light(whole.sun_direction, whole, clear, 0.0) * 2.0,
        -whole.sun_direction,
        vec3f(0.0),
        base,
    );
    let field =
        CloudField(
            vec4f(sky_settings.clouds.x, sky_settings.clouds.y, sky_settings.clouds.z, sky_settings.clouds.w),
            sky_settings.cloud_place.xy,
        );
    let seed = bitcast<u32>(position.x) ^ (bitcast<u32>(position.y) << 16u);
    let clouds = cloud_march(direction, light, field, min(u32(params.cloud_steps), 16u), seed);
    return pack((base * (1.0 - clouds.w) + clouds.rgb) * params.gain);
}
