// The temporal resolve (task M3-A11): one triangle over the render size that mixes the frame's
// color into the history of the view, read where each surface lay in the last frame.
//
// The pass reads the scene's color, the depth and the motion target that the frame drew, and the
// two kept history targets, and writes the resolved color. The history it reads is the one that
// the frame before wrote: the builder binds both and the block names it, so a frame drawn again
// reads the same one. The history target holds each pixel's color and its surface's distance from
// the camera in alpha. A pixel with no history, such as the first frame after the resolve turns
// on, takes this frame's color alone.
//
// The reprojected place of a pixel comes from its own motion beyond what the camera's move
// explains, plus the camera's part from its depth and the last frame's camera. The history is
// clamped to the colors of this frame's neighborhood, in YCoCg, so a surface that moved or came
// into view leaves no trail. A history that holds another surface's distance is rejected. The
// pixel keeps most of the history where the brightness held, and less where it changed much.
//
// The MULTISAMPLED builds read a multisampled scene depth, on WebGPU: the pixel's depth is the
// nearest of its samples. The WebGL2 builds read a copy of one depth sample that its backend
// keeps. WebGPU draws the top row of an image first and WebGL2 the bottom row, so the image's
// texture coordinates, which the motion target holds from the top left, turn over on WebGL2.
#import null3d::fullscreen::{triangle}

/// The resolve's values: the matrix from this frame's clip space to the last frame's, the drawn
/// corner in pixels and its reciprocal, the terms that turn a depth value into a distance, this
/// frame's jitter in clip space, the history's share, whether the histories hold a frame, and
/// whether the frame reads the second history target.
struct Block {
    reproject: mat4x4f,
    /// xy: the drawn corner's size in pixels. zw: its reciprocal.
    size: vec4f,
    /// The inverse projection's terms that give a distance from a depth value: the view-space z is
    /// (x * depth + y) / (z * depth + w).
    depth: vec4f,
    /// The sub-pixel jitter of this frame's projection, in clip space.
    jitter: vec4f,
    /// x: the share of the history that a pixel keeps, where nothing rejects it. y: 1 while the
    /// histories hold no frame. z: 1 for a perspective camera. w: unused.
    settings: vec4f,
    /// x: 1 while the frame writes the second history target, so it reads the first. The rest is
    /// unused.
    parity: vec4f,
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

/// The distance in front of the camera of a depth value.
fn distance_of(depth: f32) -> f32 {
    let d = block.depth;
    let view_z = (d.x * depth + d.y) / (d.z * depth + d.w);
    return max(-view_z, 1e-4);
}

/// The depth value of the texel, or of a multisampled texel the nearest of its samples, which
/// belongs to the surface in front.
fn depth_of(texel: vec2i) -> f32 {
#ifdef MULTISAMPLED
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

/// The color in YCoCg: the brightness in x, and the two chroma terms in y and z. The history is
/// clamped in this space, where a change of brightness does not move the chroma.
fn ycocg(c: vec3f) -> vec3f {
    return vec3f(
        0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
        0.5 * c.r - 0.5 * c.b,
        -0.25 * c.r + 0.5 * c.g - 0.25 * c.b,
    );
}

/// The color of YCoCg's three values.
fn from_ycocg(c: vec3f) -> vec3f {
    let tmp = c.x - c.z;
    return vec3f(tmp + c.y, c.x + c.z, tmp - c.y);
}

/// The relative luminance of a linear color, in the weights that the engine lights with.
fn luma(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// The color the history may take: its brightness and chroma clamped to this frame's
/// neighborhood, a box around the 3 x 3 colors' mean, as wide as their mean spread, within their
/// smallest and largest values.
fn clip_to_neighborhood(history: vec3f, center: vec2i) -> vec3f {
    var smallest = vec3f(1e9);
    var largest = vec3f(-1e9);
    var sum = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let c = ycocg(color_at(center + vec2i(x, y)).rgb);
            smallest = min(smallest, c);
            largest = max(largest, c);
            sum += c;
        }
    }
    let mean = sum / 9.0;
    var spread = vec3f(0.0);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let c = ycocg(color_at(center + vec2i(x, y)).rgb);
            spread += abs(c - mean);
        }
    }
    spread = spread / 9.0;
    return from_ycocg(clamp(history, max(mean - spread, smallest), min(mean + spread, largest)));
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
        // Where the surface, which moved by `motion_uv` since the last frame, showed then.
        let history_uv = last_uv - motion_uv;
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
            // The history that the frame before wrote is the other one of the two, whose place the
            // parity names: the frame writes that one after the resolve.
            if (block.parity.x < 0.5) {
                history = textureSampleLevel(history_b, history_sampler, sample_uv, 0.0);
            } else {
                history = textureSampleLevel(history_a, history_sampler, sample_uv, 0.0);
            }
            // A history from another surface, by a distance that differs, is dropped.
            if (abs(history.a - distance) > 0.05 * distance) {
                history_weight = 0.0;
            }
            history = vec4f(clip_to_neighborhood(history.rgb, texel), history.a);
            // Less history where the brightness changed much, as Lottes weighs it, so a light
            // that moves over a surface follows at once.
            let current_luma = luma(current.rgb);
            let history_luma = luma(history.rgb);
            let change =
                abs(current_luma - history_luma) / max(max(current_luma, history_luma), 1e-4);
            history_weight *= 1.0 - smoothstep(0.5, 2.0, change);
        } else {
            history_weight = 0.0;
        }
    } else {
        history_weight = 0.0;
    }
    return vec4f(mix(current.rgb, history.rgb, clamp(history_weight, 0.0, 1.0)), distance);
}
