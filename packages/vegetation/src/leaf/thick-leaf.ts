// The thick foliage kind: a lens-shaped section along an arching leaf, with teeth on the margin and
// a terminal spine. It throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The thick foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('thick leaves');
	},
};
