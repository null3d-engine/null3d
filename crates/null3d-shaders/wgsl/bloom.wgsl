// One step of bloom's chain: one triangle over the step's target, which samples the step before it
// with a linear filter. The bright pass keeps the scene color's pixels whose luminance passes the
// threshold, at half size. Each level then blurs the level before it with a Gaussian, first across
// and then down, at half the size of that level. The weights and the steps follow three.js's
// UnrealBloomPass: pairs of taps merge into one filtered read each.
//
// Prototype P2's mip chain draws with the same shader, by the step's mode: a 13-tap step down
// (Jimenez, Call of Duty: Advanced Warfare), with the threshold and a Karis average on the first
// step, and a 3x3 tent step up, whose output the pipeline blends over its target by the step's mix.
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
    /// The kind of step: 0 a blur or bright pass of `UnrealBloomPass`, 1 the mip chain's first
    /// step down, 2 a later step down, 3 a step up.
    mode: u32,
    /// A step up's mix: the share of the levels below that it blends over its target.
    mix: f32,
    /// 1 when the first step down weighs its groups of taps by a Karis average.
    karis: u32,
    /// The brightest value a step keeps from the scene color.
    limit: f32,
}

@group(0) @binding(0) var<uniform> settings: Step;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

const LUMINANCE = vec3f(0.2126729, 0.7151522, 0.0721750);

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space, at a depth that every WebGL2 depth mode keeps.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The source's filtered color at `uv`, clamped inside its drawn corner.
fn tap(uv: vec2f) -> vec3f {
    return textureSampleLevel(source, source_sampler, clamp(uv, settings.bounds.xy, settings.bounds.zw), 0.0).rgb;
}

/// A tap of the mip chain's first step down: the scene color within the limit, kept by the
/// threshold's soft step on its luminance.
fn bright(uv: vec2f) -> vec3f {
    let c = min(max(tap(uv), vec3f(0.0)), vec3f(settings.limit));
    if settings.threshold <= 0.0 {
        return c;
    }
    let edge = settings.threshold + max(settings.knee, 0.0001);
    return c * smoothstep(settings.threshold, edge, dot(c, LUMINANCE));
}

/// A tap of a step down: the first step's bright color, or the level above as it is.
fn down_tap(uv: vec2f) -> vec3f {
    if settings.mode == 1u {
        return bright(uv);
    }
    return tap(uv);
}

/// The weight of a group of taps in a Karis average: bright groups count less, so one very bright
/// pixel cannot flicker the glow as it moves.
fn karis(group: vec3f) -> f32 {
    return 1.0 / (1.0 + dot(group, LUMINANCE));
}

/// The 13-tap step down: four groups of four taps around the center, and one group of the inner
/// four, as Jimenez weighs them. With the Karis average the weights also divide by each group's
/// brightness, and the sum divides by the weights' sum.
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
    if settings.karis == 1u {
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
    if settings.mode == 3u {
        // Premultiplied: the pipeline keeps 1 - mix of the target's own level.
        return vec4f(up(uv) * settings.mix, settings.mix);
    }
    if settings.mode != 0u {
        return vec4f(down(uv), 1.0);
    }
    var sum = tap(uv) * settings.center;
    for (var pair = 0u; pair < settings.pairs; pair++) {
        let along = settings.scale.zw * settings.offsets[pair >> 2u][pair & 3u];
        sum += (tap(uv + along) + tap(uv - along)) * settings.weights[pair >> 2u][pair & 3u];
    }
    // three.js's bright pass: a soft step from the threshold up.
    let keep = smoothstep(settings.threshold, settings.threshold + settings.knee, dot(sum, LUMINANCE));
    return vec4f(sum * keep, 1.0);
}
