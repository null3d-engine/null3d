// The common alder's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the alder's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as alderFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 20 m. The
 * plan scales it to the adult frame's own height, so a seed that grows taller keeps its own
 * proportions. The alder is a fast young tree: a stool's shoot reaches several metres in a handful
 * of years, then the leader's climb slows at about 60 model years.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 2.2],
	[0.08, 6],
	[0.16, 10],
	[0.3, 14.5],
	[0.5, 17.5],
	[0.75, 19.5],
	[1, 20],
];

/**
 * The crown's radius as a share of its height, by age share. The alder's whole views show a crown
 * about 0.59 to 0.63 of the height across on its wide side, so it is a narrow cone on a straight
 * leader, not the oak's broad dome.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.05],
	[0.05, 0.14],
	[0.15, 0.22],
	[0.35, 0.28],
	[0.7, 0.3],
	[1, 0.3],
];

/** The common alder's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. An open-grown common alder lives about sixty years.
	fullAge: 60,
	height: HEIGHT,
	spread: SPREAD,
	// The leader, its near-level branches and their twigs, with the clumps they end in, are the
	// frame's stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: alderFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the branches: the branches themselves are stated by the frame; these describe
	// the woody twigs the keyed fill grows inside each clump.
	// The alder's pictures show one leafy mass at every branch end, where the oak's show bays: its
	// fill carries half again the twigs through each clump.
	orders: [
		{ density: 12, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 18, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The leader and the great branches never thin;
	// at sparseness 1 about two thirds of the branches and a third of the twigs stay.
	thin: [0, 0, 0.34, 0.67, 0.72],
	// The share of each kept clump's sockets that stays, by sparseness, never under the contract's
	// 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// The alder bears its cones on a mature tree; the crop fills over a tenth of the model's age.
	fruitFrom: 0.25,
	fruitBand: 0.1,
	// Priced at the nearest level's own draw: a branch end's leaves, a leaf card's triangles, one
	// clump card and one wood tube segment.
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
