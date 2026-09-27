#define_import_path sokko3d::math

// Math helpers for the engine's shaders. Shaders import them with `#import sokko3d::math` and
// call them as `sokko3d::math::square(x)`.

/// Returns x times x.
fn square(x: f32) -> f32 {
    return x * x;
}
