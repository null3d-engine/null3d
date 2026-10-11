#define_import_path null3d::reflection

// Planar reflections. A reflection pass draws the camera's view mirrored across a plane, into a
// texture that a custom material reads where the surface shows on the screen. The texture holds
// the mirrored image turned around across x and upright, with v = 0 at its bottom row, as every
// pass texture stands. A surface function finds its place with `reflection_uv`, then puts the color
// into the surface's `reflection`, which the engine's lighting reflects in place of the
// environment.

/// The texture coordinates in a reflection pass's texture of a surface point at clip position
/// `clip`, moved by `offset` in texture coordinates. Give it the point's clip position from the
/// camera's matrix: `camera.viewProjection * vec4f(input.relativePosition, 1.0)`. A rippled surface
/// moves the place by its normal's tilt, such as `s.normal.xz * 0.05` on water that faces up.
fn reflection_uv(clip: vec4f, offset: vec2f) -> vec2f {
    let ndc = clip.xy / clip.w;
    return vec2f(0.5 - 0.5 * ndc.x, 0.5 + 0.5 * ndc.y) + offset;
}
