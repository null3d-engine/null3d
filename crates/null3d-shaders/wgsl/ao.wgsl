// Ambient occlusion's steps, as three.js's GTAOPass draws them, at a fraction of the render size.
// Each step is one triangle over its target's drawn corner:
//
// - `depth` copies one texel of the depth that the depth prepass left per pixel: the depth of the
//   surface whose occlusion the pixel finds. The MULTISAMPLED build reads sample 0 of a
//   multisampled depth target. The depth binds as unfilterable floats, since compatibility mode
//   reads no depth texture type with textureLoad.
// - `horizon` is three.js's GTAOShader: it rebuilds the surface's normal from the depth around it,
//   then searches each of a few slices around the view for the horizons that hide the sky, and
//   writes how open the surface is, with the normal. It also marches the sun's contact shadows
//   through the depth copy. It writes the occlusion, the normal's x and y, and the contact shadows.
//   The normal faces the camera, so its z follows from x and y.
// - `denoise` is three.js's PoissonDenoiseShader: a blur over a disk of taps that keeps the taps on
//   the pixel's own surface, by their occlusion, their distance from its plane and their normal. It
//   writes the occlusion beside the depth, which the opaque pass reads (null3d::gtao). The same
//   taps blur the contact shadows, kept to the surface by its plane and normal alone, which
//   smooths the noise of the march's start without bleeding across an object's edge.
//
// When only contact shadows draw, the same steps run: the horizon step skips the horizon search,
// and the denoise writes no occlusion.
//
// The last step's target holds one value per channel: the occlusion, the depth, the length of a
// reflected ray (written by a step of screen-space reflections, which this step copies through, or
// 0 for none), and the share of the sun that contact shadows let through (1 for all of it).
//
// Contact shadows are short shadows found in the camera's depth. From the surface at each texel, a
// ray goes toward the sun for a short reach. It steps across the depth copy between the ray's two
// ends on the screen, where the depth value changes linearly. A step whose ray lies behind the
// surface that the copy holds, by more than a small bias and less than a thickness, is in shadow.
// They close the lit gap that the cascades' texels and biases leave where small objects meet the
// ground. Each texel jitters its steps with interleaved gradient noise, which the denoise blurs.
//
// Positions are in the camera's view space, from texture coordinates of the render size that count
// from the top left. A texel of the steps stands for the pixel of the scene under its center.
// WebGPU draws a corner into a target's first rows, and WebGL2, which counts rows from the bottom,
// into its last, so the steps turn rows around there. Every read clamps inside the drawn corner.
#import null3d::fullscreen::{triangle}
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
    /// three.js's scale, the slices around the view, the steps along each slice, and 1 while the
    /// denoise copies screen-space reflections' ray lengths, else 0.
    shape: vec4f,
    /// The denoise's luma, depth and normal phi, and its radius in texels of the steps.
    denoise: vec4f,
    /// xyz: the unit direction toward the sun, in view space. w: how far contact shadows reach, in
    /// meters.
    contact: vec4f,
    /// x: the steps of each contact shadow's march, 0 for none. y: how thick the march takes each
    /// surface of the depth copy to be, in meters. z: 1 while ambient occlusion draws, else 0.
    /// w: a spare.
    march: vec4f,
}

// Binding 1 is the scene's depth target in the depth step, and the steps' copy of the depth in the
// others. Binding 2 is the horizon step's target, which only the denoise reads, and binding 3 the
// target of screen-space reflections' trace, which only the denoise reads, and only while they draw,
// or a blank array while they do not. It binds as an array of layers in either case.
@group(0) @binding(0) var<uniform> settings: Settings;
#ifdef MULTISAMPLED
@group(0) @binding(1) var source: texture_multisampled_2d<f32>;
#else
@group(0) @binding(1) var source: texture_2d<f32>;
#endif
@group(0) @binding(2) var horizons: texture_2d<f32>;
@group(0) @binding(3) var reflections: texture_2d_array<f32>;

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
    return triangle(vertex);
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
    let depth = depth_at(texel);
    if depth <= 0.0 {
        // The far plane, where no surface hides the sky or the sun.
        return vec4f(1.0, 0.0, 0.0, 1.0);
    }
    let center = position_at(texel);
    let normal = rebuilt_normal(texel, center);
    let contact = contact_light(texel, depth);
    if settings.march.z <= 0.0 {
        return vec4f(1.0, normal.xy, contact);
    }
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
    return vec4f(occlusion, normal.xy, contact);
}

