// A texture behind every object: one triangle over the whole view at the far plane, drawn in the
// camera's opaque pass behind the objects (see the renderer's `background` module), as three.js
// draws a texture in `scene.background`. The texture stretches to the view, with its first row at
// the bottom, as it sits on a plane. The texture is a layer of a texture array, and the draw's
// first vertex names it: each vertex's index is the layer times three, plus its corner. The
// fragment shader writes the texture's linear color as the mesh shaders write theirs: into the HDR
// scene color, or tone mapped and encoded on the 8-bit path (the TONE_MAP builds), times the
// background's intensity. Cube map and sky backgrounds draw with background_cube.wgsl and sky.wgsl.
#import null3d::globals::Frame
#import null3d::tonemap
#import null3d::backdrop::{Backdrop}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var layers: texture_2d_array<f32>;
@group(1) @binding(1) var layer_sampler: sampler;
@group(2) @binding(0) var<uniform> backdrop: Backdrop;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
    @location(1) @interpolate(flat, either) layer: u32,
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> VertexOut {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at the far plane: depth 0 in
    // reversed depth, which every WebGL2 depth mapping keeps at the edge of the clip volume. The
    // view's corners get texture coordinates from 0 to 1, with v = 0 at the bottom.
    let index = vertex % 3u;
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: VertexOut;
    out.clip = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = corner;
    out.layer = vertex / 3u;
    return out;
}

/// The texture's color, opaque, times the background's intensity and the exposure. Sampling
/// decodes an sRGB texture to linear values.
@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let texel = textureSample(layers, layer_sampler, in.uv, in.layer);
    let light = backdrop.params.x * frame.output.exposure;
    return null3d::tonemap::finish(texel.rgb * light, in.clip.xy, frame.output);
}
