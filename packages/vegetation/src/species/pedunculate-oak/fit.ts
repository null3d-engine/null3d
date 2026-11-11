// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `pedunculate-oak`, measured from its reference turning video
// `oak-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit pedunculate-oak`
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
		0.115, 0.178, 0.241, 0.304, 0.368, 0.431, 0.494, 0.557, 0.621, 0.684, 0.747, 0.81, 0.874, 0.937,
		1,
	],
	radii: [
		[
			0.385, 0.223, 0.073, 0.216, 0.454, 0.533, 0.512, 0.526, 0.538, 0.539, 0.532, 0.532, 0.476,
			0.293, 0.136, 0.245,
		],
		[
			0.453, 0.262, 0.085, 0.254, 0.534, 0.627, 0.602, 0.619, 0.633, 0.634, 0.626, 0.626, 0.56,
			0.345, 0.16, 0.288,
		],
		[
			0.766, 0.813, 0.759, 0.744, 0.735, 0.7, 0.687, 0.738, 0.78, 0.75, 0.692, 0.702, 0.689, 0.541,
			0.429, 0.552,
		],
		[
			0.84, 0.844, 0.793, 0.775, 0.761, 0.712, 0.684, 0.728, 0.773, 0.74, 0.668, 0.684, 0.719, 0.63,
			0.598, 0.721,
		],
		[
			0.827, 0.826, 0.775, 0.758, 0.752, 0.697, 0.648, 0.684, 0.744, 0.723, 0.672, 0.703, 0.746,
			0.697, 0.66, 0.736,
		],
		[
			0.804, 0.815, 0.771, 0.771, 0.77, 0.733, 0.718, 0.74, 0.742, 0.702, 0.669, 0.698, 0.727, 0.66,
			0.605, 0.687,
		],
		[
			0.737, 0.721, 0.658, 0.643, 0.673, 0.697, 0.701, 0.719, 0.737, 0.719, 0.7, 0.733, 0.732,
			0.632, 0.574, 0.647,
		],
		[
			0.68, 0.639, 0.607, 0.653, 0.697, 0.713, 0.723, 0.739, 0.725, 0.68, 0.671, 0.723, 0.718,
			0.594, 0.52, 0.601,
		],
		[
			0.652, 0.667, 0.665, 0.694, 0.701, 0.693, 0.683, 0.685, 0.67, 0.628, 0.617, 0.664, 0.648,
			0.526, 0.463, 0.543,
		],
		[
			0.645, 0.673, 0.666, 0.67, 0.628, 0.554, 0.522, 0.568, 0.623, 0.611, 0.585, 0.587, 0.572,
			0.512, 0.469, 0.534,
		],
		[
			0.601, 0.609, 0.564, 0.532, 0.522, 0.501, 0.461, 0.486, 0.517, 0.427, 0.33, 0.386, 0.471,
			0.415, 0.384, 0.494,
		],
		[
			0.498, 0.528, 0.512, 0.496, 0.477, 0.448, 0.419, 0.397, 0.367, 0.33, 0.309, 0.362, 0.419,
			0.365, 0.331, 0.408,
		],
		[
			0.366, 0.368, 0.38, 0.397, 0.409, 0.413, 0.39, 0.354, 0.332, 0.306, 0.281, 0.298, 0.334,
			0.344, 0.358, 0.369,
		],
		[
			0.248, 0.191, 0.156, 0.19, 0.238, 0.254, 0.265, 0.251, 0.219, 0.207, 0.205, 0.228, 0.258,
			0.273, 0.28, 0.275,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'oak-turntable.mp4',
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
	width: 0.2802,
	height: 0.0433,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.29;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.53;
export const crownBase = 0.115;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7283, mean: 0.795, highest: 0.8661 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
