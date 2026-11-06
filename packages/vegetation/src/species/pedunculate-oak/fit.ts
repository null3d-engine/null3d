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
			0.382, 0.217, 0.062, 0.205, 0.445, 0.525, 0.51, 0.532, 0.546, 0.544, 0.529, 0.528, 0.47,
			0.275, 0.119, 0.237,
		],
		[
			0.449, 0.255, 0.073, 0.241, 0.523, 0.617, 0.6, 0.626, 0.642, 0.64, 0.623, 0.621, 0.553, 0.324,
			0.139, 0.279,
		],
		[
			0.764, 0.808, 0.754, 0.745, 0.735, 0.7, 0.693, 0.746, 0.788, 0.759, 0.699, 0.707, 0.699,
			0.541, 0.42, 0.545,
		],
		[
			0.843, 0.849, 0.79, 0.766, 0.754, 0.718, 0.698, 0.739, 0.779, 0.742, 0.664, 0.686, 0.726,
			0.623, 0.58, 0.713,
		],
		[
			0.831, 0.832, 0.77, 0.747, 0.744, 0.7, 0.663, 0.698, 0.748, 0.72, 0.666, 0.702, 0.751, 0.693,
			0.647, 0.729,
		],
		[
			0.805, 0.813, 0.763, 0.76, 0.764, 0.732, 0.718, 0.743, 0.748, 0.708, 0.668, 0.7, 0.737, 0.659,
			0.592, 0.68,
		],
		[
			0.741, 0.718, 0.65, 0.632, 0.66, 0.687, 0.702, 0.725, 0.74, 0.727, 0.708, 0.737, 0.738, 0.636,
			0.577, 0.654,
		],
		[
			0.682, 0.634, 0.601, 0.647, 0.69, 0.708, 0.723, 0.74, 0.73, 0.689, 0.677, 0.729, 0.731, 0.61,
			0.535, 0.611,
		],
		[
			0.648, 0.662, 0.662, 0.695, 0.705, 0.7, 0.691, 0.694, 0.679, 0.639, 0.626, 0.67, 0.653, 0.523,
			0.452, 0.532,
		],
		[
			0.645, 0.663, 0.656, 0.663, 0.626, 0.56, 0.525, 0.566, 0.626, 0.618, 0.582, 0.581, 0.57,
			0.502, 0.46, 0.537,
		],
		[
			0.595, 0.597, 0.551, 0.521, 0.512, 0.499, 0.471, 0.496, 0.52, 0.43, 0.326, 0.382, 0.474,
			0.411, 0.374, 0.488,
		],
		[
			0.5, 0.534, 0.512, 0.489, 0.471, 0.451, 0.432, 0.409, 0.375, 0.334, 0.306, 0.358, 0.421,
			0.361, 0.322, 0.402,
		],
		[
			0.375, 0.38, 0.387, 0.394, 0.403, 0.412, 0.393, 0.362, 0.338, 0.306, 0.272, 0.289, 0.332,
			0.339, 0.351, 0.371,
		],
		[
			0.25, 0.201, 0.166, 0.195, 0.241, 0.26, 0.268, 0.25, 0.214, 0.197, 0.197, 0.226, 0.262, 0.267,
			0.265, 0.266,
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
	height: 0.0638,
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
export const consistency = { lowest: 0.7236, mean: 0.7911, highest: 0.8604 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
