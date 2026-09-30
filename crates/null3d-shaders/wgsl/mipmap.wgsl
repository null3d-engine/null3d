// Makes one mip level of one layer of a texture array from the level before it. Each texel is the
// average of the 2 x 2 texels that it covers, which a linear sampler reads between them. Sampling
// an sRGB texture decodes it and drawing into one encodes, so the average is in linear color. One
// triangle covers the level, and the layer comes as the draw's first instance. The source's first
// level is the level before: on WebGPU a view holds only that level, and on WebGL2 the texture's
// base and highest levels are set to it.

@group(0) @binding(0) var source: texture_2d_array<f32>;
@group(0) @binding(1) var source_sampler: sampler;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) layer: u32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) layer: u32) -> VertexOut {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space, at a depth that every WebGL2 depth
    // mapping keeps inside the clip volume.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    var out: VertexOut;
    out.clip = vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
    out.layer = layer;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
    // A texel of the new level covers the source texels around the same place, counted in texels
    // from the first row, as the fragment's own place is.
    let size = vec2f(textureDimensions(source));
    let level = max(floor(size * 0.5), vec2f(1.0));
    return textureSampleLevel(source, source_sampler, in.clip.xy / level, in.layer, 0.0);
}
