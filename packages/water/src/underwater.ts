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

/** Which of each pair of 16-bit words of a 32-bit float holds its top bits on this machine. */
const TOP = new Uint16Array(new Float32Array([1]).buffer)[1] === 0 ? 0 : 1;

/**
 * The top 16 bits of a 32-bit float, as a whole number that orders as the floats do: of two floats
 * whose numbers differ, the larger number is the larger float. Floats whose top bits match give
 * the same number, and only their full values tell them apart. A whole number this small is never
 * an object, so code that compares two of them allocates nothing, even unoptimized.
 */
export function topOrder(top: number): number {
	return top & 0x8000 ? 0xffff - top : top | 0x8000;
}

/** The order of the top bits of a 32-bit float, as `topOrder` gives it. */
function orderOf(value: number): number {
	const float = new Float32Array([value]);
	return topOrder(new Uint16Array(float.buffer)[TOP] as number);
}

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
	// The camera's place as 32-bit floats, and the same bytes as 16-bit words.
	const place = new Float32Array(3);
	const words = new Uint16Array(place.buffer);
	// Above these heights the camera is clear of the highest wave by the gap that adds the effect,
	// or by the gap that removes it, so the surface's height under it is not needed. Each is kept
	// as the order of its top bits.
	const readyAbove = orderOf(water.level + water.waveReach + ready);
	const releaseAbove = orderOf(water.level + water.waveReach + release);
	let effect: Effect | null = null;
	return {
		update(t, air, light) {
			// Code that runs once a frame stays unoptimized for a long time, and there each fraction
			// that it reads or works out is a new object. So the camera's height is first compared
			// by the top bits of its float alone, which read as small whole numbers: a camera clearly
			// above the waves allocates nothing.
			camera.getPosition(place);
			const clear = topOrder(words[2 + TOP] as number) > (effect ? releaseAbove : readyAbove);
			if (!clear) camera.getPosition(eye);
			if (
				clear ||
				(eye[1] as number) - water.surfaceHeight(eye[0] as number, eye[2] as number, t) >
					(effect ? release : ready)
			) {
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
						waveAmplitude: water.waveAmplitude,
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
