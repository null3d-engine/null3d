// The holm oak as a directed frame, in its clump form: ten slender stems from one swollen base
// that spread like the ribs of a vase, each with one slow S-bend, each forking three times under one
// shared dome of clumps, which fine wood clothes with the branch end of still 21. Each figure names
// the reference picture it was read on. Shares are of the plant's height. Still 01 and the
// whole-plant turning video are the one plant the frame follows.
import type { Curve } from '../../core/types';
import {
	type FrameBranchRule,
	type FrameLength,
	type FrameSide,
	type FrameSpec,
	framedRecord,
} from '../../grow/frame';
import { PIECES } from './pieces';
import { record } from './record';

/**
 * The fine wood that clothes a clump, each twig ending in a socket that carries the branch end of
 * still 21. A branch end is 1.05 m long and 1.0 m wide on a plant 8 m tall, so the sockets stand a
 * branch end's width apart over the clump's surface and a branch end's reach inside it.
 */
const ENDS = { pitch: 1.0 / 8, reach: 1.05 / 8 } as const;

/**
 * A rounded clump of foliage that fine wood clothes. Still 01: the dome's surface is rounded masses
 * a fifth to a quarter of the height across.
 */
const CLUMP = { kind: 'clump', width: 0.24, depth: 0.18, fill: ENDS } as const;

/**
 * The branches that end a stem's stated wood: three from each second fork, each to the dome's
 * shell, where it carries a clump of foliage that fine wood clothes. Still 05: the bare wood ends
 * at the crown's underside and the clumps fill the dome above it.
 */
const branches: FrameBranchRule = {
	name: 'branch',
	role: 'branch',
	count: 3,
	along: [1, 1],
	around: 'ring',
	jitter: 25,
	// Still 21: about 30 degrees each side of the axis.
	angle: 30,
	from: 'parent',
	angleSpread: 6,
	// A clump's pieces stand a tenth of the height outside the branch's end, so the end stands that
	// far inside the outline. Still 09: a leafy spray is half a metre long at the least.
	length: { outline: 0.8 },
	vary: 0.06,
	least: 0.06,
	most: 0.4,
	radius: 0.65,
	taper: 0.3,
	// Still 01: the dome's rim droops a little.
	bends: [{ from: 0.4, to: 1, by: 12 }],
	sway: 14,
	elbows: 4,
	patch: CLUMP,
};

/**
 * The side branches of a stem's first arms, each with its own clump. Stills 02 and 18: foliage
 * hangs along the outer wood and down to the rim at a quarter of the height, under the dome the
 * forks carry. They leave the arms, above the arch under the forks that no foliage stands in.
 */
const sides: FrameBranchRule = {
	name: 'side',
	role: 'branch',
	count: { every: 0.03, least: 1, most: 4 },
	along: [0.4, 0.95],
	stagger: 0.3,
	around: 'spiral',
	// None leaves an arm's underside, so none runs down into the arch's boundary from where it
	// leaves.
	clear: 140,
	jitter: 20,
	angle: 55,
	from: 'parent',
	angleSpread: 8,
	length: { outline: 0.82 },
	vary: 0.1,
	least: 0.05,
	most: 0.26,
	radius: 0.5,
	taper: 0.35,
	// Still 02: the rim's foliage hangs from wood that arches out and over.
	bends: [{ from: 0.3, to: 1, by: 25 }],
	sway: 14,
	elbows: 3,
	apart: 0.006,
	patch: CLUMP,
};

/**
 * A fork of a stem's wood. Still 08: 55 degrees between the arms, each 0.6 to 0.7 of the stem. A
 * fork whose length is found on the outline stops short of it on the crown's narrow sides, where a
 * fixed length would carry its clumps past the rim.
 */
function fork(
	name: string,
	length: FrameLength,
	children: readonly FrameBranchRule[],
): FrameBranchRule {
	return {
		name,
		role: 'limb',
		// Stills 01 and 18: a stem forks into two, sometimes three.
		count: 2,
		along: [1, 1],
		around: 'ring',
		jitter: 25,
		angle: 27,
		from: 'parent',
		angleSpread: 5,
		length,
		vary: 0.15,
		least: 0.08,
		most: 0.16,
		radius: 0.65,
		taper: 0.7,
		// Stills 05 and 18: the arms keep bending.
		sway: 16,
		elbows: 2,
		children,
	};
}

/**
 * One side of the crown as a whole still shows it, from the species' measured targets: the
 * greatest reach from the trunk's line in bands a sixteenth of the height deep, from the band where
 * the crown starts to the top band, and the lower boundary, read from the same reach as the lowest
 * band that reaches each distance out, with the arch under the forks read by eye nearer the trunk.
 * Every figure is a share of the plant's height in that still.
 */
interface Reading {
	/** The band, from 1 at the foot to 16 at the top, where the crown starts on this side. */
	readonly from: number;
	readonly reach: readonly number[];
	readonly under: Curve;
}

