// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `bamboo`, measured from its reference turning video
// `bamboo-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit bamboo`
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
		0.083, 0.149, 0.214, 0.28, 0.345, 0.411, 0.476, 0.542, 0.607, 0.673, 0.738, 0.804, 0.869, 0.935,
		1,
	],
	radii: [
		[
			0.097, 0.097, 0.097, 0.11, 0.123, 0.123, 0.123, 0.124, 0.119, 0.107, 0.095, 0.097, 0.104,
			0.092, 0.08, 0.087,
		],
		[
			0.114, 0.114, 0.114, 0.129, 0.144, 0.145, 0.144, 0.146, 0.14, 0.126, 0.112, 0.115, 0.123,
			0.108, 0.094, 0.102,
		],
		[
			0.121, 0.12, 0.117, 0.133, 0.152, 0.154, 0.152, 0.155, 0.149, 0.135, 0.123, 0.126, 0.132,
			0.115, 0.1, 0.109,
		],
		[
			0.132, 0.129, 0.124, 0.143, 0.165, 0.161, 0.157, 0.163, 0.157, 0.141, 0.127, 0.138, 0.15,
			0.127, 0.107, 0.118,
		],
		[
			0.142, 0.139, 0.131, 0.154, 0.182, 0.175, 0.166, 0.175, 0.172, 0.154, 0.136, 0.144, 0.158,
			0.139, 0.117, 0.126,
		],
		[
			0.197, 0.17, 0.154, 0.199, 0.245, 0.228, 0.218, 0.242, 0.247, 0.219, 0.188, 0.22, 0.258,
			0.205, 0.162, 0.185,
		],
		[
			0.268, 0.221, 0.192, 0.254, 0.312, 0.285, 0.255, 0.287, 0.316, 0.29, 0.238, 0.23, 0.245,
			0.231, 0.216, 0.245,
		],
		[
			0.297, 0.267, 0.244, 0.269, 0.303, 0.313, 0.317, 0.33, 0.331, 0.313, 0.299, 0.323, 0.339,
			0.287, 0.251, 0.279,
		],
		[
			0.31, 0.286, 0.266, 0.332, 0.415, 0.396, 0.361, 0.382, 0.386, 0.329, 0.264, 0.284, 0.329,
			0.294, 0.262, 0.29,
		],
		[
			0.396, 0.369, 0.329, 0.345, 0.377, 0.353, 0.32, 0.34, 0.367, 0.349, 0.322, 0.341, 0.355,
			0.317, 0.307, 0.361,
		],
		[
			0.383, 0.354, 0.323, 0.321, 0.338, 0.36, 0.369, 0.394, 0.406, 0.355, 0.295, 0.33, 0.383,
			0.327, 0.297, 0.354,
		],
		[
			0.437, 0.402, 0.354, 0.36, 0.382, 0.351, 0.326, 0.35, 0.373, 0.353, 0.315, 0.341, 0.388,
			0.368, 0.357, 0.406,
		],
		[
			0.365, 0.31, 0.263, 0.256, 0.262, 0.283, 0.307, 0.332, 0.341, 0.318, 0.288, 0.293, 0.31,
			0.293, 0.29, 0.341,
		],
		[
			0.199, 0.209, 0.213, 0.233, 0.249, 0.255, 0.241, 0.216, 0.196, 0.181, 0.168, 0.163, 0.154,
			0.127, 0.116, 0.152,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'bamboo-turntable.mp4',
		views: 35,
		stills: [
			{ file: '01-whole-clump-distant.png', turn: 0 },
			{ file: '02-whole-clump-profile.png', turn: 90 },
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
	width: 0.2504,
	height: 0.398,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.4;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.75;
export const crownBase = 0.083;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.6433, mean: 0.7955, highest: 0.8655 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
