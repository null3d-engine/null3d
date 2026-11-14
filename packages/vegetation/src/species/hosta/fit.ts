// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `hosta`, measured from its reference turning video
// `hosta-turntable-halfturn-b.mp4`. Run `bun run plants:fit hosta` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 16 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0, 0.071, 0.143, 0.214, 0.286, 0.357, 0.429, 0.5, 0.571, 0.643, 0.714, 0.786, 0.857, 0.929, 1,
	],
	radii: [
		0,
		[0.182, 0.231, 0.206, 0.076, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.033, 0.1, 0.149],
		[
			0.441, 0.51, 0.548, 0.518, 0.435, 0.372, 0.372, 0.39, 0.355, 0.297, 0.284, 0.335, 0.403, 0.43,
			0.418, 0.407,
		],
		[
			0.698, 0.74, 0.749, 0.712, 0.634, 0.571, 0.585, 0.613, 0.577, 0.517, 0.51, 0.55, 0.572, 0.569,
			0.597, 0.649,
		],
		[
			0.693, 0.733, 0.763, 0.787, 0.784, 0.771, 0.793, 0.803, 0.743, 0.659, 0.609, 0.609, 0.613,
			0.594, 0.605, 0.648,
		],
		[
			0.67, 0.737, 0.795, 0.812, 0.796, 0.78, 0.797, 0.804, 0.75, 0.697, 0.684, 0.679, 0.654, 0.623,
			0.616, 0.631,
		],
		[
			0.664, 0.728, 0.787, 0.809, 0.79, 0.78, 0.804, 0.797, 0.729, 0.68, 0.672, 0.664, 0.655, 0.644,
			0.622, 0.622,
		],
		[
			0.68, 0.75, 0.792, 0.796, 0.798, 0.808, 0.828, 0.817, 0.736, 0.656, 0.639, 0.655, 0.658,
			0.644, 0.634, 0.64,
		],
		[
			0.67, 0.743, 0.79, 0.791, 0.778, 0.779, 0.801, 0.8, 0.744, 0.675, 0.63, 0.615, 0.613, 0.606,
			0.606, 0.624,
		],
		[
			0.616, 0.687, 0.734, 0.729, 0.711, 0.706, 0.717, 0.722, 0.685, 0.635, 0.612, 0.607, 0.581,
			0.541, 0.537, 0.566,
		],
		[
			0.488, 0.553, 0.641, 0.672, 0.655, 0.65, 0.675, 0.673, 0.617, 0.568, 0.552, 0.539, 0.528,
			0.517, 0.499, 0.481,
		],
		[
			0.5, 0.563, 0.602, 0.581, 0.552, 0.564, 0.588, 0.579, 0.538, 0.505, 0.495, 0.487, 0.465,
			0.446, 0.446, 0.463,
		],
		[
			0.361, 0.403, 0.449, 0.47, 0.455, 0.438, 0.433, 0.398, 0.351, 0.35, 0.368, 0.346, 0.308,
			0.301, 0.322, 0.342,
		],
		[
			0.07, 0.104, 0.161, 0.205, 0.205, 0.202, 0.215, 0.226, 0.226, 0.209, 0.166, 0.109, 0.07,
			0.054, 0.049, 0.054,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'hosta-turntable-halfturn-b.mp4', views: 16 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = { angles: [0, 45, 90, 135], width: 0.0602, height: 0.0699 } as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.5;
export const crownBase = 0;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.8216, mean: 0.8488, highest: 0.8725 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
