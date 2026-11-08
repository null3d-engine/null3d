// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants
// The figures of `english-elm`, measured from its whole-plant stills `01-whole-vase-distant.png`
// and `02-whole-vase-profile.png`. The reference set has no turning video of the whole plant, so
// the envelope comes from the two profiles' outlines rather than a turntable hull. Run
// `bun run plants:fit english-elm` where a turn exists, and replace these figures with its
// measures.
import type { RadialEnvelope } from '../../core/record';

/**
 * The outline the plant fills: the visual hull of the two profile stills, as radii over the plant's
 * height at 16 azimuths. Each row is an ellipse: still `01` at turn 0 sets the extent across the
 * camera's view, and still `02` at turn 90 sets the extent toward it.
 */
export const envelope: RadialEnvelope | undefined = {
	kind: 'radial',
	heights: [
		0.2, 0.257, 0.314, 0.371, 0.429, 0.486, 0.543, 0.6, 0.657, 0.714, 0.771, 0.829, 0.886, 0.943, 1,
	],
	radii: [
		[
			0.12, 0.0946, 0.0683, 0.0562, 0.0528, 0.0562, 0.0683, 0.0946, 0.12, 0.0946, 0.0683, 0.0562,
			0.0528, 0.0562, 0.0683, 0.0946,
		],
		[
			0.1923, 0.1576, 0.1178, 0.0981, 0.0924, 0.0981, 0.1178, 0.1576, 0.1923, 0.1576, 0.1178,
			0.0981, 0.0924, 0.0981, 0.1178, 0.1576,
		],
		[
			0.4369, 0.3558, 0.2643, 0.2196, 0.2067, 0.2196, 0.2643, 0.3558, 0.4369, 0.3558, 0.2643,
			0.2196, 0.2067, 0.2196, 0.2643, 0.3558,
		],
		[
			0.4631, 0.4142, 0.3402, 0.2955, 0.2815, 0.2955, 0.3402, 0.4142, 0.4631, 0.4142, 0.3402,
			0.2955, 0.2815, 0.2955, 0.3402, 0.4142,
		],
		[
			0.5431, 0.4903, 0.4077, 0.3564, 0.3402, 0.3564, 0.4077, 0.4903, 0.5431, 0.4903, 0.4077,
			0.3564, 0.3402, 0.3564, 0.4077, 0.4903,
		],
		[
			0.5062, 0.4849, 0.443, 0.4104, 0.3988, 0.4104, 0.443, 0.4849, 0.5062, 0.4849, 0.443, 0.4104,
			0.3988, 0.4104, 0.443, 0.4849,
		],
		[
			0.5785, 0.5543, 0.5065, 0.4692, 0.456, 0.4692, 0.5065, 0.5543, 0.5785, 0.5543, 0.5065, 0.4692,
			0.456, 0.4692, 0.5065, 0.5543,
		],
		[
			0.5585, 0.545, 0.5163, 0.4916, 0.4824, 0.4916, 0.5163, 0.545, 0.5585, 0.545, 0.5163, 0.4916,
			0.4824, 0.4916, 0.5163, 0.545,
		],
		[
			0.5354, 0.5305, 0.5192, 0.5086, 0.5044, 0.5086, 0.5192, 0.5305, 0.5354, 0.5305, 0.5192,
			0.5086, 0.5044, 0.5086, 0.5192, 0.5305,
		],
		[
			0.4862, 0.4883, 0.4936, 0.4991, 0.5015, 0.4991, 0.4936, 0.4883, 0.4862, 0.4883, 0.4936,
			0.4991, 0.5015, 0.4991, 0.4936, 0.4883,
		],
		[
			0.4554, 0.4594, 0.4696, 0.4806, 0.4853, 0.4806, 0.4696, 0.4594, 0.4554, 0.4594, 0.4696,
			0.4806, 0.4853, 0.4806, 0.4696, 0.4594,
		],
		[
			0.3969, 0.4014, 0.4129, 0.4255, 0.4311, 0.4255, 0.4129, 0.4014, 0.3969, 0.4014, 0.4129,
			0.4255, 0.4311, 0.4255, 0.4129, 0.4014,
		],
		[
			0.3585, 0.3579, 0.3566, 0.3554, 0.3548, 0.3554, 0.3566, 0.3579, 0.3585, 0.3579, 0.3566,
			0.3554, 0.3548, 0.3554, 0.3566, 0.3579,
		],
		[
			0.2446, 0.2381, 0.2242, 0.2125, 0.2082, 0.2125, 0.2242, 0.2381, 0.2446, 0.2381, 0.2242,
			0.2125, 0.2082, 0.2125, 0.2242, 0.2381,
		],
		[
			0.0185, 0.0138, 0.0096, 0.0078, 0.0073, 0.0078, 0.0096, 0.0138, 0.0185, 0.0138, 0.0096,
			0.0078, 0.0073, 0.0078, 0.0096, 0.0138,
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
];
