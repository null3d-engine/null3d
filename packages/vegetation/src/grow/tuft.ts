// The tuft grower: blades from a small base, leaning by length, with seed heads, for grasses,
// sedges and rushes. It throws until its growth is built.
import { notBuilt } from '../core/not-built';
import type { Grower } from './models';

/** The tuft grower. */
export const grower: Grower = {
	grow() {
		throw notBuilt('tuft growth');
	},
};
