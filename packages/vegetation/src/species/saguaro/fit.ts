// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `saguaro`, measured from its reference turning video
// `saguaro-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit saguaro`
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
		0.292, 0.342, 0.393, 0.443, 0.494, 0.545, 0.595, 0.646, 0.696, 0.747, 0.798, 0.848, 0.899,
		0.949, 1,
	],
	radii: [
		[
			0.165, 0.152, 0.113, 0.108, 0.113, 0.095, 0.091, 0.127, 0.165, 0.154, 0.105, 0.102, 0.123,
			0.1, 0.087, 0.125,
		],
		[
			0.194, 0.179, 0.132, 0.126, 0.133, 0.112, 0.107, 0.149, 0.194, 0.181, 0.123, 0.12, 0.145,
			0.117, 0.102, 0.147,
		],
		[
			0.214, 0.197, 0.149, 0.14, 0.147, 0.12, 0.114, 0.164, 0.21, 0.184, 0.119, 0.117, 0.14, 0.106,
			0.094, 0.158,
		],
		[
			0.226, 0.21, 0.154, 0.144, 0.155, 0.129, 0.119, 0.169, 0.221, 0.202, 0.138, 0.094, 0.079,
			0.084, 0.106, 0.166,
		],
		[
			0.226, 0.21, 0.15, 0.136, 0.152, 0.129, 0.119, 0.169, 0.221, 0.202, 0.138, 0.094, 0.079,
			0.084, 0.106, 0.166,
		],
		[
			0.226, 0.211, 0.151, 0.107, 0.092, 0.1, 0.119, 0.169, 0.221, 0.202, 0.138, 0.118, 0.126,
			0.107, 0.106, 0.166,
		],
		[
			0.226, 0.211, 0.151, 0.123, 0.125, 0.116, 0.119, 0.169, 0.221, 0.202, 0.137, 0.124, 0.139,
			0.114, 0.106, 0.166,
		],
		[
			0.226, 0.211, 0.151, 0.126, 0.132, 0.119, 0.119, 0.169, 0.221, 0.202, 0.137, 0.124, 0.139,
			0.114, 0.106, 0.166,
		],
		[
			0.22, 0.198, 0.139, 0.121, 0.127, 0.108, 0.103, 0.155, 0.205, 0.178, 0.117, 0.115, 0.136,
			0.11, 0.099, 0.162,
		],
		[
			0.114, 0.086, 0.059, 0.088, 0.112, 0.078, 0.048, 0.085, 0.122, 0.085, 0.048, 0.085, 0.119,
			0.076, 0.037, 0.075,
		],
		[
			0.116, 0.086, 0.059, 0.088, 0.112, 0.079, 0.049, 0.085, 0.122, 0.085, 0.047, 0.047, 0.044,
			0.038, 0.039, 0.078,
		],
		[
			0.045, 0.05, 0.055, 0.058, 0.055, 0.05, 0.048, 0.048, 0.048, 0.045, 0.04, 0.039, 0.041, 0.038,
			0.035, 0.039,
		],
		[
			0.044, 0.047, 0.048, 0.048, 0.048, 0.048, 0.045, 0.038, 0.035, 0.034, 0.034, 0.037, 0.041,
			0.038, 0.034, 0.038,
		],
		[
			0.042, 0.044, 0.046, 0.047, 0.044, 0.038, 0.035, 0.034, 0.034, 0.034, 0.034, 0.037, 0.041,
			0.038, 0.034, 0.038,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'saguaro-turntable.mp4',
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
	width: 0.9806,
	height: 0.3833,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.99;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.32;
export const crownBase = 0.292;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.4612, mean: 0.7261, highest: 0.8301 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the envelope's outlines match the views it came from with a mean overlap of only 0.7261: the plant drifts between views, or is too open for a hull to stand for it",
];
