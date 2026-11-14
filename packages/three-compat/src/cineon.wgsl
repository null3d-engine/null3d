// Cineon's curve, the filmic operator of Jim Hejl and Richard Burgess-Dawson, as three.js's
// CineonToneMapping writes it in tonemapping_pars_fragment.glsl.js. The color arrives exposed, so
// the curve leaves out the exposure that three.js multiplies in.
fn toneCurve(color: vec3f) -> vec3f {
    let x = max(vec3f(0.0), color - vec3f(0.004));
    let numerator = x * (vec3f(6.2) * x + vec3f(0.5));
    let denominator = x * (vec3f(6.2) * x + vec3f(1.7)) + vec3f(0.06);
    return pow(numerator / denominator, vec3f(2.2));
}
