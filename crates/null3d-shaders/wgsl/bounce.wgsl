// Screen-space bounce light's steps, at a fraction of the render size. Each step is one triangle
// over its target's drawn corner:
//
// - `gather` traces a few short rays from each texel's surface through the scene depth, toward the
//   hemisphere around its normal, and takes the color of the first surface that a ray passes
//   behind. It writes that color with the surface's distance. The MULTISAMPLED build reads sample
//   0 of a multisampled depth target. The depth binds as unfilterable floats, since compatibility
//   mode reads no depth texture type with textureLoad.
// - `denoise` blurs each texel over its neighbours, keeping to the surface by their distances, so
//   the rays' noise goes without one object's bounce bleeding onto another.
// - `add` draws at the render size, and adds the gathered light, weighted by each pixel's own
//   color as its albedo, to the scene's lit color. The result feeds the custom effects, the
//   volumetric fog, depth of field, bloom, the grading and the tone mapping.
//
// Positions are in the camera's view space, from texture coordinates of the render size that count
// from the top left. A texel of the steps stands for the pixel of the scene under its center.
// WebGPU draws a corner into a target's first rows, and WebGL2, which counts rows from the bottom,
// into its last, so the steps turn rows around there. Every read clamps inside the drawn corner.
#import null3d::fullscreen::{triangle}
#import null3d::depth::{view_position}
#import null3d::noise::{pcg, to_unit}

/// The steps' settings, which the frame builder writes once for all of them.
struct Settings {
    /// The camera's inverse projection matrix, and its projection.
    inverse_projection: mat4x4f,
    projection: mat4x4f,
    /// xy: the scene's drawn corner in pixels, the render size. zw: the steps' drawn corner.
    corners: vec4f,
    /// xy: the scene targets' extent, the canvas. zw: the steps' targets' extent.
    extents: vec4f,
    /// x: the farthest that a ray travels. y: the steps of each march. z: the light's share.
    /// w: how far behind a surface a ray may pass and still take its color.
    ray: vec4f,
}

// Binding 1 is the scene depth in the gather, the gather's target in the denoise and the denoised
// light in the add. Binding 2 is the scene color in the gather, the gather's target in the denoise
// and the lit color in the add.
@group(0) @binding(0) var<uniform> settings: Settings;
#ifdef MULTISAMPLED
@group(0) @binding(1) var first: texture_multisampled_2d<f32>;
#else
@group(0) @binding(1) var first: texture_2d<f32>;
#endif
@group(0) @binding(2) var second: texture_2d<f32>;

/// The most rays that a texel traces, as the settings give them.
const RAYS: u32 = 4;
/// How far the denoise keeps a neighbour whose distance differs from the centre's, as a share of
/// that distance, plus a floor in meters.
const DEPTH_TOLERANCE: f32 = 0.03;
const DEPTH_FLOOR: f32 = 0.02;
/// The gap behind a surface below which a ray counts as inside it, in meters.
const SURFACE_BIAS: f32 = 0.02;

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

/// The render size in pixels.
fn scene_size() -> vec2u {
    return vec2u(settings.corners.xy);
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

/// The depth that the scene depth target holds at a pixel counted from the top left.
fn depth_at(pixel: vec2i) -> f32 {
    let size = vec2i(scene_size());
    let inside = clamp(pixel, vec2i(0), size - 1);
    return textureLoad(first, vec2i(inside.x, turned(inside.y, settings.extents.y)), 0).x;
}

/// The view-space position of the surface at a pixel counted from the top left.
fn position_at(pixel: vec2i) -> vec3f {
    let uv = (vec2f(pixel) + 0.5) / settings.corners.xy;
    return view_position(uv, depth_at(pixel), settings.inverse_projection);
}

/// The scene color at a pixel counted from the top left.
fn color_at(pixel: vec2i) -> vec3f {
    let size = vec2i(scene_size());
    let inside = clamp(pixel, vec2i(0), size - 1);
    return textureLoad(second, vec2i(inside.x, turned(inside.y, settings.extents.y)), 0).rgb;
}

/// The normal of the surface at `pixel`, from the neighbours on each side whose depths continue
/// the surface's slope best, so edges keep their own side.
fn rebuilt_normal(pixel: vec2i, center: vec3f) -> vec3f {
    let size = vec2i(scene_size());
    let last = size - 1;
    let step = max(1, i32(round(settings.corners.y / settings.corners.w)));
    let c = depth_at(pixel);
    let left = depth_at(pixel - vec2i(step, 0));
    let right = depth_at(pixel + vec2i(step, 0));
    let above = depth_at(pixel - vec2i(0, step));
    let below = depth_at(pixel + vec2i(0, step));
    let left_error = select(abs(left - c), 1e30, pixel.x < step);
    let right_error = select(abs(right - c), 1e30, pixel.x > last.x - step);
    let above_error = select(abs(above - c), 1e30, pixel.y < step);
    let below_error = select(abs(below - c), 1e30, pixel.y > last.y - step);
    var across = position_at(pixel + vec2i(step, 0)) - center;
    if left_error < right_error {
        across = center - position_at(pixel - vec2i(step, 0));
    }
    var up = position_at(pixel - vec2i(0, step)) - center;
    if below_error < above_error {
        up = center - position_at(pixel + vec2i(0, step));
    }
    return normalize(cross(across, up));
}

/// A number from 0 up to 1 for a pixel of the scene and a salt, by whole-number hashing, so every
/// GPU gives the same number and no value passes through a float.
fn random_at(pixel: vec2i, salt: u32) -> f32 {
    let at = u32(pixel.x) * 1973u + u32(pixel.y) * 9277u + salt;
    return to_unit(pcg(at | 1u));
}

/// A direction in the hemisphere around `normal`, from two numbers from 0 to 1: cosine weighted, so
/// the samples that count most are the ones nearest the normal, as a matte surface reflects.
fn hemisphere(normal: vec3f, a: f32, b: f32) -> vec3f {
    let angle = 6.2831853 * a;
    let radius = sqrt(b);
    let local = vec3f(cos(angle) * radius, sin(angle) * radius, sqrt(max(0.0, 1.0 - b)));
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(normal.y) > 0.9);
    let tangent = normalize(cross(up, normal));
    let bitangent = cross(normal, tangent);
    return normalize(tangent * local.x + bitangent * local.y + normal * local.z);
}

