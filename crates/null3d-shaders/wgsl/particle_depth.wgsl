// The copy of the camera's opaque depth that soft particles read: one texel per pixel, into a
// target of 32-bit floats, after the opaque pass and before the transparent pass. A multisampled
// depth copies its first sample (the MULTISAMPLED build, on WebGPU); WebGL2's backend hands the copy
// a one-sample copy of a multisampled depth. Both passes number pixels the same way, so the copy
// keeps the depth's rows in their order.

#import null3d::fullscreen::{triangle}

#ifdef MULTISAMPLED
@group(0) @binding(0) var depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(0) var depth: texture_2d<f32>;
#endif

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return vec4f(textureLoad(depth, vec2u(at.xy), 0).x, 0.0, 0.0, 1.0);
}
