// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `giant-sequoia`, measured from its reference turning video
// `giant-sequoia-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit giant-sequoia`
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
		0.333, 0.381, 0.429, 0.476, 0.524, 0.571, 0.619, 0.667, 0.714, 0.762, 0.81, 0.857, 0.905, 0.952,
		1,
	],
	radii: [
		[
			0.126, 0.115, 0.098, 0.091, 0.083, 0.067, 0.062, 0.094, 0.131, 0.128, 0.112, 0.113, 0.115,
			0.113, 0.109, 0.117,
		],
		[
			0.149, 0.135, 0.115, 0.107, 0.097, 0.078, 0.073, 0.111, 0.154, 0.15, 0.132, 0.133, 0.135,
			0.132, 0.128, 0.138,
		],
		[
			0.139, 0.089, 0.063, 0.085, 0.116, 0.132, 0.13, 0.141, 0.156, 0.145, 0.132, 0.131, 0.129,
			0.125, 0.126, 0.143,
		],
		[
			0.163, 0.153, 0.143, 0.136, 0.131, 0.136, 0.151, 0.165, 0.171, 0.171, 0.165, 0.158, 0.153,
			0.154, 0.159, 0.164,
		],
		[
			0.162, 0.15, 0.137, 0.141, 0.151, 0.151, 0.145, 0.151, 0.163, 0.159, 0.145, 0.136, 0.133,
			0.136, 0.144, 0.156,
		],
		[
			0.166, 0.157, 0.146, 0.14, 0.133, 0.133, 0.141, 0.153, 0.158, 0.157, 0.159, 0.157, 0.149,
			0.141, 0.142, 0.156,
		],
		[
			0.141, 0.133, 0.13, 0.138, 0.146, 0.148, 0.151, 0.157, 0.159, 0.153, 0.144, 0.136, 0.13,
			0.127, 0.13, 0.138,
		],
		[
			0.145, 0.146, 0.143, 0.146, 0.147, 0.144, 0.144, 0.15, 0.156, 0.155, 0.15, 0.146, 0.14, 0.137,
			0.137, 0.14,
		],
		[
			0.129, 0.123, 0.12, 0.122, 0.119, 0.123, 0.132, 0.138, 0.14, 0.139, 0.131, 0.126, 0.125,
			0.126, 0.127, 0.129,
		],
		[
			0.117, 0.116, 0.116, 0.122, 0.127, 0.131, 0.135, 0.137, 0.135, 0.13, 0.127, 0.124, 0.115,
			0.106, 0.103, 0.11,
		],
		[
			0.112, 0.107, 0.106, 0.111, 0.111, 0.108, 0.112, 0.115, 0.114, 0.111, 0.109, 0.111, 0.114,
			0.115, 0.111, 0.11,
		],
		[
			0.101, 0.095, 0.091, 0.093, 0.092, 0.091, 0.095, 0.1, 0.102, 0.102, 0.101, 0.101, 0.099,
			0.094, 0.091, 0.096,
		],
		[
			0.086, 0.087, 0.088, 0.085, 0.081, 0.08, 0.081, 0.081, 0.079, 0.079, 0.079, 0.081, 0.081,
			0.08, 0.079, 0.083,
		],
		[
			0.06, 0.057, 0.055, 0.056, 0.059, 0.063, 0.061, 0.059, 0.061, 0.062, 0.063, 0.064, 0.065,
			0.065, 0.061, 0.059,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'giant-sequoia-turntable.mp4',
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
	width: 0.8722,
	height: 0.5457,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.88;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.31;
export const crownBase = 0.333;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7368, mean: 0.8801, highest: 0.9157 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
