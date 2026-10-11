// Screen-space reflections' steps before the camera's opaque pass, on the grid of the screen
// texture that ambient occlusion's steps share (see ao.wgsl). Each step is one triangle over its
// target's drawn corner:
//
// - `reduce` makes one level of a depth pyramid: each texel keeps the nearest depth of the 2 x 2
//   texels of the level below it. The engine draws with reversed depth, so the nearest depth is the
//   largest. The first level is ambient occlusion's depth copy, one texel per texel of the grid.
// - `trace` marches each texel's mirror ray through the pyramid, as AMD's FidelityFX SSSR marches
//   it: where a cell holds nothing nearer than the ray, the ray crosses the cell and climbs a
//   level; where it does, the ray stops at the cell's nearest depth or its edge, and drops a level.
//   It writes the length of the ray to its hit, in world units, or 0 for a miss, into z of the
//   screen texture. x and y hold no occlusion and the texel's depth, and w no contact shadow, until
//   the last of the screen texture's steps writes them.
//
// Positions on the grid count texels of the first level from the corner's top left. WebGPU draws a
// corner into a target's first rows and WebGL2, which counts rows from the bottom, into its last,
// so the steps turn rows around there, by each texture's own height.
#import null3d::depth::{view_position}

/// One pyramid step's values.
struct Level {
    /// xy: the drawn corner of the level that the step reads, in texels. z: the height of the
    /// step's own target, which WebGL2 turns rows by. w: a spare.
    finer: vec4f,
}

/// The trace's values, which the frame builder writes when a setting, the lens or the size changes.
struct Trace {
    /// The camera's projection matrix, and its inverse.
    projection: mat4x4f,
    inverse_projection: mat4x4f,
    /// xy: the render size in pixels. zw: the grid's drawn corner, in texels of the first level.
    corners: vec4f,
    /// The most distance that a ray travels in world units, how far behind a surface the ray may
    /// pass and still hit it, in world units, the most steps of the march, and 1 for an
    /// orthographic camera.
    ray: vec4f,
}

#ifdef REDUCE
@group(0) @binding(0) var<uniform> level: Level;
@group(0) @binding(1) var finer: texture_2d<f32>;
#else
@group(0) @binding(0) var<uniform> trace: Trace;
@group(0) @binding(1) var level_0: texture_2d<f32>;
@group(0) @binding(2) var level_1: texture_2d<f32>;
@group(0) @binding(3) var level_2: texture_2d<f32>;
@group(0) @binding(4) var level_3: texture_2d<f32>;
@group(0) @binding(5) var level_4: texture_2d<f32>;
@group(0) @binding(6) var level_5: texture_2d<f32>;
@group(0) @binding(7) var level_6: texture_2d<f32>;
#endif

/// The pyramid's coarsest level: a cell of it covers 64 texels of the first level each way.
const COARSEST: i32 = 6;
/// A far-off ray parameter, for a plane that the ray never meets.
const NEVER: f32 = 3.0e38;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// A row counted from the top of a drawn corner, as a row of a texture of `rows` rows: the same on
/// WebGPU, and turned around on WebGL2. The same turn maps a texture's row back.
fn turned(row: i32, rows: i32) -> i32 {
#ifdef WEBGL2
    return rows - 1 - row;
#else
    return row;
#endif
}

#ifdef REDUCE
@fragment
fn reduce(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let own = vec2i(i32(position.x), turned(i32(position.y), i32(level.finer.z)));
    let last = vec2i(level.finer.xy) - 1;
    let rows = i32(textureDimensions(finer).y);
    var nearest = 0.0;
    for (var k = 0; k < 4; k++) {
        let at = clamp(own * 2 + vec2i(k & 1, k >> 1u), vec2i(0), last);
        nearest = max(nearest, textureLoad(finer, vec2i(at.x, turned(at.y, rows)), 0).x);
    }
    return vec4f(nearest, 0.0, 0.0, 1.0);
}
#else

