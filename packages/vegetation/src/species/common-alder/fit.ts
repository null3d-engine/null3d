// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `common-alder`, measured from its reference turning video
// `common-alder-turntable-c.mp4`. Run `bun run plants:fit common-alder` to measure them again
// rather than edit them.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of 31 views round the video,
 * as radii over the plant's height at 16 azimuths. Undefined when the views give none.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0, 0.071, 0.143, 0.214, 0.286, 0.357, 0.429, 0.5, 0.571, 0.643, 0.714, 0.786, 0.857, 0.929, 1,
	],
	radii: [
		[
			0.09, 0.063, 0.058, 0.061, 0.064, 0.061, 0.068, 0.088, 0.149, 0.275, 0.375, 0.375, 0.321,
			0.245, 0.174, 0.129,
		],
		[
			0.44, 0.357, 0.305, 0.298, 0.299, 0.271, 0.27, 0.324, 0.367, 0.398, 0.426, 0.422, 0.399,
			0.402, 0.449, 0.481,
		],
		[
			0.297, 0.295, 0.291, 0.269, 0.255, 0.28, 0.346, 0.406, 0.412, 0.38, 0.353, 0.337, 0.317,
			0.301, 0.3, 0.302,
		],
		[
			0.433, 0.364, 0.331, 0.34, 0.349, 0.347, 0.382, 0.47, 0.538, 0.529, 0.482, 0.46, 0.464, 0.462,
			0.467, 0.473,
		],
		[
			0.437, 0.352, 0.304, 0.29, 0.317, 0.39, 0.487, 0.573, 0.601, 0.568, 0.525, 0.49, 0.469, 0.487,
			0.524, 0.516,
		],
		[
			0.403, 0.389, 0.367, 0.358, 0.38, 0.398, 0.405, 0.415, 0.424, 0.411, 0.386, 0.382, 0.399,
			0.421, 0.429, 0.417,
		],
		[
			0.502, 0.507, 0.493, 0.465, 0.444, 0.425, 0.386, 0.369, 0.397, 0.419, 0.4, 0.366, 0.353,
			0.385, 0.443, 0.483,
		],
		[
			0.444, 0.395, 0.346, 0.305, 0.306, 0.357, 0.424, 0.468, 0.481, 0.446, 0.389, 0.375, 0.398,
			0.421, 0.453, 0.472,
		],
		[
			0.294, 0.283, 0.287, 0.299, 0.324, 0.358, 0.4, 0.432, 0.415, 0.367, 0.341, 0.339, 0.367,
			0.401, 0.386, 0.334,
		],
		[
			0.342, 0.34, 0.334, 0.336, 0.349, 0.358, 0.348, 0.33, 0.323, 0.325, 0.325, 0.314, 0.297,
			0.287, 0.297, 0.324,
		],
		[
			0.29, 0.237, 0.185, 0.168, 0.195, 0.262, 0.311, 0.307, 0.283, 0.26, 0.245, 0.25, 0.266, 0.277,
			0.287, 0.3,
		],
		[
			0.123, 0.158, 0.187, 0.196, 0.197, 0.201, 0.199, 0.204, 0.215, 0.218, 0.21, 0.18, 0.141,
			0.111, 0.094, 0.098,
		],
		[
			0.086, 0.081, 0.088, 0.097, 0.096, 0.1, 0.123, 0.15, 0.147, 0.116, 0.098, 0.101, 0.107, 0.1,
			0.092, 0.091,
		],
		[
			0.058, 0.052, 0.042, 0.039, 0.045, 0.06, 0.078, 0.084, 0.074, 0.061, 0.048, 0.039, 0.037,
			0.042, 0.048, 0.054,
		],
		0,
	],
	source: { method: 'turntable-hull', from: 'common-alder-turntable-c.mp4', views: 31 },
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0.9486,
	height: 0.3256,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.95;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.13;
export const crownBase = 0;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without an envelope.
 */
export const consistency = { lowest: 0.5986, mean: 0.7738, highest: 0.8213 } as const;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	"the plant's height in the frame changes by 32 per cent over the turn: its foot or its top is lost against the background in some views",
];
