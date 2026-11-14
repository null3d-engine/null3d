// The European beech as a directed frame: a thick, barely tapering trunk that divides at a third of
// the height into ten great limbs, which sweep out and up under a wide low dome, their boughs ending
// in layered sprays over the dome's surface and in a skirt near the grass, which fine wood clothes
// with the branch end of still 21. Each figure names the reference picture it was read on. Shares
// are of the tree's height. Still 01 and the whole-tree turning video are the one tree the frame
// follows.
import type { Curve } from '../../core/types';
import {
	type FrameBranchRule,
	type FrameSide,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a spray, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 1.2 m long and 1.3 m wide on a tree 20 m tall, so the sockets stand a
 * branch end's width apart over the spray's surface and a branch end's reach inside it.
 */
const ENDS = { pitch: 1.2 / 20, reach: 1.17 / 20 } as const;

/**
 * A layered spray of foliage that fine wood clothes. Still 04: flat sprays of oval leaves overlap
 * like shingles. Still 01: the dome's surface is a scale of rounded layers a sixth of the height
 * across and half as deep.
 */
const SPRAY = { kind: 'clump', width: 0.17, depth: 0.08, fill: ENDS } as const;

/**
 * The boughs of a great limb, each ending at the dome's surface in a spray. Stills 05 and 06: the
 * foliage sits on the outer half of every limb and on its boughs, and the inner wood is bare. Still
 * 01: the low boughs' ends droop to the skirt.
 */
const boughs: FrameBranchRule = {
	name: 'bough',
	role: 'branch',
	count: { every: 0.03, least: 4, most: 10 },
	along: [0.3, 1],
	stagger: 0.3,
	around: 'spiral',
	// None leaves a limb's underside, so none runs down into the open space under the crown.
	clear: 120,
	jitter: 20,
	// Still 08: a fork opens about 40 degrees; a bough stands wider off its limb near the trunk.
	angle: [
		[0, 50],
		[1, 30],
	],
	from: 'parent',
	angleSpread: 8,
	// A spray's pieces stand a tenth of the height outside the bough's end, so the end stands that
	// far inside the outline.
	length: { outline: 0.92 },
	vary: 0.1,
	least: 0.04,
	most: 0.3,
	radius: 0.45,
	taper: 0.3,
	// Still 01: the boughs bow down toward the dome's rim.
	bends: [{ from: 0.3, to: 1, by: 35 }],
	sway: 14,
	elbows: 3,
	apart: 0.006,
	patch: SPRAY,
};

/**
 * One side of the crown as a whole still shows it, from the species' measured targets: the greatest
 * reach from the trunk's line in bands a sixteenth of the height deep, from the foot to the top, and
 * the crown's lower boundary out from the trunk.
 */
interface Reading {
	readonly reach: readonly number[];
	readonly under: Curve;
}

/**
 * The crown's lower boundary out from the trunk's line. Still 01: the bole shows bare to 0.21 of the
 * height under the crown, the skirt falls away from it, and at the rim the foliage hangs to 0.04 of
 * the height on the left and 0.036 on the right.
 */
const UNDER: Curve = [
	[0, 0.22],
	[0.12, 0.21],
	[0.25, 0.14],
	[0.4, 0.08],
	[0.55, 0.045],
	[0.75, 0.036],
];

// Still 01, right of the trunk's line, and left of it, foot band first.
const STILL_01_RIGHT: Reading = {
	reach: [
		0.7039, 0.7303, 0.7138, 0.7072, 0.7303, 0.7138, 0.6579, 0.6678, 0.6579, 0.625, 0.6086, 0.5625,
		0.5493, 0.4539, 0.3816, 0.2467,
	],
	under: UNDER,
};
const STILL_01_LEFT: Reading = {
	reach: [
		0.5592, 0.6382, 0.6875, 0.7105, 0.6908, 0.6875, 0.6908, 0.6579, 0.6349, 0.6382, 0.6118, 0.5395,
		0.5066, 0.4539, 0.3586, 0.2829,
	],
	under: UNDER,
};

/** A side of the outline, from its reading on a still. */
function side(toward: number, read: Reading): FrameSide {
	return {
		toward,
		reach: [
			[0, read.reach[0] as number],
			...read.reach.map((reach, band) => [(band + 0.5) / 16, reach] as const),
			[1, 0],
		],
		under: read.under,
	};
}

/** The European beech's frame. */
export const frame: FrameSpec = {
	// The outline, side by side. The turning video reads the crown 0.69 to 0.70 tall over wide at
	// every turn, so the crown is round in plan and still 01's two sides stand for the other two as
	// well. Stills 02 and 18, 1.65 wide over tall, are other trees, which the frame does not follow.
	outline: [
		side(0, STILL_01_RIGHT),
		side(90, STILL_01_RIGHT),
		side(180, STILL_01_LEFT),
		side(270, STILL_01_LEFT),
	],
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.26 wide at the ground, 0.118 at breast height and 0.104 at mid bole. Still 17:
		// the bole barely thins below the first limbs.
		width: [
			[0, 0.26],
			[0.04, 0.15],
			[0.08, 0.118],
			[0.3, 0.104],
		],
		// Stills 01 and 17: the trunk divides at about a third of the height.
		length: { share: 0.33 },
		// Stills 01, 17 and 03: no lean and no bend.
		sway: 1.5,
		elbows: 3,
		children: [
			{
				name: 'limb',
				role: 'limb',
				// Still 18: ten to twelve great limbs leave the trunk's top.
				count: 10,
				along: [0.82, 1],
				stagger: 0.2,
				around: 'spiral',
				jitter: 15,
				// Still 01: the lowest leave at 55 to 65 degrees from plumb and sweep out under the
				// skirt; the middle ones stand at 40; the highest rise at 15 to 20.
				angle: [
					[0, 78],
					[0.5, 50],
					[1, 20],
				],
				from: 'plumb',
				angleSpread: 5,
				// Stills 01 and 05: the bare wood shows to about 0.7 of the crown's half width.
				length: { outline: 0.75 },
				vary: 0.08,
				// Still 07: a great limb is half the bole where it leaves.
				radius: 0.5,
				taper: 0.55,
				// Still 01: the limbs sweep out and then up.
				bends: [
					{
						from: 0.15,
						to: 0.75,
						level: [
							[0, -10],
							[0.4, 10],
							[0.7, 30],
							[1, 50],
						],
					},
					{
						from: 0.75,
						to: 1,
						by: [
							[0, 30],
							[0.4, 15],
							[1, 0],
						],
					},
				],
				sway: 10,
				elbows: 4,
				// Still 05: the limbs fan round the tree and none lies along another.
				apart: 0.012,
				children: [boughs],
			},
		],
	},
};

/**
 * The foot of the framed beech. The frame's trunk already flares to still 01's foot, so the stem
 * base adds no flare of its own, as the framed oak's and willow's do; the elephant-toe buttresses,
 * the roots and the clefts of stills 14 and 17 stay.
 */
const base = { ...record.base, flare: { amount: 0, height: 0.5 } } as const;

/**
 * The European beech's record with the frame as its growth and the branch end of still 21 at each
 * socket. The shoot rows are working figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45, piece: 'branch-end' }),
	base,
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
};
