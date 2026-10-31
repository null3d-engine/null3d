// Screen-space bounce light: one bounce of the indirect diffuse light that the camera's own view
// showed in the frame before, at ambient occlusion's grid, which the camera's opaque pass mixes
// into the ambient light in place of the environment's diffuse light (null3d::gtao).
//
// - `trace` takes each texel of the grid, rebuilds the surface's position and normal from the depth
//   copy and the horizon step's normal, and samples a disk of screen texels around it. A sample
//   whose surface lies in the texel's hemisphere, within the gather's reach, takes the color that
//   the frame before showed there, from the copy that the transmission and reflections read too,
//   weighted by the cosine of its direction. The texel writes the mean light, times pi, and in
//   alpha the share of the disk that found a surface. The environment's light keeps the rest.
// - `denoise` blurs the traced light over a disk of taps that keeps to the texel's own surface, by
//   each tap's distance from its plane and its normal, as the ambient occlusion denoise does. The
//   opaque pass then reads the result through the same four depth-weighted texels that it reads the
//   occlusion from, so the light reaches each pixel of the scene at its own surface.
//
// Rows count from the top left of the drawn corner. WebGL2 counts rows from the bottom, so the
// steps turn rows around there. Every read clamps inside the drawn corner.
//
// The grid is ambient occlusion's, whose depth copy and normals these steps read, so the two
// features share one corner. The opaque pass reads the result as the screen texture's second layer
// and weights it by the frame's `bounce` values (null3d::gtao).

#import null3d::fullscreen::{triangle}
#import null3d::depth::{view_position}

/// The steps' settings, which the frame builder writes once for both of them.
struct Settings {
    /// The camera's projection matrix, and its inverse.
    projection: mat4x4f,
    inverse_projection: mat4x4f,
    /// xy: the scene's drawn corner in pixels, the render size. zw: the steps' drawn corner.
    corners: vec4f,
    /// xy: the depth copy's size in pixels. zw: the size of the steps' targets.
    extents: vec4f,
    /// x: the rays of each texel. y: the steps of each ray's march. z: the most distance of a ray,
    /// in meters. w: how far behind a surface a ray may pass and still hit it, in meters.
    ray: vec4f,
    /// x: the share of the screen over which the light fades toward its edges. y: the denoise's
    /// radius in texels of the steps. z: the share of a tap's weight that its depth keeps, w: the
    /// power that a tap's normal alignment is raised to.
    shape: vec4f,
    /// xy: the color copy's size in pixels. zw: the drawn corner that the frame before filled.
    copy: vec4f,
}

// Binding 1 is the depth copy, binding 2 the horizon step's target, which holds the normal's x and
// y, and binding 3 the color copy for the trace, or the traced light for the denoise. The copy is
// an array of layers, as the surfaces that let light through sample it; the traced light binds as
// an array of one layer so both builds take one layout.
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var depths: texture_2d<f32>;
@group(0) @binding(2) var horizons: texture_2d<f32>;
@group(0) @binding(3) var source: texture_2d_array<f32>;

const PI: f32 = 3.141592653589793;
/// The taps of the denoise's disk, and its rings, as ambient occlusion's denoise uses them.
const DENOISE_TAPS: i32 = 24;
const DENOISE_RINGS: f32 = 3.0;
/// The golden angle, which turns each ray's azimuth from the one before it and each texel's set
/// from its neighbors'.
const GOLDEN: f32 = 2.39996323;


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
    return textureLoad(depths, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0).x;
}

/// The view-space position of the surface at a texel of the steps.
fn position_at(texel: vec2i) -> vec3f {
    return view_position(texel_uv(texel), depth_at(texel), settings.inverse_projection);
}