/// The depth that level `mip` of the pyramid holds at its texel `cell`, counted from the corner's
/// top left and clamped inside the level's drawn corner.
fn depth_at(mip: i32, cell: vec2i) -> f32 {
    let size = vec2i(trace.corners.zw);
    let corner = (size + (1 << u32(mip)) - 1) >> vec2u(u32(mip));
    let at = clamp(cell, vec2i(0), corner - 1);
    switch mip {
        case 0: {
            return textureLoad(level_0, vec2i(at.x, turned(at.y, i32(textureDimensions(level_0).y))), 0).x;
        }
        case 1: {
            return textureLoad(level_1, vec2i(at.x, turned(at.y, i32(textureDimensions(level_1).y))), 0).x;
        }
        case 2: {
            return textureLoad(level_2, vec2i(at.x, turned(at.y, i32(textureDimensions(level_2).y))), 0).x;
        }
        case 3: {
            return textureLoad(level_3, vec2i(at.x, turned(at.y, i32(textureDimensions(level_3).y))), 0).x;
        }
        case 4: {
            return textureLoad(level_4, vec2i(at.x, turned(at.y, i32(textureDimensions(level_4).y))), 0).x;
        }
        case 5: {
            return textureLoad(level_5, vec2i(at.x, turned(at.y, i32(textureDimensions(level_5).y))), 0).x;
        }
        default: {
            return textureLoad(level_6, vec2i(at.x, turned(at.y, i32(textureDimensions(level_6).y))), 0).x;
        }
    }
}

/// The pixel of the scene that a texel of the grid stands for, as ambient occlusion's depth step
/// took its depth, in texture coordinates of the render size.
fn texel_uv(texel: vec2i) -> vec2f {
    let render = trace.corners.xy;
    let at = floor((vec2f(texel) + 0.5) * render / trace.corners.zw);
    return (min(at, render - 1.0) + 0.5) / render;
}

/// The view-space position of the surface at a texel of the grid.
fn position_at(texel: vec2i) -> vec3f {
    return view_position(texel_uv(texel), depth_at(0, texel), trace.inverse_projection);
}

/// A view-space point on the grid: x and y in texels of the first level from the corner's top left,
/// and z its depth value.
fn on_grid(view: vec3f) -> vec3f {
    let clip = trace.projection * vec4f(view, 1.0);
    let ndc = clip.xyz / clip.w;
    return vec3f(vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * trace.corners.zw, ndc.z);
}

