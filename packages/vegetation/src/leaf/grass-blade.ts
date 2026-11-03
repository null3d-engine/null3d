// The grass-blade foliage kind: a tapered ribbon on a curve with a V-fold, a twist and a dry tip.
// It throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The grass-blade foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('grass blades');
	},
};
