// The camera's weighted layer, weighted blended transparency (null3d::weighted): two full-screen
// steps, each one triangle over its target.
//
// `composite` blends the layer over the scene color. It reads the weighted color sum and the
// coverage sum one texel per pixel, divides the color by its weights, and writes it premultiplied
// by the share that the layer covers, one minus two to the power of minus the coverage sum, for
// the normal blending to put over the scene. Pixels that no weighted surface reached keep the
// scene's color.
//
// `depth` copies the scene depth, one texel per pixel, into the depth target of one sample that the
// weighted pass tests against. The MULTISAMPLED build reads the first sample of a multisampled
// depth, on WebGPU; WebGL2's backend hands it a copy of one sample instead. Every target here
// counts its pixels as the scene's do, so each step reads the pixel it draws.

#import null3d::fullscreen::{triangle}

#ifdef MULTISAMPLED
@group(0) @binding(0) var scene_depth: texture_multisampled_2d<f32>;
#else ifdef DEPTH
@group(0) @binding(0) var scene_depth: texture_2d<f32>;
#else
@group(0) @binding(0) var color_sum: texture_2d<f32>;
@group(0) @binding(1) var cover_sum: texture_2d<f32>;
#endif

/// The least weighted alpha that the average divides by: three.js's floor, times the scale of
/// null3d::weighted's weights.
const LEAST_WEIGHT: f32 = 1e-5 / 32.0;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

#ifdef DEPTH
@fragment
fn depth(@builtin(position) at: vec4f) -> @builtin(frag_depth) f32 {
    return textureLoad(scene_depth, vec2u(at.xy), 0).x;
}
#else
@fragment
fn composite(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let texel = vec2u(at.xy);
    let covered = textureLoad(cover_sum, texel, 0).x;
    if covered <= 0.0 {
        discard;
    }
    let total = textureLoad(color_sum, texel, 0);
    let shown = exp2(-covered);
    let average = total.rgb / max(total.a, LEAST_WEIGHT);
    return vec4f(average * (1.0 - shown), 1.0 - shown);
}
#endif
