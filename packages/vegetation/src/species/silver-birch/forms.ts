// The silver birch's other forms, each as the changes it makes to the open-grown record: the young
// birch of stills 31 and 32, a slim red-brown stem whose light crown is still round rather than a
// flame, the woodland birch of still 30, grown tall in shade on a long clean bole under a small high
// crown, and the mature birch of still 33, whose drooping twigs close into a broad dense veil on a
// thick white bole. The outlines start from the stills' own width profiles, read by the review
// tool's mask as shares of the plant's height, and are round in plan. Plain data, as the record is.
import type { SpeciesForm } from '../../core/record';

/** Internodes along a shoot: even along the run, the leaves alternate to its end. */
const ALTERNATE: readonly (readonly [number, number])[] = [
	[0, 0.9],
	[0.8, 1],
	[1, 0.8],
];

/** The birch's other forms by name. */
export const forms: Readonly<Record<string, SpeciesForm>> = {
	young: {
		form: 'young birch: a slim red-brown stem under a light open oval crown',
		// Still 31: about four metres tall, the stem a sixtieth of the height across at breast height.
		size: { height: { mean: 4.2, spread: 0.3 }, dbh: 0.05, aspect: 0.66 },
		growth: {
			// Still 31: the sapling's limbs stand open and even, so no great limb keeps clearance from
			// another.
			clearance: null,
			// Still 31: about nine seasons of growth.
			years: 9,
			macroOrders: 3,
			// Still 31: short internodes on thin wood, so a limb reads as a twig, not a pole.
			internode: { length: 0.25 },
			// Still 31: one slim stem runs to the top; there are no great limbs yet.
			divide: null,
			// Still 31: the leader runs straight to the top and the limbs leave it all the way up, filling
			// an oval crown.
			apical: {
				control: [
					[0, 0.72],
					[1, 0.6],
				],
				dominance: [1.6, 0.6, 0.98],
				wander: 10,
			},
			// Still 31: the limbs leave the stem at a middling angle and rise, and the crown has not yet
			// begun to weep.
			buds: {
				angle: [
					[0, 52],
					[1, 52],
				],
				extinction: [0.01, 0.02],
			},
			tropism: {
				gravi: [
					[0, 0.25],
					[0.5, 0.05],
					[1, 0.05],
				],
			},
			bending: { strength: 0.2 },
			pipe: { tipRadius: 0.006 },
			// Still 31: the stem is bare to a quarter of the height, and few limbs leave it low.
			branching: 0.9,
			shedding: { cleanBole: 0.25, underCrown: 0 },
		},
		envelope: {
			// Still 31's width profile: an oval crown from a tenth of the height, widest a little above
			// its middle at two thirds of the height across, and closing to the leader's tip.
			heights: [
				0.104, 0.146, 0.188, 0.229, 0.271, 0.313, 0.354, 0.396, 0.438, 0.479, 0.521, 0.563, 0.604,
				0.646, 0.688, 0.729, 0.771, 0.813, 0.854, 0.9, 1,
			],
			radii: [
				0.108, 0.205, 0.238, 0.302, 0.321, 0.316, 0.299, 0.312, 0.326, 0.325, 0.329, 0.286, 0.264,
				0.266, 0.244, 0.202, 0.202, 0.17, 0.124, 0.07, 0,
			],
			source: {
				method: 'profile',
				from: '31-young-birch-whole.png',
				views: 1,
				stills: [{ file: '31-young-birch-whole.png', turn: 0 }],
			},
		},
		// Still 31: a light crown for a sapling, with sky through it everywhere.
		shoots: { placement: { density: 2.6 } },
		// Still 31: the stem is red-brown over its whole run, with the white bark only at the very foot.
		bark: { youngRadius: 0.05 },
		// Still 32: a plain foot, with no buttress lobes or surface roots.
		base: { flare: { amount: 0.25, height: 0.15 }, buttress: null, roots: null },
		// A young birch bears no catkins.
		extras: null,
		// No turning video shows this form, so the all-round check takes the form's own band.
		roundBand: null,
	},
	mature: {
		form: 'mature birch: a broad dense weeping crown on a thick white bole',
		// Still 33: the crown about nine tenths of the height across, the bole a sixteenth of it.
		size: { height: { mean: 17, spread: 1 }, dbh: 1.1, aspect: 0.89 },
		growth: {
			// Still 33: the great limbs leave low and spread wide, so the crown reaches down to the foot.
			divide: { at: 0.22, count: 5, angle: 74, lean: 34 },
			// Still 33: the crown's limbs stand far enough apart that the clearance holds them apart.
			clearance: 0.35,
			// Still 33: the drooping twigs of a heavy crown hang far below their limbs.
			tropism: {
				gravi: [
					[0, 0.2],
					[0.4, 0.05],
					[0.75, -0.25],
					[1, -0.45],
				],
			},
			// Still 33: a heavy crown sags on its limbs.
			bending: { strength: 0.75 },
			// Still 33: the bole is clear for a twentieth of the height.
			shedding: { cleanBole: 0.06, underCrown: 0.5 },
		},
		envelope: {
			// Still 33's width profile: a broad crown from the foot, widest about a third of the way up
			// at nine tenths of the height across, narrowing to a soft top.
			heights: [
				0.063, 0.104, 0.146, 0.188, 0.229, 0.271, 0.313, 0.354, 0.396, 0.438, 0.479, 0.521, 0.563,
				0.604, 0.646, 0.688, 0.729, 0.771, 0.813, 0.854, 0.9, 0.95, 1,
			],
			radii: [
				0.309, 0.363, 0.393, 0.409, 0.419, 0.419, 0.442, 0.445, 0.444, 0.424, 0.403, 0.395, 0.397,
				0.388, 0.356, 0.347, 0.346, 0.297, 0.258, 0.236, 0.19, 0.12, 0,
			],
			source: {
				method: 'profile',
				from: '33-mature-dense-crown-whole.png',
				views: 1,
				stills: [{ file: '33-mature-dense-crown-whole.png', turn: 0 }],
			},
		},
		// Still 33: a grown birch packs its drooping twigs into a dense continuous veil. The fine
		// birch leaf costs many leaves for each square metre of crown, so this form carries its foliage
		// on long shoots: the card levels draw a row for each shoot, and the tree caps hold about eight
		// thousand of them however long a shoot grows. The crown then reads 0.194 open where its
		// photograph reads 0.057, a gap it cannot close inside those caps; the record states it.
		shoots: {
			leafYears: 1,
			classes: [
				{
					name: 'short',
					vigor: [0, 0.05],
					share: 0.3,
					years: 1,
					length: { mean: 0.2, spread: 0.03 },
					nodes: { mean: 5, spread: 0.4 },
					internode: ALTERNATE,
					leafScale: [
						[0, 0.8],
						[1, 1],
					],
					leafAngle: [
						[0, 62],
						[1, 45],
					],
					leafAngleSpread: 12,
					droop: 6,
				},
				{
					name: 'long',
					vigor: [0.05, 0.5],
					share: 0.35,
					years: 2,
					length: { mean: 0.4, spread: 0.06 },
					nodes: { mean: 24, spread: 1 },
					internode: ALTERNATE,
					stem: { radius: [0.004, 0.002] },
					laterals: 2,
					lateralGap: 0.45,
					bend: { length: 0.06, angle: 22 },
					leafScale: [
						[0, 0.8],
						[1, 1],
					],
					leafAngle: [
						[0, 64],
						[1, 48],
					],
					droop: 5,
				},
				{
					name: 'spray',
					vigor: [0.5, 1],
					share: 0.35,
					years: 2,
					length: { mean: 0.6, spread: 0.1 },
					nodes: { mean: 36, spread: 1 },
					internode: ALTERNATE,
					stem: { radius: [0.009, 0.004] },
					laterals: 2,
					lateralGap: 0.45,
					bend: { length: 0.07, angle: 24 },
					leafScale: [
						[0, 0.75],
						[1, 1],
					],
					leafAngle: [
						[0, 66],
						[1, 50],
					],
					droop: 8,
				},
			],
			placement: { density: 0.2, skyPrune: 0.2 },
		},
		roundBand: null,
	},
	woodland: {
		form: 'woodland birch: a long clean bole under a small high crown',
		// Still 30: taller than the open birch, the crown about a third of the height across.
		size: { height: { mean: 26, spread: 2 }, dbh: 0.7, aspect: 0.33 },
		growth: {
			// Still 30: shade has shed every limb below the crown, two thirds of the height up.
			shedding: { cleanBole: 0.62, underCrown: 0.5 },
			// Still 30: the leader runs on up through the crown to its top.
			divide: null,
			apical: {
				control: [
					[0, 0.72],
					[1, 0.68],
				],
			},
			// Still 30: the limbs leave the long bole high up and spread into a small crown.
			buds: {
				angle: [
					[0.25, 58],
					[1, 58],
				],
			},
			pipe: { leader: 0.85 },
		},
		envelope: {
			// Still 30's crown, read from its picture: from two thirds of the height, widest about four
			// fifths of the way up at a quarter of the height across, and closing at the leader's tip.
			heights: [0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 0.96, 1],
			radii: [0.05, 0.095, 0.12, 0.125, 0.11, 0.08, 0.045, 0],
			source: {
				method: 'hand',
				from: '30-woodland-form-whole.png',
				views: 1,
				stills: [{ file: '30-woodland-form-whole.png', turn: 0 }],
			},
		},
		// Still 30: the crown's foliage fills its small volume, with the sky its photograph shows through.
		shoots: { placement: { density: 4.5, shadePrune: 0.05, skyPrune: 0.15 } },
		// Still 30: no surface roots, on the forest floor's litter.
		base: { flare: { amount: 0.2, height: 0.3 }, buttress: null, roots: null },
		roundBand: null,
	},
};
