// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `meadow-grass`, measured from its reference turning video
// `grass-turntable-c.mp4`. Run `bun run plants:fit meadow-grass` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.063, 0.129, 0.196, 0.263, 0.33, 0.397, 0.464, 0.531, 0.598, 0.665, 0.732, 0.799, 0.866, 0.933,
		1,
	],
	radii: [
		[
			0.089, 0.079, 0.071, 0.069, 0.072, 0.078, 0.087, 0.1, 0.11, 0.113, 0.11, 0.104, 0.102, 0.103,
			0.102, 0.096,
		],
		[
			0.105, 0.094, 0.083, 0.081, 0.085, 0.091, 0.103, 0.118, 0.129, 0.132, 0.129, 0.122, 0.12,
			0.121, 0.119, 0.113,
		],
		[
			0.191, 0.175, 0.157, 0.146, 0.139, 0.139, 0.156, 0.183, 0.207, 0.227, 0.242, 0.24, 0.223,
			0.217, 0.217, 0.205,
		],
		[
			0.184, 0.211, 0.223, 0.214, 0.195, 0.18, 0.183, 0.212, 0.25, 0.262, 0.245, 0.222, 0.207,
			0.189, 0.168, 0.163,
		],
		[
			0.208, 0.188, 0.158, 0.141, 0.142, 0.152, 0.171, 0.202, 0.241, 0.268, 0.26, 0.243, 0.234,
			0.216, 0.197, 0.201,
		],
		[
			0.233, 0.22, 0.186, 0.162, 0.157, 0.163, 0.179, 0.2, 0.216, 0.215, 0.194, 0.171, 0.162, 0.169,
			0.188, 0.215,
		],
		[
			0.148, 0.167, 0.162, 0.137, 0.131, 0.151, 0.181, 0.221, 0.252, 0.233, 0.179, 0.142, 0.132,
			0.131, 0.131, 0.134,
		],
		[
			0.116, 0.153, 0.176, 0.172, 0.157, 0.149, 0.164, 0.196, 0.223, 0.209, 0.153, 0.102, 0.074,
			0.061, 0.066, 0.086,
		],
		[
			0.125, 0.177, 0.202, 0.188, 0.162, 0.156, 0.182, 0.213, 0.216, 0.174, 0.116, 0.078, 0.058,
			0.05, 0.058, 0.084,
		],
		[
			0.116, 0.152, 0.172, 0.163, 0.148, 0.142, 0.152, 0.183, 0.209, 0.202, 0.156, 0.1, 0.076,
			0.081, 0.088, 0.094,
		],
		[
			0.152, 0.145, 0.123, 0.108, 0.109, 0.119, 0.134, 0.168, 0.216, 0.229, 0.179, 0.127, 0.11,
			0.103, 0.105, 0.128,
		],
		[
			0.116, 0.118, 0.108, 0.096, 0.091, 0.091, 0.102, 0.122, 0.154, 0.177, 0.148, 0.099, 0.082,
			0.079, 0.081, 0.1,
		],
		[
			0.051, 0.071, 0.077, 0.071, 0.067, 0.068, 0.081, 0.1, 0.115, 0.108, 0.071, 0.037, 0.028,
			0.032, 0.036, 0.039,
		],
		[0, 0, 0, 0, 0.004, 0.012, 0.013, 0.007, 0.002, 0, 0, 0, 0, 0, 0, 0],
		0,
	],
	source: { method: 'turntable-hull', from: 'grass-turntable-c.mp4', views: 32 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0.3604,
	height: 0.0217,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.37;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.7;
export const crownBase = 0.063;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.5007, mean: 0.5815, highest: 0.7692 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the last frame shows the first frame's plant with an overlap of only 0.6858: the plant changes shape over the turn, or the turn does not come back to its start",
	"the envelope's outlines match the views it came from with a mean overlap of only 0.5815: the plant drifts between views, or is too open for a hull to stand for it",
];