// Still 01, right of the trunk's line, and left of it.
const STILL_01_RIGHT: Reading = {
	from: 6,
	reach: [0.5, 0.628, 0.638, 0.641, 0.632, 0.589, 0.549, 0.526, 0.461, 0.365, 0.204],
	under: [
		[0, 0.42],
		[0.15, 0.4],
		[0.3, 0.31],
		[0.5, 0.31],
		[0.6, 0.375],
		[0.64, 0.44],
	],
};
const STILL_01_LEFT: Reading = {
	from: 6,
	reach: [0.451, 0.572, 0.612, 0.605, 0.605, 0.609, 0.569, 0.49, 0.467, 0.322, 0.227],
	under: [
		[0, 0.42],
		[0.15, 0.4],
		[0.3, 0.31],
		[0.45, 0.31],
		[0.5, 0.375],
		[0.6, 0.44],
	],
};
// Still 02, a quarter turn on: the wide side, whose rim hangs lower.
const STILL_02_LEFT: Reading = {
	from: 5,
	reach: [0.737, 0.759, 0.772, 0.788, 0.769, 0.761, 0.7, 0.692, 0.546, 0.48, 0.462, 0.324],
	under: [
		[0, 0.42],
		[0.15, 0.4],
		[0.35, 0.25],
		[0.7, 0.25],
		[0.75, 0.31],
		[0.78, 0.44],
	],
};
const STILL_02_RIGHT: Reading = {
	from: 5,
	reach: [0.759, 0.791, 0.825, 0.814, 0.783, 0.783, 0.74, 0.719, 0.663, 0.552, 0.424, 0.122],
	under: [
		[0, 0.42],
		[0.15, 0.4],
		[0.35, 0.25],
		[0.75, 0.25],
		[0.8, 0.31],
		[0.82, 0.375],
	],
};

/** A side of the outline, from its reading on a still. */
function side(toward: number, read: Reading): FrameSide {
	return {
		toward,
		reach: [
			...read.reach.map((reach, band) => [(read.from + band - 0.5) / 16, reach] as const),
			[1, 0],
		],
		under: read.under,
	};
}

/** The holm oak's frame. */
export const frame: FrameSpec = {
	// The outline, side by side, as the oak's is: still 01 gives the two sides it looks across, and
	// still 02, a quarter turn on, the two it looks along, which are the crown's wide way.
	outline: [
		side(0, STILL_01_RIGHT),
		side(90, STILL_02_LEFT),
		side(180, STILL_01_LEFT),
		side(270, STILL_02_RIGHT),
	],
	stems: {
		name: 'stem',
		// Stills 02 and 18: ten to twelve stems, two of them near the middle. Still 01 shows eight
		// in profile, where stems hide one another.
		count: 10,
		inner: 2,
		// The outer stems stand an eighth of a turn apart from the side still 01 looks across, so
		// each one's lean below is stated for its own side.
		first: 0,
		// Still 01: the stool is 0.08 of the height wide, and the stems part at 0.07.
		ring: [
			[0, 0.008],
			[0.12, 0.01],
			[0.2, 0.03],
			[1, 0.03],
		],
		// Each stem's lean from plumb where it leaves the stool. Still 01: the inner stems lean 5 to
		// 15 degrees, and the outer ones toward its two sides about 32. Still 18, at still 01's turn:
		// the outer ones lean 25 to 35. Still 02: the outer ones toward the crown's wide sides lean
		// about 40 and carry its rim out and down to a quarter of the height; those between lean 35,
		// so the crown's plan is the turning video's oval and no rounder. The record's single lean
		// is the old grower's mean over every stem. The eight outer stems stand at places 2 to 9 of
		// 9, from the side still 01's right looks across, a turn round.
		lean: [
			[0, 6],
			[1 / 9, 13],
			[2 / 9, 32],
			[3 / 9, 35],
			[4 / 9, 40],
			[5 / 9, 35],
			[6 / 9, 32],
			[7 / 9, 35],
			[8 / 9, 40],
			[1, 35],
		],
		// Stills 01 and 17: a stem is 0.026 to 0.03 of the height wide above its foot and holds
		// its width to its fork.
		width: [
			[0, 0.036],
			[0.03, 0.03],
			[0.5, 0.026],
		],
		// Stills 01 and 18: a stem forks between 0.35 and 0.52 of the height, the middle ones highest.
		length: {
			height: [
				[0, 0.46],
				[0.2, 0.42],
				[1, 0.4],
			],
		},
		vary: 0.12,
		// Stills 01 and 06: one slow S to a stem. It leans out farther above the stool and stands
		// steeper under the crown, as a vase's rib does.
		bends: [
			{ from: 0.08, to: 0.45, by: 12 },
			{ from: 0.45, to: 1, by: -14 },
		],
		sway: 16,
		elbows: 2,
		children: [fork('arm', { share: 0.12 }, [fork('fork', { outline: 0.62 }, [branches]), sides])],
	},
};

/**
 * The holm oak's record with the frame as its growth and the branch end of still 21 at each socket.
 * The shoot rows are working figures, not measured ones: a kit with no pieces draws them.
 */
export const directed = {
	...framedRecord(record, frame, { rows: { mean: 4, spread: 1 }, fan: 45, piece: 'branch-end' }),
	pieces: PIECES.filter((piece) => piece.name === 'branch-end'),
	// Each of the frame's ten stems takes the foot's flare, so the record's flare for one stem of the
	// clump spreads into a disc. Still 07: each stem swells a little where it joins the stool, and
	// short roots stand out of the ground between them.
	base: {
		...record.base,
		flare: { amount: 0.25, height: 0.3 },
		buttress: { lobes: { mean: 3, spread: 1 }, amount: 0.2, sharpness: 2, height: 0.3 },
		roots: {
			count: { mean: 4, spread: 1 },
			length: { mean: 0.45, spread: 0.12 },
			radius: 0.06,
			dive: 0.2,
		},
	},
};
