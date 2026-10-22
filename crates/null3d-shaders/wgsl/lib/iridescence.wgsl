#define_import_path null3d::iridescence
#import null3d::lighting::{f_schlick}
#import null3d::math::{PI, square}

// Thin-film interference above a surface, as three.js's `evalIridescence` (Belcour and Barla's
// "A Practical Extension to Microfacet Theory for the Modeling of Varying Iridescence"). A film of
// a given thickness and index of refraction reflects each wavelength by its own phase, so the
// reflection takes the colors of the film's thickness rather than the surface's reflectance. The
// sensitivity of the eye's three color channels to the film's phase comes from the fit of Belcour's
// article, which costs a few cosines and no table.
//
// The formulas run at full precision in every build, as the coat's do.

/// The reflectance of a dielectric interface at normal incidence, from the indices of refraction on
/// each side.
fn ior_to_reflectance(transmitted_ior: f32, incident_ior: f32) -> f32 {
    let ratio = (transmitted_ior - incident_ior) / (transmitted_ior + incident_ior);
    return ratio * ratio;
}

/// Each channel's reflectance at normal incidence as its index of refraction, for a surface whose
/// reflectance is `fresnel0`.
fn fresnel0_to_ior(fresnel0: vec3f) -> vec3f {
    let root = sqrt(fresnel0);
    return (vec3f(1.0) + root) / (vec3f(1.0) - root);
}

/// Each channel's reflectance at normal incidence, from the indices of refraction on each side.
fn ior_to_reflectance_color(transmitted_ior: vec3f, incident_ior: f32) -> vec3f {
    let ratio = (transmitted_ior - vec3f(incident_ior)) / (transmitted_ior + vec3f(incident_ior));
    return ratio * ratio;
}

/// The eye's sensitivity to a film's optical path difference `opd`, in three color channels, turned
/// by the phase `shift`: three.js's `evalSensitivity`, a fit in the Fourier domain.
fn eval_sensitivity(opd: f32, shift: vec3f) -> vec3f {
    let phase = 2.0 * PI * opd * 1.0e-9;
    let value = vec3f(5.4856e-13, 4.4201e-13, 5.2481e-13);
    let position = vec3f(1.6810e+06, 1.7953e+06, 2.2084e+06);
    let spread = vec3f(4.3278e+09, 9.3046e+09, 6.6121e+09);
    let phase2 = phase * phase;
    let middle = value * sqrt(2.0 * PI * spread) * cos(position * phase + shift);
    var xyz = middle * exp(-phase2 * spread);
    xyz.x += 9.7470e-14
        * sqrt(2.0 * PI * 4.5282e+09)
        * cos(2.2399e+06 * phase + shift.x)
        * exp(-4.5282e+09 * phase2);
    xyz /= 1.0685e-7;
    // XYZ to linear sRGB, by the matrix's columns.
    let to_srgb = mat3x3f(
        vec3f(3.2404542, -0.9692660, 0.0556434),
        vec3f(-1.5371385, 1.8760108, -0.2040259),
        vec3f(-0.4985314, 0.0415560, 1.0572252),
    );
    return to_srgb * xyz;
}

/// The reflectance of a film of `thickness` nanometers and index `film_ior`, over a surface whose
/// reflectance at normal incidence is `base_reflectance`, seen at the cosine `cos_theta1` from the air.
/// three.js's `evalIridescence`: two interfaces whose reflections add, with the phase between them.
fn eval_iridescence(
    outside_ior: f32,
    film_ior: f32,
    cos_theta1: f32,
    thickness: f32,
    base_reflectance: vec3f,
) -> vec3f {
    // A film that thins to nothing takes the index of the air, so the surface shows no color.
    let ior = mix(outside_ior, film_ior, smoothstep(0.0, 0.03, thickness));
    // The cosine within the film, by Snell's law.
    let sin2 = square(outside_ior / ior) * (1.0 - cos_theta1 * cos_theta1);
    let cos2_sq = 1.0 - sin2;
    if cos2_sq < 0.0 {
        return vec3f(1.0);
    }
    let cos_theta2 = sqrt(cos2_sq);
    // The first interface, air to film.
    let r0 = ior_to_reflectance(ior, outside_ior);
    let r12 = f_schlick(vec3f(r0), 1.0, cos_theta1).x;
    let t121 = 1.0 - r12;
    let phi12 = select(0.0, PI, ior < outside_ior);
    let phi21 = PI - phi12;
    // The second interface, film to the surface, whose reflectance each channel of the base color
    // gives.
    let base_ior = fresnel0_to_ior(clamp(base_reflectance, vec3f(0.0), vec3f(0.9999)));
    let r1 = ior_to_reflectance_color(base_ior, ior);
    let r23 = f_schlick(r1, 1.0, cos_theta2);
    var phi23 = vec3f(0.0);
    if base_ior.x < ior {
        phi23.x = PI;
    }
    if base_ior.y < ior {
        phi23.y = PI;
    }
    if base_ior.z < ior {
        phi23.z = PI;
    }
    // The phase between the two reflections, from the film's optical path difference.
    let opd = 2.0 * ior * thickness * cos_theta2;
    let phi = vec3f(phi21) + phi23;
    // The series of the reflections between the two interfaces, its first term and the pairs that
    // follow.
    let r123 = clamp(r12 * r23, vec3f(1e-5), vec3f(0.9999));
    let root123 = sqrt(r123);
    let reflected = t121 * t121 * r23 / (vec3f(1.0) - r123);
    var interference = vec3f(r12) + reflected;
    var pair = reflected - t121;
    for (var k = 1; k <= 2; k++) {
        pair *= root123;
        let order = f32(k);
        interference += pair * (2.0 * eval_sensitivity(order * opd, order * phi));
    }
    // A film can reflect more than the display shows at a channel, and negative values have no
    // meaning.
    return max(interference, vec3f(0.0));
}

/// The reflectance at normal incidence that a Fresnel term at the cosine `dot_v_h` implies, after
/// inverting Schlick's approximation: three.js's `Schlick_to_F0`.
fn schlick_to_reflectance(f: vec3f, f90: f32, dot_v_h: f32) -> vec3f {
    let x = clamp(1.0 - dot_v_h, 0.0, 1.0);
    let x2 = x * x;
    let x5 = clamp(x * x2 * x2, 0.0, 0.9999);
    return (f - vec3f(f90) * x5) / (1.0 - x5);
}
