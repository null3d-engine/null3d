#define_import_path null3d::reflection

// Planar reflections. A reflection pass draws the camera's view mirrored across a plane, into a
// texture that a custom material reads where the surface shows on the screen. The texture holds
// the mirrored image turned around across x. Its rows start at the top on the HDR WebGPU path,
// where the view draws into it directly; on the other paths a copy turns them, so they start at
// the bottom, as every pass texture stands. A surface function finds its place with
// `reflection_uv`, then puts the color into the surface's `reflection`, which the engine's lighting
// reflects in place of the environment.

/// The texture coordinates in a reflection pass's texture of a surface point at clip position
/// `clip`, moved by `offset` in texture coordinates. Give it the point's clip position from the
/// camera's matrix: `camera.viewProjection * vec4f(input.relativePosition, 1.0)`. A rippled surface
/// moves the place by its normal's tilt, such as `s.normal.xz * 0.05` on water that faces up. The
/// lookup decides from the shader permutation, not from the pass that the texture comes from: on
/// the HDR WebGPU path it turns the rows. Read a reflection pass's texture with it, and no scene
/// pass's, which would look flipped on that path.
fn reflection_uv(clip: vec4f, offset: vec2f) -> vec2f {
    let ndc = clip.xy / clip.w;
    var v = 0.5 + 0.5 * ndc.y;
#ifndef WEBGL2
#ifndef TONE_MAP
    // On the HDR WebGPU path a reflection view draws into the texture that this reads, and WebGPU
    // draws its rows from the top. The 8-bit path keeps the copy that turns them, and the copy also
    // decodes the display color.
    v = 1.0 - v;
#endif
#endif
    return vec2f(0.5 - 0.5 * ndc.x, v) + offset;
}