/// The horizon step's occlusion, normal's x and y, and contact shadows at a texel, clamped inside
/// the corner.
fn horizon_at(texel: vec2i) -> vec4f {
    let inside = clamp(texel, vec2i(0), vec2i(settings.corners.zw) - 1);
    return textureLoad(horizons, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0);
}

/// The reflected ray's length that screen-space reflections' trace wrote at a texel, or 0 while
/// they draw nothing.
fn reflection_at(texel: vec2i) -> f32 {
    if settings.shape.w < 0.5 {
        return 0.0;
    }
    return textureLoad(reflections, vec2i(texel.x, turned(texel.y, settings.extents.w)), 0, 0).z;
}

/// Interleaved gradient noise (Jimenez 2014) at a texel: a value from 0 to 1 that changes from each
/// texel to the next with little low-frequency pattern.
fn gradient_noise(texel: vec2i) -> f32 {
    return fract(52.9829189 * fract(dot(vec2f(texel), vec2f(0.06711056, 0.00583715))));
}

/// The unit normal whose x and y the horizon step wrote. It faces the camera, so its z is positive.
fn unpacked_normal(xy: vec2f) -> vec3f {
    return vec3f(xy, sqrt(max(1.0 - dot(xy, xy), 0.0)));
}

/// three.js's Poisson denoise of the horizon step's occlusion at `texel`, whose copied depth is
/// `depth`, then the same disk's blur of its contact shadows. The contact shadows' taps keep to the
/// surface by their distance from its plane, within a share of its distance from the camera, and
/// by their normal. Each is 1 where it does not draw, and at the far plane.
fn blurred(texel: vec2i, depth: f32) -> vec2f {
    let draws = vec2f(settings.march.z, settings.march.x) > vec2f(0.0);
    if depth <= 0.0 || !any(draws) {
        return vec2f(1.0);
    }
    let found = horizon_at(texel);
    let center = position_at(texel);
    let normal = unpacked_normal(found.yz);
    let contact_phi = CONTACT_PLANE * -center.z;
    // Interleaved gradient noise turns the disk at each texel, where three.js reads a noise texture.
    let noise = gradient_noise(texel);
    let swing = vec2f(sin(noise * 2.0 * PI), cos(noise * 2.0 * PI));
    // three.js's matrix from its noise, as its shader builds it.
    let turn = mat2x2f(swing.x, -swing.y, swing.x, swing.y);
    let luma_phi = settings.denoise.x;
    let depth_phi = settings.denoise.y;
    let normal_phi = settings.denoise.z;
    let radius = settings.denoise.w;
    var sums = found.xw;
    var totals = vec2f(1.0);
    for (var tap = 0; tap < DENOISE_TAPS; tap++) {
        let angle = 2.0 * PI * DENOISE_RINGS * f32(tap) / f32(DENOISE_TAPS);
        let spread = f32(tap) / f32(DENOISE_TAPS - 1);
        let offset = turn * (vec2f(cos(angle), sin(angle)) * (1.0 + spread * (radius - 1.0)));
        let other = texel + vec2i(floor(offset + 0.5));
        let held = horizon_at(other);
        let normal_weight = pow(max(dot(normal, unpacked_normal(held.yz)), 0.0), normal_phi);
        let luma_weight = max(1.0 - abs(held.x - found.x) / luma_phi, 0.0);
        let plane = abs(dot(center - position_at(other), normal));
        let depth_weight = max(1.0 - plane / depth_phi, 0.0);
        let contact_weight = max(1.0 - plane / contact_phi, 0.0);
        let weights = vec2f(luma_weight * depth_weight, contact_weight) * normal_weight;
        sums += held.xw * weights;
        totals += weights;
    }
    return select(vec2f(1.0), sums / totals, draws);
}

/// How far from a surface's plane the blur of its contact shadows still takes a tap, as a share of
/// the surface's distance from the camera. A tap on a small object above the surface, such as a
/// pebble on the ground, lies further out, so its shadow does not bleed onto the object.
const CONTACT_PLANE: f32 = 0.01;
/// The share of the march's reach, at its far end, over which a hit's shadow fades out, so each
/// contact shadow ends softly rather than at a hard line.
const CONTACT_FADE: f32 = 0.5;
/// The bias of the march as a share of the surface's distance from the camera: a ray must lie
/// this far behind a surface of the depth copy before it counts as hidden. It covers the depth
/// copy's texels, which each hold the depth at one point of their area.
const CONTACT_BIAS: f32 = 0.004;
/// The share of the depth copy's corner, at each edge, over which contact shadows fade out, as
/// the copy holds no surfaces past its edges.
const CONTACT_EDGE: f32 = 0.05;

