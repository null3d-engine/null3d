// The reflection cadence and its budget, which the river, the lake and the sea share: one pass
// draws the scene a second time, and how often it draws is a feature setting of the quality preset
// and of the frame-budget governor.
import type { QualityPreset } from '@null3d/engine';

/** The presets in the order that a setting's row gives them. */
export const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;
/** The frames between two draws of the reflection at each preset, before the governor's steps. */
export const REFLECT_EVERY = [2, 2, 1, 1] as const;
/** The most frames between two reflection draws that the governor may reach. */
export const REFLECT_EVERY_MAX = 16;
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
