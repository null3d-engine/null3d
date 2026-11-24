// Loads the renderer on a thread that draws only in some modes: the page and the sketch worker. The
// bundler puts the renderer and the GPU layer in a file of their own, which a thread downloads only
// when it draws.

import { awaitLater } from '../shared/await-later';
import type { DrawingPreload, EarlyStart } from './renderer';

export type DrawModule = typeof import('./draw');

/** Starts loading the renderer, so the download overlaps the thread's other startup work. */
export function loadDrawModule(): Promise<DrawModule> {
	return awaitLater(import('./draw'));
}

/**
 * Starts what the renderer that `preload` describes needs first, once the renderer's code has
 * loaded through `draw`: the downloads of its shaders and of its GPU path's renderers, and on
 * WebGPU the request for its device. The renderer reports a failure of any of them when it starts.
 * Resolves with the start, which the thread hands to its renderer, or with undefined when the code
 * did not load.
 */
export function preloadDrawing(
	draw: Promise<DrawModule>,
	preload: DrawingPreload,
): Promise<EarlyStart | undefined> {
	return draw.then(
		(module) => module.startEarly(preload),
		() => undefined,
	);
}
