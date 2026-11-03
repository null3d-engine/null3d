// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `sedge`, measured from its reference turning video
// `sedge-turntable-e.mp4`. Run `bun run plants:fit sedge` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.01, 0.081, 0.152, 0.222, 0.293, 0.364, 0.435, 0.505, 0.576, 0.647, 0.717, 0.788, 0.859, 0.929,
		1,
	],
	radii: [
		[0.003, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.003, 0.007],
		[
			0.694, 0.631, 0.544, 0.505, 0.504, 0.508, 0.519, 0.503, 0.478, 0.479, 0.502, 0.551, 0.609,
			0.66, 0.692, 0.705,
		],
		[
			0.717, 0.692, 0.643, 0.619, 0.641, 0.668, 0.652, 0.614, 0.6, 0.607, 0.633, 0.673, 0.705,
			0.714, 0.709, 0.712,
		],
		[
			0.701, 0.666, 0.627, 0.62, 0.645, 0.661, 0.635, 0.598, 0.586, 0.595, 0.619, 0.657, 0.693,
			0.706, 0.706, 0.708,
		],
		[
			0.678, 0.644, 0.614, 0.61, 0.623, 0.627, 0.606, 0.584, 0.579, 0.583, 0.603, 0.643, 0.683, 0.7,
			0.698, 0.693,
		],
		[
			0.649, 0.613, 0.588, 0.59, 0.607, 0.618, 0.593, 0.558, 0.547, 0.555, 0.581, 0.624, 0.661,
			0.672, 0.666, 0.664,
		],
		[
			0.627, 0.587, 0.555, 0.556, 0.582, 0.595, 0.564, 0.525, 0.52, 0.525, 0.541, 0.584, 0.621,
			0.635, 0.64, 0.643,
		],
		[
			0.578, 0.539, 0.516, 0.526, 0.547, 0.55, 0.523, 0.494, 0.479, 0.472, 0.484, 0.526, 0.557,
			0.563, 0.572, 0.588,
		],
		[
			0.53, 0.474, 0.425, 0.428, 0.466, 0.479, 0.457, 0.436, 0.425, 0.414, 0.415, 0.431, 0.452,
			0.479, 0.515, 0.544,
		],
		[
			0.515, 0.433, 0.36, 0.352, 0.388, 0.405, 0.372, 0.323, 0.3, 0.308, 0.306, 0.283, 0.283, 0.347,
			0.458, 0.532,
		],
		[
			0.125, 0.089, 0.084, 0.112, 0.19, 0.291, 0.335, 0.304, 0.266, 0.245, 0.212, 0.183, 0.195,
			0.215, 0.2, 0.169,
		],
		[
			0.099, 0.081, 0.089, 0.122, 0.186, 0.261, 0.282, 0.237, 0.183, 0.149, 0.136, 0.144, 0.166,
			0.185, 0.179, 0.143,
		],
		[
			0.006, 0.007, 0.006, 0.006, 0.007, 0.041, 0.099, 0.106, 0.07, 0.042, 0.03, 0.027, 0.03, 0.042,
			0.042, 0.019,
		],
		[0, 0, 0, 0, 0, 0.007, 0.031, 0.041, 0.017, 0, 0, 0, 0, 0, 0, 0],
		0,
	],
	source: { method: 'turntable-hull', from: 'sedge-turntable-e.mp4', views: 32 },
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
export const consistency = { lowest: 0.6479, mean: 0.7294, highest: 0.7851 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the last frame shows the first frame's plant with an overlap of only 0.6622: the plant changes shape over the turn, or the turn does not come back to its start",
	"the envelope's outlines match the views it came from with a mean overlap of only 0.7294: the plant drifts between views, or is too open for a hull to stand for it",
];
