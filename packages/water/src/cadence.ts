// The reflection cadence and its budget, which the river, the lake and the sea share: one pass
// draws the scene a second time, and how often it draws is a feature setting of the quality preset
// and of the frame-budget governor.
import type { Camera, QualityPreset } from '@null3d/engine';

/** The presets in the order that a setting's row gives them. */
export const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
/** The frames between two draws of the reflection at each preset, before the governor's steps. */
export const REFLECT_EVERY = [2, 2, 1, 1] as const;
/** The most frames between two reflection draws that the governor may reach. */
export const REFLECT_EVERY_MAX = 16;
/**
 * How far the camera may move, in meters, and turn, in quaternion units, between two frames before
 * the reflection reads the view as moving. A held frame's camera stands exactly still.
 */
const STILL_MOVE = 1e-4;
const STILL_TURN = 2e-5;
/**
 * The reflection pass's time at full quality, per frame, on each preset: the shared figure from the
 * S25's check of planar reflections, halved where the cadence draws every other frame.
 */
export const REFLECT_MS: readonly [number, number, number, number] = [1.7, 1.7, 3.4, 3.4];

/** The cadence that each preset takes, with the caller's own cadence where it names one. */
export function cadenceRow(
	cadence: Partial<Record<QualityPreset, number>> | undefined,
): [number, number, number, number] {
	const row = PRESETS.map((preset, index) => {
		const given = cadence?.[preset];
		const every = Math.round(given ?? (REFLECT_EVERY[index] as number));
		if (!Number.isFinite(every) || every < 1 || every > REFLECT_EVERY_MAX)
			throw new Error(
				`@null3d/water: a reflection cadence must be from 1 to ${REFLECT_EVERY_MAX} frames, and it is ${given}`,
			);
		return every;
	});
	return row as [number, number, number, number];
}

/**
 * The reflection's cadence while a camera moves: the river, the lake and the sea each give their
 * pass the cadence that the preset and the frame-budget governor settle on, and each draws in every
 * frame while the camera moves or turns, so a moving view never shows a mirror of an older one.
 * `set` is the call that gives the pass its cadence, and the object is made once, at setup.
 *
 * @category api/water
 */
export function reflectionCadence(
	camera: Camera | undefined,
	set: (every: number) => void,
): {
	/** The cadence that the preset and the governor give, which a still camera keeps. */
	budget(every: number): void;
	/** Follows the camera for this frame: a move or a turn draws the reflection in every frame. */
	follow(): void;
} {
	let every = 1;
	let posed = false;
	let moving = false;
	const pose = new Float64Array(3);
	const turn = new Float64Array(4);
	const held = new Float64Array(7);
	return {
		budget(next) {
			every = next;
			// A camera that moves draws in every frame whatever the budget says, and takes the new
			// cadence when the view settles.
			if (!moving) set(every);
		},
		follow() {
			if (!camera) return;
			camera.getPosition(pose);
			camera.getRotation(turn);
			if (posed) {
				let still = true;
				for (let k = 0; k < 3; k++)
					if (Math.abs((pose[k] as number) - (held[k] as number)) > STILL_MOVE) still = false;
				for (let k = 0; k < 4; k++)
					if (Math.abs((turn[k] as number) - (held[k + 3] as number)) > STILL_TURN) still = false;
				if (!still !== moving) {
					moving = !still;
					set(moving ? 1 : every);
				}
			}
			for (let k = 0; k < 3; k++) held[k] = pose[k] as number;
			for (let k = 0; k < 4; k++) held[k + 3] = turn[k] as number;
			posed = true;
		},
	};
}
