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
// A frame below the whole canvas's scale may instead draw in two steps. The first build, whose
// settings hold RESOLVE, draws one texel for each render pixel into a target of the render size,
// with FXAA, and leaves the dither to the second. The second build reads that target as display
// color and scales it up as the pass above does.
//
// The second build sharpens its display color, at the whole canvas's scale as well, while the
// sketch asks for it: FidelityFX's RCAS over the four texels that cross each pixel, after the
// output transform and the upscale, and before the color table, the outline and the dither. At the
// whole canvas's scale a sketch that sharpens draws the two steps, so one output transform runs
// for each pixel and the sharpening reads display color.
//
// Only the UPSCALE build holds the upscale and the sharpening, and only the second step draws it.
// Every other build reads the texel under each pixel. A software GPU, such
// as CI's, pays in every frame for the code of a loop that no pixel enters: S1 drew four to six
// times faster on it without the two loops (decision record D-236).
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
// A custom tone curve takes the place of the built-in ones: the shader compiler adds its WGSL,
// `fn toneCurve(color: vec3f) -> vec3f`, after this file's last line, and builds every variant with
// the shader def CUSTOM_TONE_CURVE. The pass clamps what the curve returns to 0 to 1.
//
// The EFFECT_CHAIN builds host the custom effects that fold into the final pass: the last group of
// effects, when nothing reads the image between them and the final pass (see `effect_group.wgsl`).
// The engine makes a fold's shader at run time from such a build and the effects' pieces: it puts
// the pieces before `effect_chain` and writes in its place a chain that calls them in order. Each
// pixel then reads its scene color through the chain before the vignette and the tone mapping. A
// custom tone curve folds the same way, through `tone_curve_hook`. The engine folds only without
// FXAA and bloom, and at the whole canvas's scale, where each pixel reads the one texel it covers;
// below it, the chain would run on each of the four texels that a pixel blends.
//
// The vignette multiplies HDR color before the tone mapping, as Filament, URP, Bevy and Babylon.js
// do, so bright corners darken as dark ones do instead of turning gray. On the 8-bit path the scene
// shaders darken their light by it before their tone mapping, and the pass applies none.
//
// With automatic exposure, the pass multiplies the HDR color by the exposure that the meter wrote
// into one texel this frame: the scene's texels, the folded effects' output and bloom's glow, each
// before they meet. FXAA, the vignette and the tone mapping then see the adapted color. The flag
// is clear on the 8-bit path, and the texel's read is skipped while it is clear.
//
// Last, the pass grades each pixel's display color with a color grading table while its flag is
// set, as three.js's LUTPass does after its OutputPass, then dithers it. The table is a 3D texture
// that maps a display color to its graded color, read with a linear filter. The dither comes after
// every other step, so no later step shrinks its noise below one step of the canvas. On the 8-bit
// path the scene shaders dithered already, and the pass dithers again only where it changes the
// color. Grading and the dither work on the color that a pixel's coverage divides out, and
// multiply it back after.
#import null3d::fullscreen::{triangle}
#import null3d::color::{limit_hdr, linear_to_srgb}
#import null3d::grade::{logc_encode_rgb}
#import null3d::tonemap

/// The settings flag that says the scene color holds display color.
const DISPLAY_COLOR: u32 = 1u;
/// The settings flag that turns the vignette on.
const VIGNETTE: u32 = 2u;
/// The settings flag that turns the color grading table on.
const LUT: u32 = 4u;
/// The settings flag that grades the display color with the built-in grading table.
const GRADE: u32 = 256u;
/// The settings flag that skips the tone curve where the mask marks a surface that keeps its color
/// as the display shows it.
const UNMAPPED: u32 = 512u;
/// The settings flag that grades high dynamic range light with the built-in table before the tone
/// curve.
const GRADE_HDR: u32 = 1024u;

