// A texture behind every object: one triangle over the whole view, drawn first in the camera's
// opaque pass, as three.js draws a texture in `scene.background`. The texture stretches to the
// view, with its first row at the bottom, as it sits on a plane. The texture is a layer of a
// texture array, and the draw's first vertex names it: each vertex's index is the layer times
// three, plus its corner.
#import null3d::color

@group(1) @binding(0) var layers: texture_2d_array<f32>;
@group(1) @binding(1) var layer_sampler: sampler;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat, either) layer: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> VertexOut {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at a depth that every WebGL2 depth
    // mapping keeps inside the clip volume. The view's corners get texture coordinates from 0 to
    // 1, with v = 0 at the bottom.
    let index = vertex % 3u;
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: VertexOut;
    out.clip = vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
    out.uv = corner;
    out.layer = vertex / 3u;
    return out;
}

/// The texture's color, opaque. Sampling decodes an sRGB texture to linear values, and the output
/// encodes them as the mesh shaders encode theirs.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let texel = textureSample(layers, layer_sampler, in.uv, in.layer);
    return vec4f(null3d::color::linear_to_srgb(texel.rgb), 1.0);
}
