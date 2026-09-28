#define_import_path null3d::color

// Color conversions. Shaders light in linear space and encode sRGB only at the output.

/// Encodes a linear color as sRGB, the way the canvas shows it.
fn linear_to_srgb(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}
