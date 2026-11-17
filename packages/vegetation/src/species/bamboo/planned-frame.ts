// The bamboo's frame for the planned model: the culm model's measured clump, stated as a frame.
//
// Every size here is the culm model's own, read in directed.ts and fit.ts; the frame only says how
// a culm stands and where its branching joints are. One stem is one culm, 22 on a foot 0.12 of the
// height; a culm's width is nearly constant, with the swollen foot and the slow taper the culm
// grower states; its bow is a foot lean and a bend above it. A child is one branching joint, a
// short spur whose patch carries the pair piece the crown is made of.
//
// This is a candidate for the class study, not the shipped record: index.ts still exports the
// directed clump.
import type { Planned } from '../../core/record';
import type { Spread } from '../../core/types';
import { evenOutline, type FrameSpec } from '../../grow/frame';
import { directed } from './directed';
import { envelope } from './fit';

const growth = directed.growth;
if (growth.model !== 'culm-clump')
	throw new Error("@null3d/vegetation: the bamboo's directed record is not a culm clump");

/** The clump's height, in metres, as the directed record states it. */
const HEIGHT = 8;

/** A spread's mean, whether the record states a range or a single figure. */
const meanOf = (spread: Spread): number => (typeof spread === 'number' ? spread : spread.mean);

/**
 * The envelope's mean radius by height: the clump's reach round every azimuth, as the fitting tool
 * measured it from the turning video. The plan's outline is one reach curve, so the 16 azimuths
 * become their mean; the narrow share below gives the plan's other side.
 */
const REACH = (envelope?.heights ?? []).map((at, row): readonly [number, number] => {
	const radii = envelope?.radii[row] ?? 0;
	const values = typeof radii === 'number' ? [radii] : radii;
	const mean =
		values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
	return [at, mean];
});

/**
 * A culm's diameter as a share of the height, by the share of its length: the culm grower's own
 * profile, a swollen foot and a slow taper to a tip at 0.45 of the foot's width. The grower's
 * constants are not in the record, so the curve restates them; a class that states its culm's
 * width profile in the record would carry one copy.
 */
const WIDTH = [
	[0, 0.0257],
	[0.12, 0.0215],
	[0.5, 0.0154],
	[0.8, 0.0115],
	[1, 0.0086],
] as const;

/** The bamboo's planned frame: 22 culms, their branch joints, and the pair each carries. */
export const plannedFrame: FrameSpec = {
	outline: evenOutline(REACH, growth.depth),
	stems: {
		name: 'culm',
		count: Math.round(meanOf(growth.culms)),
		// The culm stands near plumb and rigid: little sway, and a few long elbows in its bow.
		sway: 1,
		elbows: 4,
		// The culm's feet stand on a sunflower spiral out to a foot 0.12 of the height across.
		ring: [
			[0, 0.02],
			[0.25, 0.06],
			[0.5, 0.085],
			[0.75, 0.104],
			[1, growth.foot / HEIGHT],
		],
		// The foot's lean, by the culm's place from the middle to the rim; the frame leans a stem
		// only as a whole, so the bow above it is a bend.
		lean: [
			[0, 0.5],
			[1, growth.lean.foot],
		],
		bends: [
			{
				from: 0.25,
				to: 1,
				level: [
					[0, 80],
					[1, 90 - growth.lean.tip],
				],
			},
		],
		width: WIDTH,
		length: {
			share: [
				[0, growth.height[0]],
				[1, growth.height[1]],
			],
		},
		children: [
			{
				name: 'pair',
				role: 'branch',
				// One joint every internode, the middle joints about 0.06 of the height apart.
				count: { every: 0.06, least: 2, most: 14 },
				along: [growth.branches.from.rim, 0.95],
				// One pair a joint, each turned on from the last.
				around: 'spiral',
				angle: [
					[0, meanOf(growth.branches.leave)],
					[1, meanOf(growth.branches.leave) - 5],
				],
				from: 'parent',
				// The pair piece hangs from the spur, so the spur itself is short and thin.
				length: { share: 0.02 },
				radius: 0.5,
				taper: 0.5,
				sway: 2,
				elbows: 2,
				patch: {
					kind: 'clump',
					width: [
						[0, 0.035],
						[1, 0.05],
					],
					depth: [
						[0, 0.035],
						[1, 0.05],
					],
					// The pair hangs at a socket of the fan cluster's own width; the fine wood under
					// it is what prices the crown in the plan's socket order.
					fill: { pitch: 0.04, reach: 0.02 },
				},
			},
		],
	},
};

/** The bamboo's planned growth, a candidate for the class study. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// A culm lives about a dozen years; the clump renews itself culm by culm.
	fullAge: 12,
	// A shoot reaches most of its height in one season, and the clump then fills in.
	height: [
		[0, 0],
		[0.05, 2.5],
		[0.15, 5.5],
		[0.35, 7.4],
		[1, HEIGHT],
	],
	spread: [
		[0, 0.04],
		[0.1, 0.18],
		[0.3, 0.42],
		[0.7, 0.66],
		[1, 0.75],
	],
	adult: 'frame',
	frame: plannedFrame,
	// The pair the crown is made of: one piece a socket, as the directed clump places them.
	piece: 'pair-full',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The fill's woody twigs through a clump: the pair piece carries the fans, so the fill is thin.
	orders: [{ density: 3, angle: 55, length: 0.12, birth: 0, kink: 12 }],
	// The culms never thin; the pair spurs and the fill do.
	thin: [0, 0.55, 0.45, 0.3],
	leavesAt: [
		[0, 1],
		[0.5, 0.6],
		[1, 0.25],
	],
	// The bamboo's record carries no fruit, so the crop never shows.
	fruitFrom: 2,
	fruitBand: 0.1,
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
