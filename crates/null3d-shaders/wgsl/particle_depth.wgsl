// The copy of the camera's opaque depth that soft particles read: one texel per pixel, into a
// target of 32-bit floats, after the opaque pass and before the transparent pass. A multisampled
// depth copies its first sample (the MULTISAMPLED build, on WebGPU); WebGL2's backend hands the copy
// a one-sample copy of a multisampled depth. Both passes number pixels the same way, so the copy
// keeps the depth's rows in their order.

#ifdef MULTISAMPLED
@group(0) @binding(0) var depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(0) var depth: texture_2d<f32>;
#endif

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return vec4f(textureLoad(depth, vec2u(at.xy), 0).x, 0.0, 0.0, 1.0);
}
