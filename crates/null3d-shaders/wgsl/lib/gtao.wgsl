#define_import_path null3d::gtao
#import null3d::mesh::{frame}

// Ambient occlusion in the camera's opaque pass. Its steps (ao.wgsl) leave a texture at a fraction
// of the render size: each texel holds how much ambient light reaches the surface it shows, and the
// depth of that surface. Each pixel of the opaque pass reads the four texels around its place and
// weights them by how close their depths lie to its own, so the occlusion of a wall does not bleed
// onto an object in front of it, and the reverse.
//
// The frame's `occlusion` values: x is the strength, 0 when the view draws no ambient occlusion,
// y the scene target's height in pixels, which WebGL2 needs as it counts rows from the bottom, and
// zw the texels of the texture per pixel of the scene, across and down.

/// The texture of ambient occlusion: the occlusion in red, and the depth it was found at in green.
/// A blank texel of 1 and 0 when the frame draws none.
@group(0) @binding(11) var gtao_map: texture_2d<f32>;

/// The share of a texel's weight that its depth keeps, from 1 for the pixel's own depth down to 0
/// at this far, as a fraction of the pixel's depth.
const DEPTH_TOLERANCE: f32 = 0.03;

/// How much ambient light reaches the pixel at `pixel`, a fragment position, whose depth value is
/// `depth`: 1 for all of it, the occlusion's strength blending toward the occlusion that the
/// texture holds. Blended materials draw over the surfaces that the occlusion saw, so they take
/// none.
fn screen_occlusion(pixel: vec3f, blended: bool) -> f32 {
    let values = frame.occlusion;
    if values.x <= 0.0 || blended {
        return 1.0;
    }
    let size = vec2i(textureDimensions(gtao_map));
    var from_top = pixel.xy;
#ifdef WEBGL2
    from_top.y = values.y - pixel.y;
#endif
    let corner = max(vec2i(round(frame.target_size.xy * values.zw)), vec2i(1));
    let at = from_top * values.zw - 0.5;
    let base = vec2i(floor(at));
    let blend = at - floor(at);
    var sum = 0.0;
    var total = 0.0;
    var nearest = 1.0;
    var nearest_gap = 1e30;
    for (var k = 0; k < 4; k++) {
        let offset = vec2i(k & 1, k >> 1u);
        var texel = clamp(base + offset, vec2i(0), corner - 1);
#ifdef WEBGL2
        texel.y = size.y - 1 - texel.y;
#endif
        let held = textureLoad(gtao_map, texel, 0).xy;
        let along = mix(1.0 - blend, blend, vec2f(offset));
        let gap = abs(held.y - pixel.z);
        let weight = along.x * along.y * max(0.0, 1.0 - gap / (DEPTH_TOLERANCE * pixel.z));
        sum += held.x * weight;
        total += weight;
        if gap < nearest_gap {
            nearest_gap = gap;
            nearest = held.x;
        }
    }
    // Where no texel lies at the pixel's depth, as on a thin edge, the nearest one in depth speaks
    // for it.
    let occlusion = select(nearest, sum / total, total > 1e-4);
    return mix(1.0, occlusion, values.x);
}
