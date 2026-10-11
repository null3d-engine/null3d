// The copy of the camera's opaque color into the first level of the target that surfaces which
// let light through sample (null3d::refraction). The scene color and the target have the same
// size, and both GPU paths keep their rows in the same order, so one triangle over the target
// reads one texel per pixel. On the 8-bit path (the TONE_MAP builds) the scene color holds display
// color, which the scene shaders encoded as sRGB. The target there is an sRGB texture, which
// encodes what the copy writes, so the copy writes the decoded color: the target's levels then
// average linear color, and a surface that samples it reads linear color.

#import null3d::color::{srgb_to_linear}

@group(0) @binding(0) var image: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let color = textureLoad(image, vec2u(at.xy), 0);
#ifdef TONE_MAP
    return vec4f(srgb_to_linear(color.rgb), 1.0);
#else
    return vec4f(color.rgb, 1.0);
#endif
}
