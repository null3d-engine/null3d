// The culm grower: jointed culms with branch complements at the nodes, in a clump or along runners,
// for bamboo. It throws until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The culm grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('culm growth');
	},
};
