#define_import_path null3d::math

// Math helpers for the engine's shaders. Shaders import them with `#import null3d::math` and
// call them as `null3d::math::square(x)`.

/// Returns x times x.
fn square(x: f32) -> f32 {
    return x * x;
}
