// The holm oak's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the holm oak's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as holmOakFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown clump of about 8 m. The
 * plan scales it to the adult frame's own height, so a seed that grows taller keeps its own
 * proportions. The holm oak is a slow young plant: a stool's shoots gain a little under a metre in
 * a decade, where the ash's pole gains several, and the dome is a long time forming.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 0.3],
	[0.08, 1],
	[0.16, 2],
	[0.3, 3.4],
	[0.5, 5.1],
	[0.75, 6.8],
	[1, 8],
];

/**
 * The crown's radius as a share of its height, by age share. Stills 01, 02 and 18: the mature crown
 * is a broad dome wider than tall, about 1.15 times its height across, so its radius runs to a
 * little under 0.6. Young shoots stand under a compact bushy crown, already round rather than
 * spire-like.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.12],
	[0.05, 0.25],
	[0.15, 0.4],
	[0.35, 0.5],
	[0.7, 0.56],
	[1, 0.58],
];

/** The holm oak's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. An open-grown holm oak clump lives well over a century.
	fullAge: 120,
	height: HEIGHT,
	spread: SPREAD,
	// The stems of the stool, their forks, their arms and branches, with the clumps they end in, are
	// the frame's stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: holmOakFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the branches: the branches themselves are stated by the frame; these describe
	// the woody twigs the keyed fill grows inside each clump. Still 04: the crown's outer surface is
	// a dense fine-textured mass of small leathery leaves, its sky only in the small bays between
	// one clump and the next, so each clump carries half again the alder's twigs.
	orders: [
		{ piece: 'branch-end', density: 16 },
		{ piece: 'branch-end', density: 22 },
	],
	// The share of each order kept at full sparseness. The stems and their forks never thin; at
	// sparseness 1 about two thirds of the branches and a third of the twigs stay.
	thin: [0, 0, 0.34, 0.67, 0.72],
	// The share of each kept clump's sockets that stays, by sparseness, never under the contract's
	// 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// Still 19: the acorns come on a mature plant; the holm oak is slow to bear and the crop fills
	// over a tenth of the age.
	fruitFrom: 0.3,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the holm oak's shape or its size: its capped
	// crowns stand at their clumps' stated places, as the alder's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
