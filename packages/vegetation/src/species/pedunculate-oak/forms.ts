// The pedunculate oak's other forms, each as the changes it makes to the open-grown record: the
// woodland oak of stills 30 and 31, grown tall in shade with a long clean bole and a small high
// crown, and the young oak of still 32, a slim single stem about four metres tall with thin limbs
// and a sparse crown. The outlines start from the stills' own width profiles, read by the review
// tool's mask as shares of the plant's height, and are tuned against review renders of those stills.
// Plain data, as the record is.
import type { SpeciesForm } from '../../core/record';

/** Internodes along a young shoot: one long first internode, then the leaves crowd at its tip. */
const YOUNG_ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/** The oak's other forms by name. */
export const forms: Readonly<Record<string, SpeciesForm>> = {
	woodland: {
		form: 'tall woodland oak: a long clean bole under a small high crown',
		// Still 30: the trunk is 0.057 of the height across a tenth of the way up, on a tree taller
		// than the open oak, measured on the photo's outline as on the render's.
		size: { height: { mean: 26, spread: 2 }, dbh: 1.57, aspect: 0.6 },
		growth: {
			// Still 30: the leader runs up through the crown to the top; it does not divide low.
			divide: null,
			// Still 30: one leader carries the crown to its top, its limbs leaving it at upward angles.
			apical: {
				control: [
					[0, 0.72],
					[1, 0.66],
				],
			},
			// Still 30: the side branches spread wide from the leader and its limbs, so the crown is
			// broad and open for its height rather than a narrow point.
			buds: {
				angle: [
					[0.25, 58],
					[1, 60],
				],
				// Still 30: no shoot's end bud dies by chance, so the limbs reach out to round the
				// crown's top and the bole runs on up through it in every tree.
				extinction: [0, 0.03],
			},
			// Stills 30 and 31: shade has shed every limb below the crown, about half the height; the
			// crown's own lower limbs keep their leaves in still 30, so they shed only in deep shade.
			shedding: { threshold: 0.06, cleanBole: 0.46 },
			// Still 30: the bole runs on up through the crown as its leader, never outgrown by a limb.
			pipe: { leader: 0.85 },
		},
		envelope: {
			// Still 30's width profile: the crown from 0.44 of the height, widest near 0.6 at 0.6 of
			// the height across, a waist near 0.75 and a second tier near 0.85, round in plan.
			heights: [0.47, 0.51, 0.56, 0.6, 0.65, 0.69, 0.73, 0.77, 0.81, 0.85, 0.9, 0.94, 0.98, 1],
			radii: [0.07, 0.14, 0.22, 0.3, 0.3, 0.27, 0.21, 0.2, 0.24, 0.24, 0.14, 0.13, 0.08, 0],
			source: {
				method: 'profile',
				from: '30-woodland-form-whole.png',
				views: 1,
				stills: [{ file: '30-woodland-form-whole.png', turn: 0 }],
			},
		},
		// Still 30: the crown's lower limbs stay leafy into its shade, and the foliage fills the crown
		// to the share of sky that the photograph shows through it; a tip in its deepest shade is bare.
		shoots: { placement: { density: 0.8, shadePrune: 0.1, tipPrune: 0.05 } },
		// Still 31: the shaded bole flares smoothly into the moss at its foot, with no buttress lobes or
		// surface roots, so it runs up nearly parallel-sided from the ground.
		base: { flare: { amount: 0.3, height: 0.5 }, buttress: null, roots: null },
		// No turning video shows this form, so the all-round check takes the form's own band.
		roundBand: null,
	},
	young: {
		form: 'young oak: a slim single stem with thin upward limbs and a sparse crown',
		// Still 32: about four metres tall to its top leaves, the stem a sixtieth of the height across.
		size: { height: { mean: 4.4, spread: 0.4 }, dbh: 0.06, aspect: 0.5 },
		growth: {
			// Stills 02, 18 and 32: a sapling's limbs are open enough that the clearance thins its
			// stem and limbs, so the young form grows without it.
			clearance: null,
			// A sapling of about eleven seasons.
			years: 11,
			// Still 32: the limbs carry the shoots directly, with no orders between.
			macroOrders: 2,
			// Still 32: about ten limbs, evenly round the stem up its upper two thirds.
			branching: 1.2,
			// Still 32: the thin limbs run straight from the stem, at the angle they leave it, rather
			// than turning up toward its line as an old tree's vigorous shoots do.
			kinks: false,
			forkRule: false,
			// Still 32: short internodes on the thin wood, so the limbs read as twigs, not poles.
			internode: { length: 0.15 },
			// Still 32: one slim stem runs to the top; there are no great limbs yet.
			divide: null,
			// Still 32: the leader dominates its few side limbs and runs straight to the top, and the
			// limbs fill out as the leader reaches the crown's top.
			apical: {
				control: [
					[0, 0.75],
					[0.5, 0.58],
					[1, 0.45],
				],
				dominance: [1.8, 0.6, 0.98],
				wander: 8,
			},
			// Still 32: the limbs leave the stem at about 60 degrees and the leader never dies back; the
			// limbs themselves run out unbranched, each to its one rosette.
			buds: {
				angle: [
					[0, 60],
					[1, 60],
				],
				extinction: [0, 0.03],
				sideOrders: 1,
			},
			// Still 32: the thin limbs run out straight, turning a little upward, and hardly sag.
			tropism: {
				gravi: [
					[0, 0.3],
					[0.5, 0.04],
					[1, 0.04],
				],
			},
			bending: { strength: 0.2 },
			// Still 32: the slim stem tapers evenly to its top; no limb outgrows it.
			pipe: { leader: 0.85 },
			// Still 32: an open sapling, whose few leaves shade its lower limbs only a little.
			light: { shadow: [5, 0.08, 2] },
			// Still 32: the stem is bare to under a third of the height.
			shedding: { cleanBole: 0.28 },
		},
		envelope: {
			// Still 32's width profile: the crown from 0.28 of the height, long low limbs near 0.4,
			// widest near 0.65 at half the height across, and a narrow top round the leader.
			heights: [0.28, 0.34, 0.4, 0.46, 0.52, 0.58, 0.64, 0.7, 0.76, 0.82, 0.88, 0.94, 1],
			radii: [0.08, 0.12, 0.14, 0.15, 0.14, 0.15, 0.16, 0.15, 0.11, 0.08, 0.055, 0.03, 0],
			source: {
				method: 'profile',
				from: '32-young-oak-whole.png',
				views: 1,
				stills: [{ file: '32-young-oak-whole.png', turn: 0 }],
			},
		},
		shoots: {
			// Still 32: this year's shoots alone, a rosette at each twig's end, with no old sprays.
			classes: [
				{
					name: 'short',
					vigor: [0, 0.5],
					share: 0.5,
					years: 1,
					length: { mean: 0.14, spread: 0.02 },
					nodes: { mean: 10, spread: 0.5 },
					internode: YOUNG_ROSETTE,
					leafScale: [
						[0, 0.85],
						[1, 1.05],
					],
					leafAngle: [
						[0, 150],
						[0.5, 95],
						[1, 40],
					],
					leafAngleSpread: 30,
					droop: 3,
				},
				{
					name: 'long',
					vigor: [0.5, 1],
					share: 0.5,
					years: 1,
					length: { mean: 0.3, spread: 0.05 },
					// Still 32: seven or so leaves to a rosette at the end of each limb's shoot.
					nodes: { mean: 7, spread: 1 },
					internode: YOUNG_ROSETTE,
					stem: { radius: [0.005, 0.003] },
					leafScale: [
						[0, 0.8],
						[1, 1],
					],
					leafAngle: [
						[0, 120],
						[0.5, 90],
						[1, 60],
					],
					droop: 5,
				},
			],
			// Still 32: a small tuft at each limb's end, where the thin wood stands bare behind it, each
			// tuft apart from the next with sky between.
			placement: {
				density: 1.2,
				tipBias: 1,
				// Still 32: the lower limbs keep their leaves in the open sapling's light.
				shadePrune: 0.05,
				// Still 32: only a tip in the sapling's deepest shade goes bare.
				tipPrune: 0.025,
				scale: { mean: 1.25, spread: 0.1 },
			},
		},
		// Still 32: smooth young bark, with no moss or lichen yet.
		bark: { moss: null, lichen: null },
		// Still 32: a plain foot, with no buttresses, surface roots or flutes.
		base: { flare: { amount: 0.3, height: 0.15 }, buttress: null, roots: null, flutes: null },
		// A young oak bears no acorns.
		extras: null,
		// No turning video shows this form, so the all-round check takes the form's own band.
		roundBand: null,
		// The branch cutting is a twig of this year's long shoot, as the young tree has no sprays.
		cuttings: { branch: { shoot: 'long' } },
	},
};
