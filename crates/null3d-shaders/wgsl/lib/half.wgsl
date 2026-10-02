enable f16;
#define_import_path null3d::half
#import null3d::color::{ACES_INPUT, ACES_OUTPUT, AGX_INSET, AGX_MAX_EV, AGX_MIN_EV, AGX_OUTSET}
#import null3d::color::{LINEAR_REC2020_TO_LINEAR_SRGB, LINEAR_SRGB_TO_LINEAR_REC2020}
#import null3d::lighting::{PbrMaterial, Reflected}

// The engine's color math at half precision, for the builds of the HALF permutation bit: direct
// and ambient light on a PBR surface, the tone mapping curves and sRGB encoding. Each function
// takes and returns 32-bit floats, with the name and the result of its full precision twin in
// null3d::lighting or null3d::color, so a template picks one module or the other by its imports.
// Positions, depths and shadow lookups stay at full precision in the templates.
//
// The math runs in 16-bit floats, which hold values up to 65504 with about three decimal digits.
// WebGPU builds that the device feature `shader-f16` allows get the module as written. Other builds
// get it with 32-bit floats, and WebGL2 runs its functions at `mediump`. Where a 32-bit value could
// pass the largest 16-bit float, the function clamps it first, because an infinite light turns
// into NaN in the tone mapping.

/// The largest finite 16-bit float.
const MAX: f16 = 65504.0h;
/// One over pi.
const INV_PI: f16 = 0.3183098861837907h;
/// The smallest sum of the Smith visibility term's two parts that it divides by: 16-bit floats
/// hold no smaller normal number with room to spare.
const SMITH_FLOOR: f16 = 1e-4h;
/// The brightest linear color that the tone mapping curves take. Each curve is white well before
/// it, and the curves square their input, which must stay below the largest 16-bit float.
const TONE_LIMIT: f32 = 64.0;

/// A 32-bit color as a 16-bit one, clamped to the largest 16-bit float.
fn half_color(c: vec3f) -> vec3h {
    return vec3h(min(c, vec3f(f32(MAX))));
}

/// Schlick's Fresnel weight at a half vector whose cosine with the view is `v_dot_h`: the share
/// that moves the reflectance from its value at normal incidence toward its grazing value.
fn fresnel_weight(v_dot_h: f16) -> f16 {
    return exp2((-5.55473h * v_dot_h - 6.98316h) * v_dot_h);
}

/// The GGX normal distribution, as `null3d::lighting::d_ggx` gives it. It takes 1 minus the
/// squared cosine from the cross product of the normal and the half vector, which keeps its
/// digits where 16-bit floats lose them near the highlight's peak (Filament's form).
fn ggx(alpha: f16, n_dot_h: f16, normal_cross_half: vec3h) -> f16 {
    let a = n_dot_h * alpha;
    let k = alpha / (dot(normal_cross_half, normal_cross_half) + a * a);
    return min(k * INV_PI * k, MAX);
}

/// The height-correlated Smith visibility term of GGX, as
/// `null3d::lighting::v_ggx_smith_correlated` gives it.
fn smith_visibility(alpha: f16, n_dot_l: f16, n_dot_v: f16) -> f16 {
    let a2 = alpha * alpha;
    let gv = n_dot_l * sqrt(a2 + (1.0h - a2) * n_dot_v * n_dot_v);
    let gl = n_dot_v * sqrt(a2 + (1.0h - a2) * n_dot_l * n_dot_l);
    return 0.5h / max(gv + gl, SMITH_FLOOR);
}

/// The light that a PBR surface reflects from one direct light, as
/// `null3d::lighting::direct_light` gives it.
fn direct_light(
    m: PbrMaterial,
    normal: vec3f,
    to_view: vec3f,
    to_light: vec3f,
    light: vec3f,
    compensation: vec3f,
) -> Reflected {
    let n = vec3h(normal);
    let v = vec3h(to_view);
    let l = vec3h(to_light);
    let half_dir = normalize(l + v);
    let n_dot_l = saturate(dot(n, l));
    let n_dot_v = saturate(dot(n, v));
    let n_dot_h = saturate(dot(n, half_dir));
    let fresnel = fresnel_weight(saturate(dot(v, half_dir)));
    let grazing = f16(m.specular_grazing) * fresnel;
    let specular = vec3h(m.specular_blended) * (1.0h - fresnel) + grazing;
    let dielectric = vec3h(m.specular) * (1.0h - fresnel) + grazing;
    let alpha = f16(m.roughness * m.roughness);
    let brdf = min(
        smith_visibility(alpha, n_dot_l, n_dot_v) * ggx(alpha, n_dot_h, cross(n, half_dir)),
        MAX,
    );
    let irradiance = n_dot_l * half_color(light);
    let diffuse = irradiance * (INV_PI * vec3h(m.diffuse)) * (1.0h - dielectric);
    let reflected = irradiance * specular * brdf * vec3h(compensation);
    return Reflected(vec3f(diffuse), vec3f(min(reflected, vec3h(MAX))));
}

