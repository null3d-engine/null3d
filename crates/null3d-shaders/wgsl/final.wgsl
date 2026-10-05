// The final pass: one triangle over the whole canvas. Each pixel reads the scene color under it,
// which holds exposed color, darkens it by the vignette, applies the tone mapping and encodes sRGB.
// The FXAA build smooths edges first. On the 8-bit path the scene shaders did the output transform
// already, so the scene color holds display color, and the pass keeps the color as it reads it.
//
// The scene drew into the top-left corner of the scene color at the render scale, and the scene
// color has the canvas's size. At the whole canvas's scale, each pixel reads the texel it covers.
// Below it, each pixel blends the four texels of the corner around its place, as a bilinear filter
// does, and so scales the corner up to the whole canvas, with no FXAA. It blends their display
// colors, after the tone mapping: a filter over HDR color would let a small share of a very bright
// texel turn its neighbors almost white.
//
// The scene color holds color multiplied by its coverage. Where it is only partly covered, as over
// a transparent canvas's background, the pass maps the color that covers it and keeps the coverage
// as the canvas's premultiplied alpha. WebGL2 keeps GL's row order, bottom row first, in the scene
// color and the canvas alike.
//
// The BLOOM build reads the base level of bloom's mip chain once, with a linear filter, and blends
// it into the scene color before the output transform: it mixes it in by the intensity, which keeps
// the image's light, or adds or screens it. Bloom is smooth, so a pixel reads it once at its own
// place, also where it blends four texels of the corner. Bloom adds coverage as its brightest
// channel, so it glows over a transparent canvas.
//
// While objects are outlined, the pass draws a crisp line around them from the outline mask, after
// the output transform: outside the objects, the highest coverage of the mask at 8 places on a
// circle of the line's width is the line's coverage, so the line has no blur and shows its colors,
// apart from the dither. The 8-bit path draws it the same way, because both paths hold display
// color there.
//
// The vignette multiplies HDR color before the tone mapping, as Filament, URP, Bevy and Babylon.js
// do, so bright corners darken as dark ones do instead of turning gray. The 8-bit path has no HDR
// color, so there the pass multiplies the linear value of the display color, before the outline.
//
// Last, the pass grades each pixel's display color with a color grading table while its flag is
// set, as three.js's LUTPass does after its OutputPass, then dithers it. The table is a 3D texture
// that maps a display color to its graded color, read with a linear filter. The dither comes after
// every other step, so no later step shrinks its noise below one step of the canvas. On the 8-bit
// path the scene shaders dithered already, and the pass dithers again only where it changes the
// color. Grading and the dither work on the color that a pixel's coverage divides out, and
// multiply it back after.
#import null3d::color::{limit_hdr, linear_to_srgb, srgb_to_linear}
#import null3d::tonemap

/// The settings flag that says the scene color holds display color.
const DISPLAY_COLOR: u32 = 1u;
/// The settings flag that turns the vignette on.
const VIGNETTE: u32 = 2u;
/// The settings flag that turns the color grading table on.
const LUT: u32 = 4u;
/// The settings flag that draws the outline's line.
const OUTLINE: u32 = 8u;

