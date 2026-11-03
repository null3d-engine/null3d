// The frond-colony grower: fronds rising singly along buried rhizomes, for bracken. It throws until
// its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The frond-colony grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('frond-colony growth');
	},
};
