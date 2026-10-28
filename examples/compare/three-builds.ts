// The three.js halves that a page can run on its own thread, by the name of the scene they build.
// The comparisons' list holds no page code, so the page loads each build from here.

import type { ThreeBuilder } from '../lib/three-worker';
import type { Comparison } from './comparisons';

const BUILDS: Readonly<Record<string, () => Promise<ThreeBuilder>>> = {
	'night-town': () => import('./night-town/three-build').then((module) => module.buildNightTown),
};

/** Loads the three.js build of a comparison's scene, to run on the page's thread. */
export function threeBuildOf(comparison: Comparison): Promise<ThreeBuilder> {
	const load = BUILDS[comparison.sameSceneAs ?? comparison.name];
	if (!load) throw new Error(`${comparison.title} has no three.js build to run on the page.`);
	return load();
}
