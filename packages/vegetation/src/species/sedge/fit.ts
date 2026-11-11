// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `sedge`, measured from its reference turning video
// `sedge-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit sedge`
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
		0.01, 0.081, 0.152, 0.222, 0.293, 0.364, 0.435, 0.505, 0.576, 0.647, 0.717, 0.788, 0.859, 0.929,
		1,
	],
	radii: [
		[
			0.457, 0.29, 0.102, 0.125, 0.144, 0.073, 0.018, 0.22, 0.426, 0.23, 0.031, 0.084, 0.139, 0.09,
			0.054, 0.258,
		],
		[
			0.705, 0.597, 0.509, 0.574, 0.682, 0.657, 0.592, 0.659, 0.707, 0.576, 0.498, 0.617, 0.751,
			0.754, 0.71, 0.721,
		],
		[
			0.728, 0.652, 0.605, 0.66, 0.738, 0.743, 0.702, 0.717, 0.741, 0.67, 0.632, 0.709, 0.782,
			0.776, 0.74, 0.742,
		],
		[
			0.811, 0.681, 0.589, 0.648, 0.724, 0.724, 0.682, 0.684, 0.697, 0.643, 0.625, 0.705, 0.774,
			0.765, 0.731, 0.782,
		],
		[
			0.809, 0.678, 0.579, 0.623, 0.684, 0.688, 0.66, 0.656, 0.651, 0.612, 0.608, 0.682, 0.753,
			0.75, 0.721, 0.776,
		],
		[
			0.79, 0.665, 0.564, 0.592, 0.646, 0.664, 0.646, 0.637, 0.632, 0.597, 0.584, 0.655, 0.733,
			0.726, 0.692, 0.751,
		],
		[
			0.762, 0.631, 0.537, 0.572, 0.621, 0.643, 0.628, 0.66, 0.7, 0.62, 0.562, 0.62, 0.68, 0.68,
			0.659, 0.723,
		],
		[
			0.6, 0.537, 0.509, 0.568, 0.632, 0.62, 0.568, 0.606, 0.666, 0.572, 0.494, 0.57, 0.649, 0.633,
			0.602, 0.613,
		],
		[
			0.639, 0.527, 0.446, 0.508, 0.594, 0.572, 0.502, 0.556, 0.632, 0.541, 0.459, 0.513, 0.567,
			0.543, 0.521, 0.6,
		],
		[
			0.643, 0.499, 0.372, 0.442, 0.549, 0.504, 0.425, 0.492, 0.56, 0.445, 0.339, 0.421, 0.51,
			0.452, 0.446, 0.59,
		],
		[
			0.492, 0.284, 0.119, 0.258, 0.436, 0.426, 0.385, 0.437, 0.454, 0.353, 0.255, 0.345, 0.469,
			0.388, 0.288, 0.406,
		],
		[
			0.461, 0.27, 0.116, 0.209, 0.333, 0.366, 0.356, 0.394, 0.406, 0.273, 0.166, 0.295, 0.442,
			0.354, 0.247, 0.366,
		],
		[
			0.225, 0.153, 0.089, 0.169, 0.26, 0.209, 0.171, 0.282, 0.337, 0.172, 0.041, 0.182, 0.331,
			0.208, 0.095, 0.175,
		],
		[
			0.189, 0.125, 0.051, 0.115, 0.189, 0.123, 0.071, 0.16, 0.214, 0.106, 0.018, 0.072, 0.129,
			0.085, 0.045, 0.12,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'sedge-turntable.mp4',
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
	width: 0.228,
	height: 0.0269,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.42;
export const crownBase = 0.01;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.3194, mean: 0.647, highest: 0.7086 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the last frame shows the first frame's plant with an overlap of only 0.6578: the plant changes shape over the turn, or the turn does not come back to its start",
	"the envelope's outlines match the views it came from with a mean overlap of only 0.647: the plant drifts between views, or is too open for a hull to stand for it",
];
