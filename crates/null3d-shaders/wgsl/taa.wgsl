// Temporal anti-aliasing's resolve, a prototype: one triangle over a target of the render size.
// Each frame's camera moves by a different fraction of a pixel, and the resolve blends the frame
// into a history of the frames before it, as Brian Karis's "High quality temporal supersampling"
// (SIGGRAPH 2014) and Playdead's INSIDE describe:
//
// - The 3 x 3 neighbors of each pixel give the colors the pixel can take in this frame: their
//   mean and spread in YCoCg, within their smallest and largest values.
// - The nearest depth among the neighbors gives where the pixel's surface lay in the last frame,
//   seen by the last frame's camera, so thin edges in front keep their own place.
// - The history there, read with a Catmull-Rom filter of five linear taps, moves toward the
//   neighbors' box until it lies inside it, so a surface that moved or came into view leaves no
//   trail.
// - The pixel takes a share of the history and the rest from this frame. Colors blend after a
//   squeeze by their brightness, so one bright sample does not flicker.
//
// It finds the last place from depth alone: objects that move or bend on their own, such as
// swaying grass, reproject as if they stood still, and the box limits their history.
// The MULTISAMPLED build reads a multisampled depth, on WebGPU. WebGPU draws a corner into a
// target's first rows, and WebGL2, which counts rows from the bottom, into its last.

