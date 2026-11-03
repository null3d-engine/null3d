// The frond foliage kind: one recursive frond function: rachis curve, pinnae by count, length,
// angle, droop, fold and planes, fan fronds as pleated segments with split tips and threads, and
// croziers. It throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The frond foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('fronds');
	},
};
