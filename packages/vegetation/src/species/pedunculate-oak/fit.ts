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
			0.056, 0.073, 0.119, 0.229, 0.373, 0.478, 0.534, 0.53, 0.486, 0.484, 0.491, 0.376, 0.185,
			0.081, 0.058, 0.052,
		],
		[
			0.066, 0.086, 0.14, 0.27, 0.439, 0.562, 0.628, 0.623, 0.572, 0.569, 0.578, 0.442, 0.218,
			0.095, 0.068, 0.061,
		],
		[
			0.486, 0.413, 0.411, 0.453, 0.541, 0.658, 0.739, 0.757, 0.734, 0.705, 0.686, 0.676, 0.679,
			0.702, 0.698, 0.61,
		],
		[
			0.703, 0.599, 0.531, 0.522, 0.565, 0.636, 0.712, 0.748, 0.744, 0.728, 0.695, 0.675, 0.707,
			0.77, 0.819, 0.797,
		],
		[
			0.709, 0.653, 0.64, 0.64, 0.646, 0.661, 0.684, 0.713, 0.716, 0.68, 0.638, 0.627, 0.672, 0.752,
			0.806, 0.785,
		],
		[
			0.648, 0.588, 0.585, 0.603, 0.62, 0.647, 0.677, 0.689, 0.69, 0.693, 0.69, 0.679, 0.686, 0.728,
			0.765, 0.734,
		],
		[
			0.628, 0.58, 0.569, 0.583, 0.621, 0.675, 0.721, 0.726, 0.702, 0.684, 0.663, 0.621, 0.593,
			0.615, 0.668, 0.681,
		],
		[
			0.563, 0.544, 0.531, 0.555, 0.618, 0.665, 0.682, 0.677, 0.668, 0.685, 0.703, 0.675, 0.628,
			0.597, 0.582, 0.577,
		],
		[
			0.451, 0.432, 0.425, 0.444, 0.526, 0.611, 0.624, 0.602, 0.604, 0.642, 0.679, 0.672, 0.653,
			0.644, 0.601, 0.517,
		],
		[
			0.489, 0.452, 0.445, 0.462, 0.506, 0.563, 0.591, 0.574, 0.536, 0.515, 0.518, 0.523, 0.557,
			0.617, 0.625, 0.56,
		],
		[
			0.474, 0.408, 0.342, 0.296, 0.271, 0.281, 0.332, 0.386, 0.402, 0.404, 0.423, 0.446, 0.475,
			0.525, 0.559, 0.533,
		],
		[
			0.393, 0.331, 0.287, 0.264, 0.266, 0.287, 0.308, 0.315, 0.327, 0.36, 0.391, 0.411, 0.439,
			0.476, 0.496, 0.464,
		],
		[
			0.35, 0.345, 0.317, 0.276, 0.25, 0.247, 0.264, 0.289, 0.308, 0.332, 0.369, 0.387, 0.385,
			0.394, 0.392, 0.366,
		],
		[
			0.201, 0.238, 0.254, 0.234, 0.203, 0.189, 0.186, 0.189, 0.203, 0.24, 0.267, 0.242, 0.196,
			0.165, 0.154, 0.168,
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
export const consistency = { lowest: 0.7664, mean: 0.8067, highest: 0.8496 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
