// The column grower: a ribbed column with arms and areoles on its rib crests, for the saguaro. It
// throws until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The column grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('column growth');
	},
};
