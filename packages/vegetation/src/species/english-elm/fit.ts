// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `english-elm`, measured from its whole-plant stills `01-whole-vase-distant.png`
// and `02-whole-vase-profile.png`. The reference set has no turning video of the whole plant, so
// the envelope comes from the two profiles' outlines rather than a turntable hull. Run
// `bun run plants:fit english-elm` where a turn exists, and replace these figures with its
// measures.
//
// The grown plant reaches about 0.85 of a profile hull at the stills' angles, since its shoots stop
// short of the cap. Each radius here is the still's measured outline divided by that fill, so the
// drawn crown reaches the outline the photographs show. The review rounds measured the fill; a turn
// would measure it again.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the two profile stills' outline scaled by the grown plant's fill, as
 * radii over the plant's height at 16 azimuths. Each row is an ellipse: still `01` at turn 0 sets
 * the extent across the camera's view, and still `02` at turn 90 sets the extent toward it.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.2, 0.257, 0.314, 0.371, 0.429, 0.486, 0.543, 0.6, 0.657, 0.714, 0.771, 0.829, 0.886, 0.943, 1,
	],
	radii: [
		[
			0.1416, 0.1116, 0.0806, 0.0663, 0.0623, 0.0663, 0.0806, 0.1116, 0.1416, 0.1116, 0.0806,
			0.0663, 0.0623, 0.0663, 0.0806, 0.1116,
		],
		[
			0.2269, 0.186, 0.139, 0.1158, 0.109, 0.1158, 0.139, 0.186, 0.2269, 0.186, 0.139, 0.1158,
			0.109, 0.1158, 0.139, 0.186,
		],
		[
			0.5155, 0.4198, 0.3119, 0.2591, 0.2439, 0.2591, 0.3119, 0.4198, 0.5155, 0.4198, 0.3119,
			0.2591, 0.2439, 0.2591, 0.3119, 0.4198,
		],
		[
			0.5465, 0.4888, 0.4014, 0.3487, 0.3322, 0.3487, 0.4014, 0.4888, 0.5465, 0.4888, 0.4014,
			0.3487, 0.3322, 0.3487, 0.4014, 0.4888,
		],
		[
			0.6409, 0.5786, 0.4811, 0.4206, 0.4014, 0.4206, 0.4811, 0.5786, 0.6409, 0.5786, 0.4811,
			0.4206, 0.4014, 0.4206, 0.4811, 0.5786,
		],
		[
			0.5973, 0.5722, 0.5227, 0.4843, 0.4706, 0.4843, 0.5227, 0.5722, 0.5973, 0.5722, 0.5227,
			0.4843, 0.4706, 0.4843, 0.5227, 0.5722,
		],
		[
			0.6826, 0.6541, 0.5977, 0.5537, 0.5381, 0.5537, 0.5977, 0.6541, 0.6826, 0.6541, 0.5977,
			0.5537, 0.5381, 0.5537, 0.5977, 0.6541,
		],
		[
			0.659, 0.6431, 0.6092, 0.5801, 0.5692, 0.5801, 0.6092, 0.6431, 0.659, 0.6431, 0.6092, 0.5801,
			0.5692, 0.5801, 0.6092, 0.6431,
		],
		[
			0.6318, 0.626, 0.6127, 0.6001, 0.5952, 0.6001, 0.6127, 0.626, 0.6318, 0.626, 0.6127, 0.6001,
			0.5952, 0.6001, 0.6127, 0.626,
		],
		[
			0.5737, 0.5762, 0.5824, 0.5889, 0.5918, 0.5889, 0.5824, 0.5762, 0.5737, 0.5762, 0.5824,
			0.5889, 0.5918, 0.5889, 0.5824, 0.5762,
		],
		[
			0.5374, 0.5421, 0.5541, 0.5671, 0.5727, 0.5671, 0.5541, 0.5421, 0.5374, 0.5421, 0.5541,
			0.5671, 0.5727, 0.5671, 0.5541, 0.5421,
		],
		[
			0.4683, 0.4737, 0.4872, 0.5021, 0.5087, 0.5021, 0.4872, 0.4737, 0.4683, 0.4737, 0.4872,
			0.5021, 0.5087, 0.5021, 0.4872, 0.4737,
		],
		[
			0.423, 0.4223, 0.4208, 0.4194, 0.4187, 0.4194, 0.4208, 0.4223, 0.423, 0.4223, 0.4208, 0.4194,
			0.4187, 0.4194, 0.4208, 0.4223,
		],
		[
			0.2886, 0.281, 0.2646, 0.2507, 0.2457, 0.2507, 0.2646, 0.281, 0.2886, 0.281, 0.2646, 0.2507,
			0.2457, 0.2507, 0.2646, 0.281,
		],
		[
			0.0218, 0.0163, 0.0113, 0.0092, 0.0086, 0.0092, 0.0113, 0.0163, 0.0218, 0.0163, 0.0113,
			0.0092, 0.0086, 0.0092, 0.0113, 0.0163,
		],
	],
	source: {
		method: 'profile',
		from: '02-whole-vase-profile.png and 01-whole-vase-distant.png',
		views: 2,
		stills: [
			{ file: '01-whole-vase-distant.png', turn: 0 },
			{ file: '02-whole-vase-profile.png', turn: 90 },
		],
	},
};

/**
 * The reference's own crown box at the rubric's angles, as the review tool measures it: the
 * spread of its width and of its height, largest less smallest over their mean. The reference has
 * no whole-plant turning video, so no spread is measured and the form's band stands.
 */
export const crownBox = {
	angles: [0, 45, 90, 135, 180, 225, 270, 315],
	width: 0,
	height: 0,
} as const;

/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */
export const roundBand = 0.25;

/** Crown width over plant height, and the crown's base as a share of the height, over the views. */
export const aspect = 1.16;
export const crownBase = 0.19;

/**
 * How far the envelope's outlines overlap the views it came from: the generated plant drifts
 * between views, so no one solid matches them all. Undefined without a turn.
 */
export const consistency = undefined;

/** Why the reference is poor to measure the envelope from; empty when it is not. */
export const problems: readonly string[] = [
	'the reference set has no turning video of the whole plant: its own index says every attempt changed tree part way round, so the envelope comes from the two profile stills and the all-round band keeps the form default',
	'the envelope measures two views only, so the crown plan is an ellipse between the stills rather than a measured hull',
	"the radii carry a fill calibration of 0.85, measured on the review rounds, so they are not the stills' outline alone",
];
