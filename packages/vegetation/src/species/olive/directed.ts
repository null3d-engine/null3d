// The olive as a directed frame: one massive trunk a third of the height wide, three crooked great
// limbs that leave it below its top and spread outward, two that divide from its top, and each
// limb's branches, which end in an airy mass of sprays. Each figure names the reference picture it
// was read on. Shares are of the tree's height. Still 01 and the whole-tree turning video are the
// one tree the frame follows.
//
// The trunk here is one axis with the bundle's measured width. Its surface is the wood mesher's
// work: six columns wound half a turn from the ground to the fork, each 0.3 of the waist wide, with
// grooves 0.4 of a column deep, a dark opening 0.05 wide and 0.075 tall at 0.20 of the height, two
// or three burrs on the lower bole, and one or two roots from each column.

import type { ExtraSpec } from '../../core/record';
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a mass, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 0.95 m tall and 1.06 times as wide on a tree 7 m tall. The sockets stand
 * a branch end's reach inside the mass's surface and closer together than its width, so neighbouring
 * branch ends overlap as a real crown's do.
 */
const ENDS = { pitch: (0.95 * 1.06 * 0.65) / 7, reach: 0.95 / 7 } as const;

/**
 * What a great limb's own wood shares. Stills 05, 01 and 18: a limb is crooked, with two or three
 * bends of 20 to 40 degrees to one side and the other in turn, each rounded, and it is never
 * straight for more than five of its widths.
 */
const crooked = { sway: 32, elbows: 4, crook: 0.35 } as const;

/**
 * The branches a limb ends in. Still 05: a limb divides into two or three branches, and those
 * divide again before the leafy sprays. Still 01: each limb carries its own airy mass, 0.3 to 0.45
 * of the crown's width across, on drooping sprays, and the wood behind the sprays is bare.
 */
const branches: FrameBranchRule = {
	name: 'branch',
	role: 'branch',
	count: 3,
	along: [1, 1],
	around: 'ring',
	jitter: 25,
	angle: 38,
	from: 'parent',
	angleSpread: 8,
	length: { share: 0.15 },
	vary: 0.2,
	radius: 0.6,
	taper: 0.6,
	sway: 28,
	elbows: 2,
	children: [
		{
			name: 'spray',
			role: 'branch',
			count: 4,
			along: [1, 1],
			around: 'ring',
			jitter: 30,
			angle: 38,
			from: 'parent',
			angleSpread: 8,
			// A mass's sprays stand a little outside the wood's end, and its upright branch ends stand
			// above them, so the sprays end inside the outline by about a branch end's height.
			length: { outline: 0.82 },
			vary: 0.08,
			least: 0.06,
			most: 0.32,
			radius: 0.6,
			taper: 0.3,
			// Still 01: the sprays droop.
			bends: [{ from: 0.35, to: 1, by: 38 }],
			sway: 22,
			elbows: 3,
			// Still 01: each limb's airy mass is 0.3 to 0.45 of the crown's width across, made of its
			// sprays' masses together.
			// Still 01: a mass hangs from its sprays' ends, its body under them.
			patch: { kind: 'mass', width: 0.34, depth: 0.26, offset: -0.35, fill: ENDS },
		},
	],
};

