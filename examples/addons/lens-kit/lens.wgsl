// The lens kit's one effect: the camera's own marks on the picture. It runs on linear HDR color
// after the exposure and before the tone curve, as the engine's effects do, and reads a level of
// bloom's chain for the streak, so bloom draws before it. Each mark is off at 0, so a look that
// wants only the grade pays for no tap of its own.

#import null3d::noise::{random2}

struct Uniforms {
    // How far the red and the blue pull apart toward the corners, in pixels.
    aberration: f32,
    // The share of bloom's glow that bleeds sideways.
    streak: f32,
    // How much the grain changes each pixel's brightness, from 0 to 1.
    grain: f32,
    // How far the frame smears toward the middle, for speed, from 0 to 1.
    speed: f32,
}

fn effect(input: EffectInput) -> vec4f {
    let toCenter = vec2f(0.5) - input.uv;
    var color = input.color.rgb;

    // Chromatic aberration: the red and the blue channels move apart toward the edges.
    if (uniforms.aberration > 0.0) {
        let shift = toCenter * uniforms.aberration / input.size;
        color.r = effectColor(input.uv + shift).r;
        color.b = effectColor(input.uv - shift).b;
    }

    // The anamorphic streak: bloom's own glow, spread sideways into a blue-white flare. The chain
    // has thresholded and blurred the light already, so the streak never blurs the picture again.
    if (uniforms.streak > 0.0) {
        var glow = vec3f(0.0);
        for (var i = 1; i <= 5; i++) {
            let across = vec2f(f32(i) * 3.0 / input.size.x, 0.0);
            glow += effectBloom(input.uv - across) + effectBloom(input.uv + across);
        }
        color += glow * 0.1 * uniforms.streak * vec3f(0.45, 0.65, 1.0);
    }

    // Speed: the picture smears toward the middle, so a moving camera reads as movement.
    if (uniforms.speed > 0.0) {
        var smear = color;
        for (var i = 1; i <= 6; i++) {
            smear += effectColor(input.uv + toCenter * f32(i) * 0.12 * uniforms.speed).rgb;
        }
        color = smear / 7.0;
    }

    // Grain, at the film rate rather than the frame rate.
    if (uniforms.grain > 0.0) {
        let seeded = input.pixel + vec2f(floor(input.time * 24.0) * 37.0, 0.0);
        color *= 1.0 + (random2(seeded) - 0.5) * uniforms.grain;
    }
    return vec4f(color, input.color.a);
}
