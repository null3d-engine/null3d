// Loads the renderer on the page, which draws only in single-threaded mode and with ?render=main.
// The bundler puts each GPU path's renderers in a file of their own, and the frame loops and the
// code that both paths share in another. The page downloads its own path's file and the shared
// one together, and never the other path's.

import { awaitLater } from '../shared/await-later';
import type { DrawModule } from './draw';
import type { Tier } from './renderer';

export type { DrawModule };

/** Starts loading the renderer of `tier`, so the download overlaps the page's other startup work. */
export function loadDrawModule(tier: Tier): Promise<DrawModule> {
	return awaitLater(tier === 'webgl2' ? import('./webgl2-renderer') : import('./webgpu-renderer'));
}
