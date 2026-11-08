// The Scots pine's other habit: its first decades, when it is a dense narrow cone with living
// branches within a metre of the ground and short stiff blue-green needles. The reference set draws
// it in stills 30 to 32. The young plant has no measured envelope, so its own bough lengths shape
// the cone.
import type { SpeciesForm } from '../../core/record';

/** The young pine of stills 30 to 32. */
export const young: SpeciesForm = {
	form: 'young conical pine with living branches low down',
	size: { height: { mean: 5, spread: 0.4 }, dbh: 0.12, aspect: 0.55 },
	growth: {
		leader: { curve: 1.5, wander: 2.5, count: 1 },
		tiers: {
			kind: 'whorl',
			// Stills 30 and 31: a ring of living branches every short year of growth, down to within
			// a metre of the ground.
			spacing: [
				[0, 0.4],
				[1, 0.22],
			],
			perWhorl: { mean: 5, spread: 1 },
			between: 0.7,
			start: 0.06,
			deadBelow: { height: 0.04, stubs: 2 },
		},
		orders: [
			{
				// Still 30: the lowest branches are the longest, and the crown narrows evenly to its
				// pointed top.
				length: [
					[0, 2.2],
					[0.4, 2],
					[0.8, 1.4],
					[1, 0.5],
				],
				angle: [
					[0, 95],
					[0.5, 85],
					[1, 55],
				],
				density: 1,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.25,
				sag: 4,
				upturn: 12,
				curve: 2,
			},
			{
				length: [
					[0, 0.4],
					[1, 1],
				],
				angle: [
					[0, 70],
					[1, 55],
				],
				density: 1.4,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.3,
				sag: 2,
				upturn: 8,
				curve: 1,
			},
			{
				length: [
					[0, 0.2],
					[1, 0.35],
				],
				angle: [
					[0, 60],
					[1, 45],
				],
				density: 3.5,
				arrangement: { kind: 'spiral', divergence: 137.5 },
				flatten: 0.25,
				sag: 1,
				upturn: 5,
				curve: 0,
			},
		],
		pipe: { exponent: 2.2, tipRadius: 0.003, leader: 0.7 },
	},
	// The mature envelope would hold the young tree inside its bole, so the young plant grows to its
	// own bough lengths instead.
	envelope: null,
	// Stills 30 and 32: the young crown is a dense soft cone with almost no bare wood and few sky
	// gaps, the opposite of the mature crown's openness.
	shoots: {
		placement: {
			density: 0.72,
			skyPrune: 0.22,
			tipPrune: 0.05,
			clump: { spacing: 0.6, depth: 0.35, fine: { spacing: 0.22, depth: 0.25 } },
		},
	},
	// Still 31: the young needles are shorter and stiffer than the mature tree's.
	foliage: {
		needle: {
			length: { mean: 0.035, spread: 0.006 },
		},
	},
	// Still 31: the young stem and branches carry the orange-brown flaking bark almost to the ground.
	bark: {
		zones: [{ layer: 1, by: 'height', from: 0, to: 20, blend: 0 }],
	},
	base: {
		flare: { amount: 0.2, height: 0.35 },
		taper: null,
		buttress: null,
		roots: null,
		flutes: null,
	},
	// The young plant's regular cone takes the conifer form's own all-round band.
	roundBand: 0.15,
	// A young pine carries no cut studio piece of its own.
	cuttings: null,
	// Stills 30 and 31: the young tree stands upright, with no lopsided habit.
	lopsided: null,
	wind: {
		stiffness: [
			[0, 0.99],
			[1, 0.85],
		],
		sway: { frequency: 0.32, amplitude: 0.02 },
		flutter: { kind: 'needle', amplitude: 0.4, frequency: 2.8 },
	},
};

/** The Scots pine's other forms. */
export const forms = { young };
