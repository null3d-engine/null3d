#define_import_path null3d::color

// Color in linear space: sRGB encoding and decoding, luminance, HSV, and the tone mapping curves
// that three.js offers. Shaders light in linear color, and encode sRGB only at the output. The
// tone mapping curves take linear color that the exposure has already scaled, and return linear
// color from 0 to 1, ready for sRGB encoding.

/// Encodes a linear color as sRGB, the way the canvas shows it.
fn linear_to_srgb(c: vec3f) -> vec3f {
    let low = c * 12.92;
    let high = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(high, low, c <= vec3f(0.0031308));
}

/// Decodes an sRGB color to linear color. It undoes `linear_to_srgb`. Use it for colors given in
/// sRGB, such as hex colors and colors picked from the screen.
fn srgb_to_linear(c: vec3f) -> vec3f {
    let low = c / 12.92;
    let high = pow((c + 0.055) / 1.055, vec3f(2.4));
    return select(high, low, c <= vec3f(0.04045));
}

/// The brightest linear color that the engine stores in a 16-bit float target: one step below
/// the largest 16-bit float, 65,504. Some GPUs store a larger value as infinity, and the tone
/// mapping curves turn infinity into black.
const HDR_LIMIT: f32 = 65472.0;

/// A linear color with each channel no brighter than HDR_LIMIT, so that a 16-bit float target
/// holds it. Infinity becomes HDR_LIMIT too.
fn limit_hdr(c: vec3f) -> vec3f {
    return min(c, vec3f(HDR_LIMIT));
}

/// The relative luminance of a linear color, with the Rec. 709 weights that three.js uses.
fn luminance(c: vec3f) -> f32 {
    return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

/// Converts a color to hue, saturation and value, each from 0 to 1. Hue 0 is red.
fn rgb_to_hsv(c: vec3f) -> vec3f {
    let k = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = mix(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), step(c.b, c.g));
    let q = mix(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), step(p.x, c.r));
    let d = q.x - min(q.w, q.y);
    let e = 1e-10;
    return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

/// Converts hue, saturation and value, each from 0 to 1, to a color. It undoes `rgb_to_hsv`.
fn hsv_to_rgb(c: vec3f) -> vec3f {
    let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, saturate(p - k.xxx), c.y);
}

// The matrices of ACES filmic tone mapping, by columns, as three.js fits them.

/// ACES filmic's input: sRGB to XYZ, D65 to D60, AP1 and the RRT's saturation.
const ACES_INPUT = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
);
/// ACES filmic's output: the ODT's saturation, XYZ, D60 to D65 and sRGB.
const ACES_OUTPUT = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
);

/// The curve fit of the ACES reference rendering transform and output device transform.
fn rrt_and_odt_fit(v: vec3f) -> vec3f {
    let a = v * (v + 0.0245786) - 0.000090537;
    let b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
}

/// ACES filmic tone mapping, as three.js's `ACESFilmicToneMapping`. Like three.js, it scales the
/// color by 1 / 0.6 first, which suits a bright viewing place.
fn tone_map_aces(c: vec3f) -> vec3f {
    return saturate(ACES_OUTPUT * rrt_and_odt_fit(ACES_INPUT * (c / 0.6)));
}

// The matrices of AgX tone mapping, by columns, as three.js gives them after Filament and Blender.

/// Linear Rec. 2020 primaries to linear sRGB.
const LINEAR_REC2020_TO_LINEAR_SRGB = mat3x3f(
    vec3f(1.6605, -0.1246, -0.0182),
    vec3f(-0.5876, 1.1329, -0.1006),
    vec3f(-0.0728, -0.0083, 1.1187),
);
/// Linear sRGB to linear Rec. 2020 primaries.
const LINEAR_SRGB_TO_LINEAR_REC2020 = mat3x3f(
    vec3f(0.6274, 0.0691, 0.0164),
    vec3f(0.3293, 0.9195, 0.0880),
    vec3f(0.0433, 0.0113, 0.8956),
);
/// AgX's inset matrix, which moves colors toward white before the log encoding.
const AGX_INSET = mat3x3f(
    vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859),
);
/// AgX's outset matrix, which undoes the inset after the contrast curve.
const AGX_OUTSET = mat3x3f(
    vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405),
);
/// The lowest exposure of AgX's log encoding, log2(2^-10 * 0.18).
const AGX_MIN_EV: f32 = -12.47393;
/// The highest exposure of AgX's log encoding, log2(2^6.5 * 0.18).
const AGX_MAX_EV: f32 = 4.026069;

/// AgX's default contrast curve, as a polynomial fit.
fn agx_contrast(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2
        + 0.1191 * x - 0.00232;
}

/// AgX tone mapping, as three.js's `AgXToneMapping`, in Rec. 2020 primaries.
fn tone_map_agx(c: vec3f) -> vec3f {
    let inset = AGX_INSET * (LINEAR_SRGB_TO_LINEAR_REC2020 * c);
    let logged = (log2(max(inset, vec3f(1e-10))) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
    let curved = AGX_OUTSET * agx_contrast(saturate(logged));
    let rec2020 = pow(max(curved, vec3f(0.0)), vec3f(2.2));
    return saturate(LINEAR_REC2020_TO_LINEAR_SRGB * rec2020);
}

/// Khronos PBR Neutral tone mapping, as three.js's `NeutralToneMapping`. It keeps base colors
/// under about 0.8 as they are, apart from a small offset.
fn tone_map_neutral(c: vec3f) -> vec3f {
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
