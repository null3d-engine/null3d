// The Italian cypress's other habit: its first years, when it is a narrow ragged bush whose side
// sprays stand out past the young column. The reference set draws it in still 20. The young plant
// has no measured envelope, so its own bough lengths shape the bush.
import type { SpeciesForm } from '../../core/record';

/** The young cypress of still 20. */
export const young: SpeciesForm = {
	form: 'young narrow ragged bush, the closed column not yet formed',
	size: { height: { mean: 2.2, spread: 0.3 }, dbh: 0.06, aspect: 0.24 },
	growth: {
		leader: { curve: 2, wander: 3, count: 1 },
		tiers: {
			// Still 20: short rings of boughs leave the young stem all the way up, and the loose tips
			// stand out past the bush's own outline.
			spacing: [
				[0, 0.16],
				[1, 0.1],
			],
			perWhorl: { mean: 3, spread: 1 },
			between: 2,
			start: 0.02,
			deadBelow: { height: 0.01, stubs: 0 },
		},
		orders: [
			{
				length: [
					[0, 0.24],
					[0.4, 0.3],
					[1, 0.12],
				],
				angle: [
					[0, 42],
					[1, 26],
				],
				density: 1,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.1,
				sag: 1,
				upturn: 8,
				curve: 2,
			},
			{
				length: [
					[0, 0.06],
					[1, 0.1],
				],
				angle: [
					[0, 55],
					[1, 42],
				],
				density: 5,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.2,
				sag: 1,
				upturn: 5,
				curve: 1,
			},
			{
				length: [
					[0, 0.03],
					[1, 0.06],
				],
				angle: [
					[0, 58],
					[1, 44],
				],
				density: 8,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.2,
				sag: 0,
				upturn: 4,
				curve: 0,
			},
		],
		pipe: { exponent: 2.1, tipRadius: 0.0006, leader: 0.8 },
	},
	// The mature envelope would hold the young bush inside its column, so the young plant grows to
	// its own bough lengths instead.
	envelope: null,
	shoots: {
		placement: {
			// Still 20: the young crown is looser than the mature column, and its branch tips stand
			// out as ragged sprays.
			density: 0.8,
			skyPrune: 0.1,
			tipPrune: 0.05,
			clump: { spacing: 0.16, depth: 0.25, fine: { spacing: 0.06, depth: 0.15 } },
		},
	},
	// Still 20: the young cords are shorter than the mature column's.
	foliage: {
		spray: {
			segment: 0.017,
			radius: 0.0009,
		},
	},
	// Still 20: the young stem and boughs carry the redder young bark almost to the ground.
	bark: {
		zones: [{ layer: 0, by: 'height', from: 0, to: 3, blend: 1 }],
		youngRadius: 0.02,
	},
	base: {
		flare: { amount: 0.2, height: 0.3 },
		taper: null,
		buttress: null,
		roots: null,
		flutes: null,
	},
	// A young cypress carries no cut studio piece of its own.
	cuttings: null,
	// Still 20: the young bush stands upright, with no lopsided habit.
	roundBand: 0.3,
	wind: {
		stiffness: [
			[0, 0.99],
			[1, 0.85],
		],
		sway: { frequency: 0.3, amplitude: 0.025 },
		flutter: { kind: 'needle', amplitude: 0.3, frequency: 2.6 },
	},
};

/** The Italian cypress's other forms. */
export const forms = { young };