/// The pass's settings: the output settings, then the vignette's intensity, size, falloff and
/// roundness, then the scale and the offset that place a display color in the table, with the
/// table's intensity in the scale's last value, then the outline's display colors: the visible one
/// with the line's width in pixels of the canvas, then the hidden one with 1 where the line draws
/// around hidden parts.
struct Settings {
    output: null3d::tonemap::Output,
    vignette: vec4f,
    lut_scale: vec4f,
    lut_offset: vec4f,
    outline: vec4f,
    outline_hidden: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var scene_color: texture_2d<f32>;
@group(0) @binding(9) var lut: texture_3d<f32>;
@group(0) @binding(10) var lut_sampler: sampler;
@group(0) @binding(11) var outline_mask: texture_2d<f32>;

/// Where a texture of `size` texels that a pass drew at the render size halved `halvings` times
/// holds `uv`, a place on the drawn corner from 0 to 1. The place stays within that corner's texel
/// centers.
fn level_uv(size: vec2u, halvings: u32, uv: vec2f, render: vec2f) -> vec2f {
    let extent = vec2f(size);
    let corner = ceil(render / f32(1u << halvings));
#ifdef WEBGL2
    // WebGL2 counts rows from the bottom, and draws a corner into its target's top rows.
    let origin = vec2f(0.0, extent.y - corner.y);
#else
    let origin = vec2f(0.0);
#endif
    return (origin + clamp(uv * corner, vec2f(0.5), corner - 0.5)) / extent;
}

/// The outline mask at `uv` on the drawn corner, read with a linear filter: coverage in red, and
/// in green the parts that nothing hides.
fn mask_at(uv: vec2f, render: vec2f) -> vec2f {
    let at = level_uv(textureDimensions(outline_mask), 0u, uv, render);
    return textureSampleLevel(outline_mask, lut_sampler, at, 0.0).rg;
}

/// Canvas color `color`, multiplied by its coverage, with the outline's line painted over it at
/// `uv`, the pixel's place on the drawn corner, on a canvas of `size` pixels. The reads keep the
/// highest coverage and the highest visible coverage that they find. While the flag is clear, or
/// inside an object, the color stays as it is.
fn outlined(color: vec4f, uv: vec2f, size: vec2f, render: vec2f) -> vec4f {
    if (settings.output.flags & OUTLINE) == 0u {
        return color;
    }
    let inside = mask_at(uv, render).r;
    if inside >= 1.0 {
        return color;
    }
    let across = vec2f(settings.outline.w / size.x, 0.0);
    let down = vec2f(0.0, settings.outline.w / size.y);
    let diagonal = (across + down) * 0.70710678;
    let slant = (across - down) * 0.70710678;
    var found = max(mask_at(uv + across, render), mask_at(uv - across, render));
    found = max(found, max(mask_at(uv + down, render), mask_at(uv - down, render)));
    found = max(found, max(mask_at(uv + diagonal, render), mask_at(uv - diagonal, render)));
    found = max(found, max(mask_at(uv + slant, render), mask_at(uv - slant, render)));
    let line = max(found.g, found.r * settings.outline_hidden.w) * (1.0 - inside);
    if line <= 0.0 {
        return color;
    }
    // Green never exceeds red in the mask, so the share of visible coverage runs from 0 to 1.
    let shown = found.g / max(found.r, 0.0001);
    let line_color = mix(settings.outline_hidden.rgb, settings.outline.rgb, shown);
    return color * (1.0 - line) + vec4f(line_color, 1.0) * line;
}

#ifdef BLOOM
/// Bloom's settings: in xy the base level's drawn corner in texels, in z the intensity, and in w
/// the blend: 0 mixes, 1 adds, 2 screens.
struct Bloom {
    glow: vec4f,
}

@group(0) @binding(2) var<uniform> bloom: Bloom;
@group(0) @binding(3) var bloom_base: texture_2d<f32>;
@group(0) @binding(8) var bloom_sampler: sampler;

/// The glow at `uv` on the drawn corner, times the intensity, with its coverage. The base level
/// covers the whole image in its own drawn corner.
fn glow(uv: vec2f) -> vec4f {
    let extent = vec2f(textureDimensions(bloom_base));
    let corner = bloom.glow.xy;
#ifdef WEBGL2
    // WebGL2 counts rows from the bottom, and draws a corner into its target's top rows.
    let origin = vec2f(0.0, extent.y - corner.y);
#else
    let origin = vec2f(0.0);
#endif
    let at = (origin + clamp(uv * corner, vec2f(0.5), corner - 0.5)) / extent;
    let light = bloom.glow.z * textureSampleLevel(bloom_base, bloom_sampler, at, 0.0).rgb;
    return vec4f(light, max(light.r, max(light.g, light.b)));
}

/// Scene color `texel` with the glow `light` blended in: mixed, which moves the color toward the
/// glow by the intensity, added, or screened as pmndrs's SCREEN blend does.
fn with_glow(texel: vec4f, light: vec4f) -> vec4f {
    if bloom.glow.w > 1.5 {
        let screened = texel.rgb + light.rgb - min(texel.rgb * light.rgb, vec3f(1.0));
        return vec4f(screened, max(texel.a, light.a));
    }
    if bloom.glow.w > 0.5 {
        return texel + light;
    }
    return vec4f(texel.rgb * (1.0 - bloom.glow.z) + light.rgb, max(texel.a, light.a));
}
#else
fn glow(uv: vec2f) -> vec4f {
    return vec4f(0.0);
}

fn with_glow(texel: vec4f, light: vec4f) -> vec4f {
    return texel;
}
#endif

/// True when the scene color holds display color, on the 8-bit path.
fn display_color() -> bool {
    return (settings.output.flags & DISPLAY_COLOR) != 0u;
}

/// The vignette's factor at canvas pixel `position` of a canvas of `size` pixels: 1 at the center,
/// falling toward the edges by the intensity. The place from the center is scaled by the size, and
/// across by the canvas's shape as the roundness sets it: 0 follows the canvas, 1 makes a circle.
/// The factor is 1 everywhere while the flag is clear.
fn vignette(position: vec2f, size: vec2f) -> f32 {
    if (settings.output.flags & VIGNETTE) == 0u {
        return 1.0;
    }
    let shape = settings.vignette;
    var d = (position / size - 0.5) * shape.y;
    d.x *= mix(1.0, size.x / size.y, shape.w);
    // The smallest value keeps the power's logarithm finite at the edges, on every GPU.
    let light = pow(max(1.0 - dot(d, d), 1e-6), shape.z);
    return max(mix(1.0 - shape.x, 1.0, light), 0.0);
}

/// Scene color `texel` darkened by the vignette's factor `shade` where it holds HDR color. Display
/// color stays as it is, and `shaded_display` darkens it.
fn shaded(texel: vec4f, shade: f32) -> vec4f {
    return vec4f(texel.rgb * select(shade, 1.0, display_color()), texel.a);
}

/// Canvas color `color`, multiplied by its coverage, darkened by the vignette's factor `shade` on
/// the 8-bit path: the linear value of its display color times the factor. The HDR path's color
/// stays as it is, because `shaded` darkened it.
fn shaded_display(color: vec4f, shade: f32) -> vec4f {
    if !display_color() || shade >= 1.0 || color.a <= 0.0 {
        return color;
    }
    let c = linear_to_srgb(srgb_to_linear(color.rgb / color.a) * shade);
    return vec4f(c * color.a, color.a);
}

/// The scene color's texel at `pixel`, no brighter than a 16-bit float holds. The scene shaders
/// write no brighter color, but additive blending can add past it, and some GPUs store the sum as
/// infinity, which the tone mapping curves would turn into black.
fn scene_texel(pixel: vec2i) -> vec4f {
    let texel = textureLoad(scene_color, pixel, 0);
    return vec4f(limit_hdr(texel.rgb), texel.a);
}

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

/// HDR color squeezed below 1: exposed luminance l becomes l / (1 + l). Display color stays as it
/// is.
fn squeeze(texel: vec4f) -> vec4f {
    if display_color() {
        return texel;
    }
    return vec4f(texel.rgb / (1.0 + dot(texel.rgb, LUMINANCE)), texel.a);
}

/// Undoes `squeeze`.
fn unsqueeze(c: vec4f) -> vec4f {
    if display_color() {
        return c;
    }
    let squeezed = min(dot(c.rgb, LUMINANCE), 0.999);
    return vec4f(c.rgb / (1.0 - squeezed), c.a);
}

/// The squeezed texel at `pixel`, clamped inside the scene color, whose last texel is `last`.
fn texel_at(pixel: vec2i, last: vec2i) -> vec4f {
    return squeeze(scene_texel(clamp(pixel, vec2i(0), last)));
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

/// The brightness that FXAA compares, from 0 to 1 as the eye sees it. Squeezed HDR color takes a
/// square root, near the sRGB curve.
fn luma(c: vec4f) -> f32 {
    let y = dot(c.rgb, LUMINANCE);
    return select(sqrt(y), y, display_color());
}

/// The scene color of the pixel at `position`, smoothed along the edge that crosses it.
fn pixel_color(position: vec2f) -> vec4f {
    let last = vec2i(textureDimensions(scene_color)) - 1;
    let pixel = vec2i(position);
    let texel = scene_texel(pixel);
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
    return scene_texel(vec2i(position));
}
#endif

/// Scene color `texel` as the canvas shows it before the dither: tone mapped and encoded, and
/// multiplied by its coverage. Display color stays as it is.
fn display(texel: vec4f) -> vec4f {
    if (settings.output.flags & DISPLAY_COLOR) != 0u {
        return texel;
    }
    // Additive blending adds coverage too, past 1 over a covered pixel, which covers it whole.
    let coverage = min(texel.a, 1.0);
    if coverage <= 0.0 {
        return vec4f(0.0);
    }
    let mapped = null3d::tonemap::tone_map(texel.rgb / coverage, settings.output);
    let encoded = saturate(linear_to_srgb(mapped));
    return vec4f(encoded * coverage, coverage);
}

/// Canvas color `color`, multiplied by its coverage, as canvas pixel `position` shows it last:
/// graded by the color grading table, then dithered. The 8-bit path's color stays as it is while
/// the pass grades nothing.
fn finish(color: vec4f, position: vec2f) -> vec4f {
    let flags = settings.output.flags;
    let grades = (flags & (LUT | VIGNETTE)) != 0u;
    if (display_color() && !grades) || color.a <= 0.0 {
        return color;
    }
    var c = color.rgb / color.a;
    if (flags & LUT) != 0u {
        let at = c * settings.lut_scale.xyz + settings.lut_offset.xyz;
        let graded = textureSampleLevel(lut, lut_sampler, at, 0.0).rgb;
        c = mix(c, graded, settings.lut_scale.w);
    }
    c = saturate(c + null3d::tonemap::dither(position));
    return vec4f(c * color.a, color.a);
}

/// The texel of a place in the drawn corner, counted from the corner's top-left.
fn corner_texel(place: vec2f, size: vec2f) -> vec2i {
#ifdef WEBGL2
    return vec2i(i32(place.x), i32(size.y - 1.0 - place.y));
#else
    return vec2i(place);
#endif
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let size = vec2f(textureDimensions(scene_color));
    let packed = settings.output.render_size;
    let render = vec2f(f32(packed & 0xffffu), f32(packed >> 16u));
    let whole = all(render == size);
    // The pixel's place on the drawn corner, from 0 to 1 in the rows' own order, which every
    // target of the frame shares.
    let uv = position.xy / size;
    let light = glow(uv);
    let shade = vignette(position.xy, size);
    var color = vec4f(0.0);
    if whole {
        color = display(shaded(with_glow(pixel_color(position.xy), light), shade));
    }
#ifdef WEBGL2
    let from_top = vec2f(position.x, size.y - position.y);
#else
    let from_top = position.xy;
#endif
    // The pixel's place in the corner, in texels from the center of its top-left texel. It stays
    // within the corner's texel centers, so no tap reads past the corner.
    let place = clamp(from_top / size * render - 0.5, vec2f(0.0), render - 1.0);
    let first = floor(place);
    let share = place - first;
    // The taps run in a loop of no rounds at the whole canvas's scale, not on one side of a branch.
    // A software GPU, such as CI's, runs both sides of a branch for every group of pixels, but
    // skips a loop that none of them enters. So the whole canvas costs what it would cost alone.
    let taps = select(4u, 0u, whole);
    for (var tap = 0u; tap < taps; tap++) {
        let corner = vec2f(f32(tap & 1u), f32(tap >> 1u));
        let weights = mix(1.0 - share, share, corner);
        let texel = corner_texel(min(first + corner, render - 1.0), size);
        let texel_color = with_glow(scene_texel(texel), light);
        color += weights.x * weights.y * display(shaded(texel_color, shade));
    }
    return finish(outlined(shaded_display(color, shade), uv, size, render), position.xy);
}
