// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `silver-birch`, measured from its reference turning video
// `birch-turntable-c.mp4`. Run `bun run plants:fit silver-birch` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 32 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.219, 0.275, 0.33, 0.386, 0.442, 0.498, 0.554, 0.609, 0.665, 0.721, 0.777, 0.833, 0.888, 0.944,
		1,
	],
	radii: [
		[
			0.087, 0.116, 0.128, 0.112, 0.091, 0.079, 0.081, 0.092, 0.11, 0.123, 0.105, 0.073, 0.052,
			0.044, 0.051, 0.066,
		],
		[
			0.102, 0.136, 0.151, 0.132, 0.107, 0.093, 0.095, 0.108, 0.13, 0.145, 0.124, 0.086, 0.061,
			0.052, 0.06, 0.077,
		],
		[
			0.163, 0.194, 0.189, 0.158, 0.136, 0.127, 0.131, 0.158, 0.191, 0.197, 0.163, 0.121, 0.098,
			0.092, 0.101, 0.126,
		],
		[
			0.169, 0.191, 0.167, 0.139, 0.128, 0.13, 0.148, 0.177, 0.22, 0.239, 0.201, 0.152, 0.13, 0.119,
			0.114, 0.129,
		],
		[
			0.177, 0.212, 0.209, 0.182, 0.163, 0.156, 0.161, 0.19, 0.236, 0.253, 0.222, 0.175, 0.143,
			0.127, 0.122, 0.137,
		],
		[
			0.2, 0.227, 0.22, 0.196, 0.179, 0.173, 0.182, 0.206, 0.232, 0.235, 0.208, 0.18, 0.162, 0.154,
			0.154, 0.167,
		],
		[
			0.193, 0.222, 0.214, 0.194, 0.186, 0.193, 0.208, 0.232, 0.255, 0.24, 0.191, 0.15, 0.133,
			0.127, 0.127, 0.148,
		],
		[
			0.181, 0.216, 0.208, 0.179, 0.166, 0.172, 0.193, 0.215, 0.23, 0.227, 0.198, 0.164, 0.142,
			0.135, 0.139, 0.149,
		],
		[
			0.186, 0.213, 0.19, 0.154, 0.143, 0.144, 0.16, 0.184, 0.204, 0.21, 0.183, 0.143, 0.119, 0.116,
			0.128, 0.149,
		],
		[
			0.17, 0.191, 0.182, 0.16, 0.155, 0.16, 0.166, 0.182, 0.188, 0.156, 0.122, 0.107, 0.106, 0.113,
			0.125, 0.143,
		],
		[
			0.163, 0.177, 0.166, 0.15, 0.146, 0.15, 0.154, 0.154, 0.145, 0.121, 0.099, 0.09, 0.088, 0.095,
			0.109, 0.134,
		],
		[
			0.141, 0.158, 0.142, 0.119, 0.111, 0.11, 0.116, 0.133, 0.14, 0.121, 0.097, 0.084, 0.08, 0.083,
			0.093, 0.113,
		],
		[
			0.096, 0.108, 0.106, 0.094, 0.083, 0.08, 0.082, 0.085, 0.081, 0.068, 0.057, 0.052, 0.055,
			0.059, 0.063, 0.075,
		],
		[
			0.056, 0.064, 0.068, 0.067, 0.065, 0.065, 0.065, 0.066, 0.059, 0.047, 0.039, 0.039, 0.039,
			0.038, 0.041, 0.047,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'birch-turntable-c.mp4', views: 32 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0.4892,
	height: 0.0688,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.49;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.48;
export const crownBase = 0.219;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.668, mean: 0.7649, highest: 0.872 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
