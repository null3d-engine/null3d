// The date palm's other forms, each as the changes it makes to the mature record: the young palm
// of still 08, a short stem with a crown of small fronds and no skirt, grown as an offshoot does
// before its trunk rises. Plain data, as the record is.
import type { SpeciesForm } from '../../core/record';

/** The date palm's other forms by name. */
export const forms: Readonly<Record<string, SpeciesForm>> = {
	young: {
		form: 'young palm: a short stem under a rosette of small fronds, with no skirt',
		size: { height: { mean: 1.4, spread: 0.2 }, aspect: 1.1 },
		growth: {
			stem: {
				// Still 08: the growing point stands a short way above the ground, its fronds about
				// the height of the stem again.
				height: { mean: 0.55, spread: 0.1 },
				radius: [
					[0, 0.06],
					[0.3, 0.055],
					[1, 0.05],
				],
				lean: { mean: 0.5, spread: 0.5 },
				curve: { mean: 0.3, spread: 0.3 },
				suckers: null,
				surface: 'leaf-bases',
			},
			crown: {
				// Still 08: the upright young fronds at the centre, ringed by older arching ones.
				fronds: { mean: 14, spread: 2 },
				dead: { count: 0, hang: 126, skirt: 0 },
			},
			frond: {
				length: { mean: 1.3, spread: 0.2 },
				petiole: { length: 0.15, width: 0.03, teeth: 0 },
			},
		},
		extras: null,
	},
};
