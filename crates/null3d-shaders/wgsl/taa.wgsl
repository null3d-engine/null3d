// The temporal resolve (task M3-A11): one triangle over the render size that mixes the frame's
// color into the history of the view, read where each surface lay in the last frame.
//
// The pass reads the scene's color, the depth and the motion target that the frame drew, the copy
// of the scene's color after the opaque pass, and the two kept history targets, and writes the
// resolved color. The history it reads is the one that the frame before wrote: the builder binds
// both and the block names it, so a frame drawn again reads the same one. The history target holds
// each pixel's color and its surface's distance from the camera in alpha. A pixel with no history,
// such as the first frame after the resolve turns on, takes this frame's color alone.
//
// The reprojected place of a pixel comes from its own motion beyond what the camera's move
// explains, plus the camera's part from its depth and the last frame's camera. The history is
// clamped to a box around this frame's neighborhood in YCoCg, which always holds the pixel's own
// color, so a surface that moved or came into view leaves no trail and a lit gradient does not
// band. A history that holds another surface's distance is rejected, and one written under another
// exposure is scaled into this frame's. A reactive mask lowers the history where a blended surface
// moved: from the scene's alpha where the canvas shows through, and from the difference between the
// composited color and the opaque-only copy.
//
// The MULTISAMPLED builds read a multisampled scene depth, on WebGPU: the pixel's depth is the
// nearest of its samples. The WebGL2 builds read a copy of one depth sample that its backend
// keeps. WebGPU draws the top row of an image first and WebGL2 the bottom row, so the image's
// texture coordinates, which the motion target holds from the top left, turn over on WebGL2.
//
// The phone path reads one depth sample, samples the history with four taps, and skips the opaque
// comparison and the brightness weighting, so a device whose speed picked the Low preset pays less
// per pixel. It draws the same picture, a little softer.
#import null3d::fullscreen::{triangle}
#import null3d::temporal::{TemporalBox, temporal_rgb, temporal_weight, temporal_widen, temporal_ycocg}

/// The resolve's values: the matrix from this frame's clip space to the last frame's, the drawn
/// corner in pixels and its reciprocal, the terms that turn a depth value into a distance, this
/// frame's jitter in clip space, the history's share, whether the histories hold a frame, the
/// exposure's change since the frame before, whether the opaque-only copy is bound, and whether the
/// phone path draws.
struct Block {
    reproject: mat4x4f,
    /// xy: the drawn corner's size in pixels. zw: its reciprocal.
    size: vec4f,
    /// The inverse projection's terms that give a distance from a depth value: the view-space z is
    /// (x * depth + y) / (z * depth + w).
    depth: vec4f,
    /// The sub-pixel jitter of this frame's projection, in clip space.
    jitter: vec4f,
    /// The sub-pixel jitter that the last frame's projection had, in clip space.
    last_jitter: vec4f,
    /// x: the share of the history that a pixel keeps, where nothing rejects it. y: 1 while the
    /// histories hold no frame. z: this frame's exposure over the last frame's. w: unused.
    settings: vec4f,
    /// x: 1 while the frame writes the second history target, so it reads the first. yz: the scale
    /// from the drawn corner's texture coordinates into the history target's. w: 1 on the phone
    /// path.
    parity: vec4f,
    /// x: the transparency signals to read, as bits: 1 for the scene's alpha, 2 for the opaque-only
    /// comparison. yzw: unused.
    reactive: vec4f,
}

@group(0) @binding(0) var<uniform> block: Block;
@group(0) @binding(1) var scene_color: texture_2d<f32>;
#ifdef MULTISAMPLED
@group(0) @binding(2) var scene_depth: texture_multisampled_2d<f32>;
#else
@group(0) @binding(2) var scene_depth: texture_2d<f32>;
#endif
@group(0) @binding(3) var motion: texture_2d<f32>;
@group(0) @binding(4) var history_a: texture_2d<f32>;
@group(0) @binding(5) var history_b: texture_2d<f32>;
@group(0) @binding(6) var history_sampler: sampler;
/// The scene's color as the opaque pass left it. A pixel whose color changed since then holds a
/// blended surface.
@group(0) @binding(7) var opaque_color: texture_2d<f32>;

