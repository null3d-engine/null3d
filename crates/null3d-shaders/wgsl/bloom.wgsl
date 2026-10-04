// One step of bloom's chain: one triangle over the step's target, which samples the step before it
// with a linear filter. The bright pass keeps the scene color's pixels whose luminance passes the
// threshold, at half size. Each level then blurs the level before it with a Gaussian, first across
// and then down, at half the size of that level. The weights and the steps follow three.js's
// UnrealBloomPass: pairs of taps merge into one filtered read each.
//
// Each target holds its drawn corner, as the render scale leaves it, so a read clamps inside the
// source's drawn corner, as a smaller texture would clamp at its edge. WebGPU draws a corner into a
// target's first rows, and WebGL2, which counts rows from the bottom, into its last, so the
// frame builder writes where each corner starts. A fragment's position and a texture's rows count
// the same way on each path.

/// A step's settings, which the frame builder writes for each step.
struct Step {
    /// xy: the source's texture coordinates per pixel of the target. zw: the blur's direction, as
    /// the source's texture coordinates per pixel of the target, or zero for the bright pass.
    scale: vec4f,
    /// xy: the source's texture coordinates at the target's first pixel, before the corners'
    /// origins line up. zw: unused.
    origin: vec4f,
    /// xy: the lowest texture coordinates of the source's drawn corner, the centers of its first
    /// texels. zw: the highest, the centers of its last.
    bounds: vec4f,
    /// The weight of the center tap.
    center: f32,
    /// The pairs of taps on each side of the center.
    pairs: u32,
    /// The luminance below which the bright pass drops a pixel. A blur keeps every pixel.
    threshold: f32,
    /// The width of the threshold's soft edge.
    knee: f32,
    /// Each pair's distance from the center, in pixels of the target, four to a vector.
    offsets: array<vec4f, 3>,
    /// Each pair's weight, for both of its taps.
    weights: array<vec4f, 3>,
}

@group(0) @binding(0) var<uniform> settings: Step;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

#import null3d::color::{limit_hdr}

const LUMINANCE = vec3f(0.2126729, 0.7151522, 0.0721750);

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

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let uv = position.xy * settings.scale.xy + settings.origin.xy;
    var sum = tap(uv) * settings.center;
    for (var pair = 0u; pair < settings.pairs; pair++) {
        let along = settings.scale.zw * settings.offsets[pair >> 2u][pair & 3u];
        sum += (tap(uv + along) + tap(uv - along)) * settings.weights[pair >> 2u][pair & 3u];
    }
    // three.js's bright pass: a soft step from the threshold up.
    let keep = smoothstep(settings.threshold, settings.threshold + settings.knee, dot(sum, LUMINANCE));
    return vec4f(sum * keep, 1.0);
}
