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
import { evenOutline, type FrameBranchRule, type FrameSpec, framedRecord } from '../../grow/frame';
import { record } from './record';

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
			count: 3,
			along: [1, 1],
			around: 'ring',
			jitter: 30,
			angle: 38,
			from: 'parent',
			angleSpread: 8,
			// A mass's sprays stand a little outside the wood's end.
			length: { outline: 0.9 },
			vary: 0.08,
			least: 0.06,
			most: 0.32,
			radius: 0.6,
			taper: 0.3,
			// Still 01: the sprays droop.
			bends: [{ from: 0.45, to: 1, by: 28 }],
			sway: 22,
			elbows: 3,
			patch: { kind: 'mass', width: 0.19, depth: 0.15 },
		},
	],
};

/** The olive's frame. */
export const frame: FrameSpec = {
	// Still 01, the outline's half width in bands from the top down to the foliage foot.
	outline: evenOutline(
		[
			[0.26, 0.5],
			[0.271, 0.55],
			[0.313, 0.6],
			[0.354, 0.66],
			[0.396, 0.69],
			[0.438, 0.725],
			[0.479, 0.785],
			[0.521, 0.81],
			[0.563, 0.805],
			[0.604, 0.785],
			[0.688, 0.76],
			[0.729, 0.75],
			[0.771, 0.68],
			[0.813, 0.635],
			[0.854, 0.395],
			[0.896, 0.385],
			[0.938, 0.325],
			[0.979, 0.18],
			[1, 0],
		],
		// The crown is built nearly round. Still 01 looks across the wide side.
		0.8,
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
				// Still 01: an outer limb turns level over its first half and runs out so.
				bends: [{ from: 0.1, to: 0.5, level: 6 }],
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
 * The olive's record with the frame as its growth. A socket holds four shoot rows that fan 45
 * degrees from its line. These two are working figures, not measured ones: they stand until the
 * species' branch pieces are placed at its sockets, which then state what a socket holds.
 */
export const directed = framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45 });
