// The meadow grass's planned growth: the state it grows to at each maturity, sparseness and
// triangle maximum, as numbers rather than a grown and then cut plant.
//
// A tuft's frame is its stool, its two populations of axes and its pieces. A tree's frame cannot
// read it: the frame states one stem population where the plant has two, the leaf shoots and the
// flowering stems; its fill clothes a clump in rows of leaves, where a blade is one strap; it has
// no body for the stool the pictures show; and its piece rules build a stem with leaves, where a
// bare blade is a piece of its own. The planned model's tuft adult therefore keeps the tuft
// family's own plan, pieces and stool mesh, and this file states only the curves and prices the
// plan adds.
import type { Planned, SpeciesForm } from '../../core/record';
import { seedlingFoliage, seedlingGrowth, tuftGrowth } from './record';

/** The prices the planned model states for one drawn piece of each kind. */
const PRICES = { piece: 24, card: 6, clumpCard: 6, tubeSegment: 14 } as const;

/** The meadow grass's planned growth: its tuft numbers at each state its plan asks for. */
export const plannedGrowth: Planned = {
	model: 'planned',
	adult: 'tuft',
	tuft: tuftGrowth,
	// A tuft rebuilds its leaves each year; its flowering stems stand for one summer.
	fullAge: 1,
	// The plant's height by age: the seedling's few centimetres, then the leaf mound, then the
	// heads at about twice the mound over the first summer.
	height: [
		[0, 0],
		[0.08, 0.04],
		[0.3, 0.15],
		[0.6, 0.32],
		[1, 0.5],
	],
	// The crown's radius as a share of its height: the stills' 0.79 width over height.
	spread: [
		[0, 0.1],
		[0.2, 0.22],
		[0.5, 0.34],
		[1, 0.4],
	],
	orders: [],
	thin: [0],
	leavesAt: [
		[0, 1],
		[1, 0.1],
	],
	fruitFrom: 1,
	fruitBand: 1,
	// The flowering stems are the plant's flowers: they stand in late spring and early summer, as
	// the record's stalks do, and ramp in over the first half of the summer's growth.
	flowers: { season: 'summer', from: 0.45, band: 0.35 },
	prices: PRICES,
	capCards: 'stated',
};

/** The seedling's planned growth: the tuft adult at the seedling's own size and numbers. */
export const seedlingForm: SpeciesForm = {
	form: 'a few short blades from one point, before the tuft forms',
	size: { height: { mean: 0.07, spread: 0.01 }, aspect: 0.9 },
	growth: {
		model: 'planned',
		adult: 'tuft',
		tuft: seedlingGrowth,
		fullAge: 1,
		height: [
			[0, 0],
			[0.4, 0.03],
			[1, 0.07],
		],
		spread: [
			[0, 0.05],
			[1, 0.35],
		],
		orders: [],
		thin: [0],
		leavesAt: [
			[0, 1],
			[1, 0.1],
		],
		fruitFrom: 1,
		fruitBand: 1,
		prices: PRICES,
		capCards: 'stated',
	},
	foliage: seedlingFoliage,
};
