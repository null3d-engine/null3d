// The feature that the splats add-on registers with the engine: the splats that draw at full
// quality on each preset, the time budget whose share the frame-budget governor lowers, and the
// memory of the batch's rows and its quad. It lives apart from the drawing code so that a test can
// check the preset rows and the governor's steps without a GPU.

import { defineFeature, type FeatureDescription } from '@null3d/engine';

/** The splats that draw at full quality on each preset, from Low to Ultra. */
export const PRESET_SPLATS = [100_000, 250_000, 500_000, 800_000] as const;

/** The WebGL2 presets, which sort and upload the same splats with fewer threads in reach. */
export const WEBGL2_SPLATS = [50_000, 120_000, 250_000, 400_000] as const;

/** The time in ms that a frame of splats may take at full quality, from Low to Ultra. */
const PRESET_BUDGET = [2, 3, 4, 6] as const;

/** The lowest share of that time that the governor leaves the add-on. */
const BUDGET_MIN = 0.2;

/** The most splats that the draw takes, which bounds the setting's range. */
const MAX_SPLATS = 8_000_000;

/**
 * The feature that the add-on registers: its `drawn` setting takes the budget's share of the
 * preset's count, and `memory` reports the GPU bytes that the add-on's rows and quad hold.
 */
export function splatsFeature(memory: () => number): FeatureDescription {
	return defineFeature({
		name: 'splats',
		frame: 'transparent',
		kind: 'draw',
		views: ['main'],
		settings: {
			drawn: {
				presets: PRESET_SPLATS,
				webgl2: WEBGL2_SPLATS,
				values: { min: 0, max: MAX_SPLATS, whole: true },
				governor: 'scale',
			},
		},
		budget: { presets: PRESET_BUDGET, min: BUDGET_MIN },
		memory,
	});
}
