#define_import_path null3d::ssr
#import null3d::gtao::{gtao_map}
#import null3d::ibl::{environment_sampler}
#import null3d::mesh::{frame}
#import null3d::refraction::{transmission_map}

// Screen-space reflections in the camera's opaque pass. The steps before the pass (ssr.wgsl) march
// each texel's mirror ray through a depth pyramid, and leave the ray's length to its hit, or 0 for
// a miss, in z of the screen texture that ambient occlusion shares. Each pixel here casts its own
// reflected ray, along its own normal, for the length of the hits around it, and takes the point
// where the ray ends into last frame's view. It reads last frame's opaque color there, from the copy
// with a whole chain of mip levels that transmission samples too, at the level that the cone of its
// roughness covers. The reflection takes the place of the environment's by its share, which fades
// out on misses, toward the screen's edges, for rays that turn toward the camera, near the most
// distance and on rough surfaces, so the environment's light takes over with no hard edge.
//
// The frame's `reflection` values: x the reflections' strength, 0 while the view draws none or has
// no last frame to read; y the most roughness that reflects; z the most distance of a ray; w the
// share of the screen over which reflections fade toward its edges. `reflection_corner`: last
// frame's drawn corner of the copy in pixels in xy, and in z the pixels that one world unit spans at
// a distance of one unit in last frame's view, along y.

/// The share of a texel's weight that its depth keeps, from 1 for the pixel's own depth down to 0
/// at this far, as a fraction of the pixel's depth.
const DEPTH_TOLERANCE: f32 = 0.03;

/// The radius of a roughness's cone at one unit along the ray, per unit of the squared roughness.
const CONE: f32 = 0.6;

/// The length of the reflected ray at `pixel`, a fragment position whose depth value is `pixel.z`,
/// and the share of the nearby texels of the screen texture that hit, each weighted by how close
/// its depth lies to the pixel's own. The length averages the hits only.
fn reflection_hit(pixel: vec3f) -> vec2f {
    let values = frame.occlusion;
    let size = vec2i(textureDimensions(gtao_map));
    var from_top = pixel.xy;
#ifdef WEBGL2
    from_top.y = values.y - pixel.y;
#endif
    let corner = max(vec2i(round(frame.target_size.xy * values.zw)), vec2i(1));
    let at = from_top * values.zw - 0.5;
    let base = vec2i(floor(at));
    let blend = at - floor(at);
    var hits = 0.0;
    var reach = 0.0;
    var total = 0.0;
    for (var k = 0; k < 4; k++) {
        let offset = vec2i(k & 1, k >> 1u);
        var texel = clamp(base + offset, vec2i(0), corner - 1);
#ifdef WEBGL2
        texel.y = size.y - 1 - texel.y;
#endif
        let held = textureLoad(gtao_map, texel, 0);
        let along = mix(1.0 - blend, blend, vec2f(offset));
        let gap = abs(held.y - pixel.z);
        let weight = along.x * along.y * max(0.0, 1.0 - gap / (DEPTH_TOLERANCE * pixel.z));
        let hit = select(0.0, weight, held.z > 0.0);
        hits += hit;
        reach += hit * held.z;
        total += weight;
    }
    if hits <= 1e-4 {
        return vec2f(0.0);
    }
    return vec2f(reach / hits, hits / total);
}

/// The light that a surface at `relative`, a position relative to the camera, of unit `normal`
/// and perceptual `roughness`, reflects from what the screen showed along its mirror direction, in
/// `rgb`, and the share of the environment's reflection that it takes, from 0 to 1, in `a`.
/// `to_view` points from the surface toward the camera, and `pixel` is the fragment's position.
/// Blended surfaces take none: the screen texture describes the opaque surfaces behind them.
fn screen_reflection(
    pixel: vec4f,
    relative: vec3f,
    normal: vec3f,
    to_view: vec3f,
    roughness: f32,
    blended: bool,
) -> vec4f {
    let settings = frame.reflection;
    if settings.x <= 0.0 || blended {
        return vec4f(0.0);
    }
    let smooth_enough = 1.0 - smoothstep(settings.y * 0.7, settings.y, roughness);
    if smooth_enough <= 0.0 {
        return vec4f(0.0);
    }
    let hit = reflection_hit(pixel.xyz);
    if hit.y <= 0.0 {
        return vec4f(0.0);
    }
    let direction = reflect(-to_view, normal);
    // A ray that turns back toward the camera can only meet the backs of what the screen shows.
    let away = 1.0 - smoothstep(0.1, 0.6, dot(direction, to_view));
    let near_enough = 1.0 - smoothstep(settings.z * 0.8, settings.z, hit.x);
    let clip = frame.reflection_reprojection * vec4f(relative + direction * hit.x, 1.0);
    if clip.w <= 0.0 {
        return vec4f(0.0);
    }
    let ndc = clip.xy / clip.w;
    let screen = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    let edge = min(min(screen.x, 1.0 - screen.x), min(screen.y, 1.0 - screen.y));
    let inside = smoothstep(0.0, settings.w, edge);
    let share = hit.y * smooth_enough * away * near_enough * inside * settings.x;
    if share <= 0.0 {
        return vec4f(0.0);
    }
    let full = vec2f(textureDimensions(transmission_map, 0));
    let drawn = frame.reflection_corner.xy;
    var uv = clamp(screen * drawn, vec2f(0.5), drawn - 0.5) / full;
#ifdef WEBGL2
    uv.y = 1.0 - uv.y;
#endif
    // The cone of the roughness over the ray's length, in pixels of last frame's view, picks the
    // level whose texels are as wide.
    let radius = hit.x * roughness * roughness * CONE;
    let pixels = radius * frame.reflection_corner.z / clip.w;
    let last = floor(log2(max(full.x, full.y)));
    let level = clamp(log2(max(2.0 * pixels, 1.0)), 0.0, last);
    let light = textureSampleLevel(transmission_map, environment_sampler, uv, 0, level).rgb;
    return vec4f(light, share);
}
