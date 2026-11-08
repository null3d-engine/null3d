// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `small-leaved-lime`, measured from its reference turning video
// `small-leaved-lime-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit small-leaved-lime`
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
		0.156, 0.217, 0.277, 0.337, 0.397, 0.458, 0.518, 0.578, 0.638, 0.699, 0.759, 0.819, 0.879, 0.94,
		1,
	],
	radii: [
		[
			0.253, 0.202, 0.156, 0.188, 0.235, 0.214, 0.201, 0.236, 0.265, 0.267, 0.265, 0.284, 0.292,
			0.26, 0.234, 0.249,
		],
		[
			0.297, 0.237, 0.184, 0.221, 0.276, 0.252, 0.237, 0.278, 0.312, 0.314, 0.312, 0.334, 0.343,
			0.306, 0.276, 0.293,
		],
		[
			0.338, 0.317, 0.306, 0.323, 0.329, 0.309, 0.308, 0.329, 0.345, 0.352, 0.347, 0.351, 0.356,
			0.338, 0.32, 0.329,
		],
		[
			0.362, 0.343, 0.319, 0.319, 0.338, 0.354, 0.37, 0.381, 0.372, 0.343, 0.316, 0.321, 0.346,
			0.35, 0.349, 0.359,
		],
		[
			0.394, 0.37, 0.355, 0.356, 0.348, 0.339, 0.362, 0.389, 0.381, 0.345, 0.322, 0.335, 0.356,
			0.36, 0.371, 0.394,
		],
		[
			0.352, 0.354, 0.352, 0.348, 0.341, 0.329, 0.33, 0.343, 0.346, 0.339, 0.339, 0.344, 0.344,
			0.334, 0.33, 0.342,
		],
		[
			0.38, 0.363, 0.343, 0.338, 0.336, 0.342, 0.358, 0.373, 0.378, 0.369, 0.344, 0.329, 0.325,
			0.317, 0.327, 0.361,
		],
		[
			0.325, 0.304, 0.301, 0.315, 0.323, 0.333, 0.354, 0.37, 0.369, 0.354, 0.334, 0.321, 0.325,
			0.33, 0.33, 0.333,
		],
		[
			0.289, 0.276, 0.283, 0.298, 0.301, 0.297, 0.299, 0.316, 0.329, 0.312, 0.291, 0.293, 0.298,
			0.298, 0.302, 0.302,
		],
		[
			0.283, 0.272, 0.261, 0.266, 0.277, 0.279, 0.288, 0.301, 0.295, 0.274, 0.26, 0.261, 0.267,
			0.275, 0.283, 0.286,
		],
		[
			0.24, 0.241, 0.248, 0.255, 0.254, 0.249, 0.249, 0.26, 0.257, 0.23, 0.225, 0.245, 0.254, 0.244,
			0.235, 0.238,
		],
		[
			0.21, 0.198, 0.192, 0.201, 0.204, 0.198, 0.201, 0.206, 0.201, 0.191, 0.188, 0.197, 0.208,
			0.203, 0.198, 0.206,
		],
		[
			0.169, 0.161, 0.156, 0.159, 0.159, 0.158, 0.167, 0.183, 0.185, 0.178, 0.173, 0.17, 0.167,
			0.16, 0.161, 0.169,
		],
		[
			0.1, 0.102, 0.107, 0.111, 0.109, 0.107, 0.102, 0.096, 0.097, 0.099, 0.098, 0.105, 0.112,
			0.102, 0.097, 0.1,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'small-leaved-lime-turntable.mp4',
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
	width: 0.3172,
	height: 0.1431,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.32;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.74;
export const crownBase = 0.156;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7866, mean: 0.8718, highest: 0.9344 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
