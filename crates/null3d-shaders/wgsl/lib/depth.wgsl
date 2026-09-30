#define_import_path null3d::depth

// Depth values and distances. The engine draws with reversed depth on both GPU paths. Depth is 1
// at the near plane and 0 at the far plane, which spreads a float's precision evenly over
// distance. Both paths store the same depth values, so these helpers work on each. View-space z is
// negative in front of the camera, as in three.js.

/// The view-space z of a perspective camera's depth value.
fn perspective_depth_to_view_z(depth: f32, near: f32, far: f32) -> f32 {
    return -near * far / (near + depth * (far - near));
}

/// The depth value that a perspective camera stores at view-space z `view_z`.
fn view_z_to_perspective_depth(view_z: f32, near: f32, far: f32) -> f32 {
    return near * (view_z + far) / (-view_z * (far - near));
}

/// The view-space z of an orthographic camera's depth value.
fn orthographic_depth_to_view_z(depth: f32, near: f32, far: f32) -> f32 {
    return depth * (far - near) - far;
}

/// The depth value that an orthographic camera stores at view-space z `view_z`.
fn view_z_to_orthographic_depth(view_z: f32, near: f32, far: f32) -> f32 {
    return (view_z + far) / (far - near);
}

/// The distance in front of a perspective camera of its depth value, from `near` to `far`.
fn linear_depth(depth: f32, near: f32, far: f32) -> f32 {
    return -perspective_depth_to_view_z(depth, near, far);
}

/// The view-space position under a point of the screen, from its texture coordinates, its depth
/// value and the inverse of the camera's projection matrix. Texture coordinates run from 0 at the
/// top left to 1 at the bottom right.
fn view_position(uv: vec2f, depth: f32, inverse_projection: mat4x4f) -> vec3f {
    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    let p = inverse_projection * clip;
    return p.xyz / p.w;
}
