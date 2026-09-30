// Debug lines: each pair of vertices is a line one pixel wide, in the color of its vertices.
//
// A vertex brings its position relative to the camera, which the core computes from the sketch's
// 64-bit position, so lines far from the origin draw as precisely as near it. Its color is sRGB,
// four bytes that the vertex fetch reads as values from 0 to 1. The vertex shader turns it linear,
// and the fragment shader writes it as the mesh shaders write their colors: linear into the HDR
// scene color, or tone mapped and encoded on the 8-bit path (the TONE_MAP builds).
#import null3d::color
#import null3d::globals::Frame
#import null3d::tonemap

@group(0) @binding(0) var<uniform> frame: Frame;

struct VertexIn {
    @location(0) position: vec3f,
    @location(1) srgb: vec4f,
}

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) linear: vec3f,
}

@vertex
fn vs(v: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip = frame.view_proj * vec4f(v.position, 1.0);
    out.linear = null3d::color::srgb_to_linear(v.srgb.rgb);
    return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    return null3d::tonemap::finish(in.linear, in.clip.xy, frame.output);
}
