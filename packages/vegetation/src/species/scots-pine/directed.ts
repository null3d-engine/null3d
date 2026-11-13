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
			// Picture 01, with its foot followed below the horizon, starts the crown at 0.465 of the
			// height, and the turning video's bare bole is 0.45 to 0.53 of it, median 0.466. So the
			// lowest level stands there, and the lowest pads' floors fall with their limbs to about
			// that height. Stills 18 (0.386) and 02 (0.33) are trees that start lower.
			levels: [0.46, 0.52, 0.61, 0.69, 0.755],
			// Still 02 shows 13 limbs in profile: six on its left and seven on its right. A profile
			// misses the limbs that point toward and away from the camera, about half as many again,
			// so the tree holds 18 to 20: 14 on the trunk and the 4 that carry on from its top.
			count: 14,
			// Still 05: the limbs of a level leave at slightly different heights.
			stagger: 0.012,
			jitter: 12,
			// Still 02, five limbs read at five distances from the trunk: a limb rises 15 to 25
			// degrees over its first 0.05 to 0.10 of the height, then runs level within 5 degrees.
			// The two lowest droop 10 to 20 degrees over their outer third. Still 01, one long limb
			// at 0.62 of the height traced on a grid: it rises 0.06 of the height over a run of
			// 0.14, holds for 0.18 and falls 0.12 over its last 0.22, which is four tenths of its
			// run at a mean of 29 degrees below level.
			leave: [
				[0.46, 30],
				[0.755, 34],
			],
			run: [
				[0.46, 0],
				[0.755, 5],
			],
			end: [
				[0.46, -28],
				[0.52, -28],
				[0.61, -55],
				[0.69, -55],
				[0.755, -28],
			],
			riseOver: 0.14,
			endOver: 0.4,
			// Still 01, the outline's farther side by height: 0.25 of the height from the trunk's
			// line at 0.45 to 0.50, 0.55 at 0.50 to 0.55, 0.60 at 0.55 to 0.60, 0.52 to 0.55 from
			// 0.60 to 0.75, 0.45 at 0.75 to 0.80 and 0.36 at 0.80 to 0.85. A limb rises, runs and
			// falls, and its foliage rides on its outer part, so the foliage's middle stands about
			// 0.04 of the height above where the limb leaves. Each pair is the outline at that height.
			reach: [
				[0.46, 0.4],
				[0.52, 0.6],
				[0.61, 0.55],
				[0.69, 0.55],
				[0.755, 0.47],
				[0.81, 0.36],
			],
			// Stills 03 and 05: seen from below the limbs are spokes of like length. Still 02: of 13
			// limbs, 8 show bare wood 0.12 of the height from the trunk, 5 at 0.20 and 3 at 0.30. A
			// limb that points toward the camera reads short, and a pad hides the outer half of its
			// limb, so those counts fit a tree where two limbs in three reach nearly as far as the
			// crown does at their height and one in three stops at about half of that.
			reachShare: [
				[0, 0.45],
				[0.3, 0.6],
				[0.4, 0.92],
				[1, 1],
			],
			// The crown is built nearly round. Stills 01 and 02 stand a quarter turn apart and are
			// 1.14 and 1.08 of the height wide, so the narrow side is 0.95 of the wide side. Still 01
			// looks across the wide side.
			plan: { narrow: 0.95, turn: 0 },
			// Still 02: at 0.05 of the height from the trunk's line a limb is 0.14 to 0.39 of the
			// trunk's width. Still 01: at 0.06 the long limbs are 0.30 to 0.41 of it. One long limb
			// is 0.022 of the height thick at 0.06, 0.014 at 0.10 and 0.15 and 0.013 at 0.20, where
			// the trunk is 0.054: 0.41 of the trunk, then 0.26 and 0.24. So a limb swells to twice
			// its own radius at the trunk's line and the swelling fades by 0.12 of the height, which
			// gives 0.14 and 0.41 at the measured place from 0.2 and 0.58 at the line.
			radius: [0.2, 0.58],
			collar: { swell: 2, over: 0.12 },
			// The same limb keeps 0.93 of its radius over half of its bare run, so 0.85 where its
			// pad begins.
			taper: 0.85,
			// Still 01: a long limb strays from its line in slow bends.
			wander: 7,
			// Stills 03 and 08: a limb forks two or three times in its outer half. The fork of still
			// 08 opens 75 to 80 degrees, and each arm is about 0.7 of its parent's width.
			arms: { count: 2, angle: 39, radius: 0.7 },
		},
		// Still 01: the top limbs rise at about 45 degrees and level out under the top plates. Four
		// limbs of half the trunk's width keep its cross-section.
		// Still 01, the outline's two sides by height: 0.09 and 0.11 of the height from the trunk's
		// line at 0.95 to 1, and 0.27 and 0.17 at 0.90 to 0.95. One pad stands on top over the
		// trunk's line, and the others stand lower round it.
		top: { limbs: 4, leave: 45, end: 0, radius: 0.5, leader: 0.55 },
		// Still 02, six pads: 0.23 to 0.35 of the height wide.
		// One pad a limb: the limb's arms spread under it.
		// Stills 01 and 02 from the side: a pad clothes the outer part of its limb, which is bare for
		// its inner 0.40 to 0.44 (02 on a grid, 01's two long limbs by eye). The pad lies along the
		// outer two thirds of its limb's reach.
		// Still 02's six pads read 0.29 to 0.53 as deep as wide from the side, median 0.38. The depth
		// seen there takes in the fall of the pad's floor along its falling limb, so the dome itself
		// is shallower: a dome 0.29 of its width deep reads 0.29 to 0.40 as deep as long from the
		// side, median 0.34.
		patch: {
			kind: 'pad',
			each: 'limb',
			width: [0.23, 0.35],
			along: 2 / 3,
			depth: 0.29,
			// Still 20: on a pad's top the brushes stand shoulder to shoulder. A bough carries seven
			// brushes, each 0.21 to 0.28 of its length across, so seven of them tile a square 0.36 m
			// on a side. At that spacing over the whole dome the crown reads more closed than stills
			// 01, 02 and 18 at the first card level; one bough to each 0.42 m square brings 01 and 18
			// inside the review's band. Still 02 holds more sky inside its crown: its tree starts the
			// crown at 0.33 of its height and holds more tiers, a different tree from picture 01's.
			// Stills 04 and 20: the brushes on a pad's top stand turned up and those at its rim
			// reach out. The steepest that a bough leaves its twig is read by eye.
			sockets: { piece: 'bough', pitch: 0.42, lift: 45 },
		},
	},
	foliage: needles,
	lod: {
		...record.lod,
		// A card pictures one whole bough, which already overlaps its neighbours on the pad, so it
		// draws at the bough's own size. A card larger than its bough makes the far tree taller and
		// wider than the near one.
		cardGrow: 1,
		// Both card levels keep the bole and the limbs, the wood a viewer sees between the plates.
		// The forks and twigs under a pad stand inside its boughs, which the cards picture, and each
		// card still joins drawn wood through its pad's other cards.
		woodOrders: [1, 1],
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
		// 0.40, and both between. Above the bole only the upper stem and the limbs are orange: still
		// 01's limbs and still 08's fork. The fact sheet and still 09: the smaller wood is grey-brown,
		// the branch and its side twigs alike, linear 0.21 to 0.24, 0.14 to 0.16 and 0.086 to 0.102.
		// Wood thicker than 3.5 cm in radius takes the orange, and thinner wood the grey plates
		// tinted to still 09's mean.
		zones: [
			{ layer: 0, by: 'height', from: 0, to: 7.5, blend: 1 },
			{
				layer: 1,
				by: 'radius',
				from: 0.035,
				to: 2,
				blend: 0.015,
				second: { from: 7.5, to: 30, blend: 1 },
			},
			{
				layer: 0,
				by: 'radius',
				from: 0,
				to: 0.035,
				blend: 0.015,
				tint: [1.28, 1.13, 0.79],
				second: { from: 7.5, to: 30, blend: 1 },
			},
		],
		// The young bark of thin wood tinted to still 09's grey-brown.
		youngTint: [0.53, 0.97, 1.53],
	},
	// Still 02: the foot is 1.6 times as wide at the ground as the bole is at a tenth of the
	// height, and the widening fades within the lowest 0.03 of the height. Stills 14 and 17: the
	// bole is round, with no buttress and no flute. Still 14: five or six roots run out over the
	// ground like toes, each a quarter to a third of the trunk's width, standing clear of the
	// ground where they leave.
	base: {
		flare: { amount: 0.33, height: 0.4 },
		taper: (record.base as BaseSpec).taper,
		roots: {
			count: { mean: 5.5, spread: 0.5 },
			length: { mean: 1.4, spread: 0.3 },
			radius: 0.22,
			dive: 0.3,
			ridge: 0.8,
		},
	},
};
