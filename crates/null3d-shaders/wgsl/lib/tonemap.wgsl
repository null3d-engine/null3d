#define_import_path null3d::tonemap
#import null3d::color

// The output transform: exposure, tone mapping, sRGB encoding and dithering. The final pass applies
// it to the scene color. On the 8-bit path each fragment shader applies it itself. The tone mapping
// operators follow three.js's formulas (tonemapping_pars_fragment), so a scene looks as it does in
// three.js with the same operator and exposure.

/// Tone mapping codes, as the core and the TypeScript API number them.
const ACES: u32 = 0u;
const AGX: u32 = 1u;
const NEUTRAL: u32 = 2u;
const NONE: u32 = 3u;

/// How the output maps scene color to the display: the exposure that scales the scene color, and
/// the tone mapping, by code. The last two words are spare, so the block fills 16 bytes.
struct Output {
    exposure: f32,
    tone_mapping: u32,
    spare_a: u32,
    spare_b: u32,
}

// ACES filmic, as three.js's ACESFilmicToneMapping fits it. Each matrix is given by columns.

/// sRGB => XYZ => D65_2_D60 => AP1 => RRT_SAT.
const ACES_INPUT = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
);
/// ODT_SAT => XYZ => D60_2_D65 => sRGB.
const ACES_OUTPUT = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
);

/// The RRT and ODT curve fit.
fn rrt_and_odt_fit(v: vec3f) -> vec3f {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

/// ACES filmic tone mapping of exposed linear color. The scale of 1 / 0.6 suits a bright viewing
/// place, as in three.js.
fn aces(c: vec3f) -> vec3f {
    return saturate(ACES_OUTPUT * rrt_and_odt_fit(ACES_INPUT * (c / 0.6)));
}

// AgX, as three.js's AgXToneMapping implements it after Filament and Blender, in Rec. 2020
// primaries.

const LINEAR_REC2020_TO_LINEAR_SRGB = mat3x3f(
    vec3f(1.6605, -0.1246, -0.0182),
    vec3f(-0.5876, 1.1329, -0.1006),
    vec3f(-0.0728, -0.0083, 1.1187),
);
const LINEAR_SRGB_TO_LINEAR_REC2020 = mat3x3f(
    vec3f(0.6274, 0.0691, 0.0164),
    vec3f(0.3293, 0.9195, 0.0880),
    vec3f(0.0433, 0.0113, 0.8956),
);
const AGX_INSET = mat3x3f(
    vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859),
);
const AGX_OUTSET = mat3x3f(
    vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405),
);
/// The exposure range of the log encoding: log2(2^-10 * 0.18) to log2(2^6.5 * 0.18).
const AGX_MIN_EV: f32 = -12.47393;
const AGX_MAX_EV: f32 = 4.026069;

/// AgX's default contrast curve, as a polynomial.
fn agx_contrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2
        + 0.1191 * x - 0.00232;
}

/// AgX tone mapping of exposed linear color.
fn agx(c: vec3f) -> vec3f {
    let inset = AGX_INSET * (LINEAR_SRGB_TO_LINEAR_REC2020 * c);
    let logged = (log2(max(inset, vec3f(1e-10))) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
    let curved = AGX_OUTSET * agx_contrast(saturate(logged));
    let rec2020 = pow(max(curved, vec3f(0.0)), vec3f(2.2));
    return saturate(LINEAR_REC2020_TO_LINEAR_SRGB * rec2020);
}

/// Khronos PBR Neutral tone mapping of exposed linear color, as three.js's NeutralToneMapping
/// implements it.
fn neutral(c: vec3f) -> vec3f {
    let start_compression = 0.8 - 0.04;
    let desaturation = 0.15;
    let x = min(c.r, min(c.g, c.b));
    let toe = select(0.04, x - 6.25 * x * x, x < 0.08);
    let shifted = c - toe;
    let peak = max(shifted.r, max(shifted.g, shifted.b));
    if peak < start_compression {
        return shifted;
    }
    let d = 1.0 - start_compression;
    let new_peak = 1.0 - d * d / (peak + d - start_compression);
    let g = 1.0 - 1.0 / (desaturation * (peak - new_peak) + 1.0);
    return mix(shifted * (new_peak / peak), vec3f(new_peak), g);
}

/// Linear scene color after the exposure and the tone mapping: linear color from 0 to 1. Without
/// tone mapping, the exposed color is clipped at 1, as three.js's LinearToneMapping does.
fn tone_map(c: vec3f, settings: Output) -> vec3f {
    let exposed = c * settings.exposure;
    if settings.tone_mapping == AGX {
        return agx(exposed);
    }
    if settings.tone_mapping == NEUTRAL {
        return neutral(exposed);
    }
    if settings.tone_mapping == NONE {
        return saturate(exposed);
    }
    return aces(exposed);
}

/// The PCG hash of a 32-bit value, which integer arithmetic gives the same on every GPU.
fn pcg(v: u32) -> u32 {
    let state = v * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

/// A value from 0 to 1 that looks random from pixel to pixel, and stays the same for a pixel on
/// every frame: a hash of the pixel's column and row.
fn pixel_noise(pixel: vec2f) -> f32 {
    let hash = pcg(u32(pixel.x) + pcg(u32(pixel.y)));
    return f32(hash >> 8u) / 16777216.0;
}

/// Encodes linear color from 0 to 1 as sRGB for an 8-bit target, and dithers it by up to half a
/// step of that target, so smooth gradients show no bands. A color that the target holds exactly
/// keeps its value.
fn encode(c: vec3f, pixel: vec2f) -> vec3f {
    let dither = (pixel_noise(pixel) - 0.5) / 255.0;
    return null3d::color::linear_to_srgb(c) + dither;
}
