// The view from under the creek's water. While the camera is under the surface, a full-screen effect
// makes the picture read as seen through flowing water: the current bends the light in a slow
// wobble that runs downstream, caustics play over the bed and the stones under the surface, and the
// water swallows the light with distance, into its own green. Above the water the effect is gone,
// so it costs nothing there.
import {
	type Effect,
	type PerspectiveCamera,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import { FLOW, surfaceHeight } from './water';

const wgsl = /* wgsl */ `
#import null3d::noise::{value2}

struct Uniforms {
    tint: vec3f,
    density: f32,
    caustics: vec3f,
    level: f32,
    eye: vec3f,
    flow: f32,
    right: vec3f,
    lens: f32,
    up: vec3f,
    back: vec3f,
}

/// The caustics of the water's surface shader, the same ridges drifting with the current. Each WGSL
/// string compiles on its own, so this one holds its own copy.
fn caustics(p: vec2f, t: f32, flow: f32) -> f32 {
    let q = p * 4.6 + vec2f(flow * t * 4.0, 0.0);
    let a = sin(q.x * 3.1 + t * 1.3 + sin(q.y * 2.3 - t));
    let b = sin(q.y * 3.7 - t * 1.1 + sin(q.x * 1.9 + t * 0.7));
    let c = sin((q.x + q.y) * 2.6 + t * 0.9 + sin(q.x * 1.3 - q.y * 0.7));
    let v = (a + b + c) / 3.0;
    return pow(1.0 - abs(v), 14.0) * (0.35 + 0.65 * value2(p * 0.8 + vec2f(t * 0.1, 0.0)));
}

fn effect(input: EffectInput) -> vec4f {
    let t = input.time;
    // The current bends the light: a slow wobble whose waves run downstream across the picture.
    let wobble = vec2f(
        sin(input.uv.y * 23.0 + t * 1.7) + 0.6 * sin(input.uv.y * 41.0 + input.uv.x * 9.0 - t * 2.3),
        cos(input.uv.x * 19.0 + t * 1.3) + 0.5 * sin(input.uv.x * 37.0 - input.uv.y * 7.0 + t * 2.9),
    ) * 0.0022;
    let uv = input.uv + wobble;
    var color = effectColor(uv);
    // The ray from the eye through the pixel, in the world.
    let aspect = input.size.x / input.size.y;
    let ahead = normalize(vec3f((uv.x * 2.0 - 1.0) * uniforms.lens * aspect, (1.0 - uv.y * 2.0) * uniforms.lens, -1.0));
    let ray = uniforms.right * ahead.x + uniforms.up * ahead.y + uniforms.back * ahead.z;
    // How far the ray runs to what it shows, which is infinite where it shows the sky.
    let depth = effectDistance(uv);
    let reach = select(1e6, depth / -ahead.z, depth < 1e6);
    if reach < 1e6 {
        // Caustics on what lies under the surface, fading with depth below it.
        let world = uniforms.eye + ray * reach;
        let below = uniforms.level - world.y;
        if below > 0.0 {
            let light = caustics(world.xz, t, uniforms.flow) * exp(-below * 0.8);
            color = vec4f(color.rgb * (vec3f(1.0) + uniforms.caustics * light * 6.0), color.a);
        }
    }
    // The water swallows the light only along the part of the ray under the surface: what lies above
    // it, the trees, the banks and the sky, shows through as clear as the water between allows.
    let surface = select(1e6, (uniforms.level - uniforms.eye.y) / ray.y, ray.y > 1e-4);
    let wet = min(reach, surface);
    let fade = 1.0 - exp(-min(wet, 1e4) * uniforms.density);
    let filtered = color.rgb * vec3f(0.86, 0.97, 0.95);
    return vec4f(mix(filtered, uniforms.tint * color.a, fade), color.a);
}
`;

/** The view from under the water, which the scene drives each frame. */
export interface Underwater {
	/**
	 * Turns the effect on while the camera is under the surface, which waves at the sketch time `t`,
	 * and fits it to the frame's light.
	 */
	update(
		t: number,
		air: readonly [number, number, number],
		caustics: readonly [number, number, number],
	): void;
}

/** How far under the surface, as its waves move it, the camera must be before the view turns, in meters. */
const DIP = 0.005;
/** How much of the light the water swallows per meter. */
const DENSITY = 0.07;
/** The water's own color, as a share of the air's color at the horizon in each channel. */
const GREEN = [0.22, 0.42, 0.4] as const;

/** Makes the view from under the water whose surface stands at `level`, for `camera`. */
export function createUnderwater(
	{ post }: SketchContext,
	camera: PerspectiveCamera,
	level: number,
): Underwater {
	const eye = vec3.create();
	const turn = quat.create();
	const right = vec3.create();
	const up = vec3.create();
	const back = vec3.create();
	const tint: [number, number, number] = [0, 0, 0];
	const caustics: [number, number, number] = [0, 0, 0];
	let effect: Effect | null = null;
	return {
		update(t, air, light) {
			camera.getPosition(eye);
			const under = (eye[1] as number) < surfaceHeight(eye[0] as number, eye[2] as number, t) - DIP;
			if (!under) {
				if (effect) post.removeEffect(effect);
				effect = null;
				return;
			}
			camera.getRotation(turn);
			vec3.transformQuat(right, [1, 0, 0], turn);
			vec3.transformQuat(up, [0, 1, 0], turn);
			vec3.transformQuat(back, [0, 0, 1], turn);
			for (let c = 0; c < 3; c++) {
				tint[c] = (air[c] as number) * (GREEN[c] as number);
				caustics[c] = light[c] as number;
			}
			if (!effect)
				effect = post.addEffect({
					wgsl,
					uniforms: {
						tint,
						density: DENSITY,
						caustics,
						level,
						eye,
						flow: FLOW,
						right,
						lens: Math.tan((camera.fov * Math.PI) / 360),
						up,
						back,
					},
				});
			post.setEffectUniform(effect, 'tint', tint);
			post.setEffectUniform(effect, 'caustics', caustics);
			post.setEffectUniform(effect, 'eye', eye);
			post.setEffectUniform(effect, 'right', right);
			post.setEffectUniform(effect, 'up', up);
			post.setEffectUniform(effect, 'back', back);
			// The lens changes with the depth of field's focal length.
			post.setEffectUniform(effect, 'lens', Math.tan((camera.fov * Math.PI) / 360));
		},
	};
}
