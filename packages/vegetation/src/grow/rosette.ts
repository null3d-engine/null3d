// The rosette grower: golden-angle leaves from one base, for hosta and agave. It throws until its
// growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The rosette grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('rosette growth');
	},
};
