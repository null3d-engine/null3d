// Ambient occlusion's steps, as three.js's GTAOPass draws them, at a fraction of the render size.
// Each step is one triangle over its target's drawn corner:
//
// - `depth` copies one texel of the depth that the depth prepass left per pixel: the depth of the
//   surface whose occlusion the pixel finds. The MULTISAMPLED build reads sample 0 of a
//   multisampled depth target. The depth binds as unfilterable floats, since compatibility mode
//   reads no depth texture type with textureLoad.
// - `horizon` is three.js's GTAOShader: it rebuilds the surface's normal from the depth around it,
//   then searches each of a few slices around the view for the horizons that hide the sky, and
//   writes how open the surface is, with the normal.
// - `denoise` is three.js's PoissonDenoiseShader: a blur over a disk of taps that keeps the taps on
//   the pixel's own surface, by their occlusion, their distance from its plane and their normal. It
//   writes the occlusion beside the depth, which the opaque pass reads (null3d::gtao).
//
// Positions are in the camera's view space, from texture coordinates of the render size that count
// from the top left. A texel of the steps stands for the pixel of the scene under its center.
// WebGPU draws a corner into a target's first rows, and WebGL2, which counts rows from the bottom,
// into its last, so the steps turn rows around there. Every read clamps inside the drawn corner.
#import null3d::depth::{view_position}

/// The steps' settings, which the frame builder writes once for all of them.
struct Settings {
    /// The camera's projection matrix, and its inverse.
    projection: mat4x4f,
    inverse_projection: mat4x4f,
    /// xy: the scene's drawn corner in pixels, the render size. zw: the steps' drawn corner.
    corners: vec4f,
    /// xy: the scene depth target's size in pixels. zw: the size of the steps' targets.
    extents: vec4f,
    /// three.js's radius, thickness, distance exponent and distance falloff.
    horizon: vec4f,
    /// three.js's scale, the slices around the view, the steps along each slice, and a spare.
    shape: vec4f,
    /// The denoise's luma, depth and normal phi, and its radius in texels of the steps.
    denoise: vec4f,
}

// Binding 1 is the scene's depth target in the depth step, and the steps' copy of the depth in the
// others. Binding 2 is the horizon step's target, which only the denoise reads.
@group(0) @binding(0) var<uniform> settings: Settings;
#ifdef MULTISAMPLED
@group(0) @binding(1) var source: texture_multisampled_2d<f32>;
#else
@group(0) @binding(1) var source: texture_2d<f32>;
#endif
@group(0) @binding(2) var horizons: texture_2d<f32>;

const PI: f32 = 3.141592653589793;
/// The taps of the denoise's disk, and its rings: three.js's defaults.
const DENOISE_TAPS: i32 = 16;
const DENOISE_RINGS: f32 = 2.0;
/// The side of three.js's magic square, whose numbers turn each pixel's slices.
const NOISE_SIZE: i32 = 5;
/// The slope error of a neighbor outside the steps' corner, which no neighbor inside it reaches.
const OUTSIDE: f32 = 1e30;

