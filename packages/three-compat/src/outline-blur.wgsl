// One direction of the gaussian blur that three.js's OutlinePass runs over its edges: four taps
// each way, at the radius that the pass takes, and a weight from the same gaussian. The edge's
// alpha, which holds the mask's coverage, passes through each blur unchanged, so the composite
// reads the coverage that three.js reads from its mask.
struct Uniforms {
    direction: vec2f,
    kernelRadius: f32,
}

var source: texture_2d<f32>;

fn gaussian(x: f32, sigma: f32) -> f32 {
    return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
}

fn effect(input: EffectInput) -> vec4f {
    let center = textureSampleLevel(source, sourceSampler, effectPassUv(input.uv), 0.0);
    let sigma = uniforms.kernelRadius / 2.0;
    var weightSum = gaussian(0.0, sigma);
    var sum = center.rgb * weightSum;
    // The taps span the radius in four steps, as OutlinePass's kernel does.
    let delta = uniforms.direction / input.size * (uniforms.kernelRadius / 4.0);
    var offset = delta;
    for (var i = 1; i <= 4; i++) {
        let x = uniforms.kernelRadius * f32(i) / 4.0;
        let weight = gaussian(x, sigma);
        let plus = textureSampleLevel(source, sourceSampler, effectPassUv(input.uv + offset), 0.0);
        let minus = textureSampleLevel(source, sourceSampler, effectPassUv(input.uv - offset), 0.0);
        sum += (plus.rgb + minus.rgb) * weight;
        weightSum += 2.0 * weight;
        offset += delta;
    }
    return vec4f(sum / weightSum, center.a);
}