/// The distance in front of the camera of a depth value.
fn distance_of(depth: f32) -> f32 {
    let d = block.depth;
    let view_z = (d.x * depth + d.y) / (d.z * depth + d.w);
    return max(-view_z, 1e-4);
}

/// The depth value of the texel, or of a multisampled texel the nearest of its samples, which
/// belongs to the surface in front. The phone path reads one sample, as the fog does.
fn depth_of(texel: vec2i) -> f32 {
#ifdef MULTISAMPLED
    if (block.parity.w > 0.5) {
        return textureLoad(scene_depth, texel, 0).x;
    }
    var nearest = 0.0;
    for (var index = 0; index < 4; index++) {
        nearest = max(nearest, textureLoad(scene_depth, texel, index).x);
    }
    return nearest;
#else
    return textureLoad(scene_depth, texel, 0).x;
#endif
}

/// The texel's color, clamped inside the drawn corner.
fn color_at(texel: vec2i) -> vec4f {
    let corner = vec2i(block.size.xy);
    return textureLoad(scene_color, clamp(texel, vec2i(0), corner - 1), 0);
}

/// The relative luminance of a linear color, in the weights that the engine lights with.
fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// The texel of the history that the frame reads, which is the other one of the two.
fn history_at(texel: vec2i) -> vec4f {
    if (block.parity.x < 0.5) {
        return textureLoad(history_b, texel, 0);
    }
    return textureLoad(history_a, texel, 0);
}

/// The history at `uv`, at the place that four texels' own reads interpolate to. Both histories are
/// as large as the canvas, so one gives the size.
fn bilinear(uv: vec2f) -> vec4f {
    let size = vec2f(textureDimensions(history_a));
    let place = uv * size - 0.5;
    let first = floor(place);
    let f = place - first;
    let corner = vec2i(first);
    let last = vec2i(size) - 1;
    let a = history_at(clamp(corner, vec2i(0), last));
    let b = history_at(clamp(corner + vec2i(1, 0), vec2i(0), last));
    let c = history_at(clamp(corner + vec2i(0, 1), vec2i(0), last));
    let d = history_at(clamp(corner + vec2i(1, 1), vec2i(0), last));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/// The history's value at `uv`, which counts in the history target's own rows: through the linear
/// sampler where the device filters 16-bit floats, and through four taps of `textureLoad` on the
/// phone path, whose devices may not.
fn sample_history(uv: vec2f) -> vec4f {
    if (block.parity.w <= 0.5) {
        if (block.parity.x < 0.5) {
            return textureSampleLevel(history_b, history_sampler, uv, 0.0);
        }
        return textureSampleLevel(history_a, history_sampler, uv, 0.0);
    }
    return bilinear(uv);
}

/// The box in YCoCg that the history may take: its brightness and chroma within this frame's
/// neighborhood, a box around the 3 x 3 colors' mean as wide as their mean spread, inside their
/// smallest and largest values, and widened to hold the `centre` color.
fn neighborhood_box(centre: vec2i, centre_color: vec3f) -> TemporalBox {
    var smallest = vec3f(1e30);
    var largest = vec3f(-1e30);
    var sum = vec3f(0.0);
    var colors: array<vec3f, 9>;
    var index = 0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let c = temporal_ycocg(color_at(centre + vec2i(x, y)).rgb);
            colors[index] = c;
            index++;
            smallest = min(smallest, c);
            largest = max(largest, c);
            sum += c;
        }
    }
    let mean = sum / 9.0;
    var spread = vec3f(0.0);
    for (var i = 0; i < 9; i++) {
        spread += abs(colors[i] - mean);
    }
    spread = spread / 9.0;
    var box: TemporalBox;
    box.low = max(mean - spread, smallest);
    box.high = min(mean + spread, largest);
    return temporal_widen(box, temporal_ycocg(centre_color));
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
}

