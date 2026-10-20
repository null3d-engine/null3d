// The copy of the camera's opaque color into the first level of the target that surfaces which
// let light through sample (null3d::refraction). The scene color and the target have the same
// size, and both GPU paths keep their rows in the same order, so one triangle over the target
// reads one texel per pixel. On the 8-bit path (the TONE_MAP builds) the scene color holds display
// color, which the scene shaders encoded as sRGB. The target there is an sRGB texture, which
// encodes what the copy writes, so the copy writes the decoded color: the target's levels then
// average linear color, and a surface that samples it reads linear color.
//
// The alpha keeps the opaque depth's distance code (null3d::depth), which tells a surface whether
// the opaque surface where its bent ray lands lies in front of it. The depth is the scene depth as
// the opaque pass leaves it, with the masked surfaces that the depth prepass leaves out. The
// DEPTH_MULTISAMPLED builds read sample 0 of a multisampled depth, on WebGPU; WebGL2's backend
// binds a copy of one sample in its place.

#import null3d::fullscreen::{triangle}
#import null3d::color::{srgb_to_linear}
#import null3d::depth::{distance_code}

@group(0) @binding(0) var image: texture_2d<f32>;
#ifdef DEPTH_MULTISAMPLED
@group(0) @binding(1) var depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(1) var depth: texture_2d<f32>;
#endif

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let texel = vec2u(at.xy);
    let color = textureLoad(image, texel, 0);
    let code = distance_code(textureLoad(depth, texel, 0).x);
#ifdef TONE_MAP
    return vec4f(srgb_to_linear(color.rgb), code);
#else
    return vec4f(color.rgb, code);
#endif
}
