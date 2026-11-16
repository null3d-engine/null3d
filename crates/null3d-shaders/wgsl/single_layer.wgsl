// The camera's one-sample layer, where blended surfaces that ask for it draw back to front with one
// sample per pixel instead of into the multisampled scene color: two full-screen steps, each one
// triangle over its target.
//
// `composite` blends the layer over the scene color. The layer starts as transparent black, and
// the normal blending of its surfaces leaves premultiplied color with the share that they cover in
// its alpha. The step returns that texel as it is, one texel per pixel, for the same normal
// blending to put over the scene. Pixels that no surface reached hold zero, and keep the scene's
// color.
//
// `depth` copies the scene depth, one texel per pixel, into the depth target of one sample that the
// layer's pass tests against. The MULTISAMPLED build reads the first sample of a multisampled
// depth, on WebGPU; WebGL2's backend hands it a copy of one sample instead. Every target here
// counts its pixels as the scene's do, so each step reads the pixel it draws.

#import null3d::fullscreen::{triangle}

#ifdef MULTISAMPLED
@group(0) @binding(0) var scene_depth: texture_multisampled_2d<f32>;
#else ifdef DEPTH
@group(0) @binding(0) var scene_depth: texture_2d<f32>;
#else
@group(0) @binding(0) var layer: texture_2d<f32>;
#endif

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

#ifdef DEPTH
#ifdef MULTISAMPLED
/// What the depth copy returns where WebKit reads it. The pipeline declares the layer's color
/// target so that its draw joins the layer's pass, and writes none of it. WebKit takes a fragment
/// shader that returns its depth alone as a float at color location 0, and then rejects that
/// against a target that needs four floats. A color output that the target's write mask never
/// writes gives the format the target declares.
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
    return textureLoad(layer, vec2u(at.xy), 0);
}
#endif
