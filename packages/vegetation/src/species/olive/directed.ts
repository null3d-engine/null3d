// The olive as a directed frame: one massive trunk a third of the height wide, three crooked great
// limbs that leave it below its top and spread outward, two that divide from its top, and each
// limb's branches, which end in an airy mass of sprays. Each figure names the reference picture it
// was read on. Shares are of the tree's height. Still 01 and the whole-tree turning video are the
// one tree the frame follows.
//
// The trunk here is one axis with the bundle's measured width. Its surface is the wood mesher's
// work: five deep columns wound a little over half a turn from the ground to the fork, their grooves
// a third of a column deep, a tall dark hollow up the front between the columns, a two-lobed
// buttress with burred crests at the foot, and a few thick roots that run from the lobes.

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
const ENDS = { pitch: (0.95 * 1.06 * 0.72) / 7, reach: 0.9 / 7 } as const;

/**
 * What a great limb's own wood shares. Stills 05, 01 and 18: a limb is crooked, with two or three
 * bends of 20 to 40 degrees to one side and the other in turn, each rounded, and it is never
 * straight for more than five of its widths.
 */
const crooked = { sway: 32, elbows: 4, crook: 0.35 } as const;

/**
 * The branches a limb ends in. Still 05: a limb divides into two branches, and those divide again
 * before the leafy sprays. Still 01: each limb carries its own airy mass on drooping sprays, and
 * the wood behind the sprays is bare.
 */
const branches: FrameBranchRule = {
	name: 'branch',
	role: 'branch',
	count: 2,
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
			length: { outline: 0.9 },
			vary: 0.08,
			least: 0.06,
			most: 0.32,
			radius: 0.6,
			taper: 0.3,
			// Still 01: the sprays droop.
			bends: [{ from: 0.35, to: 1, by: 38 }],
			sway: 22,
			elbows: 3,
			// Still 05: the sprays of one mass keep clear of one another.
			apart: 0.015,
			// Stills 01 and 18: each limb carries two great masses whose sprays join into a cloud,
			// with sky between the masses of neighbouring limbs.
			patch: { kind: 'mass', width: 0.4, depth: 0.32, offset: -0.3, fill: ENDS },
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
				// Stills 01 and 18: the first limb stands on the plant's +X axis, which leaves the
				// bays between the masses open where 18's photograph shows them.
				first: 0,
				jitter: 12,
				// Still 05: the outer limbs keep clear of one another as they run out level.
				apart: 0.012,
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
		// own.
		flare: { amount: 0, height: 0.25 },
		// Stills 14 and 20: two great lobes with burred crests carry the bole, and a few thick roots
		// run from them over the ground rather than a skirt of thin ones.
		buttress: record.base?.buttress && {
			...record.base.buttress,
			lobes: { mean: 2, spread: 0 },
			amount: 0.5,
			sharpness: 1.8,
			height: 0.8,
			round: 0.7,
		},
		roots: record.base?.roots && {
			...record.base.roots,
			count: { mean: 3, spread: 0 },
			length: { mean: 0.9, spread: 0.2 },
			radius: 0.16,
			dive: 0.45,
			ridge: 0.9,
		},
		// Stills 17 and 20: five deep columns wind a little over half a turn from the ground to the
		// fork, their grooves a third of a column deep, so the ridges stand as braided strands.
		flutes: { count: { mean: 5, spread: 0 }, depth: 0.34, height: 3.4, twist: 0.55, hold: 0.85 },
		// Stills 14, 17, 18 and 20: a tall dark hollow runs up the bole's front between the columns and
		// opens between the lobes at the ground; the review turns the plant's +Z side to the camera.
		scar: {
			from: 0.02,
			to: 2.4,
			angle: 90,
			width: 16,
			depth: 0.45,
			colour: [0.03, 0.026, 0.02] as const,
			shade: 0.9,
		},
	},
	extras: record.extras?.map(fruit),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
};
