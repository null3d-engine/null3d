// A lens grade as a full-screen effect: color fringes that grow toward the edges, a horizontal
// anamorphic streak on light brighter than white, and grain that changes at the film rate rather
// than the frame rate. The settings are the same in every scene that takes the effect, and the
// three.js twins in examples/compare/lens-three.ts take the same numbers and the same hash.

/** The numbers that a lens grade sets. */
export interface LensSettings {
	/** How far the red and blue channels move apart at the corners, in pixels. */
	shift: number;
	/** How much of the light brighter than white bleeds sideways. */
	streak: number;
	/** How much the grain changes each pixel's brightness, from 0 to 1. */
	grain: number;
}

/** The effect's WGSL. The engine runs it on the scene's linear color before bloom and tone mapping. */
export const LENS_WGSL = /* wgsl */ `
#import null3d::noise::{random2}

struct Uniforms { shift: f32, streak: f32, grain: f32 }

fn effect(input: EffectInput) -> vec4f {
    let toward = (input.uv - vec2f(0.5)) * uniforms.shift / input.size;
    let red = effectColor(input.uv + toward).r;
    let blue = effectColor(input.uv - toward).b;
    var color = vec3f(red, input.color.g, blue);
    var glow = vec3f(0.0);
    for (var i = 1; i <= 5; i++) {
        let across = vec2f(f32(i) * 3.0 / input.size.x, 0.0);
        glow += max(effectColor(input.uv - across).rgb - vec3f(1.0), vec3f(0.0));
        glow += max(effectColor(input.uv + across).rgb - vec3f(1.0), vec3f(0.0));
    }
    color += glow / 10.0 * uniforms.streak * vec3f(0.45, 0.65, 1.0);
    let seeded = input.pixel + vec2f(floor(input.time * 24.0) * 37.0, 0.0);
    color *= 1.0 + (random2(seeded) - 0.5) * uniforms.grain;
    return vec4f(color, input.color.a);
}
`;
