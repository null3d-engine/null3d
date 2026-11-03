// Starts the engine with the near pool's loop sketch on the page's own thread (?threads=off), so the
// pool's per-frame call is a function on the page's global object. The sketch grows its oak and the
// pool answers for the standing camera over the first frames, so the page waits for the loop to
// appear before it publishes its result.
// `__null3dSetPaused(paused)` pauses the engine, so no frame runs while the test samples the loop.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** The longest the page waits for the pool to answer, in milliseconds. */
const SETTLE_MS = 300_000;

run('near-pool-loop', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/near-pool-loop-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	(globalThis as { __null3dSetPaused?: (paused: boolean) => void }).__null3dSetPaused = (paused) =>
		engine.setPaused(paused);
	const scope = globalThis as { __null3dNearPoolLoop?: unknown };
	const started = performance.now();
	while (!scope.__null3dNearPoolLoop && performance.now() - started < SETTLE_MS)
		await new Promise((resolve) => setTimeout(resolve, 100));
	return { mode: engine.mode, loop: typeof scope.__null3dNearPoolLoop };
});
