// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `bracken`, measured from its reference turning video
// `bracken-turntable-halfturn.mp4`. Run `bun run plants:fit bracken` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 16 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0, 0.071, 0.143, 0.214, 0.286, 0.357, 0.429, 0.5, 0.571, 0.643, 0.714, 0.786, 0.857, 0.929, 1,
	],
	radii: [
		[
			0.765, 0.332, 0.083, 0.102, 0.194, 0.235, 0.1, 0, 0.297, 0.809, 0.897, 0.701, 0.602, 0.582,
			0.65, 0.827,
		],
		[
			1.272, 1.24, 1.094, 0.954, 0.885, 0.862, 0.948, 1.135, 1.238, 1.144, 0.966, 0.851, 0.818, 0.9,
			1.07, 1.204,
		],
		[
			1.218, 1.198, 1.061, 0.876, 0.76, 0.76, 0.903, 1.122, 1.207, 1.084, 0.939, 0.892, 0.94, 1.05,
			1.148, 1.194,
		],
		[
			1.322, 1.312, 1.191, 0.953, 0.811, 0.851, 1.013, 1.205, 1.276, 1.208, 1.113, 1.052, 1.035,
			1.089, 1.213, 1.304,
		],
		[
			1.322, 1.314, 1.229, 1.078, 0.997, 1.016, 1.093, 1.2, 1.264, 1.203, 1.068, 1.003, 1.045,
			1.132, 1.225, 1.298,
		],
		[
			1.322, 1.284, 1.143, 0.974, 0.908, 0.961, 1.11, 1.256, 1.273, 1.175, 1.071, 1.026, 1.046,
			1.11, 1.204, 1.291,
		],
		[
			1.177, 1.113, 0.955, 0.862, 0.902, 1.008, 1.152, 1.199, 1.024, 0.783, 0.689, 0.753, 0.899,
			1.03, 1.121, 1.169,
		],
		[
			1.143, 1.05, 0.809, 0.578, 0.472, 0.473, 0.581, 0.822, 0.999, 0.902, 0.72, 0.656, 0.693,
			0.769, 0.888, 1.054,
		],
		[
			1.165, 1.075, 0.77, 0.538, 0.483, 0.518, 0.624, 0.839, 0.998, 0.897, 0.723, 0.637, 0.634,
			0.694, 0.821, 1.018,
		],
		[
			1.268, 1.129, 0.753, 0.475, 0.409, 0.447, 0.59, 0.871, 1.052, 0.91, 0.698, 0.602, 0.591,
			0.678, 0.882, 1.13,
		],
		[
			1.175, 1.113, 0.84, 0.578, 0.472, 0.48, 0.619, 0.759, 0.696, 0.554, 0.502, 0.518, 0.568,
			0.643, 0.801, 1.027,
		],
		[
			0.545, 0.463, 0.261, 0.129, 0.105, 0.105, 0.129, 0.21, 0.346, 0.442, 0.468, 0.463, 0.437,
			0.435, 0.481, 0.523,
		],
		[
			0.454, 0.567, 0.566, 0.429, 0.297, 0.256, 0.28, 0.368, 0.478, 0.526, 0.478, 0.374, 0.297,
			0.268, 0.272, 0.335,
		],
		[0.064, 0, 0, 0.045, 0.091, 0.045, 0, 0, 0, 0, 0, 0, 0, 0, 0.064, 0.128],
		0,
	],
	source: { method: 'turntable-hull', from: 'bracken-turntable-halfturn.mp4', views: 16 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = { angles: [0, 45, 90, 135], width: 0.1362, height: 0.0651 } as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 2.5;
export const crownBase = 0;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.6531, mean: 0.7214, highest: 0.8128 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the envelope's outlines match the views it came from with a mean overlap of only 0.7214: the plant drifts between views, or is too open for a hull to stand for it",
];
