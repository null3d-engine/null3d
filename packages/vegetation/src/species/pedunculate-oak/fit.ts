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
			0.314, 0.335, 0.338, 0.367, 0.433, 0.494, 0.531, 0.532, 0.507, 0.513, 0.515, 0.441, 0.34,
			0.278, 0.255, 0.273,
		],
		[
			0.37, 0.394, 0.397, 0.432, 0.509, 0.581, 0.625, 0.625, 0.596, 0.604, 0.606, 0.519, 0.4, 0.327,
			0.3, 0.322,
		],
		[
			0.649, 0.597, 0.551, 0.538, 0.589, 0.682, 0.74, 0.754, 0.746, 0.715, 0.684, 0.671, 0.68,
			0.715, 0.734, 0.702,
		],
		[
			0.761, 0.677, 0.617, 0.597, 0.626, 0.692, 0.748, 0.764, 0.758, 0.738, 0.699, 0.677, 0.707,
			0.771, 0.825, 0.825,
		],
		[
			0.75, 0.7, 0.668, 0.657, 0.661, 0.679, 0.707, 0.732, 0.741, 0.71, 0.652, 0.634, 0.68, 0.754,
			0.806, 0.799,
		],
		[
			0.724, 0.661, 0.626, 0.627, 0.642, 0.668, 0.697, 0.701, 0.698, 0.706, 0.704, 0.689, 0.696,
			0.734, 0.772, 0.771,
		],
		[
			0.659, 0.591, 0.57, 0.589, 0.63, 0.679, 0.717, 0.728, 0.714, 0.691, 0.674, 0.66, 0.64, 0.645,
			0.694, 0.715,
		],
		[
			0.599, 0.555, 0.533, 0.554, 0.61, 0.671, 0.695, 0.683, 0.676, 0.693, 0.708, 0.684, 0.644,
			0.617, 0.615, 0.622,
		],
		[
			0.557, 0.505, 0.47, 0.489, 0.567, 0.634, 0.63, 0.602, 0.613, 0.659, 0.689, 0.674, 0.658,
			0.664, 0.648, 0.603,
		],
		[
			0.556, 0.499, 0.475, 0.495, 0.542, 0.587, 0.6, 0.581, 0.553, 0.522, 0.496, 0.509, 0.568,
			0.634, 0.653, 0.615,
		],
		[
			0.482, 0.44, 0.4, 0.375, 0.385, 0.395, 0.396, 0.428, 0.462, 0.459, 0.449, 0.468, 0.51, 0.553,
			0.571, 0.538,
		],
		[
			0.445, 0.394, 0.361, 0.355, 0.355, 0.339, 0.325, 0.328, 0.344, 0.373, 0.398, 0.417, 0.451,
			0.492, 0.508, 0.49,
		],
		[
			0.357, 0.357, 0.351, 0.33, 0.299, 0.275, 0.277, 0.294, 0.311, 0.337, 0.375, 0.401, 0.404,
			0.406, 0.398, 0.372,
		],
		[
			0.191, 0.241, 0.268, 0.246, 0.216, 0.207, 0.205, 0.203, 0.211, 0.244, 0.279, 0.269, 0.22,
			0.178, 0.157, 0.16,
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
export const consistency = { lowest: 0.7925, mean: 0.8096, highest: 0.8427 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