@fragment
fn resolve(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let size = block.size.xy;
    let texel = vec2i(at.xy);
    // The pixel's texture coordinates with the top left as the origin, where the motion target
    // and the reprojection count from.
#ifdef WEBGL2
    let uv = vec2f((at.x + 0.5) / size.x, 1.0 - (at.y + 0.5) / size.y);
#else
    let uv = (at.xy + 0.5) / size;
#endif
    let current = color_at(texel);
    let depth = depth_of(texel);
    let distance = distance_of(depth);
    let phone = block.parity.w > 0.5;
    var history_weight = block.settings.x;
    var history = current;
    // The pixel's point lies a fraction of a pixel along this frame's jitter, so its clip position
    // takes that fraction off the one the pixel's center maps to.
    let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) - block.jitter.xy;
    let last = block.reproject * vec4f(ndc, depth, 1.0);
    if (block.settings.y < 0.5 && last.w > 1e-6) {
        let then = last.xy / last.w;
        let last_uv = vec2f(then.x * 0.5 + 0.5, 0.5 - then.y * 0.5);
        let motion_uv = textureLoad(motion, texel, 0).xy;
        // Where the surface, which moved by `motion_uv` since the last frame, showed then. The
        // history's pixels hold the surfaces that the last frame's offset put there, so the
        // sample moves by that offset across the image, whose y counts down.
        let last_offset = vec2f(block.last_jitter.x, -block.last_jitter.y) * 0.5;
        let history_uv = last_uv - motion_uv + last_offset;
        if (
            history_uv.x >= 0.0
                && history_uv.x <= 1.0
                && history_uv.y >= 0.0
                && history_uv.y <= 1.0
        ) {
            // WebGL2's textures count rows from the bottom, and the coordinates above from the top.
            // The history targets are as large as the canvas, and the frame draws a corner of them,
            // so the corner's coordinates scale into the target's.
#ifdef WEBGL2
            let sample_uv = vec2f(history_uv.x, 1.0 - history_uv.y) * block.parity.yz;
#else
            let sample_uv = history_uv * block.parity.yz;
#endif
            history = sample_history(sample_uv);
            // The history was written under the exposure of the frame before, so it takes this
            // frame's exposure over that one before the two blend.
            history = vec4f(history.rgb * block.settings.z, history.a);
            // A history from another surface, by a distance that differs, is dropped.
            if (abs(history.a - distance) > 0.05 * distance) {
                history_weight = 0.0;
            }
            let box = neighborhood_box(texel, current.rgb);
            history = vec4f(
                temporal_rgb(clamp(temporal_ycocg(history.rgb), box.low, box.high)),
                history.a,
            );
            // Where a blended surface moved, this frame's color replaces the history. The scene's
            // alpha holds the surface where the canvas shows through, and the opaque-only copy
            // shows the color that a blended surface changed over an opaque one. The phone path
            // reads neither signal: it trades that history for the reads it saves.
            let signals = select(0u, u32(block.reactive.x + 0.5), !phone);
            var reactive = 0.0;
            if ((signals & 1u) != 0u && current.a < 0.999) {
                reactive = saturate(current.a);
            }
            if ((signals & 2u) != 0u) {
                let opaque = textureLoad(opaque_color, texel, 0);
                let changed = abs(luma(current.rgb) - luma(opaque.rgb));
                reactive = max(reactive, smoothstep(0.02, 0.1, changed));
            }
            // Less history where the brightness changed much, as Lottes weighs it, so a light
            // that moves over a surface follows at once.
            let current_luma = luma(current.rgb);
            let history_luma = luma(history.rgb);
            let change =
                abs(current_luma - history_luma) / max(max(current_luma, history_luma), 1e-4);
            history_weight = temporal_weight(
                history_weight,
                reactive,
                select(change, 0.0, phone),
            );
        } else {
            history_weight = 0.0;
        }
    } else {
        history_weight = 0.0;
    }
    return vec4f(mix(current.rgb, history.rgb, clamp(history_weight, 0.0, 1.0)), distance);
}