/** The olive's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in bands from the top down to the foliage foot, each band's
	// height 0.94 of the photograph's: the upright branch ends stand above the frame's outline by
	// about their own height, so the drawn top stands at the photograph's.
	outline: evenOutline(
		[
			[0.244, 0.5],
			[0.255, 0.55],
			[0.294, 0.6],
			[0.333, 0.66],
			[0.372, 0.69],
			[0.412, 0.725],
			[0.45, 0.785],
			[0.49, 0.81],
			[0.529, 0.805],
			[0.568, 0.785],
			[0.647, 0.76],
			[0.685, 0.75],
			[0.725, 0.68],
			[0.764, 0.635],
			[0.803, 0.395],
			[0.842, 0.385],
			[0.882, 0.325],
			[0.92, 0.18],
			[0.94, 0],
		],
		// The crown is built round: still 02, a quarter turn on, is 0.96 as wide over tall as still
		// 01, and still 01 looks through a crown as deep as it is wide.
		1,
	),
	stems: {
		name: 'trunk',
		count: 1,
		// Still 01: 0.30 wide at the waist, from 0.2 to 0.3 of the height; the centre column that
		// carries on above the outer limbs is two thirds of the waist. The ground width of 0.585 is
		// the roots' spread, which the wood mesher adds; the axis itself widens to 0.42.
		width: [
			[0, 0.42],
			[0.05, 0.36],
			[0.12, 0.32],
			[0.25, 0.3],
			[0.36, 0.3],
			[0.51, 0.2],
		],
		// Still 01: the centre column divides at 0.51 of the height.
		length: { share: 0.51 },
		// Stills 01, 02 and 17: no lean; the centre line sways by a quarter of the waist's width.
		sway: 12,
		elbows: 2,
		children: [
			{
				...crooked,
				name: 'outer',
				role: 'limb',
				// Stills 03 and 05, from below: five to six limbs stand round the trunk in every
				// direction; still 01 shows four in profile, which is the count seen from one side. The
				// frame has six: four outer limbs here and the centre pair. Still 01: the outer limbs
				// leave at 0.36 of the height. The shares here are of the trunk's own length.
				count: 4,
				along: [0.66, 0.76],
				around: 'ring',
				jitter: 12,
				// Still 01: the far left limb leaves at 65 to 70 degrees from plumb and the right one
				// at 60, and each runs out nearly level.
				angle: [
					[0, 70],
					[1, 62],
				],
				from: 'plumb',
				angleSpread: 4,
				// Still 01: a limb runs a third of the height bare before it breaks into branches.
				length: { share: 0.33 },
				vary: 0.1,
				// Still 01: 0.32 to 0.36 of the waist, and 0.6 of that at half its length.
				radius: 0.34,
				taper: 0.3,
				// Still 01: an outer limb turns level over its first half or more and runs out so.
				bends: [{ from: 0.05, to: 0.6, level: 6 }],
				children: [branches],
			},
			{
				...crooked,
				name: 'centre',
				role: 'limb',
				// Still 01: the centre pair divides from the column's top, at 25 and 15 degrees from
				// plumb.
				count: 2,
				along: [1, 1],
				around: 'ring',
				jitter: 15,
				angle: 20,
				from: 'plumb',
				angleSpread: 5,
				// Still 01: the centre limbs are short, and their masses reach the crown's flat top.
				length: { share: 0.15 },
				vary: 0.12,
				radius: 0.55,
				taper: 0.4,
				children: [branches],
			},
		],
	},
};

/**
 * The share of the rows that bear olives: the record's 0.3 of the old grower's 1,876 rows at seed 11
 * over the frame's 3,826, so the tree hangs the olives the record means.
 */
const FRUIT_SHARE = (0.3 * 1876) / 3826;

/** The record's olives, hung at the frame's share of its rows. */
const fruit = (extra: ExtraSpec): ExtraSpec =>
	extra.kind === 'fruit' && extra.at === 'shoot-tip' ? { ...extra, share: FRUIT_SHARE } : extra;

/**
 * The olive's record with the frame as its growth and the branch end of still 21 at each socket.
 * The shoot rows are working figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45, piece: 'branch-end' }),
	base: {
		...record.base,
		// The frame's trunk already widens to still 01's foot, so the stem base adds no flare of its
		// own and keeps still 14's lobes and roots.
		flare: { amount: 0, height: 0.25 },
		// The frame's trunk also widens toward the ground, so the lobes swell less than the record's
		// and its roots run lower and shorter: still 01's foot is 0.6 of the height across at 0.03 of
		// it, half at 0.06, 0.37 at 0.1 and 0.32 at 0.15, and its roots lie low as they spread.
		buttress: record.base?.buttress && { ...record.base.buttress, amount: 0.3 },
		roots: record.base?.roots && {
			...record.base.roots,
			radius: 0.2,
			length: { mean: 1, spread: 0.3 },
		},
		// Still 01: the bole is six columns that wind about half a turn from the ground to the fork, at
		// 0.49 of the height, with grooves between them 0.4 of a column deep.
		flutes: { count: { mean: 6, spread: 0 }, depth: 0.25, height: 3.4, twist: 0.4, hold: 0.8 },
		// Still 01: a dark opening 0.05 of the height wide and 0.077 tall at 0.21 of it, facing the
		// camera; the review turns the plant's +Z side to the camera.
		scar: {
			from: 1.14,
			to: 1.66,
			angle: 90,
			width: 20,
			depth: 0.3,
			colour: [0.03, 0.026, 0.02] as const,
			shade: 0.9,
		},
	},
	extras: record.extras?.map(fruit),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
};
