#define_import_path null3d::motion_math

// The motion pass's math that reads no binding (decision record D-140): where a clip-space point
// shows on the image, and the motion that a surface's two places leave. The shaders that draw the
// motion target import it, and the shader library's check page compares it with its own reference.

/// The place on the image of a clip-space position, in texture coordinates from the top left. The
/// position must lie in front of the camera's plane.
fn image_place(clip: vec4f) -> vec2f {
    let ndc = clip.xy / clip.w;
    return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

/// What a fragment writes: the motion from `last`, where the surface's point showed in the last
/// frame, to `still`, where this frame's point would have shown in it, both as the last frame's
/// clip-space positions. A point at or behind the last camera's plane gives no motion. A still
/// surface gives exactly zero, which the target clears to, so only moving objects draw.
fn surface_motion(still: vec4f, last: vec4f) -> vec4f {
    if still.w <= 1e-6 || last.w <= 1e-6 {
        return vec4f(0.0);
    }
    return vec4f(image_place(still) - image_place(last), 0.0, 0.0);
}
