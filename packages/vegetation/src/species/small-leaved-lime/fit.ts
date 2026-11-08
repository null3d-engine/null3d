// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `small-leaved-lime`, measured from its reference turning video
// `small-leaved-lime-turntable.mp4` and its whole-plant stills. Run `bun run plants:fit small-leaved-lime`
// to measure them again rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 35 views of the turning
 * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; `source`
 * names the stills and the turn each honours. Undefined when the views give none.
 */
// The crown's radii are the hull's, narrowed by a factor of 0.80. The fitted hull is what the
// photographs' foliage spans, and the grower adds each shoot's own reach past the bud it sits on, so
// a plant grown to the hull draws about a quarter wider than its photographs. The ground-view
// review measured that overshoot as a crown 1.05 times as wide as tall against 0.73 to 0.80, so the
// record targets the hull less that reach. A re-run of the fitting tool writes the raw hull again
// and must have this factor applied to the radii after it.
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.156, 0.217, 0.277, 0.337, 0.397, 0.458, 0.518, 0.578, 0.638, 0.699, 0.759, 0.819, 0.879, 0.94,
		1,
	],
	radii: [
		[
			0.202, 0.162, 0.125, 0.151, 0.188, 0.171, 0.161, 0.189, 0.212, 0.214, 0.212, 0.227, 0.234,
			0.207, 0.187, 0.199,
		],
		[
			0.238, 0.189, 0.147, 0.177, 0.22, 0.202, 0.189, 0.222, 0.249, 0.251, 0.249, 0.267, 0.274,
			0.245, 0.22, 0.234,
		],
		[
			0.271, 0.254, 0.245, 0.259, 0.263, 0.246, 0.246, 0.263, 0.276, 0.282, 0.278, 0.281, 0.285,
			0.271, 0.256, 0.263,
		],
		[
			0.289, 0.274, 0.256, 0.256, 0.271, 0.283, 0.296, 0.304, 0.298, 0.274, 0.253, 0.257, 0.277,
			0.28, 0.279, 0.286,
		],
		[
			0.315, 0.296, 0.284, 0.285, 0.278, 0.272, 0.289, 0.312, 0.304, 0.276, 0.258, 0.268, 0.285,
			0.287, 0.297, 0.315,
		],
		[
			0.282, 0.283, 0.282, 0.278, 0.274, 0.263, 0.264, 0.274, 0.277, 0.272, 0.272, 0.275, 0.275,
			0.267, 0.264, 0.274,
		],
		[
			0.304, 0.291, 0.274, 0.271, 0.269, 0.274, 0.286, 0.299, 0.302, 0.296, 0.275, 0.263, 0.26,
			0.254, 0.261, 0.288,
		],
		[
			0.26, 0.243, 0.241, 0.252, 0.259, 0.266, 0.283, 0.296, 0.296, 0.283, 0.267, 0.257, 0.26,
			0.264, 0.264, 0.266,
		],
		[
			0.232, 0.22, 0.226, 0.238, 0.241, 0.238, 0.239, 0.253, 0.263, 0.249, 0.234, 0.234, 0.238,
			0.238, 0.242, 0.242,
		],
		[
			0.226, 0.218, 0.208, 0.213, 0.221, 0.223, 0.231, 0.241, 0.236, 0.22, 0.207, 0.208, 0.214,
			0.22, 0.226, 0.229,
		],
		[
			0.193, 0.194, 0.198, 0.204, 0.203, 0.199, 0.199, 0.207, 0.206, 0.184, 0.18, 0.196, 0.203,
			0.195, 0.188, 0.191,
		],
		[
			0.167, 0.158, 0.154, 0.161, 0.163, 0.158, 0.161, 0.165, 0.161, 0.154, 0.151, 0.158, 0.166,
			0.162, 0.158, 0.165,
		],
		[
			0.136, 0.128, 0.125, 0.126, 0.126, 0.126, 0.134, 0.146, 0.148, 0.142, 0.139, 0.136, 0.134,
			0.127, 0.128, 0.136,
		],
		[
			0.08, 0.082, 0.086, 0.088, 0.086, 0.086, 0.082, 0.077, 0.078, 0.079, 0.078, 0.084, 0.089,
			0.082, 0.078, 0.08,
		],
		0,
	],
	source: {
		method: 'turntable-hull',
		from: 'small-leaved-lime-turntable.mp4',
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
	width: 0.3172,
	height: 0.1431,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.32;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 0.74;
export const crownBase = 0.156;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.7866, mean: 0.8718, highest: 0.9344 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [];