/// The diffuse light that a PBR surface reflects from ambient, hemisphere and probe light, as
/// `null3d::lighting::indirect_diffuse` gives it.
fn indirect_diffuse(m: PbrMaterial, irradiance: vec3f, dfg: vec2f) -> vec3f {
    let f0 = vec3h(m.specular);
    let split = vec2h(dfg);
    let single = f0 * split.x + f16(m.specular_grazing) * split.y;
    let missing = 1.0h - (split.x + split.y);
    let average = f0 + (1.0h - f0) * 0.047619h;
    let multi = single * average / (1.0h - missing * average) * missing;
    let diffuse = INV_PI * vec3h(m.diffuse);
    return vec3f(half_color(irradiance) * diffuse * (1.0h - single - multi));
}

/// A linear color as the tone mapping curves take it: no brighter than TONE_LIMIT.
fn tone_input(c: vec3f) -> vec3h {
    return vec3h(min(c, vec3f(TONE_LIMIT)));
}

/// ACES filmic tone mapping, as `null3d::color::tone_map_aces` gives it.
fn tone_map_aces(c: vec3f) -> vec3f {
    let v = mat3x3h(ACES_INPUT) * (tone_input(c) / 0.6h);
    let fitted = (v * (v + 0.0245786h) - 0.000090537h) / (v * (0.983729h * v + 0.432951h) + 0.238081h);
    return vec3f(saturate(mat3x3h(ACES_OUTPUT) * fitted));
}

/// AgX tone mapping, as `null3d::color::tone_map_agx` gives it.
fn tone_map_agx(c: vec3f) -> vec3f {
    let inset = mat3x3h(AGX_INSET) * (mat3x3h(LINEAR_SRGB_TO_LINEAR_REC2020) * tone_input(c));
    let min_ev = f16(AGX_MIN_EV);
    let range = f16(AGX_MAX_EV) - min_ev;
    // Every value below 2 to the power AGX_MIN_EV maps to 0, so the floor needs no smaller number.
    let x = saturate((log2(max(inset, vec3h(1e-4h))) - min_ev) / range);
    let x2 = x * x;
    let x4 = x2 * x2;
    let curved = 15.5h * x4 * x2 - 40.14h * x4 * x + 31.96h * x4 - 6.868h * x2 * x + 0.4298h * x2
        + 0.1191h * x - 0.00232h;
    let rec2020 = pow(max(mat3x3h(AGX_OUTSET) * curved, vec3h(0.0h)), vec3h(2.2h));
    return vec3f(saturate(mat3x3h(LINEAR_REC2020_TO_LINEAR_SRGB) * rec2020));
}

/// Khronos PBR Neutral tone mapping, as `null3d::color::tone_map_neutral` gives it.
fn tone_map_neutral(c: vec3f) -> vec3f {
    let start_compression = 0.8h - 0.04h;
    let desaturation = 0.15h;
    let h = tone_input(c);
    let x = min(h.r, min(h.g, h.b));
    let toe = select(0.04h, x - 6.25h * x * x, x < 0.08h);
    let shifted = h - toe;
    let peak = max(shifted.r, max(shifted.g, shifted.b));
    if peak < start_compression {
        return vec3f(shifted);
    }
    let d = 1.0h - start_compression;
    let new_peak = 1.0h - d * d / (peak + d - start_compression);
    let g = 1.0h - 1.0h / (desaturation * (peak - new_peak) + 1.0h);
    return vec3f(mix(shifted * (new_peak / peak), vec3h(new_peak), g));
}

/// Encodes a linear color from 0 to 1 as sRGB, as `null3d::color::linear_to_srgb` does.
fn linear_to_srgb(c: vec3f) -> vec3f {
    let h = vec3h(min(c, vec3f(1.0)));
    let low = h * 12.92h;
    let high = 1.055h * pow(h, vec3h(1.0h / 2.4h)) - 0.055h;
    return vec3f(select(high, low, h <= vec3h(0.0031308h)));
}
