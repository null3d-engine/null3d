// The outline's edge, as three.js's OutlinePass finds it: the coverage's gradient across one texel
// each way, colored by whether other objects hide the outlined surface. The pass reads the core's
// outline mask, whose red channel holds each outlined object's coverage and whose green channel
// holds the parts that nothing hides. The output's alpha keeps the coverage for the composite,
// which the blurs carry through unchanged.
struct Uniforms {
    visibleColor: vec3f,
    hiddenColor: vec3f,
}

fn effect(input: EffectInput) -> vec4f {
    // One texel of this half-size pass, which covers two of the mask's texels, as OutlinePass's
    // edge detection steps across one texel of its downsampled mask.
    let texel = 1.0 / input.size;
    let mask = effectColor(input.uv);
    let left = effectColor(input.uv - vec2f(texel.x, 0.0));
    let right = effectColor(input.uv + vec2f(texel.x, 0.0));
    let down = effectColor(input.uv - vec2f(0.0, texel.y));
    let up = effectColor(input.uv + vec2f(0.0, texel.y));
    let d = vec2f((right.r - left.r) * 0.5, (up.r - down.r) * 0.5);
    let visibility = min(min(left.g, right.g), min(down.g, up.g));
    let shown = select(uniforms.hiddenColor, uniforms.visibleColor, 1.0 - visibility > 0.001);
    return vec4f(shown * length(d), 1.0 - mask.r);
}
