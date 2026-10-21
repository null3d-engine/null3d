// Shafts of light at golden hour: a custom effect that marches from each pixel toward the sun on the
// screen, and counts the sky it passes. Leaves, trunks and rocks between the pixel and the sun
// break the count, so the light falls through the trees in rays. The scene's depth tells sky from
// everything else: nothing draws depth in the sky. The effect runs only in the mood that has it.
import type { Effect, PerspectiveCamera, SketchContext } from '@null3d/engine';

const wgsl = /* wgsl */ `
struct Uniforms { sun: vec2f, strength: f32, tint: vec3f }

fn effect(input: EffectInput) -> vec4f {
    let toSun = uniforms.sun - input.uv;
    let aspect = input.size.x / input.size.y;
    let away = length(toSun * vec2f(aspect, 1.0));
    // The rays fade away from the sun, and pixels where they are too faint to see skip the march.
    let fade = exp(-away * 2.0) * uniforms.strength;
    if (fade < 0.03) {
        return input.color;
    }
    // Steps of about the same length on the screen, so pixels near the sun take few. Enough short
    // steps make the sum smooth, with no dither: a per-pixel dither to hide them grains the rays.
    let steps = clamp(i32(away * 32.0), 6, 32);
    let delta = toSun * (0.9 / f32(steps));
    var uv = input.uv + delta * 0.5;
    var weight = 1.0;
    var total = 0.0;
    var lit = 0.0;
    for (var i = 0; i < steps; i++) {
        lit += select(0.0, weight, effectDepth(uv) == 0.0);
        total += weight;
        weight *= 0.92;
        uv += delta;
    }
    let rays = lit / total * fade;
    return vec4f(input.color.rgb + uniforms.tint * rays * input.color.a, input.color.a);
}
`;

/** Turns the shafts on or off, and keeps them on the sun as the camera moves. */
export function createShafts({ post, engine }: SketchContext, camera: PerspectiveCamera) {
	let effect: Effect | undefined;
	let sun: readonly [number, number, number] = [0, -1, 0];
	const eye = [0, 0, 0];
	const point = [0, 0, 0];
	const onScreen = [0, 0, 0];
	const place = [0.5, 0.5];
	return {
		/** Light from the sun's direction in the given linear color, or none. */
		set(
			direction: readonly [number, number, number] | undefined,
			tint: readonly [number, number, number],
		) {
			if (!direction) {
				if (effect) post.removeEffect(effect);
				effect = undefined;
				return;
			}
			sun = direction;
			effect ??= post.addEffect({
				wgsl,
				uniforms: { sun: [0.5, 0.5], strength: 0, tint: [...tint] },
			});
			post.setEffectUniform(effect, 'tint', [...tint]);
		},
		/** Puts the shafts' source where the sun shows this frame. Call it in `onLateUpdate`. */
		update() {
			if (!effect) return;
			camera.getWorldPosition(eye);
			for (let k = 0; k < 3; k++) point[k] = (eye[k] as number) - (sun[k] as number) * 500;
			camera.worldToScreen(point, onScreen);
			const ahead = (onScreen[2] as number) > 0;
			place[0] = (onScreen[0] as number) / engine.viewport.width;
			place[1] = (onScreen[1] as number) / engine.viewport.height;
			post.setEffectUniform(effect, 'sun', place);
			post.setEffectUniform(effect, 'strength', ahead ? 1.6 : 0);
		},
	};
}
