// Starts the engine with the raycast sketch, in the mode and on the GPU path the switches ask for.
// The sketch casts the same rays through null3D and three.js and posts how their hits differ.
// Then the sketch casts a batch of 10,000 rays in every frame while the page measures a second of
// frames. ?everyWorker measures on until each job worker has taken part of the batches, so the test
// sees the batches reach every worker. ?far moves the scene to the Earth's radius, and ?largeWorld
// starts the engine in large-world mode.
import { createEngine } from '@null3d/engine';
import type { RaycastResults } from './lib/raycast';
import { run } from './lib/result';

/**
 * The longest measurement, in seconds, while the page waits for every job worker to take part of a
 * batch. The measurements before it take 15 seconds in all. The thread that casts a batch takes its parts too, so a job worker that wakes late misses
 * that frame's batch. A software GPU on a busy machine can take more than a second for a frame, and
 * a measurement counts only the frames that start and end within it.
 */
const LONGEST_MEASUREMENT_S = 16;

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
	// Each job worker's busy time over the measured frames, in milliseconds. With ?everyWorker, each
	// further measurement is twice as long as the one before, until every worker has taken work.
	const jobBusyMs = new Array<number>(engine.mode.jobWorkers).fill(0);
	let frames = 0;
	let seconds = 0;
	let length = 1;
	do {
		const stats = await engine.measure(length);
		frames += stats.frames;
		seconds += length;
		length *= 2;
		jobBusyMs.forEach((total, k) => {
			const busy = stats.threads[`job-${k}`]?.busyMs;
			jobBusyMs[k] = total + (busy ? busy.mean * busy.count : 0);
		});
	} while (
		params.has('everyWorker') &&
		length <= LONGEST_MEASUREMENT_S &&
		jobBusyMs.some((ms) => ms === 0)
	);
	engine.postToSketch('stop');
	await engine.destroy();
	return { mode: engine.mode, results, failures, frames, seconds, jobBusyMs };
});
