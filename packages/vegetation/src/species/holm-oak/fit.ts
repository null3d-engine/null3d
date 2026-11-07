// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `holm-oak`, measured from its reference turning video
// `holm-oak-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit holm-oak`
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
		0.094, 0.158, 0.223, 0.288, 0.353, 0.417, 0.482, 0.547, 0.612, 0.676, 0.741, 0.806, 0.871,
		0.935, 1,
	],
	radii: [
		[
			0.111, 0.084, 0.062, 0.087, 0.116, 0.101, 0.086, 0.099, 0.108, 0.093, 0.073, 0.094, 0.121,
			0.09, 0.068, 0.096,
		],
		[
			0.131, 0.099, 0.073, 0.103, 0.137, 0.119, 0.101, 0.116, 0.127, 0.11, 0.086, 0.111, 0.142,
			0.106, 0.08, 0.113,
		],
		[
			0.223, 0.147, 0.084, 0.139, 0.196, 0.152, 0.118, 0.201, 0.26, 0.175, 0.095, 0.134, 0.176,
			0.129, 0.098, 0.174,
		],
		[
			0.365, 0.234, 0.114, 0.176, 0.239, 0.189, 0.153, 0.278, 0.37, 0.239, 0.118, 0.275, 0.44,
			0.279, 0.131, 0.26,
		],
		[
			0.448, 0.336, 0.206, 0.339, 0.478, 0.318, 0.186, 0.321, 0.417, 0.271, 0.139, 0.305, 0.479,
			0.311, 0.164, 0.315,
		],
		[
			0.605, 0.546, 0.507, 0.59, 0.657, 0.563, 0.483, 0.539, 0.556, 0.44, 0.373, 0.507, 0.641,
			0.563, 0.506, 0.578,
		],
		[
			0.626, 0.564, 0.54, 0.617, 0.666, 0.587, 0.539, 0.587, 0.604, 0.543, 0.483, 0.544, 0.63,
			0.593, 0.572, 0.625,
		],
		[
			0.613, 0.565, 0.548, 0.613, 0.661, 0.585, 0.526, 0.564, 0.589, 0.545, 0.487, 0.56, 0.662,
			0.62, 0.588, 0.622,
		],
		[
			0.584, 0.546, 0.532, 0.591, 0.621, 0.539, 0.493, 0.553, 0.594, 0.554, 0.493, 0.547, 0.631,
			0.583, 0.547, 0.583,
		],
		[
			0.572, 0.521, 0.495, 0.563, 0.597, 0.493, 0.435, 0.5, 0.552, 0.523, 0.473, 0.528, 0.604,
			0.556, 0.52, 0.564,
		],
		[
			0.503, 0.453, 0.434, 0.472, 0.486, 0.429, 0.407, 0.461, 0.504, 0.488, 0.453, 0.506, 0.571,
			0.52, 0.479, 0.509,
		],
		[
			0.457, 0.42, 0.41, 0.438, 0.441, 0.388, 0.369, 0.417, 0.452, 0.432, 0.407, 0.448, 0.49, 0.458,
			0.447, 0.472,
		],
		[
			0.395, 0.35, 0.321, 0.362, 0.389, 0.325, 0.279, 0.303, 0.342, 0.355, 0.33, 0.339, 0.372,
			0.367, 0.37, 0.399,
		],
		[
			0.169, 0.12, 0.065, 0.122, 0.192, 0.108, 0.029, 0.091, 0.193, 0.219, 0.197, 0.177, 0.172,
			0.194, 0.192, 0.178,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'holm-oak-turntable.mp4',
		views: 35,
		stills: [
			{ file: '01-whole-clump-distant.png', turn: 0 },
			{ file: '02-whole-clump-profile.png', turn: 90 },
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
	width: 0.2979,
	height: 0.1912,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.3;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.15;
export const crownBase = 0.094;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.5752, mean: 0.7529, highest: 0.8519 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
