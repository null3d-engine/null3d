// The ocean's bands in meters, as a compute pass. The transform's last pass holds each band's
// heights in its own layer, in the transform's own units. This pass scales each layer to the band's
// significant height and adds the slope along each axis, from the heights of the texels beside it,
// with the tile's other edge standing in for the one past it. A material then samples one texture
// for every band: each layer's red holds the height, and its green and blue the slopes along x and z.
//
// The block between the markers is byte for byte the same as the one in `bands.fallback.wgsl`, which
// draws the WebGL2 fragment form. A test compares them.
struct ComputeBlock {
    size: vec4f,
    clock: vec4f,
    inverseProjection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    drawn: vec4f,
    bloom: vec4f,
}

@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(0) var source: texture_2d_array<f32>;

// <band-field>
/// The texel that a place stands at, with the tile's other edge standing in for the one past it.
fn band_wrap(value: i32, n: i32) -> i32 {
    return ((value % n) + n) % n;
}

/// One band's height at a texel of its tile, in the transform's own units.
fn band_height(i: i32, j: i32, n: i32, layer: i32) -> f32 {
    return textureLoad(source, vec2i(band_wrap(i, n), band_wrap(j, n)), layer, 0).r;
}

/// One band's number from a vector of three, by the band's place.
fn band_pick(values: vec4f, band: u32) -> f32 {
    if (band == 0u) { return values.x; }
    if (band == 1u) { return values.y; }
    return values.z;
}

/// A band's texel in meters: its height, then the slopes along x and z, from the heights beside it.
fn band_value(x: i32, y: i32, n: i32, layer: i32, tile: f32, scale: f32) -> vec4f {
    let texel = tile / f32(n);
    let along = (band_height(x + 1, y, n, layer) - band_height(x - 1, y, n, layer))
        / (2.0 * texel);
    let across = (band_height(x, y + 1, n, layer) - band_height(x, y - 1, n, layer))
        / (2.0 * texel);
    return vec4f(
        band_height(x, y, n, layer) * scale,
        along * scale,
        across * scale,
        0.0,
    );
}
// </band-field>

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let size = u32(block.drawn.x);
    if (id.x >= size || id.y >= size) { return; }
    let layer = i32(id.z);
    let value = band_value(
        i32(id.x),
        i32(id.y),
        i32(size),
        layer,
        band_pick(block.u1, id.z),
        band_pick(block.u0, id.z),
    );
    // The alpha holds the sketch time that the heights belong to, which the transform wrote and a
    // read of the pass uses to match them to its own field. The surface samples the heights alone.
    let stamp = textureLoad(source, vec2i(id.xy), i32(id.z), 0).a;
    textureStore(output, vec2i(id.xy), id.z, vec4f(value.x, value.y, value.z, stamp));
}
