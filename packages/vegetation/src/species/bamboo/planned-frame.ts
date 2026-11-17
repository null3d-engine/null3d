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
import { evenOutline, type FramePatchRule, type FrameSpec } from '../../grow/frame';
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
	// The culms and their branch pairs never thin: the pairs are the record's limbs, as a pine's
	// whorl boughs are, and the grower's own thinning starts at order 2. The sub-branches and twigs
	// carry the sparseness, at orders 2 and 3.
	thin: [0, 0, 0.45, 0.3],
	leavesAt: [
		[0, 1],
		[0.5, 0.6],
		[1, 0.25],
	],
	// The bamboo's record carries no fruit, so the crop never shows.
	fruitFrom: 2,
	fruitBand: 0.1,
	capCards: 'stated',
	// The clump class's cap rule: a maximum keeps at least six culms and one pair a culm, and the
	// culm cost is the coarsest step's two triangles a segment.
	clump: { leastCulms: 6, leastPairs: 1 },
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};

/**
 * The fan cluster a planned twig carries: the blades crowd on one short twig. Its sockets are the
 * plan's fourth order, where the crown's pieces are priced.
 */
const fanPatch: FramePatchRule = {
	kind: 'clump',
	width: [
		[0, 0.025],
		[1, 0.035],
	],
	depth: [
		[0, 0.025],
		[1, 0.035],
	],
	fill: { pitch: 0.03, reach: 0.015 },
};

/**
 * The cluster a pair carries: the seed a low cap draws as a card, so the crown keeps a card on the
 * wood every cap draws before any twig is paid for.
 */
const seedPatch: FramePatchRule = {
	kind: 'clump',
	width: [
		[0, 0.03],
		[1, 0.04],
	],
	depth: [
		[0, 0.03],
		[1, 0.04],
	],
};

/**
 * Candidate two: the pair's wood stated as three orders, with a fan at the twig. The culm is order
 * 0, its branch pair order 1, the pair's sub-branches order 2, their twigs order 3, and the fan
 * piece stands at the twigs' sockets, the plan's fourth order.
 */
export const plannedFrameDeep: FrameSpec = {
	...plannedFrame,
	stems: {
		...plannedFrame.stems,
		children: [
			{
				name: 'pair',
				role: 'branch',
				// Two branches a joint, a pair every internode of about 0.06 of the height.
				count: { every: 0.03, least: 4, most: 24 },
				along: [growth.branches.from.rim, 0.95],
				around: 'opposite',
				angle: [
					[0, meanOf(growth.branches.leave)],
					[1, meanOf(growth.branches.leave) - 5],
				],
				from: 'parent',
				// The pair runs to the crown's outline, so the crown's top stays at the culm's tip
				// and the plant keeps the record's height.
				length: { outline: 0.9 },
				radius: 0.35,
				taper: 0.2,
				sway: 5,
				elbows: 3,
				patch: seedPatch,
				children: [
					{
						name: 'sub',
						role: 'branch',
						// 4 to 6 alternate sub-branches on a branch.
						count: 5,
						along: [0.25, 0.95],
						around: 'spiral',
						angle: 45,
						from: 'parent',
						length: {
							parent: [
								[0, 0.2],
								[1, 0.3],
							],
						},
						radius: 0.5,
						taper: 0.5,
						sway: 4,
						elbows: 2,
						children: [
							{
								name: 'twig',
								role: 'branch',
								count: 4,
								along: [0.3, 0.95],
								around: 'spiral',
								angle: 50,
								from: 'parent',
								length: { parent: 0.4 },
								radius: 0.5,
								taper: 0.5,
								sway: 3,
								elbows: 2,
								patch: fanPatch,
							},
						],
					},
				],
			},
		],
	},
};

/**
 * The ruled 400 cap's counts as a frame: seven culms, one pair a culm, the blades carded. It is the
 * read the ruling asks for, not the allocator rule, which is not placed here.
 */
export const plannedFrame400: FrameSpec = {
	...plannedFrameDeep,
	stems: {
		...plannedFrameDeep.stems,
		count: 7,
		children: plannedFrameDeep.stems.children?.map((rule) =>
			rule.name === 'pair' ? { ...rule, count: 1, along: [0.45, 0.85] } : rule,
		),
	},
};

/** The deep frame's planned growth, with the fan at every twig's socket. */
export const plannedGrowthDeep: Planned = {
	...plannedGrowth,
	frame: plannedFrameDeep,
	piece: 'fan',
};

/** The ruled 400 read's planned growth: seven culms, one pair each, the fan carded. */
export const plannedGrowth400: Planned = {
	...plannedGrowthDeep,
	frame: plannedFrame400,
};
