// The Italian cypress as a directed frame: a plumb trunk to the tip, steep boughs that rise inside
// the column, a closed shell of upright fans on the measured outline, and a dark inner body behind
// the fans. Shares are of the tree's height. The set has no fact sheet, so the height is the
// record's 17 m.
//
// Picture 01 and the turning video are one tree, and their figures stand first. Picture 18 is the
// same tree; picture 02 is a second one.
import type { BarkSpec, Species } from '../../core/record';
import { PIECES } from './pieces';
import { record } from './record';

const { forms: _forms, ...own } = record;

/**
 * Picture 01, the outline's half width by height: the medians of bands a twentieth of the height
 * tall, read by script, each at its band's middle. The foliage starts where 0.011 of the height of
 * trunk shows under it and tucks in to it, as pictures 02 and 18 show over their short bare stems:
 * the lowest band's median, 0.060, is held by a curve that rises from 0.035 at the foliage's foot.
 * The top band's median, 0.017, stands at its middle, where the shell ends, so the top is blunt, as
 * picture 18's is.
 */
const OUTLINE: readonly (readonly [number, number])[] = [
	[0.011, 0.035],
	[0.02, 0.052],
	[0.05, 0.068],
	[0.075, 0.077],
	[0.125, 0.082],
	[0.2, 0.084],
	[0.275, 0.084],
	[0.375, 0.081],
	[0.45, 0.08],
	[0.525, 0.077],
	[0.575, 0.074],
	[0.625, 0.071],
	[0.675, 0.068],
	[0.725, 0.0645],
	[0.775, 0.06],
	[0.825, 0.0545],
	[0.875, 0.046],
	[0.925, 0.033],
	[0.975, 0.017],
];

/** The inner body's share of the outline's half width: a share proposed by the specification, not measured. */
const BODY = 0.6;

/** The inner body's top, as a share of the height: the point above it is too narrow to hide it. */
const BODY_TOP = 0.95;

/** The inner body's half width at the foliage's foot: the trunk's own there (picture 02's foot). */
const BODY_FOOT = 0.016;

/** The height from which the inner body takes its share of the outline, above the foot's curve. */
const BODY_FROM = 0.05;

/**
 * The inner body's tint on the trunk's bark: the leaf texture's mean over the bark's, in the shade
 * of the column's own foliage. Linear means of the textures: bark 0.202, 0.131 and 0.102; leaf
 * 0.078, 0.143 and 0.017. The shade is a third of the lit colour, by eye on picture 04's creases.
 */
const BODY_TINT = [0.135, 0.38, 0.058] as const;

