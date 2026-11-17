// The olive's planned growth: the state it grows to at each maturity, sparseness and triangle
// maximum, as numbers rather than a grown and then cut plant.
//
// The bones and clumps come from the olive's own frame, which the plan reads with its fine fill
// switched off, so the adult scaffold is exactly the frame's stated axes and their patches. This
// file states the curves and rules the plan adds: how the adult appears with age, how the finer
// orders fill it, how sparseness thins it and what a triangle costs.
import type { Planned } from '../../core/record';
import { frame as oliveFrame } from './directed';

/**
 * The height in metres by age as a share of the full age, for a full-grown tree of about 7 m, the
 * stills' own fit. The plan scales it to the adult frame's own height, so a seed that grows taller
 * keeps its own proportions. An olive is slow from the seed: a young plant gains well under a metre
 * in its first years, and the squat bole is a long time forming.
 */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.03, 0.3],
	[0.08, 0.9],
	[0.16, 1.8],
	[0.3, 3],
	[0.5, 4.4],
	[0.75, 5.9],
	[1, 7],
];

/**
 * The crown's radius as a share of its height, by age share. The fit measures the crown's width at
 * 1.5 of the plant's height, so the mature radius runs to three quarters of the height: the olive's
 * dome is broad and low, the ground before the bole visible under its outer limbs.
 */
const SPREAD: Planned['spread'] = [
	[0, 0.12],
	[0.05, 0.3],
	[0.15, 0.5],
	[0.35, 0.65],
	[0.7, 0.72],
	[1, 0.75],
];

/** The olive's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// Model years at maturity 1. An open-grown olive lives for centuries; the model's life is long
	// enough that the slow young plant and the long bole both stand on the curve.
	fullAge: 80,
	height: HEIGHT,
	spread: SPREAD,
	// The bole's twisted columns, the crooked limbs and the branches with the masses they end in are
	// the frame's stated axes; the plan reads them with the frame's fine fill switched off.
	adult: 'frame',
	frame: oliveFrame,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	// The orders under the branches: the branches themselves are stated by the frame; these describe
	// the woody twigs the keyed fill grows inside each mass. Stills 05 and 06: the crown is a web of
	// many fine branches along every limb, so the fill carries more twigs a clump than the open
	// broadleaves.
	orders: [
		{ density: 12, angle: 50, length: 0.35, birth: 0, kink: 20 },
		{ density: 16, angle: 45, length: 0.3, birth: 0, kink: 18 },
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
	// Still 19: the olives hang on mature wood; an open-grown olive first bears after a few years,
	// and the crop fills over a tenth of the age.
	fruitFrom: 0.25,
	fruitBand: 0.1,
	// A maximum takes the finest rows away, never the olive's shape or its size: its capped crowns
	// stand at their clumps' stated places, as the alder's do.
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
