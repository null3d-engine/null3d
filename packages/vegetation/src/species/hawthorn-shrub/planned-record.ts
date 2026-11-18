// The hawthorn shrub's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the hawthorn's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated stems, limbs and patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as hawthornFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown shrub of about 4 m. The
 * plan scales it to the adult frame's own height. A hawthorn is slow: it thickens into its many
 * stems before it gains much height.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.05, 0.4],
	[0.15, 1.2],
	[0.35, 2.4],
	[0.6, 3.3],
	[0.85, 3.8],
	[1, 4],
];

/**
 * The crown's radius as a share of its height, by age share: a dense low dome wider than it is tall,
 * carried on many stems from one stool.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.08],
	[0.1, 0.22],
	[0.3, 0.36],
	[0.6, 0.44],
	[1, 0.45],
];

/** The hawthorn shrub's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. A hawthorn on a hedge bank lives a century or more.
	fullAge: 60,
	height: HEIGHT,
	spread: SPREAD,
	// The many stems, their limbs and branches, with the clumps they end in, are the frame's stated
	// axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: hawthornFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 35, out: 30 },
	// The pictures are a dense dark bush, not a see-through veil, so the fill carries half again the
	// twigs the oak's does through each clump.
	orders: [
		{ piece: 'branch-end', density: 12 },
		{ piece: 'branch-end', density: 18 },
	],
	// The share of each order kept at full sparseness. The stems and the great limbs never thin.
	thin: [0, 0, 0.34, 0.67, 0.72],
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// The haws hang red from a mature shrub in autumn; the crop fills over a tenth of the age.
	fruitFrom: 0.3,
	fruitBand: 0.1,
	// The blossom opens in its own season, from the same age and over the same band.
	flowers: { season: 'blossom', from: 0.25, band: 0.1 },
	// A maximum takes the finest rows away, never the shrub's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the other species' do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
