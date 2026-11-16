// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `olive`, measured from its reference turning video
// `olive-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit olive`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 29 views of the turning
 * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; `source`
 * names the stills and the turn each honours. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.115, 0.178, 0.241, 0.304, 0.368, 0.431, 0.494, 0.557, 0.621, 0.684, 0.747, 0.81, 0.874, 0.937,
		1,
	],
	radii: [
		[
			0.185, 0.151, 0.126, 0.133, 0.132, 0.122, 0.115, 0.112, 0.113, 0.118, 0.125, 0.127, 0.125,
			0.129, 0.135, 0.163,
		],
		[
			0.217, 0.177, 0.148, 0.157, 0.155, 0.144, 0.135, 0.131, 0.132, 0.139, 0.147, 0.15, 0.147,
			0.152, 0.159, 0.192,
		],
		[
			0.419, 0.293, 0.175, 0.173, 0.148, 0.129, 0.13, 0.19, 0.25, 0.202, 0.16, 0.173, 0.169, 0.163,
			0.165, 0.294,
		],
		[
			0.516, 0.522, 0.587, 0.645, 0.498, 0.299, 0.19, 0.267, 0.365, 0.264, 0.175, 0.19, 0.182,
			0.166, 0.171, 0.331,
		],
		[
			0.695, 0.714, 0.7, 0.735, 0.753, 0.667, 0.456, 0.407, 0.467, 0.329, 0.217, 0.258, 0.319,
			0.367, 0.404, 0.535,
		],
		[
			0.801, 0.799, 0.763, 0.768, 0.75, 0.721, 0.694, 0.69, 0.662, 0.564, 0.474, 0.433, 0.405,
			0.402, 0.442, 0.613,
		],
		[
			0.842, 0.812, 0.787, 0.799, 0.771, 0.732, 0.698, 0.727, 0.746, 0.641, 0.524, 0.478, 0.452,
			0.445, 0.501, 0.688,
		],
		[
			0.842, 0.806, 0.789, 0.791, 0.732, 0.68, 0.656, 0.687, 0.727, 0.661, 0.547, 0.477, 0.458,
			0.511, 0.608, 0.746,
		],
		[
			0.791, 0.746, 0.734, 0.77, 0.745, 0.694, 0.67, 0.689, 0.699, 0.63, 0.544, 0.504, 0.499, 0.56,
			0.652, 0.742,
		],
		[
			0.807, 0.753, 0.737, 0.748, 0.713, 0.67, 0.655, 0.697, 0.708, 0.613, 0.513, 0.487, 0.509,
			0.566, 0.634, 0.742,
		],
		[
			0.773, 0.748, 0.747, 0.759, 0.691, 0.608, 0.585, 0.623, 0.63, 0.555, 0.474, 0.459, 0.496,
			0.553, 0.605, 0.697,
		],
		[
			0.652, 0.655, 0.649, 0.65, 0.61, 0.568, 0.541, 0.536, 0.529, 0.481, 0.441, 0.441, 0.457,
			0.482, 0.499, 0.566,
		],
		[
			0.47, 0.448, 0.419, 0.375, 0.315, 0.297, 0.328, 0.383, 0.421, 0.431, 0.414, 0.409, 0.432,
			0.436, 0.413, 0.435,
		],
		[
			0.313, 0.271, 0.221, 0.214, 0.171, 0.134, 0.129, 0.174, 0.253, 0.282, 0.247, 0.195, 0.16,
			0.154, 0.163, 0.235,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'olive-turntable.mp4',
		views: 29,
		stills: [
			{ file: '01-whole-distant.png', turn: 0 },
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
	width: 0.3139,
	height: 0.2031,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.32;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.5;
export const crownBase = 0.115;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.6675, mean: 0.7686, highest: 0.8324 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the plant's height in the frame changes by 22 per cent over the turn: its foot or its top is lost against the background in some views",
];