/// The settings flag that draws the outline's line.
const OUTLINE: u32 = 8u;
/// The settings flag that multiplies the HDR color by the automatic exposure's texel.
const AUTO_EXPOSURE: u32 = 16u;
/// The settings flag that says the pass is the first of two steps below the whole canvas's render
/// scale: it draws one texel for each render pixel into a target of the render size, so its frame
/// is the render size and it leaves the dither to the second step.
const RESOLVE: u32 = 32u;
/// The settings flag that makes the pass dither even where it holds display color. The second step
/// sets it when the first step's target came from high dynamic range color, since that path would
/// otherwise dither in the first step.
const DITHER: u32 = 64u;
/// The settings flag that sharpens the display color at the whole canvas's render scale. The second
/// step sets it while the sketch asks for sharpening.
const SHARPEN: u32 = 128u;
/// GSR 1's constants: the edge vote's threshold, the tap's weight, the sharpness, and the most the
/// sharpening may move a pixel from its bilinear color.
const GSR_EDGE: f32 = 8.0 / 255.0;
const GSR_TAP: f32 = 0.55;
const GSR_SHARPNESS: f32 = 2.0;
const GSR_DELTA_LIMIT: f32 = 23.0 / 255.0;
/// The least that a value which divides may take, so no division reads a zero or a subnormal on a
/// device that keeps a shader's values at half precision.
const RCAS_LEAST: f32 = 0.0001;
/// The most influence that RCAS's lobe takes at an edge, as FidelityFX limits it.
const RCAS_LIMIT: f32 = 0.25 - (1.0 / 16.0);
/// The texels along each side of the built-in grading table, and the scale and the offset that
/// place a color in it: the domain's ends land on the centers of the first and last texels.
const GRADE_SIZE: f32 = 32.0;
const GRADE_SCALE: f32 = 1.0 - 1.0 / GRADE_SIZE;
const GRADE_OFFSET: f32 = 0.5 / GRADE_SIZE;

/// The pass's settings: the output settings, then the vignette's intensity, size, falloff and
/// roundness, then the scale and the offset that place a display color in the table, with the
/// table's intensity in the scale's last value, then the outline's display colors: the visible one
/// with the line's width in pixels of the canvas, then the hidden one with 1 where the line draws
/// around hidden parts, then the sharpening's strength and three spare values.
struct Settings {
    output: null3d::tonemap::Output,
    vignette: vec4f,
    lut_scale: vec4f,
    lut_offset: vec4f,
    outline: vec4f,
    outline_hidden: vec4f,
    sharpen: vec4f,
}

@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var scene_color: texture_2d<f32>;
@group(0) @binding(9) var lut: texture_3d<f32>;
@group(0) @binding(10) var lut_sampler: sampler;
@group(0) @binding(11) var outline_mask: texture_2d<f32>;
@group(0) @binding(12) var exposure_texel: texture_2d<f32>;
@group(0) @binding(13) var grade_table: texture_3d<f32>;

/// The factor of the automatic exposure for this frame, or 1 while the flag is clear. The fragment
/// shader reads it once, at its start.
var<private> eye_factor: f32 = 1.0;

/// The automatic exposure's factor from its texel, or 1 while the flag is clear.
fn eye_exposure() -> f32 {
    return select(
        1.0,
        textureLoad(exposure_texel, vec2i(0), 0).x,
        (settings.output.flags & AUTO_EXPOSURE) != 0u,
    );
}

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

