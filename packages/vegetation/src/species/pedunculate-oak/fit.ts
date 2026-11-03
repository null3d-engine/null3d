// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `pedunculate-oak`, measured from its reference turning video
// `oak-turntable-b.mp4`. Run `bun run plants:fit pedunculate-oak` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.115, 0.178, 0.241, 0.304, 0.368, 0.431, 0.494, 0.557, 0.621, 0.684, 0.747, 0.81, 0.874, 0.937,
		1,
	],
	radii: [
		[
			0.058, 0.055, 0.062, 0.089, 0.214, 0.409, 0.51, 0.52, 0.522, 0.532, 0.529, 0.469, 0.351,
			0.216, 0.119, 0.076,
		],
		[
			0.069, 0.065, 0.073, 0.105, 0.251, 0.481, 0.6, 0.612, 0.614, 0.626, 0.623, 0.551, 0.413,
			0.254, 0.139, 0.089,
		],
		[
			0.584, 0.718, 0.754, 0.72, 0.685, 0.675, 0.693, 0.715, 0.726, 0.727, 0.699, 0.614, 0.511,
			0.447, 0.42, 0.455,
		],
		[
			0.78, 0.818, 0.79, 0.739, 0.7, 0.691, 0.698, 0.713, 0.727, 0.716, 0.664, 0.596, 0.546, 0.533,
			0.58, 0.681,
		],
		[
			0.772, 0.802, 0.77, 0.718, 0.685, 0.671, 0.663, 0.67, 0.692, 0.692, 0.666, 0.65, 0.648, 0.641,
			0.647, 0.7,
		],
		[
			0.727, 0.775, 0.763, 0.73, 0.704, 0.702, 0.718, 0.721, 0.706, 0.687, 0.668, 0.645, 0.627,
			0.604, 0.592, 0.641,
		],
		[
			0.654, 0.675, 0.65, 0.612, 0.621, 0.668, 0.702, 0.706, 0.702, 0.708, 0.708, 0.685, 0.635,
			0.585, 0.577, 0.611,
		],
		[
			0.581, 0.584, 0.601, 0.625, 0.646, 0.686, 0.723, 0.72, 0.69, 0.669, 0.677, 0.674, 0.623,
			0.555, 0.535, 0.56,
		],
		[
			0.487, 0.582, 0.662, 0.689, 0.693, 0.694, 0.691, 0.671, 0.635, 0.617, 0.626, 0.593, 0.5,
			0.447, 0.452, 0.452,
		],
		[
			0.534, 0.608, 0.656, 0.655, 0.609, 0.552, 0.525, 0.538, 0.57, 0.59, 0.582, 0.547, 0.502,
			0.468, 0.46, 0.482,
		],
		[
			0.511, 0.555, 0.551, 0.507, 0.485, 0.485, 0.471, 0.441, 0.41, 0.375, 0.326, 0.291, 0.292,
			0.32, 0.374, 0.446,
		],
		[
			0.445, 0.506, 0.512, 0.479, 0.451, 0.441, 0.432, 0.395, 0.345, 0.32, 0.306, 0.286, 0.275,
			0.288, 0.322, 0.374,
		],
		[
			0.375, 0.38, 0.387, 0.394, 0.403, 0.412, 0.393, 0.355, 0.325, 0.3, 0.272, 0.258, 0.271, 0.308,
			0.351, 0.371,
		],
		[
			0.219, 0.185, 0.166, 0.176, 0.203, 0.241, 0.268, 0.25, 0.213, 0.197, 0.197, 0.204, 0.218,
			0.246, 0.265, 0.251,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'oak-turntable-b.mp4', views: 32 },
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
export const consistency = { lowest: 0.7758, mean: 0.8127, highest: 0.8399 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
