#define_import_path null3d::shadows

// The shadows of the main directional light, which lit templates read where a surface receives
// shadows. Each frame the core fits up to four cascades to the camera's view, near ones small and
// far ones large, and draws the depth of the light's shadow casters into one layer of a depth
// texture array per cascade. Far cascades draw only every few frames, and keep the box they drew
// with in between. A receiver picks the cascade that holds its distance along the camera's view,
// or the next one whose box holds it, and compares its depth from the light with the depth that
// the cascade stored.
//
// Depth is reversed, as everywhere in the engine: 1 on the light's side of a cascade and 0 on the
// far side. A point is lit where its depth is at least the stored depth. The comparison sampler
// tests the four nearest texels and blends them, and the filter blends several such samples, so
// a shadow's edge fades over a square of 3 or 5 texels.

/// The cascades of the main directional light's shadows, as the core writes them each frame.
struct ShadowCascades {
    /// Each cascade's matrix from positions relative to the camera into its clip space.
    view_proj: array<mat4x4f, 4>,
    /// Where each cascade ends along the camera's view. Past the last, nothing is shadowed.
    ends: vec4f,
    /// The vector whose dot product with a position relative to the camera gives its distance
    /// along the camera's view, then the cascade count.
    forward: vec4f,
    /// How far each cascade's receivers move along their normals, in meters.
    normal_offsets: vec4f,
    /// How far each cascade's receivers move their depth toward the light.
    depth_biases: vec4f,
    /// The texels on each side of each layer, the size of one texel in texture coordinates, and
    /// the texels on each side of the filter's square: 3 or 5, or less for the comparison
    /// sampler's own blend of four texels.
    kernel: vec4f,
}

@group(0) @binding(4) var shadow_map: texture_depth_2d_array;
@group(0) @binding(5) var shadow_sampler: sampler_comparison;
@group(0) @binding(6) var<uniform> cascades: ShadowCascades;

/// The share of the shadow distance over which shadows fade out.
const FADE_SHARE: f32 = 0.1;

/// How much of the main directional light reaches a point: 1 in full light, 0 in full shadow.
/// `relative` is the point's position relative to the camera, and `normal` its unit normal, which
/// moves the point off its own surface before the lookup.
fn sun_shadow(relative: vec3f, normal: vec3f) -> f32 {
    let along = dot(relative, cascades.forward.xyz);
    let count = u32(cascades.forward.w);
    var cascade = 0u;
    while cascade < count && along >= cascades.ends[cascade] {
        cascade += 1u;
    }
    // The filter reads up to three texels beyond the point, which must stay inside the layer.
    let inside = 0.5 - 3.0 * cascades.kernel.y;
    for (; cascade < count; cascade += 1u) {
        let moved = relative + normal * cascades.normal_offsets[cascade];
        let clip = cascades.view_proj[cascade] * vec4f(moved, 1.0);
        if any(abs(clip.xy) > vec2f(2.0 * inside)) {
            // A box that kept its place while the camera turned can miss the point; the next
            // cascade's box is larger.
            continue;
        }
        var uv = clip.xy * vec2f(0.5, -0.5) + 0.5;
#ifdef WEBGL2
        // WebGL2 keeps the rows of a drawn texture bottom first.
        uv.y = 1.0 - uv.y;
#endif
        let lit = filtered(uv, cascade, clip.z + cascades.depth_biases[cascade]);
        let end = cascades.ends[count - 1u];
        return mix(lit, 1.0, smoothstep(end * (1.0 - FADE_SHARE), end, along));
    }
    return 1.0;
}

/// The comparison of `depth` with layer `layer` of the shadow map around `uv`, blended over the
/// filter's square of texels with even weights. Each sample of the comparison sampler blends four
/// texels, so a square of 3 texels takes 4 samples and a square of 5 takes 9. The samples sit
/// between texels where their bilinear weights give each texel of the square its share (Ignacio
/// Castaño's filter for The Witness).
fn filtered(uv: vec2f, layer: u32, depth: f32) -> f32 {
    let size = cascades.kernel.x;
    let texel = cascades.kernel.y;
    let taps = cascades.kernel.z;
    if taps < 3.0 {
        return textureSampleCompareLevel(shadow_map, shadow_sampler, uv, layer, depth);
    }
    // The texel corner nearest to the point, and the point's place from the texel center before
    // that corner, from 0 to 1 on each axis.
    let corner = floor(uv * size + 0.5);
    let s = uv * size + 0.5 - corner;
    let origin = (corner - 0.5) * texel;
    var weights: array<vec2f, 3>;
    var offsets: array<vec2f, 3>;
    var samples = 2u;
    var total = 16.0;
    if taps < 5.0 {
        weights[0] = 3.0 - 2.0 * s;
        weights[1] = 1.0 + 2.0 * s;
        offsets[0] = (2.0 - s) / weights[0] - 1.0;
        offsets[1] = s / weights[1] + 1.0;
    } else {
        samples = 3u;
        total = 144.0;
        weights[0] = 4.0 - 3.0 * s;
        weights[1] = vec2f(7.0);
        weights[2] = 1.0 + 3.0 * s;
        offsets[0] = (3.0 - 2.0 * s) / weights[0] - 2.0;
        offsets[1] = (3.0 + s) / 7.0;
        offsets[2] = s / weights[2] + 2.0;
    }
    var sum = 0.0;
    for (var row = 0u; row < samples; row += 1u) {
        for (var column = 0u; column < samples; column += 1u) {
            let at = origin + vec2f(offsets[column].x, offsets[row].y) * texel;
            let lit = textureSampleCompareLevel(shadow_map, shadow_sampler, at, layer, depth);
            sum += weights[column].x * weights[row].y * lit;
        }
    }
    return sum / total;
}
