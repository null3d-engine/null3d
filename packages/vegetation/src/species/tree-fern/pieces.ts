// The soft tree fern's pieces: its living fronds in three arches and its dead skirt frond, each placed
// whole at a socket round the growing point. Each value names the picture or the fact-sheet line it
// was read on; lengths are metres on a fern 4.4 m tall (see directed.ts).
//
// A frond is twice divided (the fact sheet): a hairy rachis carrying thirty or more pairs of pinnae in
// its own plane, each pinna cut into some seventeen pairs of lobed pinnules. Near, the high and ultra
// tiers draw each pinnule; far, the low and medium tiers draw each pinna as one leaf whose picture
// shows its pinnules, so the frond still reads twice divided.
import type { PieceLeaves, PieceRule, PieceSides, PieceStem, PieceStudio } from '../../leaf/piece';

/** The frond's length. Picture 01: 0.6 of the fern's height, 2.64 m; the fact sheet: 1.5 to 3 m. */
export const FROND = 2.64;

/** The share of the frond's length that the bare, hairy stipe takes (stills 07 and 21; 05). */
const STIPE = 0.1;

/** Pinna pairs. The fact sheet: thirty or more; picture 05 shows more than 30 on the clearest frond. */
const PAIRS = 32;

/**
 * A pinna's length over its frond's, by its place along the frond: the blade is a broad lance,
 * narrow at the base, widest at 0.45 and tapering to a long tip (pictures 01 and 04).
 */
const PINNA_ALONG: readonly (readonly [number, number])[] = [
	[STIPE, 0.35],
	[0.45, 1],
	[0.9, 0.3],
	[1, 0.15],
];

/**
 * The longest pinna, in metres. Pictures 01 and 04: the blade is 0.25 to 0.3 of the frond wide at its
 * widest, and a pinna leaves at 75 degrees, so the longest pinna is 0.14 of the frond.
 */
const PINNA = 0.14 * FROND;

/**
 * The species' leaf is one pinna (its texture, slot 24, is a pinna with its pinnules painted in), so a
 * pinna takes the leaf at its own size and a pinnule a small copy of it. Pictures 12 and 24: a pinna
 * is 0.32 as wide as long; its pinnules stand nearly square to its midrib, so one is about 0.17 of
 * the pinna long.
 */
const LEAF = 0.36;

/** The pinnules along one pinna: about 17 pairs, in the pinna's plane (pictures 09, 10 and 12). */
const PINNULES: PieceLeaves = {
	gap: PINNA / 17,
	from: 0.04,
	ranked: [0],
	angle: 70,
	angleSpread: 4,
	scale: [
		[0, (0.17 * PINNA) / LEAF],
		[0.6, (0.15 * PINNA) / LEAF],
		[1, (0.05 * PINNA) / LEAF],
	],
	skyward: 0.6,
};

/**
 * A pinna near: a thin hairy midrib carrying its pinnules (pictures 08, 09 and 22). It is nearly
 * straight, so it keeps a ring only where it bends 8 degrees, not one at each pinnule.
 */
const PINNA_STEM: PieceStem = {
	length: { mean: PINNA, spread: 0.03 },
	radius: [0.0025, 0.0006],
	droop: 10,
	rings: 8,
	bud: false,
	leaves: PINNULES,
};

/**
 * The pinnae along the rachis: near-opposite pairs in the frond's plane, 70 to 80 degrees to the
 * rachis, a little forward (pictures 08, 21 and 22), one side and the other in turn half a pair's
 * spacing apart.
 */
const PINNAE: PieceSides = {
	stem: PINNA_STEM,
	gap: ((1 - STIPE) * FROND) / (2 * PAIRS),
	from: STIPE,
	to: 0.99,
	arrangement: 'alternate',
	angle: { mean: 75, spread: 4 },
	lengthAlong: PINNA_ALONG,
};

/** The pinnae far: one leaf each, at the same places, sizes and angles, hanging a little (picture 04). */
const PINNA_LEAVES: PieceLeaves = {
	gap: ((1 - STIPE) * FROND) / PAIRS,
	from: STIPE,
	ranked: [-15],
	angle: 75,
	angleSpread: 4,
	scale: PINNA_ALONG.map(([t, share]) => [t, (share * PINNA) / LEAF] as const),
	skyward: 0.6,
};

/**
 * A frond's rachis, bent by its rank's arch: the degrees it turns toward its lower side and the
 * stretch it turns over. It is 0.012 of the frond thick at its foot, red-brown and hairy below and
 * thinning to its tip (pictures 05 and 08). The far mesh keeps a ring every 8 degrees of the arch.
 */
function rachis(droop: number, droopOver: readonly [number, number], near: boolean): PieceStem {
	return {
		length: { mean: FROND, spread: 0.15 },
		radius: [0.006 * FROND, 0.002],
		droop,
		droopOver,
		rings: 8,
		bud: false,
		...(near ? { sides: [PINNAE] } : { leaves: PINNA_LEAVES }),
	};
}

/** A living frond of one arch: pinnules near, one leaf a pinna far. */
function frond(name: string, droop: number, droopOver: readonly [number, number]): PieceRule {
	return {
		name,
		attitude: 'along',
		variants: 1,
		lengthwise: true,
		stem: rachis(droop, droopOver, true),
		far: rachis(droop, droopOver, false),
	};
}

/**
 * The tree fern's pieces, fitted to picture 01's arches from the growing point (the specification's
 * table): the inner fronds rise to 0.45 of a frond above it at 0.7 along and end 0.38 above; the
 * middle ones rise to 0.15 at 0.35 along and end 0.1 below; the outer ones barely rise and hang to
 * 0.55 to 0.6 below. With the ranks' leaving angles (directed.ts) the fitted arches give 0.43 at 0.73
 * and 0.36 for the inner; 0.17 at 0.44 and -0.10 for the middle; and, on the middle's arch leaving
 * near level, 0.01 and -0.51 for the outer. One arch serves the middle and the outer ranks, so the
 * kit holds two living fronds rather than three.
 */
export const PIECES: readonly PieceRule[] = [
	frond('frond-inner', 90, [0.2, 1]),
	frond('frond-arched', 100, [0.15, 1]),
	// Pictures 01, 16 and 20: a dead frond hangs plumb against the trunk, shrivelled, its pinnae
	// folded down along the rachis so it is 0.18 as wide as long. It draws one leaf a pinna at every
	// tier.
	{
		name: 'frond-dead',
		attitude: 'along',
		variants: 1,
		lengthwise: true,
		stem: {
			...rachis(8, [0, 1], false),
			leaves: { ...PINNA_LEAVES, ranked: [20], angle: 25, angleSpread: 6 },
		},
	},
];

/** The studio photograph of a cut frond: still 21 stands one frond upright on its cut. */
export const STUDIO: readonly PieceStudio[] = [{ still: 21, piece: 'frond-arched' }];
