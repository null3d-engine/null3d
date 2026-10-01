#define_import_path null3d::tonemap
#import null3d::color
#import null3d::noise

// The output transform: exposure, tone mapping, sRGB encoding and dithering. The final pass applies
// it to the scene color. On the 8-bit path each fragment shader applies it itself. The tone mapping
// curves come from the color module, which follows three.js's formulas, so a scene looks as it does
// in three.js with the same curve and exposure.

/// Tone mapping codes, as the core and the TypeScript API number them.
const ACES: u32 = 0u;
const AGX: u32 = 1u;
const NEUTRAL: u32 = 2u;
const NONE: u32 = 3u;

/// How the output maps scene color to the display: the exposure that scales the scene color, and
/// the tone mapping, by code. Only the final pass reads the last two words: its flags, and the
/// size the scene drew at in pixels, the width in the low 16 bits and the height in the high 16.
struct Output {
    exposure: f32,
    tone_mapping: u32,
    flags: u32,
    render_size: u32,
}

/// Linear scene color after the exposure and the tone mapping: linear color from 0 to 1. Without
/// tone mapping, the exposed color is clipped at 1, as three.js's LinearToneMapping does.
fn tone_map(c: vec3f, settings: Output) -> vec3f {
    let exposed = c * settings.exposure;
    if settings.tone_mapping == AGX {
        return null3d::color::tone_map_agx(exposed);
    }
    if settings.tone_mapping == NEUTRAL {
        return null3d::color::tone_map_neutral(exposed);
    }
    if settings.tone_mapping == NONE {
        return saturate(exposed);
    }
    return null3d::color::tone_map_aces(exposed);
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
    return null3d::color::linear_to_srgb(c) + dither;
}

/// The color that a scene shader writes for linear color `c` at framebuffer position `pixel`: `c`
/// itself into the HDR scene color, which the final pass tone maps, or on the 8-bit path (the
/// TONE_MAP builds), `c` after the output transform that `settings` sets, encoded for the canvas.
fn finish(c: vec3f, pixel: vec2f, settings: Output) -> vec4f {
#ifdef TONE_MAP
    return vec4f(encode(tone_map(c, settings), pixel), 1.0);
#else
    return vec4f(c, 1.0);
#endif
}
