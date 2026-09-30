#define_import_path null3d::sdf

// Signed distance functions, after Inigo Quilez's formulas. Each shape gives the distance from a
// point to its surface: negative inside, 0 on the surface and positive outside. Shapes sit at the
// origin, so move the point, not the shape. The operations combine the distances of two shapes.

/// A sphere of `radius`.
fn sphere(p: vec3f, radius: f32) -> f32 {
    return length(p) - radius;
}

/// A box that reaches `half_size` from its center along each axis.
fn box(p: vec3f, half_size: vec3f) -> f32 {
    let q = abs(p) - half_size;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

/// A box with edges rounded to `radius`. It stays within `half_size`.
fn round_box(p: vec3f, half_size: vec3f, radius: f32) -> f32 {
    return box(p, half_size - radius) - radius;
}

/// A torus that lies in the xz plane: a ring of `major` radius around the y axis, with a tube of
/// `minor` radius.
fn torus(p: vec3f, major: f32, minor: f32) -> f32 {
    let q = vec2f(length(p.xz) - major, p.y);
    return length(q) - minor;
}

/// A capsule: the points within `radius` of the segment from `a` to `b`.
fn capsule(p: vec3f, a: vec3f, b: vec3f, radius: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = saturate(dot(pa, ba) / dot(ba, ba));
    return length(pa - ba * h) - radius;
}

/// A cylinder along the y axis, `half_height` above and below the origin, with flat ends.
fn cylinder(p: vec3f, half_height: f32, radius: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(radius, half_height);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

/// A plane with the unit `normal`, at `offset` from the origin along it, negative on the side the
/// normal points away from.
fn plane(p: vec3f, normal: vec3f, offset: f32) -> f32 {
    return dot(p, normal) - offset;
}

/// A circle of `radius`, in 2D.
fn circle(p: vec2f, radius: f32) -> f32 {
    return length(p) - radius;
}

/// A rectangle that reaches `half_size` from its center along each axis, in 2D.
fn rect(p: vec2f, half_size: vec2f) -> f32 {
    let d = abs(p) - half_size;
    return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
}

/// The distance from `p` to the segment from `a` to `b`, in 2D. It is never negative.
fn segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = saturate(dot(pa, ba) / dot(ba, ba));
    return length(pa - ba * h);
}

/// Both shapes together.
fn merge(a: f32, b: f32) -> f32 {
    return min(a, b);
}

/// Shape `a` with shape `b` cut out of it.
fn subtract(a: f32, b: f32) -> f32 {
    return max(a, -b);
}

/// Only the space that both shapes fill.
fn intersect(a: f32, b: f32) -> f32 {
    return max(a, b);
}

/// Both shapes together, blended where they are closer than `k`.
fn smooth_merge(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate(0.5 + 0.5 * (b - a) / k);
    return mix(b, a, h) - k * h * (1.0 - h);
}

/// Shape `a` with shape `b` cut out of it, with the cut's edges rounded over `k`.
fn smooth_subtract(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate(0.5 - 0.5 * (a + b) / k);
    return mix(a, -b, h) + k * h * (1.0 - h);
}

/// Only the space that both shapes fill, with the edges rounded over `k`.
fn smooth_intersect(a: f32, b: f32, k: f32) -> f32 {
    let h = saturate(0.5 - 0.5 * (b - a) / k);
    return mix(b, a, h) + k * h * (1.0 - h);
}

/// A shape grown by `radius` in every direction, which rounds its edges.
fn rounded(d: f32, radius: f32) -> f32 {
    return d - radius;
}

/// A shell of `thickness` on each side of a shape's surface.
fn onion(d: f32, thickness: f32) -> f32 {
    return abs(d) - thickness;
}
