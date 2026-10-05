#define_import_path null3d::tonemap
#ifdef HALF
#import null3d::half::{linear_to_srgb, tone_map_aces, tone_map_agx, tone_map_neutral}
#else
#import null3d::color::{linear_to_srgb, tone_map_aces, tone_map_agx, tone_map_neutral}
#endif
#import null3d::color::{limit_hdr}
#import null3d::noise

// The output transform: tone mapping, sRGB encoding and dithering. The final pass applies it to
// the scene color. On the 8-bit path each fragment shader applies it itself. The tone mapping
// curves come from the color module, which follows three.js's formulas, so a scene looks as it does
// in three.js with the same curve and exposure. The HALF builds take the curves and the sRGB
// encoding from the half precision module instead.
//
// The scene's color is exposed color: the exposure scales each light where it starts, not the
// scene color at the end. The core multiplies it into the frame's lights, its fog color and its
// background color, and scene shaders multiply `Output.exposure` into the colors that come from
// materials and textures. Everything before the tone mapping is linear, so the picture is the same,
// and scenes in real units stay in the range of a 16-bit float.

/// Tone mapping codes, as the core and the TypeScript API number them.
const ACES: u32 = 0u;
const AGX: u32 = 1u;
const NEUTRAL: u32 = 2u;
const NONE: u32 = 3u;

/// How the output maps scene color to the display: the exposure, which scene shaders multiply into
/// the colors of materials and textures, and the tone mapping, by code. Only the final pass reads
/// the last two words: its flags, and the size the scene drew at in pixels, the width in the low
/// 16 bits and the height in the high 16. The final pass's exposure is 1, and it reads none.
struct Output {
    exposure: f32,
    tone_mapping: u32,
    flags: u32,
    render_size: u32,
}

/// Exposed linear scene color after the tone mapping: linear color from 0 to 1. Without tone
/// mapping, the exposed color is clipped at 1, as three.js's LinearToneMapping does.
fn tone_map(exposed: vec3f, settings: Output) -> vec3f {
    if settings.tone_mapping == AGX {
        return tone_map_agx(exposed);
    }
    if settings.tone_mapping == NEUTRAL {
        return tone_map_neutral(exposed);
    }
    if settings.tone_mapping == NONE {
        return saturate(exposed);
    }
    return tone_map_aces(exposed);
}

/// A value from 0 to 1 that looks random from pixel to pixel, and stays the same for a pixel on
/// every frame: a hash of the pixel's column and row.
fn pixel_noise(pixel: vec2f) -> f32 {
    let hash = null3d::noise::pcg(u32(pixel.x) + null3d::noise::pcg(u32(pixel.y)));
    return null3d::noise::to_unit(hash);
}

/// Encodes linear color from 0 to 1 as sRGB for an 8-bit target, and dithers it by up to half a
/// step of that target, so smooth gradients show no bands. A color that the target holds exactly
/// keeps its value.
fn encode(c: vec3f, pixel: vec2f) -> vec3f {
    let dither = (pixel_noise(pixel) - 0.5) / 255.0;
    return linear_to_srgb(c) + dither;
}

/// The color that a scene shader writes for exposed linear color `c` at framebuffer position
/// `pixel`: `c` itself into the HDR scene color, which the final pass tone maps, or on the 8-bit
/// path (the TONE_MAP builds), `c` after the output transform that `settings` sets, encoded for
/// the canvas. The HDR scene color takes `c` no brighter than the 16-bit float target holds.
fn finish(c: vec3f, pixel: vec2f, settings: Output) -> vec4f {
#ifdef TONE_MAP
    return vec4f(encode(tone_map(c, settings), pixel), 1.0);
#else
    return vec4f(limit_hdr(c), 1.0);
#endif
}