/// The unit normal whose x and y the horizon step wrote. It faces the camera, so its z is positive.
fn unpacked_normal(xy: vec2f) -> vec3f {
    return vec3f(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

/// The surface's normal at a texel of the steps.
fn normal_at(texel: vec2i) -> vec3f {
    let inside = clamp(texel, vec2i(0), vec2i(settings.corners.zw) - 1);
    let held = textureLoad(horizons, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0);
    return unpacked_normal(held.yz);
}

/// A hashed number in [0, 1) for a texel, which turns that texel's rays from its neighbors'.
fn texel_noise(texel: vec2i) -> f32 {
    let at = vec2f(texel) + 0.5;
    return fract(52.9829189 * fract(0.06711056 * at.x + 0.00583715 * at.y));
}

/// The frame before's color at a scene pixel, from the copy that the camera's view filled at the
/// render size in its top left corner. Rows count from the bottom on WebGL2.
fn copied_color(pixel: vec2i) -> vec3f {
    let inside = clamp(pixel, vec2i(0), vec2i(settings.copy.zw) - 1);
    return textureLoad(source, vec2i(inside.x, turned(inside.y, settings.copy.y)), 0, 0).rgb;
}

/// The light from the surface at the texel `at`, as the frame before showed it, when that surface
/// lies in the hemisphere of `normal` around `center` within the gather's reach: its radiance and
/// its cosine with the normal, or 0.
fn gathered(center: vec3f, normal: vec3f, at: vec2i) -> vec4f {
    let depth = depth_at(at);
    if depth <= 0.0 {
        return vec4f(0.0);
    }
    let held = position_at(at);
    let delta = held - center;
    let reach = length(delta);
    // The texel's own surface, and surfaces beyond the reach, send nothing.
    if reach < settings.ray.w || reach > settings.ray.z {
        return vec4f(0.0);
    }
    // A surface that barely clears the texel's plane gives almost nothing, and its cosine would
    // make its light noisy, so it sends none.
    let cosine = dot(normal, delta / reach);
    if cosine <= 0.1 {
        return vec4f(0.0);
    }
    return vec4f(copied_color(scene_pixel(at)) * cosine, cosine);
}

@fragment
fn trace(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let center = position_at(texel);
    let depth = depth_at(texel);
    // A texel with nothing in front of the camera, or with a surface facing away from it, sends
    // no light back.
    if depth <= 0.0 {
        return vec4f(0.0);
    }
    let normal = normal_at(texel);
    let to_view = normalize(-center);
    if dot(normal, to_view) <= 0.0 {
        return vec4f(0.0);
    }
    let samples = i32(max(1.0, settings.ray.x));
    let noise = texel_noise(texel);
    // The gather samples a disk of screen texels around the texel, of the radius that the block
    // gives. Each sample takes the surface that the frame before showed there, and the cosine of
    // its direction against the surface's normal keeps the light of the hemisphere alone: a
    // surface beside the texel on its own plane sends none of it.
    let radius = max(1.0, settings.ray.y);
    let last = vec2i(settings.corners.zw) - 1;
    let place = texel_uv(texel);
    let edge = min(min(place.x, 1.0 - place.x), min(place.y, 1.0 - place.y));
    let inside = smoothstep(0.0, settings.shape.x, edge);
    var sum = vec3f(0.0);
    var weight = 0.0;
    var found = 0.0;
    for (var sample = 0; sample < samples; sample++) {
        // A spiral over the disk, turned by the texel's own noise so the samples spread evenly
        // from texel to texel.
        let angle = (f32(sample) + noise) * GOLDEN;
        let radial = sqrt((f32(sample) + 0.5) / f32(samples));
        let offset = vec2i(round(vec2f(cos(angle), sin(angle)) * radial * radius));
        let at = clamp(texel + offset, vec2i(0), last);
        let light = gathered(center, normal, at);
        if light.a > 0.0 {
            sum += light.rgb;
            weight += light.a;
            found += 1.0;
        }
    }
    if weight <= 0.0 {
        return vec4f(0.0);
    }
    // The share is the part of the disk that found a surface above the texel's plane. The samples
    // that found none keep the environment's light.
    return vec4f(PI * sum / weight, found / f32(samples) * inside);
}

/// The denoise's taps on a disk of `rings` rings around the center, three.js's Poisson pattern.
fn disk_tap(index: i32, rings: f32) -> vec2f {
    let ring = floor(sqrt(f32(index) + 0.5));
    let share = (ring + 0.5) / rings;
    let angle = f32(index) * GOLDEN;
    return vec2f(cos(angle), sin(angle)) * share;
}

@fragment
fn denoise(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let depth = depth_at(texel);
    if depth <= 0.0 {
        return vec4f(0.0);
    }
    let normal = normal_at(texel);
    let center = position_at(texel);
    let held = textureLoad(source, vec2i(texel.x, turned(texel.y, settings.extents.w)), 0, 0);
    // The center counts in full, and each tap by how near its surface's depth and normal are to
    // the center's, so light does not bleed from a wall onto the floor in front of it.
    var sum = held.rgb;
    var share = held.a;
    var total = 1.0;
    let radius = max(1.0, settings.shape.y);
    for (var tap = 0; tap < DENOISE_TAPS; tap++) {
        let offset = vec2i(round(disk_tap(tap, DENOISE_RINGS) * radius));
        let at = clamp(texel + offset, vec2i(0), vec2i(settings.corners.zw) - 1);
        let gap = abs(depth_at(at) - depth);
        let depth_weight = max(0.0, 1.0 - gap / (settings.shape.z * depth));
        if depth_weight <= 0.0 {
            continue;
        }
        let normal_weight = pow(max(dot(normal, normal_at(at)), 0.0), settings.shape.w);
        let weight = depth_weight * normal_weight;
        let found = textureLoad(source, vec2i(at.x, turned(at.y, settings.extents.w)), 0, 0);
        sum += found.rgb * weight;
        share += found.a * weight;
        total += weight;
    }
    return vec4f(sum / total, share / total);
}
