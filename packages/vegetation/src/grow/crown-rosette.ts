// The crown-rosette grower: a leaning, curving stem with a golden-angle spiral of fronds at the
// top, for palms and tree ferns. It throws until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The crown-rosette grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('crown-rosette growth');
	},
};
