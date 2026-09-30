// A shader file that a test sketch imports: a triangle that covers the view, colored by a texture
// and a uniform. It imports a library module, and it binds a uniform buffer, a texture and a
// sampler, so its WebGL2 build has a uniform block and a texture for the test page to find.
#import null3d::math

struct Tint {
    color: vec4f,
}

@group(0) @binding(0) var<uniform> tint: Tint;
@group(0) @binding(1) var pattern: texture_2d<f32>;
@group(0) @binding(2) var pattern_sampler: sampler;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
    let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: VertexOut;
    out.clip = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    let texel = textureSample(pattern, pattern_sampler, in.uv);
    return vec4f(texel.rgb * tint.color.rgb * null3d::math::square(tint.color.a), 1.0);
}
