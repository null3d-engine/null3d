// The view from under the water. Each pixel whose line of sight starts under the waving surface
// reads as seen through flowing water: the current bends the light in a slow wobble that runs
// downstream, caustics play over the bed and the stones under the surface, and the water swallows
// the light with distance, into its own color. The test is per pixel, from the point where the
// pixel's line of sight leaves the camera's near plane, so a camera half under the water splits the
// picture at the waterline, as a real one does. The effect is added only while the camera is near or
// under the water, so it costs nothing elsewhere.
import {
	type Effect,
	type PerspectiveCamera,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import underwaterShader from './underwater.wgsl';
import type { Water } from './water';

/** How much of the light the water swallows for each meter along the view. */
const DENSITY = 0.07;
/** The water's own color, as a share of the air's color at the horizon in each channel. */
const GREEN = [0.22, 0.42, 0.4] as const;
/**
 * How near above the surface the camera comes before the effect is added, and how far above it the
 * camera goes before the effect is removed, in meters. An effect takes a few frames to start
 * drawing after it is added, so it is added before the camera reaches the water, and the first
 * pixel that dips under the surface already reads as under the water.
 */
const READY = 0.6;
const RELEASE = 1;

/**
 * Options of `createUnderwater`.
 *
 * @category api/water
 */
export interface UnderwaterOptions {
	/** How much of the light the water swallows for each meter along the view. It is 0.07. */
	readonly density?: number;
	/**
	 * The water's own color, as a share of the air's color at the horizon in each channel. It is
	 * `[0.22, 0.42, 0.4]`, the green of clear water.
	 */
	readonly color?: readonly [red: number, green: number, blue: number];
	/** How near above the surface the camera comes before the effect is added. It is 0.6 m. */
	readonly ready?: number;
	/** How far above the surface the camera goes before the effect is removed. It is 1 m. */
	readonly release?: number;
}

/**
 * The view from under the water, which the scene drives in each frame.
 *
 * @category api/water
 */
export interface Underwater {
	/**
	 * Turns the effect on while the camera is under the water's surface at the sketch time `t`, and
	 * fits it to the frame's light.
	 */
	update(
		t: number,
		air: readonly [red: number, green: number, blue: number],
		caustics: readonly [red: number, green: number, blue: number],
	): void;
	/** Removes the effect, if it draws. */
	destroy(): void;
}

/**
 * Makes the view from under the water whose surface the `water` object draws, for `camera`. The
 * waterline follows the same long waves as the surface, and the effect fades the light at the same
 * current, so a camera that dips under the water sees the world through it.
 *
 * @category api/water
 */
export function createUnderwater(
	{ post }: SketchContext,
	camera: PerspectiveCamera,
	water: Water,
	options: UnderwaterOptions = {},
): Underwater {
	const density = options.density ?? DENSITY;
	const color = options.color ?? GREEN;
	const ready = options.ready ?? READY;
	const release = options.release ?? RELEASE;
	const eye = vec3.create();
	const turn = quat.create();
	const right = vec3.create();
	const up = vec3.create();
	const back = vec3.create();
	const tint: [number, number, number] = [0, 0, 0];
	const caustics: [number, number, number] = [0, 0, 0];
	const current: [number, number] = [0, 0];
	let effect: Effect | null = null;
	return {
		update(t, air, light) {
			camera.getPosition(eye);
			const above = (eye[1] as number) - water.surfaceHeight(eye[0] as number, eye[2] as number, t);
			if (above > (effect ? release : ready)) {
				if (effect) post.removeEffect(effect);
				effect = null;
				return;
			}
			camera.getRotation(turn);
			vec3.transformQuat(right, [1, 0, 0], turn);
			vec3.transformQuat(up, [0, 1, 0], turn);
			vec3.transformQuat(back, [0, 0, 1], turn);
			water.currentAt(eye[0] as number, eye[2] as number, current);
			for (let c = 0; c < 3; c++) {
				tint[c] = (air[c] as number) * (color[c] as number);
				caustics[c] = light[c] as number;
			}
			// The lens changes with the depth of field's focal length.
			const lens = Math.tan((camera.fov * Math.PI) / 360);
			if (!effect) {
				effect = post.addEffect({
					wgsl: underwaterShader,
					uniforms: {
						tint,
						density,
						caustics,
						level: water.level,
						eye,
						current: [current[0], current[1]],
						lens,
						up,
						near: camera.near,
						back,
						right,
					},
				});
				return;
			}
			post.setEffectUniform(effect, 'tint', tint);
			post.setEffectUniform(effect, 'caustics', caustics);
			post.setEffectUniform(effect, 'eye', eye);
			post.setEffectUniform(effect, 'right', right);
			post.setEffectUniform(effect, 'up', up);
			post.setEffectUniform(effect, 'back', back);
			post.setEffectUniform(effect, 'lens', lens);
			post.setEffectUniform(effect, 'current', current);
		},
		destroy() {
			if (effect) post.removeEffect(effect);
			effect = null;
		},
	};
}
