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
	least: 0.03,
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
		least: 0.05,
		most: 0.16,
		radius: 0.65,
		taper: 0.7,
		// Stills 05 and 18: the arms keep bending.
		sway: 16,
		elbows: 2,
		// Still 06, inside the clump: the arms of neighbouring stems pass beside each other.
		apart: 0.004,
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
/**
 * The crown's narrow way over its wide way. The turning video is the primary plant: 1.26 wide over
 * tall at still 01's turn and 0.92 a quarter turn on, a share of 0.73, which the owner's plan ruling
 * holds at 0.75 or more; at 0.78 the sockets' spread round the turn stays inside the video's own
 * all-round band. Still 02, filed at that quarter turn, is 1.60 wide with foliage down to a quarter
 * of the height: another tree, which the frame does not follow.
 */
const NARROW = 0.78;

/**
 * A quarter turn's side, from a still 01 side: the video gives the width there and no reading of
 * each side by height, so a side keeps the profile still 01 shows and its reach takes the narrow
 * way's share, its lower boundary drawn in with it.
 */
function quarter(read: Reading): Reading {
	return {
		from: read.from,
		reach: read.reach.map((reach) => reach * NARROW),
		under: (read.under as readonly (readonly [number, number])[]).map(
			([out, height]) => [out * NARROW, height] as const,
		),
	};
}

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
	// The outline, side by side, as the oak's is: still 01 gives the two sides it looks across, the
	// crown's wide way, and the turning video the narrower two a quarter turn on.
	outline: [
		side(0, STILL_01_RIGHT),
		side(90, quarter(STILL_01_RIGHT)),
		side(180, STILL_01_LEFT),
		side(270, quarter(STILL_01_LEFT)),
	],
	stems: {
		name: 'stem',
		// Stills 02 and 18: ten to twelve stems, two of them near the middle. Still 01 shows eight
		// in profile, where stems hide one another.
		count: 10,
		inner: 2,
		// The outer stems stand an eighth of a turn apart, an eighth of that off the side still 01
		// looks across, so no two stand in line from its camera and each shows: still 01 shows eight.
		// The two inner stems stand a quarter turn on from the first, toward still 01's two sides,
		// so they part to the left and the right of its view. Each one's lean below is stated for its
		// own side.
		first: 281.25,
		// Still 01: the stool is 0.08 of the height wide, and the stems part at 0.07.
		ring: [
			[0, 0.008],
			[0.12, 0.01],
			[0.2, 0.03],
			[1, 0.03],
		],
		// Each stem's lean from plumb where it leaves the stool. Still 01: the inner stems lean 5 to
		// 15 degrees, and the outer ones toward its two sides, the crown's wide way, 30 to 35. Still
		// 18, at still 01's turn: the outer ones lean 25 to 35. The turning video: the crown is
		// narrower a quarter turn on, so the stems toward those sides lean about 18, and those
		// between 26. The record's single lean is the old grower's mean over every stem. The eight
		// outer stems stand at places 2 to 9 of 9, from a quarter-turn side round past still 01's
		// right.
		lean: [
			[0, 7],
			[1 / 9, 12],
			[2 / 9, 18],
			[3 / 9, 26],
			[4 / 9, 34],
			[5 / 9, 26],
			[6 / 9, 18],
			[7 / 9, 26],
			[8 / 9, 34],
			[1, 26],
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
