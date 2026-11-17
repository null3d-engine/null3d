// The European beech's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the beech's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as beechFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 20 m. The
 * plan scales it to the adult frame's own height. The beech climbs slowly under shade and then
 * holds a broad dome; its share of the full height is reached late.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.02, 1.2],
	[0.05, 3.5],
	[0.12, 8],
	[0.25, 13],
	[0.45, 17],
	[0.7, 19.2],
	[1, 20],
];

/**
 * The crown's radius as a share of its height, by age share: a broad low dome, wider than the oak's
 * open crown of the same height and far wider than the birch's flame.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.06],
	[0.05, 0.18],
	[0.15, 0.3],
	[0.35, 0.38],
	[0.6, 0.42],
	[1, 0.42],
];

/** The European beech's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. A beech lives two centuries or more; this is an open-grown dome.
	fullAge: 90,
	height: HEIGHT,
	spread: SPREAD,
	// The bole, its low limbs and their branches, with the clumps they end in, are the frame's stated
	// axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: beechFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The beech's pictures are a solid bright dome, so its fill carries half again the twigs the
	// oak's does through each clump: the crown closes before any colour is judged.
	orders: [
		{ density: 12, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 18, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The bole and the low limbs never thin.
	thin: [0, 0, 0.34, 0.67, 0.72],
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// The beech's bristly cupules hang in autumn on a mature tree; the crop fills over a tenth of
	// the age.
	fruitFrom: 0.35,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the beech's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the alder's and the birch's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