/// The distance along the camera's view of the surface at texture coordinates `uv` whose depth
/// value is `depth`.
fn view_distance(uv: vec2f, depth: f32) -> f32 {
    return -view_position(uv, depth, settings.inverse_projection).z;
}

/// The texture coordinates, from the top left, of a point in clip space.
fn clip_uv(clip: vec4f) -> vec2f {
    let ndc = clip.xy / clip.w;
    return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

/// The change of the copied depth per unit of texture coordinates at `texel`, whose copied depth is
/// `depth`. On each axis it takes the neighbour whose depth is nearer, so a surface's edge does not
/// bend it. Depth values change linearly across the screen over a flat surface, so this predicts
/// the depth of the surface between the copy's points.
fn depth_slope(texel: vec2i, depth: f32) -> vec2f {
    let x = vec2i(1, 0);
    let y = vec2i(0, 1);
    let left = depth - depth_at(texel - x);
    let right = depth_at(texel + x) - depth;
    let up = depth - depth_at(texel - y);
    let down = depth_at(texel + y) - depth;
    let across = select(right, left, abs(left) < abs(right));
    let along = select(down, up, abs(up) < abs(down));
    return vec2f(across, along) / (texel_uv(texel + x + y) - texel_uv(texel));
}

/// The share of the sun that reaches the surface at `texel`, whose copied depth is `depth`, past
/// its contact shadows: 1 for all of it, and 1 where contact shadows do not draw.
fn contact_light(texel: vec2i, depth: f32) -> f32 {
    let steps = u32(settings.march.x);
    if steps == 0u || depth <= 0.0 {
        return 1.0;
    }
    let corner = settings.corners.zw;
    let start = position_at(texel);
    let to_sun = settings.contact.xyz;
    // A ray toward the camera stops short of the camera's plane, where it would leave the view.
    var reach = settings.contact.w;
    if to_sun.z > 0.0 {
        reach = min(reach, -0.9 * start.z / to_sun.z);
    }
    let near = settings.projection * vec4f(start, 1.0);
    let far = settings.projection * vec4f(start + to_sun * reach, 1.0);
    let first = clip_uv(near);
    let last = clip_uv(far);
    let depths = vec2f(near.z / near.w, far.z / far.w);
    let thickness = settings.march.y;
    let bias = CONTACT_BIAS * -start.z;
    let slope = depth_slope(texel, depth);
    let jitter = gradient_noise(texel);
    // Every texel runs the same steps, as the step count comes from the settings: a loop whose
    // count differs between the pixels of a work group runs wrongly on Adreno 830's driver.
    var shadow = 0.0;
    for (var k = 0u; k < steps; k++) {
        let t = (f32(k) + jitter) / f32(steps);
        let uv = mix(first, last, t);
        let inside = all(uv >= vec2f(0.0)) && all(uv < vec2f(1.0));
        // The copy holds each texel's depth at one point. Toward the ray's own point, the depth
        // follows the start's slope, so a flat surface at a grazing angle does not hide the ray.
        let at = vec2i(floor(uv * corner));
        let held = depth_at(at);
        let surface = held + dot(slope, uv - texel_uv(at));
        let gap = view_distance(uv, mix(depths.x, depths.y, t)) - view_distance(uv, surface);
        let hidden = inside && held > 0.0 && gap > bias && gap < thickness;
        let strength = 1.0 - smoothstep(1.0 - CONTACT_FADE, 1.0, t);
        shadow = max(shadow, select(0.0, strength, hidden));
    }
    // Toward the copy's edges, where the ray may leave the surfaces it holds, the shadow fades.
    let edges = min(min(last, 1.0 - last), min(first, 1.0 - first));
    let edge = saturate(min(edges.x, edges.y) / CONTACT_EDGE);
    return 1.0 - shadow * edge;
}

@fragment
fn denoise(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let depth = depth_at(texel);
    let values = blurred(texel, depth);
    return vec4f(values.x, depth, reflection_at(texel), values.y);
}
