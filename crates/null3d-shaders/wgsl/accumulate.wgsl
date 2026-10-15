// The still-camera accumulation's blend: one triangle over the whole target, one texel per pixel.
//
// A view that keeps its camera draws the same scene every frame, with the projection moved by a
// fraction of a pixel each time (see null3d_render::still). The blend draws the frame's scene color
// into the kept history of that view with the pipeline's blending, `src + dst * (1 - src alpha)`:
// it writes the color times the frame's weight, with the weight as alpha, so the history becomes
// `mix(history, color, weight)`. The weight is one over the frames accumulated, so the history
// holds their mean; the first frame has weight 1 and replaces whatever the history held, and a
// resting view's frames have weight 0 and leave it as it is.
//
// The step reads its texture with `textureLoad`, so the texture has the same size as the target:
// the pass draws at the render size, into the corner of a target of the canvas's size.

/// The values of the blend: the weight of the frame in the average.
struct Settings {
    /// The weight of the frame's color: one over the frames accumulated, or 0 while the view rests.
    weight: f32,
    /// Unused, kept so the block is 16 bytes.
    spare: vec3f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var color: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let frame = textureLoad(color, vec2i(at.xy), 0);
    return vec4f(frame.rgb * settings.weight, settings.weight);
}
