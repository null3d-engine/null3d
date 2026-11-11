// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `european-beech`, measured from its reference turning video
// `european-beech-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit european-beech`
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
		0.031, 0.1, 0.17, 0.239, 0.308, 0.377, 0.446, 0.516, 0.585, 0.654, 0.723, 0.792, 0.862, 0.931,
		1,
	],
	radii: [
		[
			0.623, 0.533, 0.484, 0.551, 0.605, 0.544, 0.488, 0.554, 0.591, 0.441, 0.289, 0.381, 0.53,
			0.491, 0.482, 0.597,
		],
		[
			0.733, 0.627, 0.569, 0.648, 0.712, 0.64, 0.574, 0.651, 0.696, 0.519, 0.34, 0.448, 0.624,
			0.578, 0.567, 0.703,
		],
		[
			0.76, 0.649, 0.576, 0.641, 0.696, 0.649, 0.618, 0.693, 0.697, 0.507, 0.339, 0.448, 0.645,
			0.639, 0.626, 0.732,
		],
		[
			0.747, 0.636, 0.552, 0.63, 0.711, 0.658, 0.608, 0.685, 0.725, 0.592, 0.457, 0.527, 0.657,
			0.636, 0.617, 0.71,
		],
		[
			0.742, 0.647, 0.593, 0.668, 0.727, 0.667, 0.623, 0.679, 0.701, 0.59, 0.465, 0.537, 0.682,
			0.664, 0.645, 0.727,
		],
		[
			0.692, 0.611, 0.568, 0.64, 0.694, 0.641, 0.607, 0.685, 0.727, 0.611, 0.48, 0.515, 0.606,
			0.593, 0.602, 0.68,
		],
		[
			0.701, 0.624, 0.572, 0.626, 0.663, 0.614, 0.592, 0.668, 0.7, 0.578, 0.444, 0.493, 0.602, 0.58,
			0.566, 0.657,
		],
		[
			0.683, 0.603, 0.561, 0.626, 0.672, 0.624, 0.594, 0.653, 0.678, 0.579, 0.473, 0.52, 0.613,
			0.586, 0.574, 0.657,
		],
		[
			0.669, 0.581, 0.521, 0.557, 0.583, 0.558, 0.546, 0.607, 0.648, 0.58, 0.502, 0.534, 0.595,
			0.572, 0.56, 0.635,
		],
		[
			0.606, 0.525, 0.481, 0.532, 0.572, 0.528, 0.495, 0.544, 0.595, 0.558, 0.493, 0.507, 0.544,
			0.529, 0.54, 0.6,
		],
		[
			0.576, 0.521, 0.472, 0.505, 0.531, 0.507, 0.495, 0.524, 0.542, 0.506, 0.46, 0.469, 0.5, 0.501,
			0.505, 0.548,
		],
		[
			0.493, 0.431, 0.401, 0.442, 0.467, 0.443, 0.43, 0.472, 0.502, 0.459, 0.398, 0.399, 0.435,
			0.447, 0.453, 0.488,
		],
		[
			0.426, 0.36, 0.33, 0.381, 0.404, 0.368, 0.356, 0.401, 0.427, 0.383, 0.335, 0.337, 0.355,
			0.354, 0.358, 0.406,
		],
		[
			0.28, 0.257, 0.237, 0.249, 0.264, 0.268, 0.266, 0.278, 0.275, 0.236, 0.205, 0.216, 0.242,
			0.241, 0.233, 0.257,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'european-beech-turntable.mp4',
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
	width: 0.3836,
	height: 0.0171,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.39;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.3;
export const crownBase = 0.031;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.6991, mean: 0.8109, highest: 0.8671 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
