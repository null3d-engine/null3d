// The soft tree fern's pieces: its living fronds in three arches and its dead skirt frond, each placed
// whole at a socket round the growing point. Each value names the picture or the fact-sheet line it
// was read on; lengths are metres on a fern 4.4 m tall (see directed.ts).
//
// A frond is twice divided (the fact sheet): a hairy rachis carrying thirty or more pairs of pinnae in
// its own plane, each pinna cut into some seventeen pairs of lobed pinnules. Each pinna is one card of
// the species' leaf, whose picture shows its pinnules apart with open gaps between them, so the frond
// reads twice divided at every tier: beside still 21 it reads nearer than a card for each pinnule, at
// a fourteenth of the triangles.
import type { PieceLeaves, PieceRule, PieceStem, PieceStudio } from '../../leaf/piece';

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
 * widest, and a pinna leaves at 75 degrees, so the longest pinna is 0.14 of the frond. On a whole
 * plant the whole pictures govern the frond's proportion (owner ruling 8); still 21's studio frond is
 * 0.64 as wide as long, a small frond of 11 pinna pairs, which is recorded as a conflict in the
 * reference.
 */
const PINNA = 0.14 * FROND;

/**
 * The species' leaf is one pinna (its texture, slot 24, is a pinna with its pinnules apart), in
 * metres at the leaf's own size. Pictures 12 and 24: a pinna is 0.32 as wide as long.
 */
const LEAF = 0.36;

/**
 * The pinnae: near-opposite pairs in the frond's plane, 70 to 80 degrees to the rachis, a little
 * forward (pictures 08, 21 and 22), hanging a little (picture 04), each one leaf.
 */
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
 * thinning to its tip (pictures 05 and 08). It keeps a ring every 8 degrees of its arch at every tier.
 */
function rachis(droop: number, droopOver: readonly [number, number]): PieceStem {
	return {
		length: { mean: FROND, spread: 0.15 },
		radius: [0.006 * FROND, 0.002],
		droop,
		droopOver,
		rings: 8,
		bud: false,
		leaves: PINNA_LEAVES,
	};
}

/**
 * The roll of a living frond about its line. The turning video's first frame: a frond pointing
 * across the view shows pinnae about 40 px above its rachis and 80 px below, against a face-on
 * half-width of about 53 px, so its flat blade stands 60 to 90 degrees from level; the fronds hanging
 * toward the lens still show half their faces, so the lower end.
 */
const ROLL = 60;

/** A living frond of one arch, its blade rolled. */
function frond(name: string, droop: number, droopOver: readonly [number, number]): PieceRule {
	return {
		name,
		attitude: 'along',
		variants: 1,
		lengthwise: true,
		roll: ROLL,
		stem: rachis(droop, droopOver),
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
		// A dead frond is brown to the tips (pictures 01, 05 and 20).
		browning: 1,
		stem: {
			...rachis(8, [0, 1]),
			leaves: { ...PINNA_LEAVES, ranked: [20], angle: 25, angleSpread: 6 },
		},
	},
];

/** The studio photograph of a cut frond: still 21 stands one frond upright on its cut. */
export const STUDIO: readonly PieceStudio[] = [{ still: 21, piece: 'frond-arched' }];
