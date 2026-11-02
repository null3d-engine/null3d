// The sun's shadow range of a scene, which follows the camera. Close up it holds the range that the
// scene asks for, so the near shadows stay sharp. As the camera draws back it grows, so the scene's
// core never passes the range's far edge and its shadows never vanish at once.
import { type DirectionalLight, type PerspectiveCamera, quat, vec3 } from '@null3d/engine';

/**
 * The sun's shadow range of a scene. Close up it holds the range the scene asks for, which keeps
 * the near shadows sharp. As the camera draws back it grows, so the scene's core never passes the
 * range's far edge and its shadows never vanish at once.
 */
export interface ShadowReach {
	/** The range close up, in meters, and the least it ever is. */
	distance: number;
	/** The middle of the part of the scene that must always have its shadows. */
	center: readonly [number, number, number];
	/** That part's radius, in meters. */
	radius: number;
}

/** How much longer each step of the shadow range is than the one before, as the engine's own. */
const SHADOW_LADDER = 1.25;

/** The direction a camera looks along, before its rotation. */
const AHEAD: readonly [number, number, number] = [0, 0, -1];

/**
 * The shadow range for a need of `raw` meters, from a held range of `held`: the shortest step of the
 * ladder up from `base` that reaches the need. It rises at once, and falls only once the need is a
 * whole step below the held range, so a need that hovers at a step never flickers between two. A
 * need of zero or less is the scene's core behind the camera, which asks for the base range alone.
 */
export function shadowStep(raw: number, held: number, base: number): number {
	const steps = Math.max(
		0,
		Math.ceil(Math.log(Math.max(raw, base) / base) / Math.log(SHADOW_LADDER) - 1e-9),
	);
	const up = base * SHADOW_LADDER ** steps;
	return up > held || raw < held / SHADOW_LADDER ** 2 ? up : held;
}

/** The sun's shadow range, fitted to the camera's place and direction. */
export interface ShadowRange {
	/** The range now, in meters. */
	readonly distance: number;
	/** Fits the range to where the camera looks now. */
	fit(): void;
}

/** Makes a sun's shadow range, and holds its first range now. */
export function createShadowRange(
	sun: DirectionalLight,
	camera: PerspectiveCamera,
	reach: ShadowReach,
): ShadowRange {
	let distance = reach.distance;
	sun.setShadow({ distance });
	const eye = vec3.create();
	const turn = quat.create();
	const ahead = vec3.create();
	return {
		get distance() {
			return distance;
		},
		fit() {
			camera.getPosition(eye);
			camera.getRotation(turn);
			vec3.transformQuat(ahead, AHEAD, turn);
			const [cx, cy, cz] = reach.center;
			const along =
				(cx - (eye[0] as number)) * (ahead[0] as number) +
				(cy - (eye[1] as number)) * (ahead[1] as number) +
				(cz - (eye[2] as number)) * (ahead[2] as number);
			const next = shadowStep(along + reach.radius, distance, reach.distance);
			if (next === distance) return;
			distance = next;
			sun.setShadow({ distance: next });
		},
	};
}
