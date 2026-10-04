// Loads the renderer on a thread that draws only in some modes: the page and the sketch worker. The
// bundler puts the renderer and the GPU layer in a file of their own, which a thread downloads only
// when it draws.

import { awaitLater } from '../shared/await-later';
import type { Tier } from '../shared/tier';

export type DrawModule = typeof import('./draw');

/** Starts loading the renderer, so the download overlaps the thread's other startup work. */
export function loadDrawModule(): Promise<DrawModule> {
	return awaitLater(import('./draw'));
}

/**
 * Starts the download of the device's shaders once the renderer has loaded, for a thread that
 * loads the renderer through `draw`. The renderer reports a failure of either when it starts.
 */
export function preloadShaders(draw: Promise<DrawModule>, tier: Tier, bits: number): void {
	draw.then(
		(module) => module.preloadDeviceShaders(tier, bits),
		() => undefined,
	);
}
