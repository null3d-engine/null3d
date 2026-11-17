// The silver birch's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the birch's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as birchFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 21 m. The
 * plan scales it to the adult frame's own height. The birch is a fast young tree on a wet ground:
 * its flame climbs quickly and then slows.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 2.5],
	[0.08, 6.5],
	[0.16, 11],
	[0.3, 15],
	[0.5, 18],
	[0.75, 20],
	[1, 21],
];

/**
 * The crown's radius as a share of its height, by age share. The birch's whole views show a slender
 * open flame, narrow at the foot of the crown and at its tip, so the spread stays well under the
 * oak's and never widens into a dome.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.04],
	[0.05, 0.1],
	[0.15, 0.16],
	[0.35, 0.2],
	[0.7, 0.22],
	[1, 0.22],
];

/** The silver birch's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. A silver birch on a wet ground lives about sixty years.
	fullAge: 60,
	height: HEIGHT,
	spread: SPREAD,
	// The bole, its great limbs and their branches, with the clumps they end in, are the frame's
	// stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: birchFrame,
	piece: 'spray',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the branches: the branches themselves are stated by the frame; these describe
	// the woody twigs the keyed fill grows inside each clump.
	orders: [
		{ density: 8, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 12, angle: 45, length: 0.3, birth: 0, kink: 18 },
	],
	// The share of each order kept at full sparseness. The bole and the great limbs never thin; at
	// sparseness 1 about two thirds of the branches and a third of the twigs stay.
	thin: [0, 0, 0.34, 0.67, 0.72],
	// The share of each kept clump's sockets that stays, by sparseness, never under the contract's
	// 0.08 floor.
	leavesAt: [
		[0, 1],
		[0.5, 0.44],
		[1, 0.2],
	],
	// The birch's fruiting catkins hang on a mature tree; the crop fills over a tenth of the age.
	fruitFrom: 0.3,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the birch's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the alder's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