/// The share of the pixel at `uv` on the drawn corner whose surface keeps its color as the display
/// shows it, from the mask's blue channel. It reads nothing while the flag is clear.
fn unmapped_at(uv: vec2f, render: vec2f) -> f32 {
    if (settings.output.flags & UNMAPPED) == 0u {
        return 0.0;
    }
    let at = level_uv(textureDimensions(outline_mask), 0u, uv, render);
    return textureSampleLevel(outline_mask, lut_sampler, at, 0.0).b;
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
    let light = bloom.glow.z * eye_factor * textureSampleLevel(bloom_base, bloom_sampler, at, 0.0).rgb;
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

#ifdef EFFECT_CHAIN
/// What the engine writes for each effect, as `effect_group.wgsl` lays it out.
struct EffectBlock {
    size: vec4f,
    clock: vec4f,
    inverse_projection: mat4x4f,
    u0: vec4f,
    u1: vec4f,
    u2: vec4f,
    u3: vec4f,
    u4: vec4f,
    u5: vec4f,
    u6: vec4f,
    u7: vec4f,
    spare0: vec4f,
    spare1: vec4f,
}

/// Every effect's block, as `effect_group.wgsl` holds them.
struct EffectBlocks {
    blocks: array<EffectBlock, 8>,
}

@group(0) @binding(4) var<uniform> effect_blocks: EffectBlocks;
#ifdef EFFECT_DEPTH
#ifdef DEPTH_MULTISAMPLED
@group(0) @binding(5) var effect_depth_texture: texture_multisampled_2d<f32>;
#else
@group(0) @binding(5) var effect_depth_texture: texture_2d<f32>;
#endif
#endif

/// What an effect reads for each pixel, as `effect_group.wgsl` declares it.
struct EffectInput {
    color: vec4f,
    uv: vec2f,
    pixel: vec2f,
    size: vec2f,
    time: f32,
}

/// Vector `part` of the uniforms in the block at `slot`.
fn effect_value_at(slot: u32, part: u32) -> vec4f {
    let block = effect_blocks.blocks[slot];
    switch part {
        case 0u: { return block.u0; }
        case 1u: { return block.u1; }
        case 2u: { return block.u2; }
        case 3u: { return block.u3; }
        case 4u: { return block.u4; }
        case 5u: { return block.u5; }
        case 6u: { return block.u6; }
        default: { return block.u7; }
    }
}

/// The texel of the scene color that holds the image's pixel `pixel`, counted from the top left.
fn effect_texel(pixel: vec2i) -> vec2i {
    let last = vec2i(effect_blocks.blocks[0].size.xy) - 1;
    let inside = clamp(pixel, vec2i(0), last);
#ifdef WEBGL2
    return vec2i(inside.x, i32(effect_blocks.blocks[0].size.w) - 1 - inside.y);
#else
    return inside;
#endif
}

/// The scene color of the image's pixel `pixel`, counted from the top left.
fn effectPixel(pixel: vec2i) -> vec4f {
    return textureLoad(scene_color, effect_texel(pixel), 0);
}

/// The place in a render pass's texture that holds the image's place `uv`, from 0 at the top
/// left to 1 at the bottom right. A pass's texture keeps the image's bottom row first, as materials
/// sample it, so `v` turns around.
fn effectPassUv(uv: vec2f) -> vec2f {
    return vec2f(uv.x, 1.0 - uv.y);
}

/// The input image's size in pixels: the render size. An effect's own pixels have this size too;
/// a full-screen pass's may differ.
fn effectInputSize() -> vec2f {
    return effect_blocks.blocks[0].size.xy;
}

/// The scene color at `uv` on the image, read with a linear filter.
fn effectColor(uv: vec2f) -> vec4f {
    let render = effect_blocks.blocks[0].size.xy;
    var at = clamp(uv * render, vec2f(0.5), render - 0.5);
#ifdef WEBGL2
    at.y = effect_blocks.blocks[0].size.w - at.y;
#endif
    return textureSampleLevel(scene_color, lut_sampler, at / effect_blocks.blocks[0].size.zw, 0.0);
}

#ifdef EFFECT_DEPTH
/// The scene's depth at `uv`, as `effect_group.wgsl` reads it.
fn effectDepth(uv: vec2f) -> f32 {
    let pixel = vec2i(floor(uv * effect_blocks.blocks[0].size.xy));
    return textureLoad(effect_depth_texture, effect_texel(pixel), 0).x;
}

/// The view-space position of the surface at `uv`.
fn effectViewPosition(uv: vec2f) -> vec3f {
    let clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, effectDepth(uv), 1.0);
    let p = effect_blocks.blocks[0].inverse_projection * clip;
    return p.xyz / p.w;
}

/// The distance in front of the camera of the surface at `uv`, in world units.
fn effectDistance(uv: vec2f) -> f32 {
    return -effectViewPosition(uv).z;
}
#endif

/// The folded effects, one after another. The engine writes its own chain in this function's
/// place; a piece's build calls the piece once, from the first block.
fn effect_chain(input: EffectInput) -> vec4f {
#ifdef EFFECT_PIECE
    return effect_piece_run(input, 0u);
#else
    return input.color;
#endif
}

