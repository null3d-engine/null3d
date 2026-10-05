// One step of bloom's mip chain: one triangle over the step's corner of its target, which samples
// its source with a linear filter.
//
// A step down takes Jimenez's 13-tap filter (Call of Duty: Advanced Warfare): four groups of four
// taps around the pixel and one group of the inner four, which read the source at half a target
// pixel apart. The first step reads the scene color: it limits each tap to what a 16-bit float
// holds, keeps the part of it that passes the threshold, and weighs each group by a Karis average,
// so a single bright pixel cannot make the glow flicker as it moves. Each later step reads the
// level above.
//
// A step up reads the level below with a 3x3 tent, one of its texels apart, and returns that light
// times the step's mix, with the mix as alpha. The pipeline blends it over the target's own level
// with premultiplied blending, so the level keeps the rest of its own light.
//
// Each target holds its drawn corner, so a read clamps inside the source's drawn corner, as a
// smaller texture would clamp at its edge. WebGPU draws a corner into a target's first rows, and
// WebGL2, which counts rows from the bottom, into its last, so the frame builder writes where each
// corner starts. A fragment's position and a texture's rows count the same way on each path.

/// A step's settings, which the frame builder writes for each step.
struct Step {
    /// xy: the source's texture coordinates per pixel of the target. zw: the distance between
    /// taps, in the source's texture coordinates.
    scale: vec4f,
    /// xy: the source's texture coordinates at the target's first pixel, before the corners'
    /// origins line up. zw: unused.
    origin: vec4f,
    /// xy: the lowest texture coordinates of the source's drawn corner, the centers of its first
    /// texels. zw: the highest, the centers of its last.
    bounds: vec4f,
    /// The luminance from which the first step keeps light. At 0 it keeps all of it.
    threshold: f32,
    /// The width of the threshold's soft edge.
    knee: f32,
    /// The kind of step: 0 the first step down, 1 a later step down, 2 a step up.
    mode: u32,
    /// A step up's mix: the share of the light from below that replaces the level's own.
    mix: f32,
}

@group(0) @binding(0) var<uniform> settings: Step;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

#import null3d::color::{limit_hdr, luminance}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The source's filtered color at `uv`, clamped inside its drawn corner. It is no brighter than a
/// 16-bit float holds, as Unity's URP limits bloom's input: additive blending can add the scene
/// color past it, and some GPUs store the sum as infinity, which would spread through the blur.
fn tap(uv: vec2f) -> vec3f {
    let at = clamp(uv, settings.bounds.xy, settings.bounds.zw);
    return limit_hdr(textureSampleLevel(source, source_sampler, at, 0.0).rgb);
}

/// A tap of a step down: on the first step, the part of the scene color that passes the
/// threshold's soft step on its luminance.
fn down_tap(uv: vec2f) -> vec3f {
    let c = tap(uv);
    if settings.mode != 0u || settings.threshold <= 0.0 {
        return c;
    }
    let edge = settings.threshold + max(settings.knee, 0.0001);
    return c * smoothstep(settings.threshold, edge, luminance(c));
}

/// The weight of a group of taps in a Karis average: a bright group counts less.
fn karis(group: vec3f) -> f32 {
    return 1.0 / (1.0 + luminance(group));
}

/// The 13-tap step down. The groups' weights are Jimenez's: an eighth for each outer group and a
/// half for the inner one. On the first step each weight also divides by its group's brightness,
/// and the sum divides by the weights' sum, so the average keeps the light of an even area.
fn down(uv: vec2f) -> vec3f {
    let d = settings.scale.zw;
    let a = down_tap(uv + vec2f(-2.0, -2.0) * d);
    let b = down_tap(uv + vec2f(0.0, -2.0) * d);
    let c = down_tap(uv + vec2f(2.0, -2.0) * d);
    let e = down_tap(uv + vec2f(-2.0, 0.0) * d);
    let f = down_tap(uv);
    let g = down_tap(uv + vec2f(2.0, 0.0) * d);
    let h = down_tap(uv + vec2f(-2.0, 2.0) * d);
    let i = down_tap(uv + vec2f(0.0, 2.0) * d);
    let j = down_tap(uv + vec2f(2.0, 2.0) * d);
    let k = down_tap(uv + vec2f(-1.0, -1.0) * d);
    let l = down_tap(uv + vec2f(1.0, -1.0) * d);
    let m = down_tap(uv + vec2f(-1.0, 1.0) * d);
    let n = down_tap(uv + vec2f(1.0, 1.0) * d);
    let g0 = (a + b + e + f) * 0.25;
    let g1 = (b + c + f + g) * 0.25;
    let g2 = (e + f + h + i) * 0.25;
    let g3 = (f + g + i + j) * 0.25;
    let g4 = (k + l + m + n) * 0.25;
    var w = vec4f(0.125);
    var w4 = 0.5;
    if settings.mode == 0u {
        w *= vec4f(karis(g0), karis(g1), karis(g2), karis(g3));
        w4 *= karis(g4);
    }
    let sum = g0 * w.x + g1 * w.y + g2 * w.z + g3 * w.w + g4 * w4;
    return sum / (w.x + w.y + w.z + w.w + w4);
}

/// The 3x3 tent step up, one texel of the level below between taps.
fn up(uv: vec2f) -> vec3f {
    let d = settings.scale.zw;
    var sum = tap(uv) * 0.25;
    sum += (tap(uv + vec2f(d.x, 0.0)) + tap(uv - vec2f(d.x, 0.0))) * 0.125;
    sum += (tap(uv + vec2f(0.0, d.y)) + tap(uv - vec2f(0.0, d.y))) * 0.125;
    sum += (tap(uv + d) + tap(uv - d)) * 0.0625;
    sum += (tap(uv + vec2f(d.x, -d.y)) + tap(uv + vec2f(-d.x, d.y))) * 0.0625;
    return sum;
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.scale.xy + settings.origin.xy;
    if settings.mode == 2u {
        // Premultiplied: the pipeline keeps 1 - mix of the target's own level.
        return vec4f(up(uv) * settings.mix, settings.mix);
    }
    return vec4f(down(uv), 1.0);
}
