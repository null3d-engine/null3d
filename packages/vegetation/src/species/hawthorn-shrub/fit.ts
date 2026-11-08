// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `hawthorn-shrub`, measured from its reference turning video
// `hawthorn-turntable-halfturn.mp4` and its whole-plant stills. Run `bun run plants:fit hawthorn-shrub`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 19 views of the turning
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
			0.236, 0.139, 0.05, 0.231, 0.413, 0.268, 0.094, 0.168, 0.253, 0.15, 0.054, 0.144, 0.223,
			0.122, 0.026, 0.129,
		],
		[
			0.278, 0.163, 0.059, 0.272, 0.486, 0.315, 0.11, 0.198, 0.297, 0.176, 0.064, 0.169, 0.262,
			0.143, 0.031, 0.152,
		],
		[
			0.719, 0.675, 0.666, 0.758, 0.809, 0.715, 0.636, 0.643, 0.656, 0.642, 0.642, 0.698, 0.755,
			0.746, 0.713, 0.721,
		],
		[
			0.788, 0.738, 0.708, 0.744, 0.77, 0.728, 0.702, 0.733, 0.749, 0.706, 0.678, 0.731, 0.797,
			0.784, 0.745, 0.773,
		],
		[
			0.792, 0.729, 0.7, 0.76, 0.809, 0.759, 0.72, 0.766, 0.785, 0.709, 0.65, 0.676, 0.727, 0.749,
			0.762, 0.798,
		],
		[
			0.756, 0.705, 0.685, 0.739, 0.763, 0.701, 0.663, 0.696, 0.719, 0.689, 0.666, 0.689, 0.732,
			0.743, 0.729, 0.75,
		],
		[
			0.798, 0.752, 0.702, 0.722, 0.747, 0.708, 0.678, 0.716, 0.747, 0.711, 0.675, 0.689, 0.733,
			0.757, 0.742, 0.767,
		],
		[
			0.805, 0.748, 0.698, 0.747, 0.795, 0.732, 0.685, 0.716, 0.735, 0.694, 0.66, 0.69, 0.735,
			0.734, 0.736, 0.787,
		],
		[
			0.719, 0.678, 0.653, 0.672, 0.688, 0.656, 0.641, 0.689, 0.726, 0.7, 0.674, 0.692, 0.709,
			0.711, 0.708, 0.721,
		],
		[
			0.723, 0.678, 0.63, 0.637, 0.661, 0.637, 0.637, 0.696, 0.716, 0.649, 0.596, 0.608, 0.645,
			0.685, 0.712, 0.731,
		],
		[
			0.677, 0.636, 0.592, 0.63, 0.684, 0.637, 0.592, 0.617, 0.621, 0.57, 0.543, 0.579, 0.624, 0.64,
			0.633, 0.657,
		],
		[
			0.599, 0.556, 0.502, 0.465, 0.443, 0.464, 0.511, 0.556, 0.576, 0.546, 0.508, 0.51, 0.555,
			0.593, 0.587, 0.591,
		],
		[
			0.465, 0.399, 0.348, 0.366, 0.423, 0.454, 0.453, 0.459, 0.439, 0.384, 0.378, 0.405, 0.425,
			0.454, 0.468, 0.478,
		],
		[
			0.251, 0.218, 0.206, 0.216, 0.221, 0.238, 0.26, 0.285, 0.3, 0.275, 0.255, 0.279, 0.321, 0.347,
			0.322, 0.279,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'hawthorn-turntable-halfturn.mp4',
		views: 19,
		stills: [
			{ file: '01-whole-shrub-distant.png', turn: 0 },
			{ file: '02-whole-shrub-profile.png', turn: 90 },
			{ file: '18-silhouette.png', turn: 0 },
		],
	},
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = { angles: [0, 45, 90, 135], width: 0.1418, height: 0.0557 } as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.61;
export const crownBase = 0.031;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7147, mean: 0.8017, highest: 0.8335 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
