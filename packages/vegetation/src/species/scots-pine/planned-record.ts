// The Scots pine's planned growth: the state it grows to at each maturity, sparseness and triangle
// maximum, as numbers rather than a grown plant. The bones and pads come from the pine's own frame,
// which the plan reads with its fine fill off. This file states the curves and rules the plan adds.
import type { Planned } from '../../core/record';
import { frame as pineFrame } from './planned-frame';

/** The height in metres by age as a share of the full age, for a full-grown tree of about 20 m. */
const HEIGHT: Planned['height'] = [
	[0, 0],
	[0.1, 4],
	[0.3, 12],
	[0.6, 18],
	[1, 20],
];

/** The crown's radius as a share of its height: the widest reach 0.6 a side at 0.52 of the height. */
const SPREAD: Planned['spread'] = [
	[0, 0.2],
	[0.3, 0.45],
	[0.6, 0.58],
	[1, 0.6],
];

/** The Scots pine's planned growth. */
export const plannedGrowth: Planned = {
	model: 'planned',
	// A Scots pine lives for two centuries; the model's life holds the young cone and the old plate.
	fullAge: 120,
	height: HEIGHT,
	spread: SPREAD,
	adult: 'frame',
	frame: pineFrame,
	// The bough each socket carries: the record's own piece.
	piece: 'bough',
	turn: { roll: 90, tilt: 25, out: 30 },
	orders: [
		{ density: 12, angle: 50, length: 0.3, birth: 0, kink: 18 },
		{ density: 16, angle: 45, length: 0.25, birth: 0, kink: 15 },
	],
	// The boughs are the plan's order 1, so the ladder starts there; a ladder from order 2 leaves
	// them whole and the sparseness inert.
	thin: [0, 0.25, 0.45, 0.65, 0.75],
	leavesAt: [
		[0, 1],
		[0.5, 0.45],
		[1, 0.22],
	],
	fruitFrom: 0.3,
	fruitBand: 0.1,
	capCards: 'stated',
	prices: { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 },
};
