// The Scots pine as a directed frame: the trunk, the limb levels and each limb's course, read from
// the reference set and stated here. Shares are of the tree's height. The pictures set the
// proportions and the fact sheet sets the height, so the bole is the pictures' share of a 20 m tree.
//
// Still 01 and the whole-tree turning video are one tree, and their figures stand first. Still 02
// is another tree of the same habit: its limbs show best against the sky, so the limb levels, the
// limbs' course and their thickness are read on it.
import type { BarkSpec, BaseSpec, Species } from '../../core/record';
import { PIECES } from './pieces';
import { record } from './record';

const { forms: _forms, ...own } = record;

/**
 * The needle pairs. Still 12 and the fact sheet: a needle is about twenty-two times as long as it
 * is wide.
 */
const needles: Species['foliage'] =
	record.foliage.kind === 'fascicle'
		? { ...record.foliage, needle: { ...record.foliage.needle, width: 0.0027 } }
		: record.foliage;

/** The Scots pine's record with the directed frame in place of the grown one. */
export const directed: Species = {
	...own,
	// The tree's sockets carry the bough alone, so its kit holds no other piece. The forked shoot is
	// the close photograph's subject and is drawn from the piece rules.
	pieces: PIECES.filter((piece) => piece.name === 'bough'),
	// Still 01: the bole is 0.076 of the height across at breast height.
	size: { ...record.size, dbh: 1.5 },
	growth: {
		model: 'conifer',
		trunk: {
			// Still 01, the outline's run through the trunk's line: 0.070 at 0.14 of the height, 0.064
			// at 0.28, 0.054 at 0.42 and 0.040 at 0.69. The foot's pair carries still 02's widening
			// above its flare, and the last pair runs the taper on to where the trunk divides.
			width: [
				[0, 0.084],
				[0.07, 0.076],
				[0.14, 0.07],
				[0.28, 0.064],
				[0.42, 0.054],
				[0.69, 0.04],
				[0.81, 0.034],
			],
			// Still 01: the trunk ends at 0.81 of the height, where three or four limbs rise from it.
			dividesAt: 0.81,
			// Stills 01, 02 and 18: the trunk's line holds within half a hundredth of the height.
			wander: 0.5,
		},
		limbs: {
			// Still 02: the limbs' wood crosses a line beside the trunk at these heights, in pairs.
			// The turning video's bare bole is 0.466 of the height, so the lowest level stands there.
			levels: [0.46, 0.52, 0.61, 0.69, 0.755],
			// Still 02 shows 13 limbs in profile, which is about 16 round the tree: 12 on the trunk
			// and the 4 that carry on from its top.
			count: 12,
			// Still 05: the limbs of a level leave at slightly different heights.
			stagger: 0.012,
			jitter: 12,
			// Still 02, five limbs read at five distances from the trunk: a limb rises 15 to 25
			// degrees over its first 0.05 to 0.10 of the height, then runs level within 5 degrees.
			// The two lowest droop 10 to 20 degrees over their outer third.
			leave: [
				[0.46, 20],
				[0.755, 25],
			],
			run: [
				[0.46, 0],
				[0.755, 4],
			],
			end: [
				[0.46, -15],
				[0.52, -10],
				[0.61, 0],
			],
			riseOver: 0.08,
			endOver: 0.33,
			// Still 01, the outline's farther side by height. A limb's foliage stands above the height
			// it leaves at, so each pair is the outline a tenth of the height above the limb.
			reach: [
				[0.46, 0.55],
				[0.52, 0.6],
				[0.69, 0.55],
				[0.755, 0.45],
				[0.81, 0.36],
			],
			// Stills 03 and 05: seen from below the limbs are spokes of like length. Still 02: of 13
			// limbs, 8 show bare wood 0.12 of the height from the trunk, 5 at 0.20 and 3 at 0.30; a
			// limb that points toward the camera reads short, and limbs whose bare wood runs 0.12 to
			// 0.40 of the height give those counts. The bare wood is about 0.6 of a limb's reach, so
			// the shortest limb reaches a third as far as the longest.
			reachShare: [
				[0, 0.33],
				[1, 1],
			],
			// The crown is built nearly round: its narrow side is 0.8 of its wide side. Still 01 looks
			// across the wide side.
			plan: { narrow: 0.8, turn: 0 },
			// Still 02: a limb beside the trunk is 0.14 to 0.39 of the trunk's width. Still 01: the
			// long limbs are 0.30 to 0.41 of it.
			radius: [0.2, 0.37],
			// Still 01, one long limb: 0.022 of the height thick beside the trunk and 0.014 a little
			// farther out.
			collar: { swell: 1.6, over: 0.04 },
			// The same limb is 0.013 thick at 0.20 from the trunk. Past that the pads hide the wood,
			// so the share at the pad is a working figure.
			taper: 0.5,
			// Still 01: a long limb strays from its line in slow bends.
			wander: 7,
			// Stills 03 and 08: a limb forks two or three times in its outer half. The fork of still
			// 08 opens 75 to 80 degrees, and each arm is about 0.7 of its parent's width.
			arms: { count: 2, angle: 39, radius: 0.7 },
		},
		// Still 01: the top limbs rise at about 45 degrees and level out under the top plates. Four
		// limbs of half the trunk's width keep its cross-section.
		top: { limbs: 4, leave: 45, end: 0, radius: 0.5 },
		// Still 02, six pads: 0.23 to 0.35 of the height wide, and 0.38 as deep as wide.
		// One pad a limb: the limb's arms spread under it.
		patch: {
			kind: 'pad',
			each: 'limb',
			width: [0.23, 0.35],
			depth: 0.38,
			// A bough is 0.55 m long and 0.83 as wide, and it stands on its socket tilted up, so
			// boughs half a metre apart tile a pad. Still 09: a side twig leaves its branch at 40
			// to 60 degrees.
			// Stills 04 and 20: the brushes stand on twigs that rise from the limb, which gives a
			// pad its depth. The rise is read by eye.
			sockets: { piece: 'bough', pitch: 0.5, twig: 55, lift: 35 },
		},
	},
	foliage: needles,
	lod: {
		...record.lod,
		// The first card level keeps the twigs that reach the boughs, and the second the arms under
		// each pad, so a far card still meets drawn wood.
		woodOrders: [3, 2],
		budget: {
			...record.lod.budget,
			// The kit of three bough variants holds 13,073,360 bytes at the finest tier, where each
			// needle draws round; the tree model's cap there is 22,600,000.
			kitBytes: { ...record.lod.budget.kitBytes, ultra: 13_200_000 },
		},
	},
	bark: {
		...(record.bark as BarkSpec),
		// Still 01 and the turning video: grey plates to 0.35 of the height, orange flakes above
		// 0.40, and both between.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 7.5, blend: 1 },
			{ layer: 1, by: 'height', from: 7.5, to: 24, blend: 1 },
		],
	},
	base: {
		...(record.base as BaseSpec),
		// Still 02: the foot is 1.6 times as wide at the ground as the bole is at a tenth of the
		// height, and the widening fades within the lowest 0.03 of the height.
		flare: { amount: 0.33, height: 0.4 },
	},
};