/// The light that one ray from `origin` toward `direction` finds, and 0 for none. The ray steps
/// through the scene in view space, and takes the first surface that it passes behind by less than
/// the thickness.
fn trace(origin: vec3f, direction: vec3f) -> vec3f {
    let reach = settings.ray.x;
    let steps = i32(settings.ray.y);
    let size = vec2i(scene_size());
    for (var i = 1; i <= steps; i++) {
        let t = f32(i) / f32(steps);
        let at = origin + direction * (reach * t);
        let clip = settings.projection * vec4f(at, 1.0);
        if clip.w <= 0.0 {
            return vec3f(0.0);
        }
        let ndc = clip.xy / clip.w;
        let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
        if uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 {
            return vec3f(0.0);
        }
        let pixel = min(vec2i(uv * vec2f(size)), size - 1);
        // A surface closer to the camera has the larger view-space z. A ray behind it has gone
        // past the surface that the pixel shows, which is a hit while the ray is within the
        // surface's thickness. The depth prepass leaves out blends and masked surfaces, whose
        // pixels hold the surface behind them, so a ray in front of that surface has no hit.
        let gap = position_at(pixel).z - at.z;
        if gap <= SURFACE_BIAS {
            continue;
        }
        if gap > settings.ray.w {
            // The ray has gone far behind the surface, and past it.
            continue;
        }
        return color_at(pixel) * (1.0 - 0.35 * t);
    }
    return vec3f(0.0);
}

@fragment
fn gather(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let pixel = scene_pixel(texel);
    let depth = depth_at(pixel);
    if depth <= 0.0 {
        // The background: nothing bounces from it.
        return vec4f(0.0);
    }
    let center = position_at(pixel);
    let normal = rebuilt_normal(pixel, center);
    var total = vec3f(0.0);
    for (var ray = 0u; ray < RAYS; ray++) {
        let a = random_at(pixel, 2u * ray);
        let b = random_at(pixel, 2u * ray + 1u);
        total += trace(center + normal * SURFACE_BIAS, hemisphere(normal, a, b));
    }
    // Half-precision targets hold the distance up to 65,504: a farther surface saturates, and the
    // denoise then keeps it with the other far texels.
    return vec4f(total / f32(RAYS), min(-center.z, 60000.0));
}

/// The gathered light at a texel of the steps' corner, counted from the top left, clamped inside
/// the drawn corner.
fn bounce_at(texel: vec2i) -> vec4f {
    let corner = vec2i(settings.corners.zw);
    let inside = clamp(texel, vec2i(0), corner - 1);
    return textureLoad(first, vec2i(inside.x, turned(inside.y, settings.extents.w)), 0);
}

@fragment
fn denoise(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = corner_texel(position);
    let center = bounce_at(texel);
    let tolerance = center.a * DEPTH_TOLERANCE + DEPTH_FLOOR;
    var sum = vec3f(0.0);
    var weight = 0.0;
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let other = bounce_at(texel + vec2i(x, y));
            // A neighbour that lies far from the centre's distance is on another surface: its
            // light must not bleed across the edge. The weight falls with the distance from the
            // centre, so the blur stays soft at its edge.
            let w =
                1.0
                / (1.0 + abs(other.a - center.a) / tolerance)
                / (1.0 + f32(x * x + y * y));
            sum += other.rgb * w;
            weight += w;
        }
    }
    return vec4f(sum / max(weight, 1e-5), center.a);
}

@fragment
fn add(@builtin(position) position: vec4f) -> @location(0) vec4f {
    var at = vec2i(position.xy);
#ifdef WEBGL2
    // WebGL2 counts a fragment's row from the bottom of the canvas. The pass draws the top rows of
    // a target of the canvas's height, so the turn uses that height.
    at.y = i32(settings.extents.y) - 1 - at.y;
#endif
    let corner = vec2i(settings.corners.zw);
    let texel = min(
        vec2i(floor((vec2f(at) + 0.5) * settings.corners.zw / settings.corners.xy)),
        corner - 1,
    );
    let gathered = bounce_at(texel);
    let lit = color_at(at);
    // The surface's own color as a stand-in for its albedo: a dark surface sends less back than a
    // bright one, and a colored surface tints what it sends. A texel of the background sends none:
    // the gather leaves its distance at 0.
    let albedo = select(vec3f(0.0), clamp(lit, vec3f(0.0), vec3f(1.0)), gathered.a > 0.0);
    let alpha = textureLoad(second, vec2i(at.x, turned(at.y, settings.extents.y)), 0).a;
    return vec4f(lit + gathered.rgb * albedo * settings.ray.z, alpha);
}
