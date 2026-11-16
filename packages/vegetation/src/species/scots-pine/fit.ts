// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `scots-pine`, measured from its reference turning video
// `pine-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit scots-pine`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views of the turning
 * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; `source`
 * names the stills and the turn each honours. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.406, 0.449, 0.491, 0.533, 0.576, 0.618, 0.661, 0.703, 0.746, 0.788, 0.83, 0.873, 0.915, 0.958,
		1,
	],
	radii: [
		[
			0.332, 0.168, 0.006, 0.073, 0.146, 0.101, 0.058, 0.156, 0.24, 0.137, 0.042, 0.135, 0.243,
			0.236, 0.189, 0.249,
		],
		[
			0.39, 0.197, 0.007, 0.086, 0.171, 0.118, 0.068, 0.183, 0.282, 0.162, 0.049, 0.159, 0.286,
			0.278, 0.222, 0.293,
		],
		[
			0.421, 0.211, 0.007, 0.079, 0.154, 0.101, 0.062, 0.205, 0.333, 0.224, 0.123, 0.187, 0.245,
			0.219, 0.148, 0.269,
		],
		[
			0.682, 0.48, 0.308, 0.34, 0.403, 0.298, 0.189, 0.269, 0.391, 0.448, 0.544, 0.606, 0.587,
			0.586, 0.611, 0.688,
		],
		[
			0.628, 0.587, 0.489, 0.479, 0.514, 0.494, 0.5, 0.533, 0.528, 0.522, 0.527, 0.572, 0.61, 0.559,
			0.536, 0.586,
		],
		[
			0.655, 0.584, 0.459, 0.442, 0.468, 0.456, 0.471, 0.562, 0.647, 0.595, 0.468, 0.488, 0.568,
			0.521, 0.492, 0.579,
		],
		[
			0.601, 0.485, 0.33, 0.279, 0.266, 0.291, 0.372, 0.519, 0.643, 0.613, 0.495, 0.458, 0.456,
			0.397, 0.381, 0.503,
		],
		[
			0.57, 0.49, 0.368, 0.361, 0.386, 0.356, 0.373, 0.513, 0.618, 0.551, 0.445, 0.459, 0.502,
			0.435, 0.366, 0.461,
		],
		[
			0.494, 0.506, 0.493, 0.48, 0.47, 0.463, 0.469, 0.521, 0.57, 0.533, 0.459, 0.463, 0.488, 0.433,
			0.4, 0.445,
		],
		[
			0.481, 0.483, 0.462, 0.45, 0.451, 0.467, 0.497, 0.524, 0.528, 0.496, 0.429, 0.386, 0.376,
			0.374, 0.385, 0.43,
		],
		[
			0.427, 0.456, 0.427, 0.393, 0.377, 0.402, 0.449, 0.501, 0.512, 0.455, 0.379, 0.357, 0.365,
			0.323, 0.274, 0.323,
		],
		[
			0.385, 0.349, 0.287, 0.272, 0.278, 0.317, 0.388, 0.45, 0.459, 0.417, 0.364, 0.337, 0.328,
			0.312, 0.282, 0.318,
		],
		[
			0.222, 0.213, 0.221, 0.234, 0.23, 0.232, 0.263, 0.327, 0.371, 0.346, 0.303, 0.283, 0.263,
			0.231, 0.206, 0.212,
		],
		[
			0.18, 0.167, 0.158, 0.161, 0.157, 0.161, 0.17, 0.206, 0.248, 0.236, 0.199, 0.182, 0.169,
			0.137, 0.12, 0.15,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'pine-turntable.mp4',
		views: 32,
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
	width: 0.4767,
	height: 0.1262,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.48;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.12;
export const crownBase = 0.406;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.6325, mean: 0.6991, highest: 0.7559 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the envelope's outlines match the views it came from with a mean overlap of only 0.6991: the plant drifts between views, or is too open for a hull to stand for it",
];
