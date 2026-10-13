// The still-camera accumulation steps: one triangle over the whole target, one texel per pixel.
//
// A view that keeps its camera draws the same scene every frame, with the projection moved by a
// fraction of a pixel each time (see null3d_render::still). The blend step averages the frame's
// scene color into the history of that view, and the store step copies the average into the kept
// history for the next frame. Two steps are needed because one pass may not both read and write the
// history.
//
// Both steps read their textures with `textureLoad`, so the textures have the same size as the
// target: the passes draw at the render size, into the corner of a target of the canvas's size.
//
// The blend step's weight is one over the frames accumulated, so the history holds their mean. The
// first frame of a still view has weight 1, which takes its own color and ignores whatever the
// history held. The store step takes `STORE` in its flags: it binds a blank texel in place of the
// history and copies the color it reads.

/// The values of one step: the weight of the frame in the average, and the flags.
struct Settings {
    /// The weight of the frame's color: one over the frames accumulated, from 1.
    weight: f32,
    /// Bits that pick what the step does: `STORE` copies the color it reads.
    flags: u32,
    /// Unused, kept so the block is 16 bytes.
    spare: vec2f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var color: texture_2d<f32>;
@group(0) @binding(2) var history: texture_2d<f32>;

/// The store step: it copies the color it reads, without the history.
const STORE: u32 = 1u;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // Corners at (-1, -1), (3, -1) and (-1, 3) in clip space.
    let corner = vec2f(f32((vertex << 1u) & 2u), f32(vertex & 2u));
    return vec4f(corner * 2.0 - 1.0, 0.5, 1.0);
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let texel = vec2i(at.xy);
    let frame = textureLoad(color, texel, 0);
    if settings.flags == STORE {
        return vec4f(frame.rgb, 1.0);
    }
    let previous = textureLoad(history, texel, 0);
    return vec4f(mix(previous.rgb, frame.rgb, settings.weight), 1.0);
}
