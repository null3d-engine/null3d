// The weeping willow's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the willow's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as willowFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 13 m. The
 * plan scales it to the adult frame's own height. A pollarded willow on a river bank grows fast and
 * then spreads rather than climbs.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 1.5],
	[0.1, 4.2],
	[0.25, 7.5],
	[0.45, 10.5],
	[0.7, 12.2],
	[1, 13],
];

/**
 * The crown's radius as a share of its height, by age share: a broad hanging dome, wider than the
 * tree is tall at its widest, with the curtain of strands running down from its rim.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.06],
	[0.05, 0.2],
	[0.15, 0.34],
	[0.35, 0.44],
	[0.6, 0.5],
	[1, 0.52],
];

/** The weeping willow's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. A pollarded willow lives about sixty years between cuts.
	fullAge: 60,
	height: HEIGHT,
	spread: SPREAD,
	// The bole, its arching limbs and their hanging strands, with the clumps they end in, are the
	// frame's stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: willowFrame,
	piece: 'strand-long',
	turn: { roll: 90, tilt: 25, out: 30 },
	orders: [
		{ density: 8, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 12, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The bole and the great limbs never thin.
	thin: [0, 0, 0.34, 0.67, 0.72],
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// The willow flowers as catkins in spring, before the leaves; a mature crown carries them.
	fruitFrom: 0.3,
	fruitBand: 0.1,
	flowers: { season: 'blossom', from: 0.25, band: 0.1 },
	// A maximum takes the finest rows away, never the willow's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the other species' do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
