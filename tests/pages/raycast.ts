// Starts the engine with the raycast sketch, in the mode and on the GPU path the switches ask for.
// The sketch casts the same rays through null3D and three.js and posts how their hits differ.
// Then the sketch casts a batch of 10,000 rays in every frame while the page measures a second of
// frames, so the test sees the job workers take the batch's work. ?far moves the scene to the
// Earth's radius, and ?largeWorld starts the engine in large-world mode.
import { createEngine } from '@null3d/engine';
import type { RaycastResults } from './lib/raycast';
import { run } from './lib/result';

run('raycast', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const params = new URLSearchParams(location.search);
	const sketch = new URL('./sketches/raycast-sketch.ts', import.meta.url);
	if (params.has('far')) sketch.search = 'far';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		largeWorld: params.has('largeWorld'),
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code} ${error.message}`));
	const results = await new Promise<RaycastResults>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'results') resolve(data as RaycastResults);
		});
		engine.postToSketch('results');
	});
	engine.postToSketch('batches');
	const stats = await engine.measure(1);
	engine.postToSketch('stop');
	await engine.destroy();
	const jobBusyMs = Object.entries(stats.threads)
		.filter(([name]) => name.startsWith('job-'))
		.map(([, thread]) => thread.busyMs.median);
	return { mode: engine.mode, results, failures, frames: stats.frames, jobBusyMs };
});
