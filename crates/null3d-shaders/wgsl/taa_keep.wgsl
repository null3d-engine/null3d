// Temporal anti-aliasing's keep step, a prototype: copies the resolve's target into the history
// that the next frame's resolve reads, one texel per pixel. Both have the render size and the same
// drawn corner.

@group(0) @binding(0) var resolved: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    return textureLoad(resolved, vec2u(at.xy), 0);
}
