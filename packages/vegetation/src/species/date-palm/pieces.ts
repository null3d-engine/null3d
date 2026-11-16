// The date palm's pieces: its living fronds in three shapes and its dead frond, each placed whole at
// a socket round the growing point. Each value names the picture or the fact-sheet line it was read
// on; lengths are metres on a palm 15 m tall, the fact sheet's least height (see directed.ts).
//
// A frond is a smooth, flattened, pale rachis. Its lowest fifth carries stiff spines in the frond's
// plane in place of leaflets (stills 07 and 21); above them the leaflets leave in groups of three a
// side, one raised out of the frond's plane, one in it and one lowered, so the frond reads bristly
// rather than as a flat comb (the fact sheet; stills 09, 11, 22 and 23). The leaflets shorten and
// close to a point at the tip, with no end pair (still 10).
import type { PieceLeaves, PieceRule, PieceSides, PieceStem, PieceStudio } from '../../leaf/piece';

/** The frond's length. Picture 01: 0.40 of the palm's height, 6 m at 15 m; the fact sheet: 4 to 6 m. */
export const FROND = 6;

/** The share of the frond's length that the spines take, from its foot (stills 07 and 21). */
const SPINE_ZONE = 0.22;

/**
 * The leaflets: about 102 a side, inside the re-audit's 100 to 200 (picture 04: 22 to 26
 * along 300 px of a 1,000 px rachis), in groups of three a side at lifts of -30, 0 and 30 degrees, a
 * group every 0.13 m over the frond's upper 0.78. Each leaves 50 degrees from the rachis, the
 * specification's 40 to 50 degrees forward of square (stills 09 and 22). The longest stand at the
 * middle of the frond; they shorten to a third of that at the tip (stills 10 and 21).
 */
const LEAFLETS: PieceLeaves = {
	gap: ((1 - SPINE_ZONE) * FROND) / 34,
	from: SPINE_ZONE,
	ranked: [-30, 0, 30],
	angle: 50,
	angleSpread: 5,
	scale: [
		[SPINE_ZONE, 0.6],
		[0.5, 1],
		[0.75, 0.9],
		[1, 0.35],
	],
	skyward: 0.5,
};

/**
 * The spines: stiff, yellow, 0.03 to 0.05 of the frond long, at 60 to 80 degrees to the rachis, in
 * the frond's plane, one side and the other in turn (stills 07 and 21).
 */
const SPINES: PieceSides = {
	stem: {
		length: { mean: 0.04 * FROND, spread: 0.01 * FROND },
		radius: [0.006, 0.0006],
		bud: false,
	},
	gap: 0.07,
	from: 0.02,
	to: SPINE_ZONE,
	arrangement: 'alternate',
	angle: { mean: 70, spread: 8 },
};

/**
 * A living frond's rachis, bent by its shape: the degrees it turns toward its lower side and the
 * stretch it turns over. The rachis is 0.012 of the frond thick at its foot and thins to a thread
 * (stills 07, 21 and 22).
 */
function rachis(droop: number, droopOver: readonly [number, number]): PieceStem {
	return {
		length: { mean: FROND, spread: 0.3 },
		radius: [0.006 * FROND, 0.004],
		droop,
		droopOver,
		// The far mesh keeps a ring every 8 degrees of the arch, the shared curve's bound at the
		// nearest level, so the rachis keeps its curve under its leaflets at every tier.
		rings: 8,
		bud: false,
		leaves: LEAFLETS,
		sides: [SPINES],
	};
}

/**
 * The date palm's pieces. Each is one variant: a frond's look varies by its rank's angle and length
 * and its place round the trunk, and a second variant of each would double the kit's bytes. The
 * leaflet is narrow (directed.ts): a card at the low and medium tiers, folded at its midrib at the
 * high and ultra tiers.
 */
export const PIECES: readonly PieceRule[] = [
	// Picture 01: the inner, young fronds stand straight, and the lowest living ones run nearly
	// straight below level. A slight bend over the outer half.
	{
		name: 'frond-straight',
		attitude: 'along',
		variants: 1,
		stem: rachis(15, [0.4, 1]),
	},
	// Picture 01: the upper middle fronds leave at 50 to 60 degrees with their tips 0.55 of the frond
	// above the growing point; the middle ones at 25 to 35 degrees in one even arch whose tip stands
	// just under its highest point; the outer ones near level, arching down to tips 0.15 to 0.25 of
	// the frond below the growing point. One arch of 60 degrees over the outer two thirds gives all
	// three: tips 0.55 and 0.18 above, and 0.18 below.
	{
		name: 'frond-arched',
		attitude: 'along',
		variants: 1,
		stem: rachis(60, [0.35, 1]),
	},
	// Picture 01 and still 20: a dead frond hangs nearly straight, its leaflets folded down along the
	// rachis so it is half as wide as a living one. It keeps its spines.
	{
		name: 'frond-dead',
		attitude: 'along',
		variants: 1,
		// A dead frond is brown to the tips (pictures 01, 05 and 20).
		browning: 1,
		stem: {
			...rachis(10, [0, 1]),
			// Picture 20: each dead frond is about 0.11 as wide as long, its leaflets drooping 25
			// degrees out from the rachis.
			leaves: { ...LEAFLETS, ranked: [-20, 0], angle: 25, angleSpread: 6 },
		},
	},
];

/**
 * The studio photograph of a cut frond: still 21 stands one whole frond upright on its cut. The
 * photograph's frond is a small one (35 to 40 leaflets a side), so it is matched on form.
 */
export const STUDIO: readonly PieceStudio[] = [{ still: 21, piece: 'frond-straight' }];
