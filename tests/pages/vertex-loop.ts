// Starts the engine with the vertex loop sketch on the page's own thread (?threads=off), so the
// sketch's loop of vertex updates is a function on the page's global object. The page publishes its
// result once the sketch's objects have places, with the heights that the sketch's rays hit before
// and after it lifted the mesh, and the test runs the loop by name.
// `__null3dSetPaused(paused)` pauses the engine, so no frame runs while the test samples the loop.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

run('vertex-loop', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/vertex-loop-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await new Promise<void>((resolve) => {
		engine.onSketchMessage((name) => {
			if (name === 'ready') resolve();
		});
	});
	(globalThis as { __null3dSetPaused?: (paused: boolean) => void }).__null3dSetPaused = (paused) =>
		engine.setPaused(paused);
	const scope = globalThis as { __null3dVertexLoop?: unknown; __null3dVertexHits?: number[] };
	return {
		mode: engine.mode,
		loop: typeof scope.__null3dVertexLoop,
		hits: scope.__null3dVertexHits,
	};
});
