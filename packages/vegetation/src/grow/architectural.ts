// The architectural grower: a leader with tiers of boughs, numbers by position in the crown, sag
// and upturn, flattened sprays and hanging curtains, for the whorled and tiered conifers. It throws
// until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The architectural grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('architectural growth');
	},
};
