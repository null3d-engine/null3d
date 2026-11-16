// The camera's moment transparency layer (null3d::moment): the composite, which blends the layer
// over the scene color, and the copy of one sample of a multisampled scene depth, which the moment
// pass draws first and both of the layer's passes test against.
//
// `composite` reads the moment store and the colour sum, one texel per pixel. The store's total
// optical depth gives the share of the scene that the layer covers, one minus the transmittance
// through every surface it holds. The colour sum divides by its weights, and the composite writes
// the average colour premultiplied by that share, for normal blending to put over the scene. A
// pixel that no moment surface reached keeps the scene's colour.
//
// `depth` copies the scene depth into the target of one sample that the layer's passes test
// against. The MULTISAMPLED build reads the first sample of a multisampled depth, on WebGPU;
// WebGL2's backend hands it a copy of one sample instead. Every target here counts its pixels as
// the scene's do, so each step reads the pixel it draws.

#import null3d::fullscreen::{triangle}

#ifdef MULTISAMPLED
@group(0) @binding(0) var scene_depth: texture_multisampled_2d<f32>;
#else ifdef DEPTH
@group(0) @binding(0) var scene_depth: texture_2d<f32>;
#else
@group(0) @binding(0) var moment_store: texture_2d<f32>;
@group(0) @binding(1) var colour_sum: texture_2d<f32>;
#endif

/// The least weight that the colour sum's average divides by, so a pixel whose surfaces cover
/// almost nothing keeps a finite colour.
const LEAST_WEIGHT: f32 = 1e-5;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

#ifdef DEPTH
#ifdef MULTISAMPLED
/// What the depth copy returns where WebKit reads it. The pipeline declares the moment pass's
/// colour target so that its draws join that pass, and writes it not. WebKit takes a fragment
/// shader that returns its depth alone as a float at color location 0, and then rejects that
/// against the target's 16-bit float format, which needs four floats. A color output that the
/// target's write mask never writes gives the format the target declares.
struct DepthFragment {
    @builtin(frag_depth) depth: f32,
    @location(0) unwritten: vec4f,
}

@fragment
fn depth(@builtin(position) at: vec4f) -> DepthFragment {
    let copy = textureLoad(scene_depth, vec2u(at.xy), 0).x;
    return DepthFragment(copy, vec4f(0.0));
}
#else
@fragment
fn depth(@builtin(position) at: vec4f) -> @builtin(frag_depth) f32 {
    return textureLoad(scene_depth, vec2u(at.xy), 0).x;
}
#endif
#else
@fragment
fn composite(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let texel = vec2u(at.xy);
    let b = textureLoad(moment_store, texel, 0);
    let shown = exp(-max(b.x, 0.0));
    if shown >= 1.0 {
        discard;
    }
    let total = textureLoad(colour_sum, texel, 0);
    let average = total.rgb / max(total.a, LEAST_WEIGHT);
    return vec4f(average * (1.0 - shown), 1.0 - shown);
}
#endif
