// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `weeping-willow`, measured from its reference turning video
// `willow-turntable-b.mp4`. Run `bun run plants:fit weeping-willow` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0, 0.071, 0.143, 0.214, 0.286, 0.357, 0.429, 0.5, 0.571, 0.643, 0.714, 0.786, 0.857, 0.929, 1,
	],
	radii: [
		[0.236, 0.191, 0.145, 0.096, 0.044, 0.013, 0.004, 0, 0, 0, 0, 0, 0, 0.049, 0.173, 0.253],
		[
			0.553, 0.506, 0.474, 0.461, 0.47, 0.486, 0.511, 0.547, 0.566, 0.568, 0.566, 0.563, 0.571,
			0.589, 0.603, 0.594,
		],
		[
			0.55, 0.51, 0.479, 0.47, 0.478, 0.499, 0.541, 0.581, 0.597, 0.596, 0.586, 0.574, 0.571, 0.581,
			0.587, 0.576,
		],
		[
			0.566, 0.526, 0.499, 0.51, 0.531, 0.544, 0.583, 0.631, 0.644, 0.625, 0.598, 0.582, 0.582,
			0.589, 0.597, 0.592,
		],
		[
			0.57, 0.521, 0.497, 0.508, 0.526, 0.543, 0.586, 0.636, 0.652, 0.637, 0.607, 0.582, 0.574,
			0.592, 0.621, 0.616,
		],
		[
			0.562, 0.51, 0.492, 0.508, 0.526, 0.54, 0.575, 0.624, 0.649, 0.637, 0.61, 0.585, 0.574, 0.588,
			0.613, 0.608,
		],
		[
			0.557, 0.508, 0.492, 0.508, 0.526, 0.543, 0.578, 0.617, 0.637, 0.637, 0.618, 0.594, 0.579,
			0.581, 0.601, 0.601,
		],
		[
			0.56, 0.508, 0.492, 0.505, 0.521, 0.539, 0.571, 0.595, 0.6, 0.6, 0.594, 0.581, 0.568, 0.576,
			0.608, 0.61,
		],
		[
			0.543, 0.489, 0.468, 0.476, 0.492, 0.515, 0.55, 0.573, 0.581, 0.584, 0.576, 0.56, 0.55, 0.56,
			0.589, 0.59,
		],
		[
			0.501, 0.457, 0.443, 0.45, 0.466, 0.494, 0.543, 0.581, 0.576, 0.544, 0.514, 0.495, 0.491,
			0.518, 0.556, 0.551,
		],
		[
			0.456, 0.423, 0.414, 0.417, 0.423, 0.448, 0.492, 0.515, 0.507, 0.492, 0.477, 0.465, 0.458,
			0.466, 0.491, 0.493,
		],
		[
			0.38, 0.349, 0.308, 0.295, 0.301, 0.319, 0.35, 0.4, 0.454, 0.474, 0.458, 0.429, 0.392, 0.359,
			0.346, 0.365,
		],
		[
			0.275, 0.286, 0.277, 0.257, 0.245, 0.255, 0.284, 0.32, 0.336, 0.324, 0.305, 0.294, 0.286,
			0.279, 0.271, 0.266,
		],
		[
			0.206, 0.216, 0.199, 0.17, 0.15, 0.143, 0.149, 0.166, 0.19, 0.222, 0.258, 0.259, 0.223, 0.201,
			0.198, 0.195,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'willow-turntable-b.mp4', views: 32 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0.236,
	height: 0.0138,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.26;
export const crownBase = 0;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7974, mean: 0.8638, highest: 0.9268 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
