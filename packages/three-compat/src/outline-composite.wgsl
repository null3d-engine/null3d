// Adds the outline's edges to the scene's color, as three.js's OutlinePass adds them to its input:
// the blurred edge plus the wider glow times its weight, scaled by the strength and by the pulse.
// The pulse follows OutlinePass's cosine, which runs from a quarter to the full strength over the
// period. The edge's alpha holds the mask's coverage, so the edge shows outside the outlined
// surface as OutlinePass's does.
struct Uniforms {
    settings: vec4f,
}

var edges: texture_2d<f32>;
var halo: texture_2d<f32>;

fn effect(input: EffectInput) -> vec4f {
    let edge = textureSampleLevel(edges, edgesSampler, effectPassUv(input.uv), 0.0);
    let glow = textureSampleLevel(halo, haloSampler, effectPassUv(input.uv), 0.0);
    var pulse = 1.0;
    if (uniforms.settings.z > 0.0) {
        pulse = 0.625 + 0.375 * cos(input.time * 10.0 / uniforms.settings.z);
    }
    let light = (edge.rgb + glow.rgb * uniforms.settings.y) * (uniforms.settings.x * pulse * edge.a);
    return vec4f(input.color.rgb + light, input.color.a);
}
