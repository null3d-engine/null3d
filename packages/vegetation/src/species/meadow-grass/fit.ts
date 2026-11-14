// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `meadow-grass`, measured from its reference turning video
// `grass-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit meadow-grass`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 36 views of the turning
 * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; `source`
 * names the stills and the turn each honours. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.052, 0.12, 0.188, 0.255, 0.323, 0.391, 0.458, 0.526, 0.594, 0.661, 0.729, 0.797, 0.865, 0.932,
		1,
	],
	radii: [
		[
			0.127, 0.104, 0.089, 0.123, 0.166, 0.166, 0.166, 0.181, 0.184, 0.174, 0.153, 0.151, 0.162,
			0.137, 0.108, 0.117,
		],
		[
			0.15, 0.123, 0.104, 0.145, 0.195, 0.195, 0.195, 0.212, 0.216, 0.205, 0.18, 0.178, 0.19, 0.161,
			0.127, 0.138,
		],
		[
			0.381, 0.329, 0.277, 0.314, 0.361, 0.355, 0.342, 0.381, 0.407, 0.358, 0.308, 0.318, 0.33,
			0.29, 0.256, 0.316,
		],
		[
			0.339, 0.309, 0.284, 0.314, 0.356, 0.35, 0.36, 0.445, 0.471, 0.358, 0.294, 0.336, 0.368,
			0.354, 0.327, 0.332,
		],
		[
			0.325, 0.318, 0.318, 0.329, 0.345, 0.362, 0.393, 0.439, 0.446, 0.398, 0.359, 0.376, 0.412,
			0.394, 0.354, 0.336,
		],
		[
			0.357, 0.365, 0.345, 0.322, 0.318, 0.326, 0.334, 0.336, 0.329, 0.314, 0.311, 0.35, 0.372,
			0.318, 0.288, 0.322,
		],
		[
			0.334, 0.267, 0.213, 0.236, 0.275, 0.276, 0.287, 0.345, 0.364, 0.302, 0.253, 0.305, 0.352,
			0.279, 0.234, 0.302,
		],
		[
			0.411, 0.349, 0.277, 0.282, 0.313, 0.338, 0.339, 0.366, 0.376, 0.287, 0.206, 0.261, 0.323,
			0.243, 0.199, 0.319,
		],
		[
			0.415, 0.364, 0.304, 0.317, 0.351, 0.363, 0.367, 0.415, 0.418, 0.304, 0.205, 0.269, 0.355,
			0.266, 0.203, 0.319,
		],
		[
			0.443, 0.372, 0.303, 0.327, 0.369, 0.378, 0.389, 0.439, 0.443, 0.349, 0.268, 0.324, 0.385,
			0.295, 0.251, 0.368,
		],
		[
			0.316, 0.227, 0.154, 0.223, 0.325, 0.326, 0.322, 0.403, 0.428, 0.318, 0.227, 0.268, 0.311,
			0.244, 0.202, 0.276,
		],
		[
			0.216, 0.149, 0.093, 0.148, 0.213, 0.158, 0.112, 0.202, 0.302, 0.261, 0.187, 0.197, 0.223,
			0.209, 0.193, 0.214,
		],
		[
			0.188, 0.123, 0.071, 0.102, 0.143, 0.13, 0.127, 0.18, 0.218, 0.191, 0.15, 0.165, 0.197, 0.186,
			0.165, 0.183,
		],
		[
			0.023, 0.017, 0.016, 0.028, 0.042, 0.049, 0.044, 0.037, 0.029, 0.016, 0.008, 0.015, 0.023,
			0.015, 0.008, 0.015,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'grass-turntable.mp4',
		views: 36,
		stills: [
			{ file: '01-whole-tuft-distant.png', turn: 0 },
			{ file: '02-whole-tuft-profile.png', turn: 90 },
			{ file: '17-tuft-height-profile.png', turn: 90 },
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
	width: 0.1807,
	height: 0.0572,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/**
 * Crown width over plant height, and the crown's base as a share of the height, over the views.
 *
 * The turning video's hull reads 0.76 wide over high, which is the video's plant. The whole-plant
 * stills read 1.04, 1.24, 1.40 and 1.36 tall over wide, a mean of 1.26, and they are the standard
 * that judges a plant; the record takes the stills' standard of about 1.2 tall over wide, 1/1.2 or
 * about 0.83 wide over high. The video's figure is recorded as a reference conflict.
 */
export const aspect = 0.83;
export const crownBase = 0.052;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.3711, mean: 0.4872, highest: 0.5613 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the envelope's outlines match the views it came from with a mean overlap of only 0.4872: the plant drifts between views, or is too open for a hull to stand for it",
];
