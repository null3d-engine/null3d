#define_import_path null3d::wrap

// Wrapping positions into a box that moves with the camera, for rain, snow, streaks, dust and any
// other draw that follows the camera without a buffer update. The engine's shaders hold positions
// relative to the camera, so a wrapped position stays inside a box around the camera as it moves,
// and the draw's shapes never run out.

/// Wraps `p`, a position relative to the camera, into the box that `half` gives around the camera.
/// The result lies within `half` of the camera on each axis, so the box is `2 * half` long there.
/// A copy whose position leaves one side comes back on the other, which keeps a field of shapes
/// around the camera with no upload.
fn wrap_relative(p: vec3f, half: vec3f) -> vec3f {
    let box_size = max(2.0 * half, vec3f(1e-6));
    return p - box_size * round(p / box_size);
}

/// Wraps `p`, a position relative to the camera, into the box that `half` gives around `center`,
/// another position relative to the camera.
fn wrap_around(p: vec3f, center: vec3f, half: vec3f) -> vec3f {
    return center + wrap_relative(p - center, half);
}
