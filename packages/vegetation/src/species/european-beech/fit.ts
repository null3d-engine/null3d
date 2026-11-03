// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `european-beech`, measured from its reference turning video
// `european-beech-turntable-d.mp4`. Run `bun run plants:fit european-beech` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.031, 0.1, 0.17, 0.239, 0.308, 0.377, 0.446, 0.516, 0.585, 0.654, 0.723, 0.792, 0.862, 0.931,
		1,
	],
	radii: [
		[
			0.543, 0.517, 0.421, 0.338, 0.283, 0.261, 0.284, 0.332, 0.402, 0.471, 0.487, 0.472, 0.463,
			0.46, 0.468, 0.501,
		],
		[
			0.639, 0.608, 0.496, 0.398, 0.333, 0.308, 0.335, 0.391, 0.473, 0.554, 0.573, 0.555, 0.544,
			0.542, 0.55, 0.589,
		],
		[
			0.659, 0.658, 0.587, 0.49, 0.38, 0.315, 0.336, 0.395, 0.489, 0.588, 0.612, 0.595, 0.579,
			0.566, 0.573, 0.609,
		],
		[
			0.63, 0.632, 0.572, 0.496, 0.447, 0.422, 0.434, 0.484, 0.571, 0.64, 0.626, 0.589, 0.568,
			0.555, 0.561, 0.591,
		],
		[
			0.674, 0.666, 0.592, 0.509, 0.454, 0.421, 0.421, 0.479, 0.573, 0.626, 0.612, 0.59, 0.58,
			0.566, 0.576, 0.626,
		],
		[
			0.628, 0.622, 0.553, 0.479, 0.43, 0.414, 0.44, 0.513, 0.601, 0.634, 0.603, 0.568, 0.561,
			0.561, 0.558, 0.583,
		],
		[
			0.575, 0.563, 0.516, 0.457, 0.407, 0.39, 0.431, 0.514, 0.599, 0.636, 0.607, 0.56, 0.539,
			0.536, 0.542, 0.558,
		],
		[
			0.602, 0.597, 0.544, 0.49, 0.46, 0.446, 0.454, 0.493, 0.548, 0.574, 0.562, 0.555, 0.555,
			0.547, 0.544, 0.568,
		],
		[
			0.553, 0.577, 0.546, 0.498, 0.472, 0.466, 0.47, 0.498, 0.548, 0.56, 0.522, 0.498, 0.504,
			0.499, 0.486, 0.505,
		],
		[
			0.533, 0.542, 0.509, 0.465, 0.441, 0.443, 0.475, 0.526, 0.552, 0.526, 0.48, 0.46, 0.463,
			0.464, 0.468, 0.494,
		],
		[
			0.495, 0.504, 0.478, 0.442, 0.423, 0.423, 0.436, 0.459, 0.483, 0.487, 0.47, 0.456, 0.45,
			0.446, 0.447, 0.467,
		],
		[
			0.412, 0.436, 0.429, 0.397, 0.362, 0.35, 0.368, 0.406, 0.436, 0.433, 0.41, 0.394, 0.388,
			0.382, 0.375, 0.383,
		],
		[
			0.336, 0.357, 0.339, 0.312, 0.301, 0.302, 0.316, 0.341, 0.361, 0.355, 0.326, 0.309, 0.316,
			0.32, 0.311, 0.31,
		],
		[
			0.217, 0.22, 0.219, 0.205, 0.19, 0.189, 0.198, 0.214, 0.23, 0.239, 0.24, 0.233, 0.219, 0.217,
			0.22, 0.217,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'european-beech-turntable-d.mp4', views: 32 },
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
export const aspect = 1.28;
export const crownBase = 0.031;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7831, mean: 0.8536, highest: 0.9375 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
