// The scale-spray foliage kind: a recursive branchlet system of two to four orders, clothed by the
// scale texture, with dead inner sprays. It throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The scale-spray foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('scale sprays');
	},
};
