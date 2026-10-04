// The outline effect's edge step: one triangle over a target of half the render size, which finds
// the edges of the outline mask, as three.js's OutlinePass finds them. The mask holds each
// outlined object's coverage in red, and in green the parts of it that nothing hides.
//
// three.js first copies its mask to half size with a linear filter, then reads the copy's four
// neighbors of each pixel. This step reads the mask itself with a linear filter at the places of
// those neighbors' texel centers, which gives the copy's values with no pass of its own. Where the
// coverage changes, the step writes the edge's color times the change, with the change as alpha.
// The color is the visible one where a neighbor shows a part that nothing hides, and the hidden one
// elsewhere.
//
// Reads clamp inside the mask's drawn corner, as the render scale leaves it. WebGPU draws a corner
// into a target's first rows, and WebGL2 into its last, so the frame builder writes where each
// corner starts.

/// The step's settings, which the frame builder writes.
struct Edge {
    /// xy: the mask's texture coordinates per pixel of the target. zw: unused.
    scale: vec4f,
    /// xy: the mask's texture coordinates at the target's first pixel, before the corners' origins
    /// line up. zw: unused.
    origin: vec4f,
    /// xy: the lowest texture coordinates of the mask's drawn corner. zw: the highest.
    bounds: vec4f,
    /// The linear color of the edges of the parts that nothing hides.
    color: vec4f,
    /// The linear color of the edges of the hidden parts.
    hidden_color: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Edge;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var mask_sampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The mask's filtered texel at `uv`, clamped inside its drawn corner.
fn tap(uv: vec2f) -> vec4f {
    return textureSampleLevel(mask, mask_sampler, clamp(uv, settings.bounds.xy, settings.bounds.zw), 0.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.scale.xy + settings.origin.xy;
    let across = vec2f(settings.scale.x, 0.0);
    let down = vec2f(0.0, settings.scale.y);
    let c1 = tap(uv + across);
    let c2 = tap(uv - across);
    let c3 = tap(uv + down);
    let c4 = tap(uv - down);
    let change = length(vec2f(c1.r - c2.r, c3.r - c4.r) * 0.5);
    let shown = max(max(c1.g, c2.g), max(c3.g, c4.g));
    let color = select(settings.hidden_color.rgb, settings.color.rgb, shown > 0.001);
    return vec4f(color, 1.0) * change;
}
