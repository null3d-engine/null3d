// The self-organizing grower: buds compete for light in a shadow grid inside the envelope, with
// apical control, tropisms, shedding, bending and pipe radii, for every broadleaf, pine, yew,
// juniper, shrub and hedge. It throws until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The self-organizing grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('self-organizing growth');
	},
};
