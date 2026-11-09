// The weeping willow's other form, as the changes it makes to the open-grown record: the young
// willow of stills 30 and 31, a narrow upright vase on a slim single stem whose shoots rise steeply
// and hang only at their ends. The outline starts from still 30's own width profile, read by the
// review tool's mask as shares of the plant's height, and is tuned against review renders of that
// still. Plain data, as the record is.
import type { SpeciesForm } from '../../core/record';

/** The willow's other forms by name. */
export const forms: Readonly<Record<string, SpeciesForm>> = {
	young: {
		form: 'young willow: a narrow upright vase that hangs only at its shoot ends',
		// Still 30: about four and a half metres to its top leaves, the slim stem a seventieth of the
		// height across, and a crown narrower than it is tall.
		size: { height: { mean: 4.5, spread: 0.4 }, dbh: 0.065, aspect: 0.8 },
		growth: {
			// A sapling of about nine seasons.
			years: 9,
			// Still 30: the stem runs on to the top with its limbs leaving it directly.
			macroOrders: 2,
			// Still 30: one slim stem runs to the top; there is no low fork yet.
			divide: null,
			// Still 30: the limbs leave the slim stem steeply and run out almost straight, so the
			// crown is a narrow vase rather than a spreading dome.
			buds: {
				angle: [
					[0, 38],
					[1, 46],
				],
				extinction: [0.005, 0.03],
			},
			// Still 30: the leader carries the stem to its top, and its limbs leave it at upward
			// angles.
			apical: {
				control: [
					[0, 0.72],
					[1, 0.5],
				],
				dominance: [1.2, 0.55, 0.97],
				wander: 6,
			},
			// Still 30: the young limbs climb; only the finest ends give way, so the outer order
			// turns down gently where the mature tree's curtain falls.
			tropism: {
				photo: 0.05,
				gravi: [
					[0, 0.3],
					[0.5, 0.12],
					[1, 0.02],
				],
			},
			// Still 30: the thin limbs run out with little sag.
			bending: { strength: 0.25, upturn: 0.2 },
			// Still 30: the slim stem tapers evenly to its top; no limb outgrows it.
			pipe: { leader: 0.85 },
			// Still 30: the stem is bare under its lowest limbs.
			shedding: { threshold: 0.1, cleanBole: 0.14, stubs: 0.02 },
		},
		envelope: {
			// Still 30's width profile: the fringe from about 0.13 of the height, widest near the
			// middle at about 0.39 of the height across, and a narrow top round the leader.
			heights: [0.13, 0.2, 0.28, 0.36, 0.44, 0.52, 0.6, 0.68, 0.76, 0.84, 0.9, 0.95, 1],
			radii: [0.06, 0.14, 0.22, 0.3, 0.36, 0.39, 0.39, 0.36, 0.31, 0.23, 0.15, 0.07, 0],
			source: {
				method: 'profile',
				from: '30-young-willow-whole.png',
				views: 1,
				stills: [{ file: '30-young-willow-whole.png', turn: 0 }],
			},
		},
		shoots: {
			// Stills 30 and 31: the young tree's shoots are short and gather at the limb ends, so the
			// hanging fringe is shallow and the wood shows between the tufts.
			classes: [
				{
					name: 'whip',
					vigor: [0.55, 1],
					share: 0.45,
					years: 1,
					length: { mean: 0.9, spread: 0.15 },
					nodes: { mean: 14, spread: 2 },
					internode: [
						[0, 0.95],
						[1, 0.95],
					],
					leafScale: [
						[0, 0.9],
						[0.5, 1],
						[1, 0.85],
					],
					leafAngle: [
						[0, 58],
						[1, 70],
					],
					leafAngleSpread: 12,
					skyward: 0.15,
					droop: 70,
				},
				{
					name: 'long',
					vigor: [0.2, 0.55],
					share: 0.3,
					years: 2,
					length: { mean: 0.5, spread: 0.08 },
					nodes: { mean: 10, spread: 2 },
					internode: [
						[0, 0.95],
						[1, 0.95],
					],
					laterals: { mean: 1.2, spread: 0.4 },
					lateralGap: 0.3,
					leafScale: [
						[0, 0.9],
						[1, 0.95],
					],
					leafAngle: [
						[0, 60],
						[1, 70],
					],
					skyward: 0.15,
					droop: 55,
				},
				{
					name: 'short',
					vigor: [0, 0.2],
					share: 0.25,
					years: 1,
					length: { mean: 0.25, spread: 0.04 },
					nodes: { mean: 8, spread: 1 },
					internode: [
						[0, 0.9],
						[1, 1],
					],
					leafScale: [
						[0, 0.85],
						[1, 1],
					],
					leafAngle: [
						[0, 55],
						[1, 68],
					],
					leafAngleSpread: 15,
					skyward: 0.2,
					droop: 25,
				},
			],
			// Still 30: the tufts gather at the limbs' ends with open sky between them.
			placement: {
				density: 3.4,
				shadePrune: 0.06,
				tipPrune: 0.05,
				bareTrim: 0.02,
				lift: 0,
				skyward: 0.15,
				scale: { mean: 1.1, spread: 0.12 },
			},
		},
		// Still 30: no moss or lichen on the young bark.
		bark: { moss: null, lichen: null },
		// Still 30: a plain foot, with no buttresses or surface roots.
		base: { flare: { amount: 0.25, height: 0.3 }, buttress: null, roots: null, flutes: null },
		// A young willow bears no catkins.
		extras: null,
		// No turning video shows this form, so the all-round check takes the form's own band.
		roundBand: null,
	},
};
