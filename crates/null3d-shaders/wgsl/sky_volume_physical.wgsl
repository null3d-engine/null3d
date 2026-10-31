// The physical sky's volumetric clouds, the High tier and above: a second draw over the physical
// sky, in the same pass, place and depth state, which marches null3d::cloud_volume's field and
// blends its light over the sky. It reads the physical sky's own values and tables, so the clouds
// catch the sunset's red light and the night's moon as the flat layer does, and the renderer draws
// it in place of the flat layer, from the same cloud settings.
//
// The noise field and the shader load on the tier's first use. The physical sky's uniform block
// carries the march's step count in the fourth value of its view.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::box_corner
#import null3d::sky_scattering::{SkyValues, sky_view_uv, transmittance_uv, PI}
#import null3d::cloud_volume::{CloudField, CloudLight, cloud_march}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> values: SkyValues;
@group(1) @binding(1) var transmittance_table: texture_2d<f32>;
@group(1) @binding(2) var multiscatter_table: texture_2d<f32>;
@group(1) @binding(3) var sky_view_table: texture_2d<f32>;
@group(1) @binding(4) var clamped: sampler;
@group(1) @binding(5) var wrapped: sampler;

struct CloudOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
    @location(1) @interpolate(flat, either) steps: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> CloudOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: CloudOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
    out.steps = u32(values.view.w);
    return out;
}

/// The air's transmittance from the camera toward a direction whose height is `mu`.
fn through_air(mu: f32) -> vec3f {
    let uv = transmittance_uv(values.air.ground.w, values.view.y, values.view.x, mu);
    return textureSampleLevel(transmittance_table, clamped, uv, 0.0).rgb;
}

/// The sky view table's light in the unit direction `d`.
fn sky_view(d: vec3f) -> vec3f {
    let uv = sky_view_uv(values.air.ground.w, values.view.x, d);
    return textureSampleLevel(sky_view_table, wrapped, uv, 0.0).rgb;
}

/// The light at the camera of a light toward `toward` of `light` above the air, none below the
/// horizon.
fn light_at_camera(toward: vec3f, light: f32) -> vec3f {
    return through_air(toward.y) * (light * smoothstep(-0.01, 0.01, toward.y));
}

@fragment
fn fs(in: CloudOut) -> @location(0) vec4f {
    let direction = normalize(in.direction);
    let light = CloudLight(
        values.sun.xyz,
        light_at_camera(values.sun.xyz, values.sun.w) * 0.22,
        values.moon.xyz,
        light_at_camera(values.moon.xyz, values.moon.w) * 0.22,
        sky_view(vec3f(0.0, 1.0, 0.0)),
    );
    let field =
        CloudField(
            vec4f(values.clouds.x, values.clouds.y, values.clouds.z, values.clouds.w),
            values.cloud_place.xy,
        );
    let seed = bitcast<u32>(in.clip.x) ^ (bitcast<u32>(in.clip.y) << 16u);
    let clouds = cloud_march(direction, light, field, in.steps, seed);
    let scale = values.view.z * frame.output.exposure;
    let color =
        null3d::tonemap::finish(
            clouds.rgb * scale,
            in.clip.xy,
            frame.output,
            frame.target_size.xy,
            frame.vignette,
        );
    return vec4f(color.rgb * clouds.w, clouds.w);
}