struct Settings {
    /// From this frame's clip space, with its offset, to the last frame's, without its offset.
    reproject: mat4x4f,
    /// xy: the targets' size in texels. zw: one texel in texture coordinates.
    extent: vec4f,
    /// xy: the drawn corner's size in pixels. z: its first row. w: 1 where rows count from the
    /// bottom.
    corner: vec4f,
    /// x: the history's share. y: 1 to drop the history. z: 1 for the Catmull-Rom filter. w: 1 to
    /// read one depth sample per pixel.
    params: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var current: texture_2d<f32>;
@group(0) @binding(2) var linear_sampler: sampler;
#ifdef MULTISAMPLED
@group(0) @binding(3) var depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(3) var depth_texture: texture_2d<f32>;
#endif
@group(0) @binding(4) var history: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

/// The nearest depth of a texel: the largest, with reversed depth, of its samples.
fn depth_of(texel: vec2i) -> f32 {
#ifdef MULTISAMPLED
    var depth = 0.0;
    for (var sample_index = 0; sample_index < 4; sample_index++) {
        depth = max(depth, textureLoad(depth_texture, texel, sample_index).x);
    }
    return depth;
#else
    return textureLoad(depth_texture, texel, 0).x;
#endif
}

fn brightest(c: vec3f) -> f32 {
    return max(c.r, max(c.g, c.b));
}

/// HDR color squeezed into 0 to 1 by its brightness, and back.
fn squeeze(c: vec3f) -> vec3f {
    return c / (1.0 + brightest(c));
}

fn unsqueeze(c: vec3f) -> vec3f {
    return c / max(1.0 - brightest(c), 1e-4);
}

fn to_ycocg(c: vec3f) -> vec3f {
    return vec3f(
        0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
        0.5 * c.r - 0.5 * c.b,
        -0.25 * c.r + 0.5 * c.g - 0.25 * c.b,
    );
}

fn from_ycocg(c: vec3f) -> vec3f {
    return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

/// A pixel's place in the drawn corner, from 0 to 1, with y up as clip space has it.
fn clip_xy(pixel: vec2f) -> vec2f {
    let local = vec2f(pixel.x, pixel.y - settings.corner.z) / settings.corner.xy;
    let y = select(1.0 - 2.0 * local.y, 2.0 * local.y - 1.0, settings.corner.w > 0.5);
    return vec2f(local.x * 2.0 - 1.0, y);
}

/// The pixel at a place of clip space, as [`clip_xy`] maps the other way.
fn pixel_of(clip: vec2f) -> vec2f {
    let local_y = select(0.5 - 0.5 * clip.y, 0.5 * clip.y + 0.5, settings.corner.w > 0.5);
    let local = vec2f(clip.x * 0.5 + 0.5, local_y);
    return local * settings.corner.xy + vec2f(0.0, settings.corner.z);
}

/// The history at pixel `at`, with a Catmull-Rom filter of five linear taps (Jorge Jimenez's
/// reduction of the nine-tap filter), or one linear tap.
fn history_at(at: vec2f) -> vec3f {
    let uv = at * settings.extent.zw;
    if (settings.params.z < 0.5) {
        return textureSampleLevel(history, linear_sampler, uv, 0.0).rgb;
    }
    let position = at - 0.5;
    let center = floor(position) + 0.5;
    let f = position - floor(position);
    let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
    let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
    let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
    let w3 = f * f * (-0.5 + 0.5 * f);
    let w12 = w1 + w2;
    let offset12 = w2 / w12;
    let texel = settings.extent.zw;
    let uv0 = (center - 1.0) * texel;
    let uv3 = (center + 2.0) * texel;
    let uv12 = (center + offset12) * texel;
    var color = vec3f(0.0);
    color += textureSampleLevel(history, linear_sampler, vec2f(uv12.x, uv0.y), 0.0).rgb * w12.x * w0.y;
    color += textureSampleLevel(history, linear_sampler, vec2f(uv0.x, uv12.y), 0.0).rgb * w0.x * w12.y;
    color += textureSampleLevel(history, linear_sampler, uv12, 0.0).rgb * w12.x * w12.y;
    color += textureSampleLevel(history, linear_sampler, vec2f(uv3.x, uv12.y), 0.0).rgb * w3.x * w12.y;
    color += textureSampleLevel(history, linear_sampler, vec2f(uv12.x, uv3.y), 0.0).rgb * w12.x * w3.y;
    let weight = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
    return max(color / weight, vec3f(0.0));
}

/// `color` moved toward the box's center until it lies inside the box from `low` to `high`.
fn clip_to_box(color: vec3f, low: vec3f, high: vec3f) -> vec3f {
    let center = 0.5 * (high + low);
    let half = 0.5 * (high - low) + 1e-5;
    let away = color - center;
    let reach = abs(away / half);
    let most = max(reach.x, max(reach.y, reach.z));
    return select(color, center + away / most, most > 1.0);
}

@fragment
fn resolve(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = vec2i(position.xy);
    let first = vec2i(0, i32(settings.corner.z));
    let last = first + vec2i(settings.corner.xy) - 1;
    let here = textureLoad(current, texel, 0);
    var sum = vec3f(0.0);
    var squares = vec3f(0.0);
    var low = vec3f(1e9);
    var high = vec3f(-1e9);
    var nearest = 0.0;
    var nearest_at = vec2i(0);
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let at = clamp(texel + vec2i(dx, dy), first, last);
            let c = to_ycocg(squeeze(textureLoad(current, at, 0).rgb));
            sum += c;
            squares += c * c;
            low = min(low, c);
            high = max(high, c);
            if (settings.params.w < 0.5) {
                let depth = depth_of(at);
                if (depth > nearest) {
                    nearest = depth;
                    nearest_at = vec2i(dx, dy);
                }
            }
        }
    }
    // The light build reads one depth sample, the pixel's own first, in place of the nearest of
    // every sample of the nine.
    if (settings.params.w > 0.5) {
        nearest = textureLoad(depth_texture, texel, 0).x;
    }
    let now = to_ycocg(squeeze(here.rgb));
    if (settings.params.y > 0.5) {
        return here;
    }
    // Where the nearest neighbor's surface lay in the last frame, as a move in pixels.
    let start = position.xy + vec2f(nearest_at);
    let clip = settings.reproject * vec4f(clip_xy(start), nearest, 1.0);
    let moved = pixel_of(clip.xy / clip.w) - start;
    let then = position.xy + moved;
    let inside = all(then >= vec2f(first)) && all(then <= vec2f(last) + 1.0);
    if (!inside) {
        return here;
    }
    let mean = sum / 9.0;
    let spread = sqrt(max(squares / 9.0 - mean * mean, vec3f(0.0)));
    let box_low = max(low, mean - spread);
    let box_high = min(high, mean + spread);
    let past = clip_to_box(to_ycocg(squeeze(history_at(then))), box_low, box_high);
    // Lottes's weights: a frame whose brightness differs much from the history's counts more,
    // which keeps fast changes from smearing.
    let lum_now = now.x;
    let lum_past = past.x;
    let difference = abs(lum_now - lum_past) / max(lum_now, max(lum_past, 0.2));
    let keep = mix(settings.params.x, settings.params.x * 0.8, difference);
    let blended = mix(now, past, keep);
    return vec4f(unsqueeze(max(from_ycocg(blended), vec3f(0.0))), here.a);
}
