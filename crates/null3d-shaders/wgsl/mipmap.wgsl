// Makes one mip level of one layer of a texture array from the level before it. Each texel is the
// average of the 2 x 2 texels that it covers, which a linear sampler reads between them. Sampling
// an sRGB texture decodes it and drawing into one encodes, so the average is in linear color. One
// triangle covers the level, and the layer comes as the draw's first instance. The source's first
// level is the level before: on WebGPU a view holds only that level, and on WebGL2 the texture's
// base and highest levels are set to it. The copy pipeline reads the texel under each fragment
// from the source's first level instead, for the WebGL2 backend's copies out of a layer. The scale
// pipeline draws one texture into the corner of another at a size of its own: the backends use it
// to fill a light's image with a texture that a sketch set as a spot light's map.

#import null3d::fullscreen::{triangle}

@group(0) @binding(0) var source: texture_2d_array<f32>;
@group(0) @binding(1) var source_sampler: sampler;

struct VertexOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) layer: u32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertex: u32, @builtin(instance_index) layer: u32) -> VertexOut {
    var out: VertexOut;
    out.clip = triangle(vertex);
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

/// The texel under the fragment, from the layer of the source's first level.
@fragment
fn fs_copy(in: VertexOut) -> @location(0) vec4f {
    return textureLoad(source, vec2u(in.clip.xy), in.layer, 0);
}

struct ScaleOut {
    @builtin(position) clip: vec4f,
    @location(0) @interpolate(flat, either) size: u32,
    @location(1) @interpolate(flat, either) layer: u32,
}

/// Bits of the scale draw's instance that hold the texels across the destination: an image takes at
/// most 512, so they fit in ten. The source's layer sits above them.
const SCALE_SIZE_BITS: u32 = 10u;

/// The scale pipeline's vertex shader: the full-screen triangle, with the destination's size and
/// the source's layer from the draw's first instance.
@vertex
fn vs_scale(@builtin(vertex_index) vertex: u32, @builtin(instance_index) packed: u32) -> ScaleOut {
    var out: ScaleOut;
    out.clip = triangle(vertex);
    out.size = packed & ((1u << SCALE_SIZE_BITS) - 1u);
    out.layer = packed >> SCALE_SIZE_BITS;
    return out;
}

/// The source's texel at the fragment's place in the destination's corner of `size` texels a side,
/// so the whole source fills that corner. The scissor holds the corner: on WebGPU it starts at the
/// target's first texel, and on WebGL2 the backend draws into a spare of the corner's size.
@fragment
fn fs_scale(in: ScaleOut) -> @location(0) vec4f {
    return textureSampleLevel(source, source_sampler, in.clip.xy / f32(in.size), in.layer, 0.0);
}
