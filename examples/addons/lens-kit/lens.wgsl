// The lens kit's one effect: the camera's own marks on the picture. It runs on linear HDR color
// before bloom and the tone curve, as the engine's effects do. Each mark is off at 0, so a look
// that wants only the grade pays for no tap of its own.

#import null3d::noise::{random2}

struct Uniforms {
    // How far the red and the blue pull apart toward the corners, in pixels.
    aberration: f32,
    // The share of the light brighter than white that bleeds sideways.
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

    // The anamorphic streak: light brighter than white bleeds sideways, in a blue-white flare.
    if (uniforms.streak > 0.0) {
        var glow = vec3f(0.0);
        for (var i = 1; i <= 5; i++) {
            let across = vec2f(f32(i) * 3.0 / input.size.x, 0.0);
            glow += max(effectColor(input.uv - across).rgb - vec3f(1.0), vec3f(0.0));
            glow += max(effectColor(input.uv + across).rgb - vec3f(1.0), vec3f(0.0));
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
