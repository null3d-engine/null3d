// The physical sky behind every object (see null3d::sky_scattering): the sky view table in each
// pixel's direction, the sun's disc through the air, the moon lit from the sun's side so that it
// shows its phase, the stars, and the clouds. It draws as the analytic sky does, as a box around
// the camera at the far plane (null3d::backdrop), and writes linear color as the mesh shaders
// write theirs: into the HDR scene color, or tone mapped and encoded on the 8-bit path.
#import null3d::globals::Frame
#import null3d::noise::{lattice, to_unit}
#import null3d::tonemap
#import null3d::backdrop::{box_corner}
#import null3d::atmosphere::{cloud_noise}
#import null3d::sky_scattering::{SkyValues, sky_view_uv, transmittance_uv, ground_hit, sun_disc, PI}
#import null3d::sky_clouds::{clouds}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> values: SkyValues;
@group(1) @binding(1) var transmittance_table: texture_2d<f32>;
@group(1) @binding(2) var multiscatter_table: texture_2d<f32>;
@group(1) @binding(3) var sky_view_table: texture_2d<f32>;
@group(1) @binding(4) var clamped: sampler;
@group(1) @binding(5) var wrapped: sampler;

struct SkyOut {
    @builtin(position) clip: vec4f,
    @location(0) direction: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> SkyOut {
    let corner = box_corner(vertex, frame.view_proj, frame.camera_position);
    var out: SkyOut;
    out.clip = corner.clip;
    out.direction = corner.direction;
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

/// The three numbers from 0 to 1 of a cell of the sky, from an integer hash of its coordinates,
/// so every GPU places the same stars (hard rule 29).
fn cell_hash(cell: vec3i) -> vec3f {
    let h = lattice(cell);
    return vec3f(to_unit(h.x), to_unit(h.y), to_unit(h.z));
}

/// The stars' light in the unit direction `d`, for pixels `pixel` radians wide. Each cell of a
/// grid on the faces of a cube may hold one star, at a place, brightness and color of its hash.
/// A star spreads over at least a pixel, with the same total light at any resolution.
fn stars(d: vec3f, pixel: f32, time: f32) -> vec3f {
    let a = abs(d);
    var uv: vec2f;
    var face: f32;
    if a.x >= a.y && a.x >= a.z {
        uv = d.yz / a.x;
        face = select(0.0, 1.0, d.x < 0.0);
    } else if a.y >= a.z {
        uv = d.xz / a.y;
        face = select(2.0, 3.0, d.y < 0.0);
    } else {
        uv = d.xy / a.z;
        face = select(4.0, 5.0, d.z < 0.0);
    }
    const CELLS = 160.0;
    let cell = floor((uv * 0.5 + 0.5) * CELLS);
    let h = cell_hash(vec3i(vec2i(cell), i32(face)));
    if h.x > 0.14 {
        return vec3f(0.0);
    }
    let center = (cell + 0.2 + 0.6 * h.yz) / CELLS * 2.0 - 1.0;
    var star: vec3f;
    if face < 2.0 {
        star = vec3f(select(1.0, -1.0, face > 0.5), center.x, center.y);
    } else if face < 4.0 {
        star = vec3f(center.x, select(1.0, -1.0, face > 2.5), center.y);
    } else {
        star = vec3f(center.x, center.y, select(1.0, -1.0, face > 4.5));
    }
    star = normalize(star);
    let distance = length(d - star);
    let size = max(pixel, 0.0003);
    // Few bright stars and many faint ones, most of them white to blue and a few orange.
    let rank = h.x / 0.14;
    let flux = 2.5e-6 * pow(1.0 - rank, 6.0) + 1.5e-7;
    let tint = mix(vec3f(1.0, 0.8, 0.64), vec3f(0.8, 0.88, 1.0), sqrt(fract(h.y * 7.31 + h.z)));
    // Stars low in the sky twinkle more, through more air.
    let twinkle = 1.0 + 0.45 * (1.0 - clamp(d.y * 3.0, 0.0, 1.0)) * sin(time * (5.0 + 9.0 * h.z) + h.y * 60.0);
    return tint * (flux * twinkle * exp(-(distance * distance) / (size * size)) / (PI * size * size));
}

/// The moon's light in the unit direction `d`, and its coverage there in `w`: its disc lit from
/// the sun's side, with darker seas, and a faint glow on its dark side from the earth.
fn moon_disc(d: vec3f, through: vec3f) -> vec4f {
    let moon = values.moon.xyz;
    let cos_radius = values.discs.y;
    let c = dot(d, moon);
    if values.moon.w <= 0.0 || c < cos_radius {
        return vec4f(0.0);
    }
    let sin_radius = sqrt(max(1.0 - cos_radius * cos_radius, 1e-12));
    let reference = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(moon.y) > 0.99);
    let t = normalize(cross(moon, reference));
    let b = cross(t, moon);
    let offset = d - moon * c;
    let xy = vec2f(dot(offset, t), dot(offset, b)) / sin_radius;
    let rr = dot(xy, xy);
    let coverage = 1.0 - smoothstep(0.85, 1.0, rr);
    let z = sqrt(max(1.0 - rr, 0.0));
    let normal = t * xy.x + b * xy.y - moon * z;
    let lit = max(dot(normal, values.sun.xyz), 0.0);
    let seas = smoothstep(0.05, 0.45, cloud_noise(xy * 2.3 + 7.0) * 0.5 + 0.5);
    let albedo = 1.0 - 0.35 * seas;
    let solid_angle = 2.0 * PI * (1.0 - cos_radius);
    let light = values.moon.w / solid_angle * (1.5 * lit + 0.01) * albedo;
    return vec4f(through * light, coverage);
}

@fragment
fn fs(in: SkyOut) -> @location(0) vec4f {
    let d = normalize(in.direction);
    // The pixel's width in radians, found before any branch.
    let pixel = length(fwidth(d));
    let r = values.view.x;
    var color = sky_view(d);
    let below = ground_hit(vec3f(0.0, r, 0.0), d, values.air.ground.w) >= 0.0;
    if !below {
        let through = through_air(d.y);
        let moon = moon_disc(d, through);
        if values.discs.w > 0.0 {
            // Starlight is too faint for the eye to see the air's tint in it, so the air only
            // dims it.
            let dimmed = dot(through, vec3f(0.2126, 0.7152, 0.0722));
            color += stars(d, pixel, frame.clock.x) * (values.discs.w * (1.0 - moon.w) * dimmed);
        }
        color += moon.rgb * moon.w;
        if values.discs.z > 0.0 {
            color += sun_disc(d, values.sun.xyz, values.sun.w, values.discs.x, through);
        }
        if d.y > 0.0 && values.clouds.z > 0.0 {
            let zenith = sky_view(vec3f(0.0, 1.0, 0.0));
            let sun_light = light_at_camera(values.sun.xyz, values.sun.w);
            let moon_light = light_at_camera(values.moon.xyz, values.moon.w);
            color = clouds(d, color, zenith, sun_light, moon_light, through, values);
        }
    }
    let scale = values.view.z * frame.output.exposure;
    return null3d::tonemap::finish(
        color * scale,
        in.clip.xy,
        frame.output,
        frame.target_size.xy,
        frame.vignette,
    );
}