/** The Italian cypress's record with the directed frame in place of the grown one. */
export const directed: Species = {
	...own,
	pieces: PIECES,
	// Every twig of the frame ends in a fan and the inner body carries none by its nature, so no
	// bare wood is trimmed.
	...(record.shoots
		? { shoots: { ...record.shoots, placement: { ...record.shoots.placement, bareTrim: 0 } } }
		: {}),
	growth: {
		model: 'conifer',
		trunk: {
			// Picture 02: 0.031 of the height across at the foot (20 pixels on a grid); picture 01:
			// about 0.028. The foliage hides the trunk above that in every whole view, so the taper
			// above is unmeasured: it runs to a slim leader at the tip.
			width: [
				[0, 0.031],
				[0.05, 0.026],
				[0.3, 0.02],
				[0.6, 0.013],
				[0.9, 0.006],
				[1, 0.002],
			],
			// Pictures 06, 17 and 03: one plumb stem to the tip.
			dividesAt: 1,
			wander: 0.3,
		},
		limbs: {
			// Pictures 05 and 06: boughs at many heights on every side, no whorl. The levels stand
			// closer where the column is widest, so each bough feeds about the same area of fans.
			levels: [
				0.011, 0.022, 0.035, 0.05, 0.068, 0.088, 0.11, 0.135, 0.16, 0.185, 0.21, 0.235, 0.26, 0.285,
				0.31, 0.34, 0.37, 0.4, 0.43, 0.465, 0.5, 0.54, 0.58, 0.625, 0.67, 0.72, 0.77, 0.82, 0.87,
				0.92,
			],
			count: 120,
			stagger: 0.008,
			jitter: 20,
			// Picture 07: a bough leaves at 20 to 25 degrees from the trunk; pictures 05, 06 and 03: it
			// runs 10 to 20 degrees from vertical. Below a tenth of the height the shell stands 0.06 to
			// 0.08 of the height out, which a bough that steep cannot reach: no picture shows those
			// boughs, so they leave wider and turn up.
			leave: [
				[0.011, 10],
				[0.06, 40],
				[0.12, 67],
				[1, 70],
			],
			run: [
				[0.011, 25],
				[0.06, 55],
				[0.12, 75],
				[1, 78],
			],
			end: [
				[0.011, 60],
				[0.12, 80],
				[1, 82],
			],
			riseOver: 0.04,
			endOver: 0.3,
			// The shell: picture 01's outline (picture 01 looks across the wide side).
			reach: OUTLINE,
			// Every bough runs out to the shell.
			reachShare: [
				[0, 1],
				[1, 1],
			],
			// Sixteen frames of the turning video: 0.154 to 0.174 of the height wide at 0.20 to 0.30,
			// so the narrow side is 0.94 of the wide side.
			plan: { narrow: 0.94, turn: 0 },
			// Picture 05: a bough is one eighth to one tenth of the trunk beside it.
			radius: [0.1, 0.12],
			// Picture 07: a bough's base swells a little.
			collar: { swell: 1.3, over: 0.01 },
			taper: 0.6,
			wander: 3,
			// Picture 08's narrow fork is not built: the shell's twigs carry its fans.
			arms: { count: 0, angle: 15, radius: 0.7 },
		},
		// A dark inner body stands behind the fans at the specification's share of the outline, from
		// the foliage's foot to where the point narrows, so a crease shows shade and never sky.
		body: {
			// At the foliage's foot the body is no wider than the trunk, so the column tucks in to its
			// stem; from the foot's curve up it takes its share of the outline.
			radius: [
				[OUTLINE[0]?.[0] ?? 0, BODY_FOOT],
				...OUTLINE.filter(([at]) => at >= BODY_FROM && at <= BODY_TOP).map(
					([at, half]) => [at, half * BODY] as const,
				),
			],
		},
		patch: {
			kind: 'shell',
			each: 'limb',
			// The wood a twig may leave: a bough's outer part within this width of its end. The top's
			// patch carries one fan on the leader's tip, which stands half a depth below the top.
			width: [0.02, 0.03],
			depth: 1,
			sockets: {
				// Each socket takes the plume of still 21 or the forked plume of still 08.
				piece: ['fan', 'fork'],
				// Picture 04: about twenty fans round the column where it is widest, each as wide as
				// its spacing, and the rows' tips 0.23 to 0.29 of the column's width apart up it, 0.74
				// of a fan's height. The fan of picture 21 is 0.38 of its length wide, so at 0.52 m a
				// row's fans stand 0.2 m apart and the rows 0.38 m. The fan's length is its cones':
				// picture 04's fans read 1.0 m only on a tree 17 m tall, a height no fact sheet gives,
				// so the shell holds about four times the fans picture 04 counts.
				pitch: 0.2,
				rise: 0.38,
				// Pictures 04, 10 and 03: each fan stands upright, tip up, pressed to the surface.
				lift: 10,
			},
		},
	},
	lod: {
		...record.lod,
		// A fan's card joins the plant through its twig's bough, so no card draws a stalk: on a
		// closed column every card's stalk would draw a pale line over the fans.
		cardStalk: 0,
		cardStalkToFoliage: false,
	},
	bark: {
		...(record.bark as BarkSpec),
		// The trunk's grey-brown strips, and the inner body in the foliage's shade. The body is the
		// thickest wood at every height, so three bands of height, each a radius the body passes
		// and the trunk never reaches there, give it its colour.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 22, blend: 1.5 },
			{
				layer: 0,
				by: 'radius',
				from: 0.35,
				to: 3,
				blend: 0.02,
				tint: BODY_TINT,
				second: { from: 0, to: 8, blend: 0.2 },
			},
			{
				layer: 0,
				by: 'radius',
				from: 0.18,
				to: 3,
				blend: 0.02,
				tint: BODY_TINT,
				second: { from: 8, to: 14, blend: 0.2 },
			},
			{
				layer: 0,
				by: 'radius',
				from: 0.1,
				to: 3,
				blend: 0.02,
				tint: BODY_TINT,
				second: { from: 14, to: 22, blend: 0.2 },
			},
		],
	},
	// Picture 14: a modest flare, the foot about 1.3 times the stem above it; pictures 14, 06 and 07:
	// round, with no flutes, no buttress and no root that shows.
	base: {
		flare: { amount: 0.3, height: 0.3 },
	},
};
