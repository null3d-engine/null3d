// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `hawthorn-shrub`, measured from its reference turning video
// `hawthorn-turntable-halfturn-b.mp4`. Run `bun run plants:fit hawthorn-shrub` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 16 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.031, 0.1, 0.17, 0.239, 0.308, 0.377, 0.446, 0.516, 0.585, 0.654, 0.723, 0.792, 0.862, 0.931,
		1,
	],
	radii: [
		[0, 0, 0, 0.01, 0.027, 0.029, 0.024, 0.023, 0.023, 0.023, 0.023, 0.019, 0.011, 0.005, 0.001, 0],
		[
			0, 0, 0, 0.012, 0.031, 0.034, 0.028, 0.027, 0.027, 0.027, 0.027, 0.023, 0.013, 0.005, 0.002,
			0,
		],
		[
			0.697, 0.708, 0.714, 0.689, 0.659, 0.643, 0.654, 0.665, 0.67, 0.705, 0.732, 0.72, 0.726,
			0.769, 0.781, 0.733,
		],
		[
			0.749, 0.746, 0.758, 0.741, 0.703, 0.677, 0.688, 0.716, 0.734, 0.761, 0.786, 0.782, 0.767,
			0.768, 0.78, 0.773,
		],
		[
			0.767, 0.775, 0.774, 0.735, 0.674, 0.646, 0.664, 0.71, 0.755, 0.781, 0.798, 0.802, 0.801,
			0.806, 0.799, 0.777,
		],
		[
			0.728, 0.739, 0.76, 0.731, 0.686, 0.664, 0.65, 0.656, 0.689, 0.736, 0.758, 0.742, 0.739,
			0.772, 0.789, 0.76,
		],
		[
			0.767, 0.788, 0.78, 0.724, 0.677, 0.666, 0.686, 0.73, 0.763, 0.771, 0.763, 0.749, 0.749,
			0.757, 0.764, 0.764,
		],
		[
			0.757, 0.738, 0.725, 0.71, 0.676, 0.655, 0.658, 0.674, 0.707, 0.756, 0.778, 0.766, 0.752,
			0.755, 0.76, 0.761,
		],
		[
			0.71, 0.711, 0.722, 0.721, 0.697, 0.679, 0.698, 0.719, 0.72, 0.728, 0.733, 0.712, 0.701,
			0.712, 0.719, 0.717,
		],
		[
			0.679, 0.689, 0.679, 0.639, 0.593, 0.571, 0.6, 0.662, 0.708, 0.738, 0.743, 0.702, 0.658,
			0.643, 0.651, 0.666,
		],
		[
			0.632, 0.618, 0.624, 0.609, 0.558, 0.515, 0.51, 0.538, 0.594, 0.643, 0.655, 0.646, 0.626,
			0.613, 0.629, 0.645,
		],
		[
			0.561, 0.571, 0.581, 0.546, 0.492, 0.472, 0.494, 0.531, 0.553, 0.575, 0.589, 0.551, 0.494,
			0.475, 0.502, 0.545,
		],
		[
			0.412, 0.422, 0.417, 0.392, 0.361, 0.335, 0.31, 0.304, 0.349, 0.431, 0.483, 0.491, 0.468,
			0.413, 0.376, 0.389,
		],
		[
			0.237, 0.27, 0.306, 0.3, 0.256, 0.221, 0.211, 0.227, 0.258, 0.282, 0.286, 0.268, 0.249, 0.25,
			0.253, 0.239,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'hawthorn-turntable-halfturn-b.mp4', views: 16 },
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
export const consistency = { lowest: 0.8137, mean: 0.8376, highest: 0.884 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
