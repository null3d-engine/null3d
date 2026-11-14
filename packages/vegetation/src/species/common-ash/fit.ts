// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `common-ash`, measured from its reference turning video
// `common-ash-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit common-ash`
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
		0.25, 0.304, 0.357, 0.411, 0.464, 0.518, 0.571, 0.625, 0.679, 0.732, 0.786, 0.839, 0.893, 0.946,
		1,
	],
	radii: [
		[
			0.212, 0.113, 0.016, 0.072, 0.131, 0.084, 0.043, 0.148, 0.299, 0.315, 0.273, 0.29, 0.27,
			0.156, 0.057, 0.124,
		],
		[
			0.249, 0.133, 0.019, 0.085, 0.154, 0.099, 0.051, 0.174, 0.352, 0.371, 0.321, 0.341, 0.318,
			0.183, 0.067, 0.146,
		],
		[
			0.405, 0.195, 0.07, 0.161, 0.282, 0.234, 0.235, 0.39, 0.5, 0.512, 0.472, 0.436, 0.434, 0.455,
			0.467, 0.482,
		],
		[
			0.419, 0.225, 0.12, 0.206, 0.304, 0.247, 0.252, 0.405, 0.514, 0.525, 0.479, 0.453, 0.465,
			0.476, 0.489, 0.505,
		],
		[
			0.456, 0.298, 0.189, 0.245, 0.334, 0.305, 0.318, 0.426, 0.502, 0.516, 0.481, 0.473, 0.488,
			0.463, 0.467, 0.508,
		],
		[
			0.391, 0.336, 0.299, 0.351, 0.408, 0.371, 0.368, 0.445, 0.497, 0.498, 0.475, 0.466, 0.453,
			0.42, 0.409, 0.415,
		],
		[
			0.374, 0.34, 0.304, 0.335, 0.393, 0.382, 0.409, 0.505, 0.55, 0.525, 0.481, 0.467, 0.467,
			0.432, 0.396, 0.387,
		],
		[
			0.449, 0.325, 0.243, 0.283, 0.343, 0.372, 0.423, 0.5, 0.528, 0.485, 0.423, 0.422, 0.452,
			0.431, 0.412, 0.457,
		],
		[
			0.471, 0.405, 0.333, 0.338, 0.372, 0.391, 0.434, 0.47, 0.466, 0.445, 0.415, 0.409, 0.417,
			0.396, 0.397, 0.451,
		],
		[
			0.456, 0.436, 0.381, 0.358, 0.366, 0.361, 0.384, 0.44, 0.466, 0.456, 0.419, 0.395, 0.386,
			0.355, 0.36, 0.416,
		],
		[
			0.363, 0.356, 0.339, 0.338, 0.355, 0.361, 0.381, 0.421, 0.441, 0.424, 0.362, 0.337, 0.347,
			0.304, 0.293, 0.342,
		],
		[
			0.298, 0.284, 0.255, 0.263, 0.294, 0.334, 0.373, 0.403, 0.398, 0.357, 0.314, 0.301, 0.288,
			0.24, 0.216, 0.256,
		],
		[
			0.204, 0.204, 0.205, 0.232, 0.254, 0.264, 0.274, 0.311, 0.332, 0.295, 0.26, 0.248, 0.213,
			0.155, 0.126, 0.161,
		],
		[
			0.13, 0.11, 0.098, 0.121, 0.158, 0.182, 0.179, 0.171, 0.163, 0.131, 0.091, 0.116, 0.155,
			0.114, 0.084, 0.114,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'common-ash-turntable.mp4',
		views: 35,
		stills: [
			{ file: '01-whole-distant.png', turn: 0 },
			{ file: '02-whole-profile.png', turn: 90 },
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
	width: 0.2552,
	height: 0.3627,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.37;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.9;
export const crownBase = 0.25;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.5696, mean: 0.6888, highest: 0.7958 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the last frame shows the first frame's plant with an overlap of only 0.7834: the plant changes shape over the turn, or the turn does not come back to its start",
	"the envelope's outlines match the views it came from with a mean overlap of only 0.6888: the plant drifts between views, or is too open for a hull to stand for it",
];
