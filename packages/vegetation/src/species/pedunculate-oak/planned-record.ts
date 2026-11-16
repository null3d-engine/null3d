// The pedunculate oak's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the oak's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as oakFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 20 m.
 * The plan scales it to the adult frame's own height, so a seed that grows taller keeps its own
 * proportions. A six-year whip stands about 4.4 m (guide 32); an open-grown oak reaches nine
 * tenths of its height in about a century, then grows slowly.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.02, 1.5],
	[0.04, 4.4],
	[0.07, 7],
	[0.13, 11],
	[0.27, 15.5],
	[0.47, 18.5],
	[0.67, 19.6],
	[1, 20],
];

/**
 * The crown's radius as a share of its height, by age share: a whip is narrow, and an open-grown
 * oak's crown runs out to about 0.85 of its height either side (width about 1.7 times the height).
 */
const SPREAD: Planned['spread'] = [
	[0, 0.1],
	[0.04, 0.3],
	[0.13, 0.55],
	[0.27, 0.7],
	[0.6, 0.82],
	[1, 0.85],
];

/** The oak's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. An open-grown pedunculate oak lives about a century and a half.
	fullAge: 150,
	height: HEIGHT,
	spread: SPREAD,
	// The trunk, the nine great limbs and the boughs, with the clumps they end in, are the frame's
	// stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: oakFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the boughs: the boughs themselves and their branches are stated by the frame;
	// these describe the woody branches and twigs the keyed fill grows inside each clump.
	orders: [
		{ density: 8, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 12, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The trunk, the nine great limbs and the top
	// never thin; at sparseness 1 about two thirds of the boughs and a third of the branches and
	// twigs stay, for a thinned, stag-like crown on the full scaffold.
	thin: [0, 0, 0.34, 0.67, 0.72],
	// Leaf area left at sparseness 1 is a tenth of the full crown's, and never under the 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.45],
		[1, 0.1],
	],
	// The oak first bears acorns at about 40 years in the open (FACTS gives the fruit but no age;
	// 40 of 150 model years is the usual open-grown figure), and the crop fills over 15 years.
	fruitFrom: 0.27,
	fruitBand: 0.1,
	// Catkins hang in the blossom season, from the same age as the acorns and over the same band.
	flowers: { season: 'blossom', from: 0.27, band: 0.1 },
	// Priced at the nearest level's own draw: a branch end's leaves, a leaf card's triangles, one
	// clump card and one wood tube segment. The plan shares a maximum out from these.
	prices: { piece: 24, card: 6, clumpCard: 4, tubeSegment: 14 },
};
