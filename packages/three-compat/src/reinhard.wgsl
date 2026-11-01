// Reinhard's curve, as three.js's ReinhardToneMapping writes it in
// tonemapping_pars_fragment.glsl.js. The color arrives exposed, so the curve leaves out the
// exposure that three.js multiplies in.
fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
