// The fascicle foliage kind: a sheath cone and two to five half-round needles, twisted. It throws
// until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The fascicle foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('needle fascicles');
	},
};
