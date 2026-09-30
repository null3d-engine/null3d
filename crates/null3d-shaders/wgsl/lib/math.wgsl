#define_import_path null3d::math

// Constants and small helpers that the other modules share: squares, ranges, a modulo that
// matches GLSL's `mod`, and rotations.

/// Pi, the ratio of a circle's circumference to its diameter.
const PI: f32 = 3.141592653589793;
/// Two times pi: one full turn in radians.
const TAU: f32 = 6.283185307179586;
/// Pi over two: a quarter turn in radians.
const HALF_PI: f32 = 1.5707963267948966;
/// One over pi.
const INV_PI: f32 = 0.3183098861837907;
/// A small positive number that keeps a divisor away from zero, the same as three.js's `EPSILON`.
const EPSILON: f32 = 1e-6;

/// Returns x times x.
fn square(x: f32) -> f32 {
    return x * x;
}

/// The largest of the three components of `v`.
fn max_component(v: vec3f) -> f32 {
    return max(max(v.x, v.y), v.z);
}

/// The smallest of the three components of `v`.
fn min_component(v: vec3f) -> f32 {
    return min(min(v.x, v.y), v.z);
}

/// Where `x` lies from `a` to `b`: 0 at `a`, 1 at `b`, and outside that range beyond them. It
/// undoes `mix(a, b, t)`.
fn inverse_lerp(a: f32, b: f32, x: f32) -> f32 {
    return (x - a) / (b - a);
}

/// Maps `x` from the range `in_min` to `in_max` onto the range `out_min` to `out_max`. It does not
/// clamp.
fn remap(x: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) -> f32 {
    return mix(out_min, out_max, inverse_lerp(in_min, in_max, x));
}

/// The remainder of `x` over `y` with the sign of `y`, as GLSL's `mod` gives it. For example,
/// `modulo(-0.25, 1.0)` is 0.75. WGSL's `%` keeps the sign of `x` instead.
fn modulo(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

/// Turns a 2D point counterclockwise about the origin by `angle` radians.
fn rotate_2d(p: vec2f, angle: f32) -> vec2f {
    let c = cos(angle);
    let s = sin(angle);
    return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

/// Turns `v` about a unit `axis` by `angle` radians, with Rodrigues' formula. The turn is
/// counterclockwise when the axis points toward the viewer.
fn rotate_axis(v: vec3f, axis: vec3f, angle: f32) -> vec3f {
    let c = cos(angle);
    let s = sin(angle);
    return v * c + cross(axis, v) * s + axis * (dot(axis, v) * (1.0 - c));
}

/// Turns `v` by the unit quaternion `q`, stored as x, y, z and w like the engine's `quat` helpers.
fn quat_rotate(q: vec4f, v: vec3f) -> vec3f {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

/// A rotation whose third column is the unit vector `n`. Its first two columns are unit vectors at
/// right angles to `n` and to each other. Use it as a tangent frame around a normal. It follows
/// Duff and others (2017), which has no singular direction.
fn basis_from_normal(n: vec3f) -> mat3x3f {
    let s = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (s + n.z);
    let b = n.x * n.y * a;
    let tangent = vec3f(1.0 + s * n.x * n.x * a, s * b, -s * n.x);
    let bitangent = vec3f(b, s + n.y * n.y * a, -n.y);
    return mat3x3f(tangent, bitangent, n);
}
