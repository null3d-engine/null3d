// The fresh project's page: it starts the engine on its canvas with the project's sketch, and in a
// production build it registers the service worker that caches the game for offline play. The
// engine loads the sprite shaders before the first frame, as a game that draws sprites may ask, so
// an offline start needs that feature's files from the cache. A shipped game ignores the engine's
// test switches, so the page reads `?path=webgpu` or `?path=webgl2` itself and forces that GPU path
// with the engine's testing option: the offline check starts the game on each path.
import { createEngine } from '@null3d/engine';

if (import.meta.env.PROD) void navigator.serviceWorker?.register('./sw.js');

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const root = document.documentElement;
const path = new URLSearchParams(location.search).get('path');
// The fresh-project test reads how the start ended from the page's root element: the build that
// started, or the error, and the GPU path that draws.
try {
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketch.ts', import.meta.url),
		preload: ['sprites'],
		gpu: path === 'webgpu' || path === 'webgl2' ? path : 'auto',
	});
	root.dataset.tier = engine.capabilities.tier;
	root.dataset.start = engine.capabilities.threaded ? 'threaded' : 'single-threaded';
} catch (e) {
	root.dataset.start = String(e);
	throw e;
}