/// The tone curve. The engine writes a folded custom curve in this function's place; without one,
/// it is the built-in curve.
fn tone_curve_hook(color: vec3f) -> vec3f {
#ifdef EFFECT_PIECE_CURVE
    return saturate(effect_piece_curve(color));
#else
    return null3d::tonemap::tone_map(color, settings.output);
#endif
}

/// The scene color's texel at `texel` after the folded effects and the automatic exposure, no
/// brighter than a 16-bit float holds, as `scene_texel` reads it.
fn effected_texel(texel: vec2i) -> vec4f {
    let first = effect_blocks.blocks[0];
    let position = vec2f(texel) + 0.5;
#ifdef WEBGL2
    let from_top = vec2f(position.x, first.size.w - position.y);
#else
    let from_top = position;
#endif
    var input: EffectInput;
    input.color = textureLoad(scene_color, texel, 0);
    input.size = first.size.xy;
    input.pixel = from_top;
    input.uv = from_top / first.size.xy;
    input.time = first.clock.x;
    let color = effect_chain(input);
    return vec4f(limit_hdr(color.rgb * eye_factor), color.a);
}
#endif

/// True when the scene color holds display color, on the 8-bit path.
fn display_color() -> bool {
    return (settings.output.flags & DISPLAY_COLOR) != 0u;
}

/// The vignette's factor at canvas pixel `position` of a canvas of `size` pixels, on the HDR path:
/// see `null3d::tonemap::vignette`. The factor is 1 everywhere while the flag is clear, as on the
/// 8-bit path, whose scene shaders apply the vignette.
fn vignette(position: vec2f, size: vec2f) -> f32 {
    if (settings.output.flags & VIGNETTE) == 0u {
        return 1.0;
    }
    return null3d::tonemap::vignette(position, size, settings.vignette);
}

/// Scene color `texel` darkened by the vignette's factor `shade`.
fn shaded(texel: vec4f, shade: f32) -> vec4f {
    return vec4f(texel.rgb * shade, texel.a);
}

/// The scene color's texel at `pixel` after the automatic exposure, no brighter than a 16-bit
/// float holds. The scene shaders write no brighter color, but additive blending can add past it,
/// and some GPUs store the sum as infinity, which the tone mapping curves would turn into black.
fn scene_texel(pixel: vec2i) -> vec4f {
    let texel = textureLoad(scene_color, pixel, 0);
    return vec4f(limit_hdr(texel.rgb * eye_factor), texel.a);
}