/// The surface's normal at `texel` from the depths around it, from the neighbors on each side
/// whose depths continue the surface's slope best, so edges keep their own side (three.js's
/// computeNormalFromDepth, as ambient occlusion's horizon step builds it).
fn rebuilt_normal(texel: vec2i, center: vec3f) -> vec3f {
    let last = vec2i(trace.corners.zw) - 1;
    let c = depth_at(0, texel);
    let left = depth_at(0, texel - vec2i(1, 0));
    let right = depth_at(0, texel + vec2i(1, 0));
    let above = depth_at(0, texel - vec2i(0, 1));
    let below = depth_at(0, texel + vec2i(0, 1));
    let left_error = select(abs(2.0 * left - depth_at(0, texel - vec2i(2, 0)) - c), NEVER, texel.x <= 0);
    let right_error =
        select(abs(2.0 * right - depth_at(0, texel + vec2i(2, 0)) - c), NEVER, texel.x >= last.x);
    let above_error = select(abs(2.0 * above - depth_at(0, texel - vec2i(0, 2)) - c), NEVER, texel.y <= 0);
    let below_error =
        select(abs(2.0 * below - depth_at(0, texel + vec2i(0, 2)) - c), NEVER, texel.y >= last.y);
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

/// The ray parameter at which the ray from `origin` along `direction` on the grid leaves the cell
/// of `size` texels that holds `at`, or meets the depth `surface` where it moves away from the
/// camera: whichever comes first. `ahead` holds 1 on each axis that the ray moves along in the
/// positive direction, else 0, and `nudge` a small step that carries the ray into the next cell.
fn exit_of_cell(
    origin: vec3f,
    inverse: vec3f,
    at: vec2f,
    size: f32,
    ahead: vec2f,
    nudge: vec2f,
    surface: f32,
) -> vec3f {
    let planes = (floor(at / size) + ahead) * size + nudge;
    let t = (vec3f(planes, surface) - origin) * inverse;
    return t;
}

@fragment
fn trace_rays(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let rows = i32(textureDimensions(level_0).y);
    let texel = vec2i(i32(position.x), turned(i32(position.y), rows));
    let depth = depth_at(0, texel);
    if depth <= 0.0 {
        // The far plane: nothing to reflect from.
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    let center = position_at(texel);
    let normal = rebuilt_normal(texel, center);
    let orthographic = trace.ray.w > 0.5;
    let to_view = select(normalize(-center), vec3f(0.0, 0.0, 1.0), orthographic);
    let reflected = reflect(-to_view, normal);
    // The ray's far end: the most distance, or less, so a ray toward the camera stops in front of
    // its plane, where the projection still maps it onto the grid.
    var reach = trace.ray.x;
    if !orthographic && reflected.z > 0.0 {
        reach = min(reach, (-center.z * 0.99) / reflected.z);
    }
    let origin = on_grid(center);
    let end = on_grid(center + reflected * reach);
    let direction = end - origin;
    if dot(direction.xy, direction.xy) < 1e-8 {
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    let safe = select(direction, vec3f(1.0), direction == vec3f(0.0));
    let inverse = select(1.0 / safe, vec3f(NEVER), direction == vec3f(0.0));
    let ahead = select(vec2f(0.0), vec2f(1.0), direction.xy >= vec2f(0.0));
    let nudge = select(vec2f(-0.01), vec2f(0.01), direction.xy >= vec2f(0.0));
    // The first step crosses the ray's own texel, so the ray does not hit the surface it leaves.
    let first = exit_of_cell(origin, inverse, origin.xy, 1.0, ahead, nudge, 0.0);
    var t = min(first.x, first.y);
    var mip = 0;
    let steps = i32(trace.ray.z);
    var step = 0;
    let grid = trace.corners.zw;
    loop {
        if step >= steps || mip < 0 || t > 1.0 {
            break;
        }
        let at = origin.xy + direction.xy * t;
        if any(at < vec2f(0.0)) || any(at >= grid) {
            break;
        }
        let ray_depth = origin.z + direction.z * t;
        if ray_depth <= 0.0 {
            // Past the far plane, where nothing on the screen lies.
            break;
        }
        let size = f32(1 << u32(mip));
        let surface = depth_at(mip, vec2i(floor(at / size)));
        let exits = exit_of_cell(origin, inverse, at, size, ahead, nudge, surface);
        // The depth plane counts only where the ray moves away from the camera: lower depth values.
        let to_surface = select(NEVER, exits.z, direction.z < 0.0);
        let edge = min(exits.x, exits.y);
        let in_front = ray_depth > surface;
        if in_front {
            let next = min(edge, to_surface);
            // Crossing the cell to its edge leaves the cell empty: climb. Meeting the depth inside
            // the cell: look closer.
            if next == edge && mip < COARSEST {
                mip += 1;
            } else if next != edge {
                mip -= 1;
            }
            t = max(t, next);
        } else {
            mip -= 1;
        }
        step += 1;
    }
    if mip >= 0 || t > 1.0 {
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    let at = origin.xy + direction.xy * t;
    if any(at < vec2f(0.0)) || any(at >= grid) {
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    // The hit counts only where the ray passes no farther behind the surface than its thickness.
    let cell = vec2i(floor(at));
    let ray_depth = origin.z + direction.z * t;
    let uv = at / grid;
    let surface = view_position(uv, depth_at(0, cell), trace.inverse_projection);
    let ray_point = view_position(uv, ray_depth, trace.inverse_projection);
    if surface.z - ray_point.z > trace.ray.y {
        return vec4f(1.0, depth, 0.0, 1.0);
    }
    return vec4f(1.0, depth, max(length(ray_point - center), 1e-4), 1.0);
}
#endif
