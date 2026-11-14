// Starts the engine with the instance draw's loop sketch on the page's own thread (?threads=off),
// so the sketch's loop of count and row writes is a function on the page's global object. The
// engine starts the sketch before it resolves, so the page publishes its result at once, and the
// test runs the loop by name.
// `__null3dSetPaused(paused)` pauses the engine, so no frame runs while the test samples the loop.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('feature-instances-loop', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/feature-instances-loop-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	(globalThis as { __null3dSetPaused?: (paused: boolean) => void }).__null3dSetPaused = (paused) =>
		engine.setPaused(paused);
	const loop = (globalThis as { __null3dFeatureInstancesLoop?: unknown })
		.__null3dFeatureInstancesLoop;
	return { mode: engine.mode, loop: typeof loop };
});
