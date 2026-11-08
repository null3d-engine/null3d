// The English elm's other form, as the changes it makes to the open-grown record: the ring of root
// suckers that still 20 shows round an old tree's foot. English elm spreads by suckers rather than
// seed, so a stand is one clone of upright whips. Plain data, as the record is.
import type { SpeciesForm } from '../../core/record';

/** The elm's other form by name. */
export const forms: Readonly<Record<string, SpeciesForm>> = {
	suckers: {
		form: 'sucker thicket: upright whips rising from the roots round an old foot',
		// Still 20: the whips stand about 1.5 metres to their top leaves, and the thicket is about as
		// wide as it is tall.
		size: { height: { mean: 1.4, spread: 0.15 }, dbh: 0.035, aspect: 0.9 },
		growth: {
			// Still 20: a sucker is one straight whip from the ground, with no fork and no side axes.
			divide: null,
			buds: { sideOrders: 1 },
			clearance: null,
			macroOrders: 2,
			years: 3,
			// Still 20: the whips rise close together from a ring round the old foot.
			stems: { count: { mean: 9, spread: 2 }, lean: { mean: 4, spread: 2 }, stool: 0.45, fused: 0 },
			// Still 20: short internodes put the leaves close along each whip.
			internode: { length: 0.3, ageFactor: 0.98 },
			// Still 20: each whip runs to its own top, so the leader holds to the end.
			apical: {
				control: [
					[0, 0.8],
					[1, 0.85],
				],
			},
			// Still 20: a whip is leafy from the ground, so nothing below it is shed.
			shedding: { threshold: 0.1, cleanBole: 0, stubs: 0.2, underCrown: 0 },
		},
		// Still 20's ring of whips, as a round thicket measured across the picture's outline.
		envelope: {
			kind: 'radial',
			heights: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
			radii: [0.45, 0.5, 0.52, 0.52, 0.5, 0.47, 0.43, 0.38, 0.3, 0.18, 0.02],
			source: {
				method: 'profile',
				from: '20-suckers.png',
				views: 1,
				stills: [{ file: '20-suckers.png', turn: 0 }],
			},
		},
		// Still 20: the whips stand on the old tree's roots, not on a flare of their own, so the form
		// carries neither buttress nor surface roots.
		base: null,
		// No turn shows this form, so the all-round check takes the form's own band.
		roundBand: null,
	},
};
