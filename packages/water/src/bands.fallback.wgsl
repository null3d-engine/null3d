// The ocean's bands in meters, as the fragment form that WebGL2 draws in place of the compute pass.
// Each pixel writes the same texel that the compute shader writes: the band's height, and the slopes
// that the heights beside it give. The block between the markers is byte for byte the same as the one
// in `bands.wgsl`, which a test compares.
struct Uniforms {
    u0: vec4f,
    u1: vec4f,
}

var source: texture_2d_array<f32>;

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

fn effect(input: EffectInput) -> vec4f {
    let size = i32(round(input.size.x));
    // The pass texture keeps the image's bottom row first, and `input.uv` counts down from the image's
    // top row, so the texel's row turns around.
    let cell = vec2i(floor(vec2f(input.uv.x, 1.0 - input.uv.y) * input.size));
    let value = band_value(
        cell.x,
        cell.y,
        size,
        i32(input.layer),
        band_pick(uniforms.u1, input.layer),
        band_pick(uniforms.u0, input.layer),
    );
    // The alpha holds the sketch time that the heights belong to, which the transform wrote.
    let stamp = textureLoad(source, cell, i32(input.layer), 0).a;
    return vec4f(value.x, value.y, value.z, stamp);
}
