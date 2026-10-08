// The copy of a view's image into the target that materials sample, on WebGPU. Materials sample a
// texture with v = 0 at its first row, the bottom of an image, as three.js's render targets hold
// it on WebGL. WebGPU draws the top row of an image first, so the copy reads each texel from the
// same column of the mirrored row. The image and the target have the same size, so one triangle
// over the target reads one texel per pixel.
// On the 8-bit path (the TONE_MAP builds) the image holds display color, which the scene shaders
// encoded as sRGB. The target there is an sRGB texture, which encodes what the copy writes, so the
// copy writes the decoded color: the target keeps the image's bytes, and a material that samples
// it reads linear color, as on the HDR path.

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
    let size = textureDimensions(image);
    let texel = vec2u(at.xy);
    let color = textureLoad(image, vec2u(texel.x, size.y - 1u - texel.y), 0);
#ifdef TONE_MAP
    return vec4f(srgb_to_linear(color.rgb), color.a);
#else
    return color;
#endif
}
