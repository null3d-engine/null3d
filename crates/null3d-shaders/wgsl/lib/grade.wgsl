#define_import_path null3d::grade

// The grading controls applied to high dynamic range light, before the tone curve: the white
// balance, then the saturation, lift, gamma and gain, then the split toning. The controls act on
// the light's ARRI LogC (EI 1000) code, which is how a color grading tool holds a film image, so a
// light above the canvas's white still takes its share of the grade before the curve turns it
// white. The same steps are baked into a 3D table on the HDR path (see `grading-hdr.ts`), and a
// scene shader applies them one color at a time on the 8-bit path.
//
// The grade reaches the shaders in the output block, which every scene shader reads, so the 8-bit
// path needs no binding of its own. A grade with the flag clear leaves the light as it is.

/// Linear light below which ARRI LogC encodes with its straight segment.
const LOG_C_CUT: f32 = 0.011361;
/// The LogC curve's four constants, and its straight segment's two.
const LOG_C_MUL: f32 = 5.555556;
const LOG_C_OFFSET: f32 = 0.047996;
const LOG_C_SCALE: f32 = 0.244161;
const LOG_C_SHIFT: f32 = 0.386036;
const LOG_C_SLOPE: f32 = 5.301883;
const LOG_C_LINEAR: f32 = 0.092819;
/// The LogC code of the straight segment's end, which both halves of the curve share:
/// LOG_C_SCALE * log10(LOG_C_MUL * LOG_C_CUT + LOG_C_OFFSET) + LOG_C_SHIFT.
const LOG_C_CUT_CODE: f32 = 0.15304868;

/// The luma weights of Rec. 709, which the engine's grading shares.
const GRADE_LUMA = vec3f(0.2126, 0.7152, 0.0722);

/// The grading values: the white balance's factors with the saturation, the lift, the gamma and
/// the gain of each channel, and the split toning's two chromas with its balance and its strength.
struct Grade {
    white_balance: vec4f,
    lift: vec4f,
    gamma: vec4f,
    gain: vec4f,
    shadows: vec4f,
    highlights: vec4f,
}

/// The ARRI LogC code of linear light `x`.
fn logc_encode(x: f32) -> f32 {
    return select(
        LOG_C_SLOPE * x + LOG_C_LINEAR,
        LOG_C_SCALE * log(LOG_C_MUL * x + LOG_C_OFFSET) / log(10.0) + LOG_C_SHIFT,
        x > LOG_C_CUT,
    );
}

/// The ARRI LogC codes of the linear light in each channel of `c`.
fn logc_encode_rgb(c: vec3f) -> vec3f {
    return vec3f(logc_encode(c.x), logc_encode(c.y), logc_encode(c.z));
}

/// The linear light that ARRI LogC code `code` stands for.
fn logc_decode(code: f32) -> f32 {
    return select(
        (code - LOG_C_LINEAR) / LOG_C_SLOPE,
        (pow(10.0, (code - LOG_C_SHIFT) / LOG_C_SCALE) - LOG_C_OFFSET) / LOG_C_MUL,
        code > LOG_C_CUT_CODE,
    );
}

/// The linear light that the ARRI LogC codes in each channel of `code` stand for.
fn logc_decode_rgb(code: vec3f) -> vec3f {
    return vec3f(logc_decode(code.x), logc_decode(code.y), logc_decode(code.z));
}

/// The graded LogC code of exposed linear light `c`: from 0 to 1, which the table's domain holds.
/// The controls act on codes, so the table of codes interpolates as this reference does.
fn grade_hdr_code(c: vec3f, g: Grade) -> vec3f {
    let balanced = max(c, vec3f(0.0)) * g.white_balance.xyz;
    let codes = logc_encode_rgb(balanced);
    let mid = dot(codes, GRADE_LUMA);
    let colored = mid + (codes - vec3f(mid)) * g.white_balance.w;
    let curved = pow(max(colored + g.lift.xyz, vec3f(0.0)), vec3f(1.0) / g.gamma.xyz) * g.gain.xyz;
    // The balance moves the code at which the shadows' hue gives way to the highlights'.
    let split_at = 0.5 + 0.4 * g.shadows.w;
    let top = g.highlights.w * smoothstep(split_at - 0.25, split_at + 0.25, dot(curved, GRADE_LUMA));
    let bottom = g.highlights.w - top;
    let split = max(curved + g.shadows.xyz * bottom + g.highlights.xyz * top, vec3f(0.0));
    // The table's domain ends at LogC code 1, so a value past it takes the last texel: the curve
    // draws that as white either way.
    return min(split, vec3f(1.0));
}

/// Exposed linear light `c` after the grading `g`: linear light again, no brighter than the table's
/// domain, which every tone curve draws as white.
fn grade_hdr(c: vec3f, g: Grade) -> vec3f {
    return max(logc_decode_rgb(grade_hdr_code(c, g)), vec3f(0.0));
}