/// The number at `cell` of three.js's 5 x 5 magic square, from 1 to 25, by the rule that its
/// construction follows. A formula, as some drivers reject a constant array in GLSL.
fn magic_square(cell: vec2i) -> i32 {
    let high = (4 * cell.y + 4 * cell.x + 1) % NOISE_SIZE;
    let low = (3 * cell.y + 4 * cell.x + 3) % NOISE_SIZE;
    return NOISE_SIZE * high + low + 1;
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// A row counted from the top of a drawn corner, as a row of a texture of `rows` rows: the same on
/// WebGPU, and turned around on WebGL2. The same turn maps a texture's row back.
fn turned(row: i32, rows: f32) -> i32 {
#ifdef WEBGL2
    return i32(rows) - 1 - row;
#else
    return row;
#endif
}

/// The texel of the steps' corner that a fragment covers, counted from the corner's top left.
fn corner_texel(position: vec4f) -> vec2i {
    let texel = vec2i(position.xy);
    return vec2i(texel.x, turned(texel.y, settings.extents.w));
}

/// The pixel of the scene that a texel of the steps stands for, from the top left.
fn scene_pixel(texel: vec2i) -> vec2i {
    let at = floor((vec2f(texel) + 0.5) * settings.corners.xy / settings.corners.zw);
    return min(vec2i(at), vec2i(settings.corners.xy) - 1);
}

/// The texture coordinates of the scene pixel that a texel of the steps stands for.
fn texel_uv(texel: vec2i) -> vec2f {
    return (vec2f(scene_pixel(texel)) + 0.5) / settings.corners.xy;
}

/// The depth that the steps' copy holds at a texel, clamped inside the corner.
fn depth_at(texel: vec2i) -> f32 {
    let inside = clamp(texel, vec2i(0), vec2i(settings.corners.zw) - 1);
    return textureLoad(source, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0).x;
}

/// The view-space position of the surface at a texel of the steps.
fn position_at(texel: vec2i) -> vec3f {
    return view_position(texel_uv(texel), depth_at(texel), settings.inverse_projection);
}

@fragment
fn depth(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let pixel = scene_pixel(corner_texel(position));
    let at = vec2i(pixel.x, turned(pixel.y, settings.extents.y));
    return vec4f(textureLoad(source, at, 0).x, 0.0, 0.0, 1.0);
}

/// three.js's computeNormalFromDepth: the normal of the surface at `texel`, from the neighbors on
/// each side whose depths continue the surface's slope best, so edges keep their own side. At the
/// corner's edges the neighbor inside the corner speaks for the surface: a neighbor outside it
/// reads the edge texel's own depth, so it would always look best, and at the right and bottom
/// edges its position is the edge texel's own, which leaves no direction to build a normal from.
fn rebuilt_normal(texel: vec2i, center: vec3f) -> vec3f {
    let last = vec2i(settings.corners.zw) - 1;
    let c = depth_at(texel);
    let left = depth_at(texel - vec2i(1, 0));
    let right = depth_at(texel + vec2i(1, 0));
    let above = depth_at(texel - vec2i(0, 1));
    let below = depth_at(texel + vec2i(0, 1));
    let left_error =
        select(abs(2.0 * left - depth_at(texel - vec2i(2, 0)) - c), OUTSIDE, texel.x <= 0);
    let right_error =
        select(abs(2.0 * right - depth_at(texel + vec2i(2, 0)) - c), OUTSIDE, texel.x >= last.x);
    let above_error =
        select(abs(2.0 * above - depth_at(texel - vec2i(0, 2)) - c), OUTSIDE, texel.y <= 0);
    let below_error =
        select(abs(2.0 * below - depth_at(texel + vec2i(0, 2)) - c), OUTSIDE, texel.y >= last.y);
    var across = position_at(texel + vec2i(1, 0)) - center;
    if left_error < right_error {
        across = center - position_at(texel - vec2i(1, 0));
    }
    var up = position_at(texel - vec2i(0, 1)) - center;
    if below_error < above_error {
        up = center - position_at(texel + vec2i(0, 1));
    }
    return normalize(cross(across, up));
}

/// The view-space position of the surface under the sample at `view`, as three.js finds it: at the
/// sample's own place on the screen, with the depth of the texel under it. A flat surface then
/// keeps its samples on the search's line, and does not hide itself.
fn surface_under(view: vec3f) -> vec3f {
    let clip = settings.projection * vec4f(view, 1.0);
    let ndc = clip.xy / clip.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    let texel = vec2i(floor(uv * settings.corners.zw));
    return view_position(uv, depth_at(texel), settings.inverse_projection);
}

/// How far one side's horizon rises with the sample at `offset` from the surface, three.js's step.
fn raise(horizon: f32, center: vec3f, to_view: vec3f, offset: vec3f, falloff: f32) -> f32 {
    let delta = surface_under(center + offset) - center;
    if abs(delta.z) >= settings.horizon.y {
        return horizon;
    }
    let cosine = dot(to_view, normalize(delta));
    return horizon + max(0.0, (cosine - horizon) * falloff);
}

@fragment
fn horizon(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    if depth_at(texel) <= 0.0 {
        // The far plane, where no surface hides the sky.
        return vec4f(1.0, 0.0, 0.0, 0.0);
    }
    let center = position_at(texel);
    let normal = rebuilt_normal(texel, center);
    let noise = (texel % NOISE_SIZE + NOISE_SIZE) % NOISE_SIZE;
    let turn = 2.0 * PI * f32(magic_square(noise)) / f32(NOISE_SIZE * NOISE_SIZE);
    let tangent = vec3f(cos(turn), sin(turn), 0.0);
    let bitangent = vec3f(-tangent.y, tangent.x, 0.0);
    let radius = settings.horizon.x;
    let exponent = settings.horizon.z;
    let falloff = settings.horizon.w;
    let slices = i32(settings.shape.y);
    let steps = i32(settings.shape.z);
    let to_view = normalize(-center);
    var open = 0.0;
    for (var slice = 0; slice < slices; slice++) {
        let angle = f32(slice) / f32(slices) * PI;
        let direction = normalize(tangent * cos(angle) + bitangent * sin(angle));
        let slice_bitangent = normalize(cross(direction, to_view));
        let slice_tangent = cross(slice_bitangent, to_view);
        let normal_in_slice =
            normalize(normal - slice_bitangent * dot(normal, slice_bitangent));
        let toward_normal = cross(normal_in_slice, slice_bitangent);
        var horizons = vec2f(dot(to_view, toward_normal), dot(to_view, -toward_normal));
        for (var step = 0; step < steps; step++) {
            let reach = radius * pow(f32(step + 1) / f32(steps), exponent);
            let offset = direction * reach;
            let fall = mix(1.0, 2.0 / f32(step + 2), falloff);
            horizons.x = raise(horizons.x, center, to_view, offset, fall);
            horizons.y = raise(horizons.y, center, to_view, -offset, fall);
        }
        let sines = sqrt(1.0 - horizons * horizons);
        let nx = dot(normal_in_slice, slice_tangent);
        let ny = dot(normal_in_slice, to_view);
        let nxb = 0.5 * (acos(horizons.y) - acos(horizons.x) + sines.x * horizons.x
            - sines.y * horizons.y);
        let nyb = 0.5 * (2.0 - horizons.x * horizons.x - horizons.y * horizons.y);
        open += nx * nxb + ny * nyb;
    }
    let occlusion = pow(clamp(open / f32(slices), 0.0, 1.0), settings.shape.x);
    return vec4f(occlusion, normal);
}

/// The horizon step's occlusion and normal at a texel, clamped inside the corner.
fn horizon_at(texel: vec2i) -> vec4f {
    let inside = clamp(texel, vec2i(0), vec2i(settings.corners.zw) - 1);
    return textureLoad(horizons, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0);
}

@fragment
fn denoise(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let depth = depth_at(texel);
    let found = horizon_at(texel);
    if depth <= 0.0 || dot(found.yzw, found.yzw) == 0.0 {
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    let center = position_at(texel);
    let normal = found.yzw;
    // Interleaved gradient noise turns the disk at each texel, where three.js reads a noise texture.
    let p = vec2f(texel);
    let noise = fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
    let swing = vec2f(sin(noise * 2.0 * PI), cos(noise * 2.0 * PI));
    // three.js's matrix from its noise, as its shader builds it.
    let turn = mat2x2f(swing.x, -swing.y, swing.x, swing.y);
    let luma_phi = settings.denoise.x;
    let depth_phi = settings.denoise.y;
    let normal_phi = settings.denoise.z;
    let radius = settings.denoise.w;
    var sum = found.x;
    var total = 1.0;
    for (var tap = 0; tap < DENOISE_TAPS; tap++) {
        let angle = 2.0 * PI * DENOISE_RINGS * f32(tap) / f32(DENOISE_TAPS);
        let spread = f32(tap) / f32(DENOISE_TAPS - 1);
        let offset = turn * (vec2f(cos(angle), sin(angle)) * (1.0 + spread * (radius - 1.0)));
        let other = texel + vec2i(floor(offset + 0.5));
        let held = horizon_at(other);
        let normal_weight = pow(max(dot(normal, held.yzw), 0.0), normal_phi);
        let luma_weight = max(1.0 - abs(held.x - found.x) / luma_phi, 0.0);
        let plane = abs(dot(center - position_at(other), normal));
        let depth_weight = max(1.0 - plane / depth_phi, 0.0);
        let weight = luma_weight * depth_weight * normal_weight;
        sum += held.x * weight;
        total += weight;
    }
    return vec4f(sum / total, depth, 0.0, 1.0);
}
