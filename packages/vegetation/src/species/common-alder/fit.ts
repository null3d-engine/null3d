// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `common-alder`, measured from its reference turning video
// `common-alder-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit common-alder`
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
		0.229, 0.284, 0.339, 0.394, 0.449, 0.504, 0.56, 0.615, 0.67, 0.725, 0.78, 0.835, 0.89, 0.945, 1,
	],
	radii: [
		[
			0.412, 0.253, 0.122, 0.144, 0.187, 0.167, 0.173, 0.318, 0.414, 0.277, 0.15, 0.179, 0.223,
			0.219, 0.249, 0.373,
		],
		[
			0.485, 0.297, 0.144, 0.169, 0.22, 0.196, 0.203, 0.375, 0.487, 0.326, 0.177, 0.21, 0.262,
			0.258, 0.293, 0.439,
		],
		[
			0.459, 0.387, 0.316, 0.313, 0.326, 0.329, 0.349, 0.418, 0.447, 0.37, 0.314, 0.332, 0.355,
			0.361, 0.372, 0.429,
		],
		[
			0.38, 0.263, 0.169, 0.223, 0.315, 0.378, 0.411, 0.43, 0.418, 0.371, 0.33, 0.305, 0.295, 0.301,
			0.28, 0.325,
		],
		[
			0.519, 0.413, 0.315, 0.303, 0.314, 0.349, 0.416, 0.496, 0.496, 0.406, 0.344, 0.337, 0.338,
			0.344, 0.376, 0.471,
		],
		[
			0.507, 0.39, 0.307, 0.325, 0.361, 0.403, 0.429, 0.476, 0.503, 0.433, 0.371, 0.36, 0.351,
			0.355, 0.378, 0.465,
		],
		[
			0.365, 0.333, 0.3, 0.287, 0.292, 0.305, 0.322, 0.374, 0.398, 0.322, 0.263, 0.269, 0.292,
			0.317, 0.339, 0.363,
		],
		[
			0.409, 0.381, 0.341, 0.323, 0.331, 0.353, 0.385, 0.432, 0.451, 0.399, 0.344, 0.333, 0.351,
			0.374, 0.386, 0.401,
		],
		[
			0.354, 0.292, 0.246, 0.247, 0.286, 0.353, 0.392, 0.38, 0.337, 0.29, 0.272, 0.277, 0.288,
			0.313, 0.337, 0.359,
		],
		[
			0.336, 0.303, 0.273, 0.289, 0.303, 0.296, 0.276, 0.276, 0.286, 0.266, 0.229, 0.21, 0.206,
			0.212, 0.23, 0.287,
		],
		[
			0.245, 0.221, 0.209, 0.205, 0.216, 0.244, 0.26, 0.27, 0.273, 0.248, 0.231, 0.233, 0.235,
			0.244, 0.256, 0.261,
		],
		[
			0.175, 0.172, 0.165, 0.17, 0.163, 0.16, 0.165, 0.177, 0.173, 0.136, 0.109, 0.117, 0.132,
			0.123, 0.11, 0.136,
		],
		[
			0.11, 0.091, 0.071, 0.077, 0.1, 0.128, 0.149, 0.169, 0.161, 0.111, 0.075, 0.068, 0.067, 0.068,
			0.072, 0.093,
		],
		[
			0.08, 0.065, 0.05, 0.057, 0.06, 0.059, 0.06, 0.063, 0.059, 0.048, 0.033, 0.024, 0.021, 0.012,
			0.007, 0.04,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'common-alder-turntable.mp4',
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
	width: 0.3258,
	height: 0.2927,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.33;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.8;
export const crownBase = 0.229;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.5674, mean: 0.7519, highest: 0.8512 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
