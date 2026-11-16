// The pedunculate oak's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// This is the interface's stub: the height and the ages are the shapes the grower reads, and the
// adults, the orders, the thinning and the prices are filled in as the adult plan is measured.
import type { Planned } from '../../core/record';

// The height in metres by age: a young whip rises fast, and the crown closes on its adult height
// over a long life. Read from the reference's habit of 20 to 25 m at full growth.
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.05, 2.5],
	[0.15, 6],
	[0.3, 10.5],
	[0.5, 14.5],
	[0.75, 17.8],
	[1, 21],
];

// The crown's spread as a share of the height, by age: a young whip is narrow, and an open-grown
// oak's crown runs out to about one and a half times its height.
const SPREAD: Planned['spread'] = [
	[0, 0.12],
	[0.1, 0.35],
	[0.3, 0.8],
	[0.6, 1.3],
	[1, 1.6],
];

/** The oak's planned growth, stub numbers as the plan is measured. */
export const plannedGrowth: Planned = {
	model: 'planned',
	fullAge: 150,
	height: HEIGHT,
	spread: SPREAD,
	adult: 'stated',
	orders: [
		{ density: 6, angle: 55, length: 0.42, birth: 18, kink: 18 },
		{ density: 9, angle: 48, length: 0.36, birth: 26, kink: 22 },
		{ density: 14, angle: 42, length: 0.3, birth: 34, kink: 20 },
	],
	// The trunk, its nine limbs and the boughs stay at every sparseness; the orders below them thin.
	thin: [0, 0, 0, 0.6, 0.35, 0.2],
	leavesAt: [
		[0, 1],
		[0.5, 0.45],
		[1, 0.1],
	],
	fruitFrom: 0.35,
	fruitBand: 0.15,
	piece: 'branch-end',
	turn: { roll: 90, tilt: 25, out: 30 },
	prices: { piece: 560, card: 6, clumpCard: 4, tubeSegment: 14 },
};
