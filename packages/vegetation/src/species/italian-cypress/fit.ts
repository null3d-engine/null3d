// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `italian-cypress`, measured from its reference turning video
// `cypress-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit italian-cypress`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 35 views of the turning
 * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; `source`
 * names the stills and the turn each honours. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.031, 0.1, 0.17, 0.239, 0.308, 0.377, 0.446, 0.516, 0.585, 0.654, 0.723, 0.792, 0.862, 0.931,
		1,
	],
	radii: [
		[
			0.075, 0.076, 0.076, 0.076, 0.075, 0.072, 0.068, 0.068, 0.067, 0.06, 0.055, 0.06, 0.067,
			0.067, 0.067, 0.072,
		],
		[
			0.089, 0.089, 0.089, 0.089, 0.089, 0.085, 0.08, 0.08, 0.079, 0.071, 0.065, 0.071, 0.079,
			0.079, 0.079, 0.085,
		],
		[
			0.094, 0.091, 0.089, 0.091, 0.094, 0.091, 0.085, 0.082, 0.082, 0.08, 0.077, 0.083, 0.091,
			0.091, 0.089, 0.091,
		],
		[
			0.097, 0.1, 0.099, 0.097, 0.095, 0.091, 0.087, 0.085, 0.083, 0.08, 0.077, 0.083, 0.091, 0.091,
			0.089, 0.091,
		],
		[
			0.097, 0.1, 0.097, 0.094, 0.094, 0.091, 0.089, 0.088, 0.085, 0.08, 0.077, 0.083, 0.089, 0.087,
			0.086, 0.091,
		],
		[
			0.093, 0.091, 0.089, 0.091, 0.094, 0.091, 0.085, 0.082, 0.082, 0.08, 0.077, 0.083, 0.088,
			0.083, 0.08, 0.088,
		],
		[
			0.082, 0.082, 0.085, 0.091, 0.092, 0.085, 0.076, 0.075, 0.077, 0.071, 0.068, 0.079, 0.088,
			0.083, 0.077, 0.08,
		],
		[
			0.085, 0.089, 0.089, 0.088, 0.085, 0.08, 0.077, 0.079, 0.079, 0.071, 0.068, 0.076, 0.082,
			0.08, 0.077, 0.08,
		],
		[
			0.082, 0.08, 0.077, 0.08, 0.082, 0.079, 0.073, 0.07, 0.067, 0.059, 0.054, 0.063, 0.074, 0.073,
			0.073, 0.079,
		],
		[
			0.082, 0.08, 0.077, 0.077, 0.077, 0.076, 0.072, 0.069, 0.067, 0.059, 0.053, 0.059, 0.067,
			0.069, 0.072, 0.079,
		],
		[
			0.07, 0.068, 0.065, 0.068, 0.07, 0.067, 0.062, 0.063, 0.065, 0.059, 0.053, 0.056, 0.059, 0.06,
			0.062, 0.067,
		],
		[
			0.065, 0.065, 0.065, 0.064, 0.062, 0.057, 0.054, 0.055, 0.055, 0.047, 0.042, 0.044, 0.05,
			0.055, 0.061, 0.064,
		],
		[
			0.052, 0.053, 0.053, 0.053, 0.05, 0.044, 0.039, 0.039, 0.041, 0.036, 0.033, 0.038, 0.041,
			0.041, 0.043, 0.048,
		],
		[
			0.038, 0.041, 0.041, 0.039, 0.035, 0.03, 0.024, 0.026, 0.03, 0.024, 0.018, 0.018, 0.019,
			0.022, 0.028, 0.033,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'cypress-turntable.mp4',
		views: 35,
		stills: [
			{ file: '01-whole-column-distant.png', turn: 0 },
			{ file: '02-whole-column-profile.png', turn: 90 },
			{ file: '18-silhouette.png', turn: 0 },
		],
	},
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0.5863,
	height: 0.0244,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.59;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.17;
export const crownBase = 0.031;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.8733, mean: 0.9179, highest: 0.9556 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
