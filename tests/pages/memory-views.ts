// Runs the memory views sketch, which grows the engine's memory in many steps, and reads the
// memory's size after each step while the sketch waits. Reports the sizes, and leaves the engine
// running, so the test can count the buffer objects that each thread holds.
import { createEngine } from '@null3d/engine';
import { measurePageMemory } from '@null3d/engine/stats';
import { progress, run } from './lib/result';

declare global {
	interface Window {
		/** Measures the browser's memory while every engine thread can answer. */
		__measureMemoryViews?: typeof measurePageMemory;
	}
}

window.__measureMemoryViews = measurePageMemory;

run('memory-views', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/memory-views-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const sizes: number[] = [];
	await new Promise<void>((resolve) =>
		engine.onSketchMessage(async (name, data) => {
			if (name === 'grown') resolve();
			if (name !== 'step') return;
			progress(`step ${(data as { step: number }).step}`);
			const stats = await engine.measure(0.05);
			sizes.push(stats.memory.wasmBytes ?? 0);
			engine.postToSketch('go');
		}),
	);
	return { mode: engine.mode, sizes, failures };
});