@vertex
fn vs(@builtin(vertex_index) vertex: u32) -> @builtin(position) vec4f {
    return triangle(vertex);
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

/// The squeezed texel at `pixel`, clamped inside the drawn corner, whose first texel is `first` and
/// last is `last`.
fn texel_at(pixel: vec2i, first: vec2i, last: vec2i) -> vec4f {
    return squeeze(scene_texel(clamp(pixel, first, last)));
}

/// The squeezed color at a point in pixels, filtered between its four nearest texels.
fn tap(point: vec2f, first: vec2i, last: vec2i) -> vec4f {
    let corner = point - 0.5;
    let base = vec2i(floor(corner));
    let f = fract(corner);
    let top = mix(texel_at(base, first, last), texel_at(base + vec2i(1, 0), first, last), f.x);
    let bottom = mix(
        texel_at(base + vec2i(0, 1), first, last),
        texel_at(base + vec2i(1, 1), first, last),
        f.x,
    );
    return mix(top, bottom, f.y);
}

/// The brightness that FXAA compares, from 0 to 1 as the eye sees it. Squeezed HDR color takes a
/// square root, near the sRGB curve.
fn luma(c: vec4f) -> f32 {
    let y = dot(c.rgb, LUMINANCE);
    return select(sqrt(y), y, display_color());
}

/// The scene color of the pixel at `position`, smoothed along the edge that crosses it. The taps
/// stay inside the drawn corner's texels, `first` to `last`: below the whole canvas's scale the
/// scene drew one corner of the scene color only, and a tap past the corner would read another
/// frame's pixels or the clear color.
fn pixel_color(position: vec2f, first: vec2i, last: vec2i) -> vec4f {
    let pixel = vec2i(position);
    let texel = scene_texel(pixel);
    let m = luma(squeeze(texel));
    let nw = luma(texel_at(pixel + vec2i(-1, -1), first, last));
    let ne = luma(texel_at(pixel + vec2i(1, -1), first, last));
    let sw = luma(texel_at(pixel + vec2i(-1, 1), first, last));
    let se = luma(texel_at(pixel + vec2i(1, 1), first, last));
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
    let inner = 0.5
        * (tap(position - span / 6.0, first, last) + tap(position + span / 6.0, first, last));
    let outer = 0.5 * inner
        + 0.25
            * (tap(position - span * 0.5, first, last) + tap(position + span * 0.5, first, last));
    // The wider blend crossed another edge where it leaves the taps' brightness range.
    let outer_luma = luma(outer);
    return unsqueeze(select(outer, inner, outer_luma < lowest || outer_luma > highest));
}
#else
/// The scene color of the pixel at `position`, after the folded effects.
fn pixel_color(position: vec2f) -> vec4f {
#ifdef EFFECT_CHAIN
    return effected_texel(vec2i(position));
#else
    return scene_texel(vec2i(position));
#endif
}
#endif

/// Scene color `texel` at `uv` on the drawn corner as the canvas shows it before the dither: tone
/// mapped and encoded, and multiplied by its coverage. Display color stays as it is, and so does
/// the color of a surface that the tone mask marks, which skips the curve.
fn display(texel: vec4f, uv: vec2f, render: vec2f) -> vec4f {
    let flags = settings.output.flags;
    if (flags & DISPLAY_COLOR) != 0u {
        return texel;
    }
    // Additive blending adds coverage too, past 1 over a covered pixel, which covers it whole.
    let coverage = min(texel.a, 1.0);
    if coverage <= 0.0 {
        return vec4f(0.0);
    }
    let exposed = texel.rgb / coverage;
    // The table over high dynamic range light holds the grade before the curve. The curve stays
    // here, exact: a 32-texel table cannot hold a punchy curve that clamps each channel at black,
    // so the pass reads the graded light and maps it as it maps any light.
    var light = exposed;
    if (flags & GRADE_HDR) != 0u {
        let at = saturate(logc_encode_rgb(exposed)) * GRADE_SCALE + GRADE_OFFSET;
        light = max(textureSampleLevel(grade_table, lut_sampler, at, 0.0).rgb, vec3f(0.0));
    }
#ifdef CUSTOM_TONE_CURVE
    let mapped = saturate(toneCurve(light));
#else
#ifdef EFFECT_CHAIN
    let mapped = tone_curve_hook(light);
#else
    let mapped = null3d::tonemap::tone_map(light, settings.output);
#endif
#endif
    // The mask's fraction mixes a surface that keeps its display color with one that takes the
    // curve, which keeps the edges of a marked surface anti-aliased.
    let shown = mix(mapped, saturate(exposed), unmapped_at(uv, render));
    let encoded = saturate(linear_to_srgb(shown));
    return vec4f(encoded * coverage, coverage);
}

/// Canvas color `color`, multiplied by its coverage, as canvas pixel `position` shows it last:
/// graded by the color grading table, then dithered. The 8-bit path's color stays as it is while
/// the pass grades nothing.
fn finish(color: vec4f, position: vec2f) -> vec4f {
    let flags = settings.output.flags;
    let grades = (flags & (LUT | GRADE | GRADE_HDR | VIGNETTE)) != 0u;
    // A pass that holds display color and grades nothing leaves the color as it is, unless the
    // second step of the high dynamic range path asks for the dither (DITHER).
    if (display_color() && !grades && (flags & DITHER) == 0u) || color.a <= 0.0 {
        return color;
    }
    var c = color.rgb / color.a;
    if (flags & GRADE) != 0u {
        // The table's texels lie closer together toward black, where a grade's curve is steepest:
        // the lookup takes the color's square root first.
        let at = sqrt(saturate(c)) * GRADE_SCALE + GRADE_OFFSET;
        c = textureSampleLevel(grade_table, lut_sampler, at, 0.0).rgb;
    }
    if (flags & LUT) != 0u {
        let at = c * settings.lut_scale.xyz + settings.lut_offset.xyz;
        let graded = textureSampleLevel(lut, lut_sampler, at, 0.0).rgb;
        c = mix(c, graded, settings.lut_scale.w);
    }
    // The first of the two steps leaves the dither to the second, which runs at the canvas size.
    if (flags & RESOLVE) == 0u {
        c = saturate(c + null3d::tonemap::dither(position));
    }
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

/// The display color of a place in the drawn corner: what the pass reads there, with bloom's glow
/// and the vignette applied as they are to every texel that the pass blends.
fn corner_display(place: vec2f, render: vec2f, size: vec2f, light: vec4f, shade: f32) -> vec4f {
    let texel = corner_texel(clamp(place, vec2f(0.0), render - 1.0), size);
#ifdef EFFECT_CHAIN
    // The engine folds effects at the whole canvas's scale. A frame below it, before the engine
    // stops folding, still runs the effects on each texel that the pixel blends.
    let texel_color = with_glow(effected_texel(texel), light);
#else
    let texel_color = with_glow(scene_texel(texel), light);
#endif
    return display(shaded(texel_color, shade), place / render, render);
}

/// GSR 1's window over a tap's distance, after Qualcomm's fast Lanczos 2.
fn gsr_lanczos(x: f32) -> f32 {
    var a = x - 4.0;
    let b = x * a - a;
    a *= a;
    return b * a;
}

/// The brightness that RCAS compares, which weighs green most.
fn rcas_luma(c: vec4f) -> f32 {
    return c.b * 0.5 + (c.r * 0.5 + c.g);
}

/// Display color `color` of the texel at `centre`, sharpened by FidelityFX's RCAS over the four
/// texels that cross it. The lobe grows where the ring around the pixel is an edge and shrinks
/// where it is noise, and `strength`, from 0 to 1, scales it. The weights always sum to one, so a
/// flat area keeps its color. Coverage stays as it is.
fn sharpened(
    color: vec4f,
    centre: vec2f,
    render: vec2f,
    size: vec2f,
    light: vec4f,
    shade: f32,
    strength: f32,
) -> vec4f {
    let up = corner_display(centre + vec2f(0.0, -1.0), render, size, light, shade);
    let down = corner_display(centre + vec2f(0.0, 1.0), render, size, light, shade);
    let left = corner_display(centre + vec2f(-1.0, 0.0), render, size, light, shade);
    let right = corner_display(centre + vec2f(1.0, 0.0), render, size, light, shade);
    let here = rcas_luma(color);
    let above = rcas_luma(up);
    let below = rcas_luma(down);
    let before = rcas_luma(left);
    let after = rcas_luma(right);
    // How far the ring's mean sits from the pixel, against the block's spread: noise keeps it
    // small, and the sharpening then stays back.
    let ring = (above + below + before + after) * 0.25 - here;
    let highest = max(max(max(max(above, below), max(before, after)), here), RCAS_LEAST);
    let lowest = min(min(min(min(above, below), min(before, after)), here), RCAS_LEAST);
    let noise = 1.0 - 0.5 * clamp(abs(ring) / max(highest - lowest, RCAS_LEAST), 0.0, 1.0);
    // The room that each channel has before it would clip, on the side that the ring pushes the
    // color toward. A denominator near zero keeps its sign, so no division reads zero.
    let low4 = min(min(up.rgb, down.rgb), min(left.rgb, right.rgb));
    let high4 = max(max(up.rgb, down.rgb), max(left.rgb, right.rgb));
    let toward_low = min(low4, color.rgb) / max(vec3f(4.0) * high4, vec3f(RCAS_LEAST));
    let room = vec3f(4.0) * low4 - vec3f(4.0);
    let sign_of_room = select(vec3f(-RCAS_LEAST), vec3f(RCAS_LEAST), room >= vec3f(0.0));
    let guarded_room = select(sign_of_room, room, abs(room) > vec3f(RCAS_LEAST));
    let toward_high = (vec3f(1.0) - max(high4, color.rgb)) / guarded_room;
    let most = max(vec3f(0.0) - toward_low, toward_high);
    let lobe = clamp(max(max(most.r, most.g), most.b), -RCAS_LIMIT, 0.0) * strength * noise;
    let scale = 1.0 / (4.0 * lobe + 1.0);
    let blended = lobe * (up.rgb + down.rgb + left.rgb + right.rgb) + color.rgb;
    return vec4f(saturate(blended * scale), color.a);
}

/// GSR 1's weight of one tap: the distance from the sharpened place, and the tap's color's distance
/// from the block's mean along the channel that votes.
fn gsr_weight(offset: vec2f, c: f32, spread: f32) -> vec2f {
    let x = dot(offset, offset) * GSR_TAP + clamp(abs(c) * spread, 0.0, 1.0);
    let w = gsr_lanczos(x);
    return vec2f(w, w * c);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
    eye_factor = eye_exposure();
    let packed = settings.output.render_size;
    let render = vec2f(f32(packed & 0xffffu), f32(packed >> 16u));
    // The first of the two steps draws one texel for each render pixel into a target of the render
    // size, so its frame is the render size. Every other build draws the canvas, so its frame is
    // the scene color's size, which is the canvas's.
    let resolving = (settings.output.flags & RESOLVE) != 0u;
    let scene = vec2f(textureDimensions(scene_color));
    // WebGL2 counts rows from the bottom and draws the render corner into the scene color's top
    // rows, so the first step's fragments start at that corner's own origin.
#ifdef WEBGL2
    let origin = select(vec2f(0.0), vec2f(0.0, scene.y - render.y), resolving);
#else
    let origin = vec2f(0.0);
#endif
    let local = position.xy - origin;
    let size = select(scene, render, resolving);
    let whole = all(render == size);
    // The pixel's place on the drawn corner, from 0 to 1 in the rows' own order, which every
    // target of the frame shares.
    let uv = local / size;
    let light = glow(uv);
    let shade = vignette(local, size);
    // The pixel's place in the corner, in texels from the center of its top-left texel. It stays
    // within the corner's texel centers, so no tap reads past the corner.
#ifdef WEBGL2
    let from_top = vec2f(position.x, size.y - position.y);
#else
    let from_top = position.xy;
#endif
    let place = clamp(from_top / size * render - 0.5, vec2f(0.0), render - 1.0);
    let first = floor(place);
    let share = place - first;
    var color = vec4f(0.0);
    if whole {
#ifdef FXAA
        // The drawn corner's first and last texels of the scene color, which the edge blend stays
        // inside: this step drew that corner only.
        let corner_first = vec2i(origin);
        let corner_last = vec2i(origin + render - 1.0);
        color = display(
            shaded(
                with_glow(pixel_color(position.xy, corner_first, corner_last), light),
                shade,
            ),
            uv,
            render,
        );
#else
        color = display(
            shaded(with_glow(pixel_color(position.xy), light), shade),
            uv,
            render,
        );
#endif
    }
#ifdef UPSCALE
    // At the whole canvas's scale the second step sharpens the display color that the first step
    // drew. Below it the upscale sharpens its own taps, so the value adds nothing there. The call
    // sits in a loop of no rounds while the sketch asks for no sharpening: a software GPU runs both
    // sides of a branch, so a plain test would still read the four texels that the sharpening needs.
    let sharpen_rounds = select(0u, 1u, whole && (settings.output.flags & SHARPEN) != 0u);
    for (var sharp_round = 0u; sharp_round < sharpen_rounds; sharp_round++) {
        color = sharpened(color, first, render, size, light, shade, settings.sharpen.x);
    }
    // The upscale runs in a loop of no rounds at the whole canvas's scale, so a software GPU, such
    // as CI's, skips its cost there. A phone's driver stalls while it links the form that indexes
    // arrays of vectors inside a loop, so the taps and the weights stay straight-line code inside
    // this one, and no array or index reaches the driver.
    let rounds = select(1u, 0u, whole);
    for (var round = 0u; round < rounds; round++) {
        // GSR 1 with every tap named. The offsets count corner rows from the top, and the four
        // nearest texels are this row and the one below it.
        let t0 = corner_display(first + vec2f(0.0, 2.0), render, size, light, shade);
        let t1 = corner_display(first + vec2f(1.0, 2.0), render, size, light, shade);
        let t2 = corner_display(first + vec2f(-1.0, 1.0), render, size, light, shade);
        let t3 = corner_display(first + vec2f(0.0, 1.0), render, size, light, shade);
        let t4 = corner_display(first + vec2f(1.0, 1.0), render, size, light, shade);
        let t5 = corner_display(first + vec2f(2.0, 1.0), render, size, light, shade);
        let t6 = corner_display(first + vec2f(-1.0, 0.0), render, size, light, shade);
        let t7 = corner_display(first, render, size, light, shade);
        let t8 = corner_display(first + vec2f(1.0, 0.0), render, size, light, shade);
        let t9 = corner_display(first + vec2f(2.0, 0.0), render, size, light, shade);
        let t10 = corner_display(first + vec2f(0.0, -1.0), render, size, light, shade);
        let t11 = corner_display(first + vec2f(1.0, -1.0), render, size, light, shade);
        // The bilinear blend of the four nearest texels, which stays the result where the edge vote
        // finds no edge, and the base that the sharpening corrects.
        let bilinear = mix(mix(t7, t8, share.x), mix(t3, t4, share.x), share.y);
        let vote = abs(t4.g - t3.g) + abs(bilinear.g - t3.g) + abs(bilinear.g - t4.g);
        if vote > GSR_EDGE {
            let mean = (t3.g + t4.g + t7.g + t8.g) * 0.25;
            let c00 = t3.g - mean;
            let c10 = t4.g - mean;
            let c01 = t7.g - mean;
            let c11 = t8.g - mean;
            let k0 = t0.g - mean;
            let k1 = t1.g - mean;
            let k2 = t2.g - mean;
            let k5 = t5.g - mean;
            let k6 = t6.g - mean;
            let k9 = t9.g - mean;
            let k10 = t10.g - mean;
            let k11 = t11.g - mean;
            let sum = abs(k0) + abs(k1) + abs(k2) + abs(c00) + abs(c10) + abs(k5) + abs(k6)
                + abs(c01) + abs(c11) + abs(k9) + abs(k10) + abs(k11);
            let spread = 2.181818 / max(sum, 0.0001);
            let weighted = gsr_weight(vec2f(0.0, 2.0) - share, k0, spread)
                + gsr_weight(vec2f(1.0, 2.0) - share, k1, spread)
                + gsr_weight(vec2f(-1.0, 1.0) - share, k2, spread)
                + gsr_weight(vec2f(0.0, 1.0) - share, c00, spread)
                + gsr_weight(vec2f(1.0, 1.0) - share, c10, spread)
                + gsr_weight(vec2f(2.0, 1.0) - share, k5, spread)
                + gsr_weight(vec2f(-1.0, 0.0) - share, k6, spread)
                + gsr_weight(vec2f(0.0, 0.0) - share, c01, spread)
                + gsr_weight(vec2f(1.0, 0.0) - share, c11, spread)
                + gsr_weight(vec2f(2.0, 0.0) - share, k9, spread)
                + gsr_weight(vec2f(0.0, -1.0) - share, k10, spread)
                + gsr_weight(vec2f(1.0, -1.0) - share, k11, spread);
            // The kernel's negative lobes can make the weight sum negative, and the average is still
            // the ratio; only an exactly zero sum needs a guard.
            let weight_sum = select(1e-6, weighted.x, abs(weighted.x) >= 1e-6);
            let final_y = weighted.y / weight_sum;
            // The bounds and the average live in the same mean-subtracted space.
            let max_y = max(max(c00, c10), max(c01, c11));
            let min_y = min(min(c00, c10), min(c01, c11));
            let sharpened = clamp(GSR_SHARPNESS * final_y, min_y, max_y);
            let delta = clamp(sharpened - (bilinear.g - mean), -GSR_DELTA_LIMIT, GSR_DELTA_LIMIT);
            color = vec4f(clamp(bilinear.rgb + vec3f(delta), vec3f(0.0), vec3f(1.0)), bilinear.a);
        } else {
            color = bilinear;
        }
    }
#endif
    return finish(outlined(color, uv, size, render), position.xy);
}
