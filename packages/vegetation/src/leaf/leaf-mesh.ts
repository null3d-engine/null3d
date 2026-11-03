// The blade foliage kind: a grid clipped to the texture's measured contour or a parametric outline,
// bent by fold, curl, cross curl, twist and margin wave, with a petiole, both faces in one mesh,
// and compound leaves of leaflets. It throws until its leaves are built.
import { notBuilt } from '../core/not-built';
import type { FoliageBuilder } from './kinds';

/** The blade foliage kind's leaf builder. */
export const builder: FoliageBuilder = {
	leaves() {
		throw notBuilt('flat leaves');
	},
};
