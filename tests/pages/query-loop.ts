// Starts the engine with the query loop sketch on the page's own thread (?threads=off), so the
// sketch's loop of every query is a function on the page's global object. The page publishes its
// result once the sketch's objects have places, and the test runs the loop by name.
// `__null3dSetPaused(paused)` pauses the engine, so no frame runs while the test samples the loop.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('query-loop', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/query-loop-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await new Promise<void>((resolve) => {
		engine.onSketchMessage((name) => {
			if (name === 'ready') resolve();
		});
	});
	(globalThis as { __null3dSetPaused?: (paused: boolean) => void }).__null3dSetPaused = (paused) =>
		engine.setPaused(paused);
	const loop = (globalThis as { __null3dQueryLoop?: unknown }).__null3dQueryLoop;
	return { mode: engine.mode, loop: typeof loop };
});
