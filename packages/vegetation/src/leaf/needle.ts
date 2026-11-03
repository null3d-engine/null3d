// The needle foliage kind: rhombic or flat prisms of two segments, a ribbon on the low tier. It
// throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The needle foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('needles');
	},
};
