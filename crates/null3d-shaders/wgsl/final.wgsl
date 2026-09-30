// The final pass: one triangle over the whole canvas. Each pixel reads the scene color under it,
// applies the exposure and the tone mapping, encodes sRGB and dithers. The FXAA build smooths
// edges first. On the 8-bit path the scene shaders did the output transform already, so the scene
// color holds display color, and the pass keeps the color as it reads it.
//
// The scene color holds color multiplied by its coverage. Where it is only partly covered, as over
// a transparent canvas's background, the pass maps the color that covers it and keeps the coverage
// as the canvas's premultiplied alpha. The scene color and the canvas have one size, so a pixel
// reads the texel it covers, which also keeps each path's row order: WebGL2 keeps GL's order in
// both.
#import null3d::tonemap

/// The settings flag that says the scene color holds display color.
const DISPLAY_COLOR: u32 = 1u;

@group(0) @binding(0) var<uniform> settings: null3d::tonemap::Output;
@group(0) @binding(1) var scene_color: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    // A triangle past the corners of clip space: (-1, -1), (3, -1) and (-1, 3). Its depth sits
    // halfway, so no depth mode of the WebGL2 path moves it to the edge of the clip range.
    let x = f32((vertex << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(vertex & 2u) * 2.0 - 1.0;
    return vec4f(x, y, 0.5, 1.0);
}

#ifdef FXAA
// FXAA after Timothy Lottes's fast version: four diagonal taps find the edge's direction, and two
// or four taps along it blend the pixel with its neighbors. The thresholds are FXAA 3.11's high
// quality values.
//
// Blended HDR color keeps the look of its brightest part, which would leave bright edges jagged.
// So FXAA compares and blends HDR color squeezed below 1 by a curve that it undoes afterwards, as
// tone mapping would squeeze it. The taps between texels filter four squeezed texels by hand.

/// Contrast below this share of the brightest tap is no edge.
const EDGE_THRESHOLD: f32 = 0.125;
/// Contrast below this is no edge, which leaves dark areas alone.
const EDGE_THRESHOLD_MIN: f32 = 0.0625;
/// Keep the direction's scale finite where the contrast is low.
const REDUCE_MIN: f32 = 1.0 / 128.0;
const REDUCE_MUL: f32 = 1.0 / 8.0;
/// The longest blend along an edge, in pixels.
const SPAN_MAX: f32 = 8.0;
const LUMINANCE = vec3f(0.2126, 0.7152, 0.0722);

/// True when the scene color holds display color, which FXAA blends as it is.
fn display_color() -> bool {
    return (settings.flags & DISPLAY_COLOR) != 0u;
}

/// HDR color squeezed below 1: exposed luminance l becomes l / (1 + l). Display color stays as it
/// is.
fn squeeze(texel: vec4f) -> vec4f {
    if display_color() {
        return texel;
    }
    return vec4f(texel.rgb / (1.0 + settings.exposure * dot(texel.rgb, LUMINANCE)), texel.a);
}

/// Undoes `squeeze`.
fn unsqueeze(c: vec4f) -> vec4f {
    if display_color() {
        return c;
    }
    let squeezed = min(settings.exposure * dot(c.rgb, LUMINANCE), 0.999);
    return vec4f(c.rgb / (1.0 - squeezed), c.a);
}

/// The squeezed texel at `pixel`, clamped inside the scene color, whose last texel is `last`.
fn texel_at(pixel: vec2i, last: vec2i) -> vec4f {
    return squeeze(textureLoad(scene_color, clamp(pixel, vec2i(0), last), 0));
}

/// The squeezed color at a point in pixels, filtered between its four nearest texels.
fn tap(point: vec2f, last: vec2i) -> vec4f {
    let corner = point - 0.5;
    let base = vec2i(floor(corner));
    let f = fract(corner);
    let top = mix(texel_at(base, last), texel_at(base + vec2i(1, 0), last), f.x);
    let bottom = mix(texel_at(base + vec2i(0, 1), last), texel_at(base + vec2i(1, 1), last), f.x);
    return mix(top, bottom, f.y);
}

/// The brightness that FXAA compares, from 0 to 1 as the eye sees it. Squeezed HDR color takes
/// the exposure and a square root, near the sRGB curve.
fn luma(c: vec4f) -> f32 {
    let y = dot(c.rgb, LUMINANCE);
    return select(sqrt(settings.exposure * y), y, display_color());
}

/// The scene color of the pixel at `position`, smoothed along the edge that crosses it.
fn pixel_color(position: vec2f) -> vec4f {
    let last = vec2i(textureDimensions(scene_color)) - 1;
    let pixel = vec2i(position);
    let texel = textureLoad(scene_color, pixel, 0);
    let m = luma(squeeze(texel));
    let nw = luma(texel_at(pixel + vec2i(-1, -1), last));
    let ne = luma(texel_at(pixel + vec2i(1, -1), last));
    let sw = luma(texel_at(pixel + vec2i(-1, 1), last));
    let se = luma(texel_at(pixel + vec2i(1, 1), last));
    let lowest = min(m, min(min(nw, ne), min(sw, se)));
    let highest = max(m, max(max(nw, ne), max(sw, se)));
    if highest - lowest < max(EDGE_THRESHOLD_MIN, highest * EDGE_THRESHOLD) {
        return texel;
    }
    // Across the brightness gradient, which runs along the edge.
    let along = vec2f((sw + se) - (nw + ne), (nw + sw) - (ne + se));
    let reduce = max((nw + ne + sw + se) * (0.25 * REDUCE_MUL), REDUCE_MIN);
    let scale = 1.0 / (min(abs(along.x), abs(along.y)) + reduce);
    let span = clamp(along * scale, vec2f(-SPAN_MAX), vec2f(SPAN_MAX));
    let inner = 0.5 * (tap(position - span / 6.0, last) + tap(position + span / 6.0, last));
    let outer = 0.5 * inner
        + 0.25 * (tap(position - span * 0.5, last) + tap(position + span * 0.5, last));
    // The wider blend crossed another edge where it leaves the taps' brightness range.
    let outer_luma = luma(outer);
    return unsqueeze(select(outer, inner, outer_luma < lowest || outer_luma > highest));
}
#else
/// The scene color of the pixel at `position`.
fn pixel_color(position: vec2f) -> vec4f {
    return textureLoad(scene_color, vec2i(position), 0);
}
#endif

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let texel = pixel_color(position.xy);
    if (settings.flags & DISPLAY_COLOR) != 0u {
        return texel;
    }
    let coverage = texel.a;
    if coverage <= 0.0 {
        return vec4f(0.0);
    }
    let mapped = null3d::tonemap::tone_map(texel.rgb / coverage, settings);
    let encoded = saturate(null3d::tonemap::encode(mapped, position.xy));
    return vec4f(encoded * coverage, coverage);
}
