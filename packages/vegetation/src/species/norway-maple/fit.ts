// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `norway-maple`, measured from its reference turning video
// `norway-maple-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit norway-maple`
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
		0.198, 0.255, 0.313, 0.37, 0.427, 0.484, 0.542, 0.599, 0.656, 0.714, 0.771, 0.828, 0.885, 0.943,
		1,
	],
	radii: [
		[
			0.388, 0.348, 0.34, 0.413, 0.441, 0.414, 0.371, 0.394, 0.42, 0.338, 0.277, 0.342, 0.389,
			0.309, 0.227, 0.296,
		],
		[
			0.456, 0.41, 0.401, 0.485, 0.519, 0.487, 0.436, 0.463, 0.494, 0.398, 0.326, 0.402, 0.457,
			0.363, 0.268, 0.349,
		],
		[
			0.532, 0.533, 0.523, 0.538, 0.538, 0.513, 0.486, 0.528, 0.583, 0.533, 0.466, 0.479, 0.496,
			0.449, 0.408, 0.458,
		],
		[
			0.583, 0.56, 0.543, 0.581, 0.587, 0.53, 0.474, 0.492, 0.53, 0.513, 0.501, 0.546, 0.573, 0.518,
			0.46, 0.512,
		],
		[
			0.589, 0.598, 0.584, 0.592, 0.586, 0.541, 0.505, 0.538, 0.577, 0.537, 0.499, 0.541, 0.578,
			0.53, 0.481, 0.522,
		],
		[
			0.588, 0.597, 0.584, 0.591, 0.583, 0.537, 0.5, 0.543, 0.599, 0.562, 0.516, 0.551, 0.582,
			0.532, 0.488, 0.527,
		],
		[
			0.586, 0.585, 0.57, 0.577, 0.566, 0.515, 0.473, 0.509, 0.556, 0.521, 0.498, 0.546, 0.57,
			0.524, 0.496, 0.538,
		],
		[
			0.569, 0.561, 0.558, 0.58, 0.571, 0.524, 0.479, 0.494, 0.534, 0.523, 0.506, 0.534, 0.553,
			0.522, 0.493, 0.526,
		],
		[
			0.566, 0.565, 0.557, 0.565, 0.555, 0.516, 0.472, 0.489, 0.521, 0.478, 0.457, 0.5, 0.522,
			0.494, 0.483, 0.524,
		],
		[
			0.535, 0.53, 0.515, 0.518, 0.514, 0.483, 0.443, 0.449, 0.477, 0.463, 0.452, 0.48, 0.495,
			0.472, 0.47, 0.505,
		],
		[
			0.472, 0.483, 0.476, 0.462, 0.425, 0.379, 0.355, 0.386, 0.432, 0.422, 0.405, 0.428, 0.441,
			0.42, 0.401, 0.429,
		],
		[
			0.433, 0.422, 0.397, 0.398, 0.39, 0.339, 0.296, 0.338, 0.396, 0.36, 0.333, 0.372, 0.396,
			0.381, 0.378, 0.408,
		],
		[
			0.291, 0.309, 0.321, 0.321, 0.319, 0.306, 0.279, 0.282, 0.296, 0.283, 0.285, 0.316, 0.329,
			0.305, 0.282, 0.28,
		],
		[
			0.242, 0.238, 0.229, 0.215, 0.197, 0.179, 0.163, 0.179, 0.209, 0.213, 0.221, 0.229, 0.23,
			0.236, 0.237, 0.238,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'norway-maple-turntable.mp4',
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
	width: 0.2361,
	height: 0.0317,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.14;
export const crownBase = 0.198;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7569, mean: 0.8537, highest: 0.9383 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
