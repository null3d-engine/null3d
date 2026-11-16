// Measures what a tree of cluster patches costs on this device: the same heightfield of 32,768
// triangles at three camera distances (tests/pages/sketches/cluster-cost-sketch.ts). Near the
// ground the view draws most of the patches at full detail, and far from it the walk stops at
// coarse patches, so the GPU time falls as the camera draws back. The page reports the medians of
// GPU time per frame where the device has a GPU timer, and of the frame interval and CPU time,
// after a warm-up at each distance. Open it with ?gpu= for each path.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

/** Seconds of play before each distance's measurement. */
const WARM_UP_SECONDS = 2;
/** Seconds of each measurement. */
const SECONDS = 2;
/** The camera's distances from the middle of the ground, in metres: close, middle, far. */
const DISTANCES = [12, 30, 80];

run('cluster-cost', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/cluster-cost-sketch.ts', import.meta.url);
	const engine = await createEngine({ canvas, sketch });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const moved = (distance: number) =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'moved' || data !== distance) return;
				off();
				resolve();
			});
			engine.postToSketch('distance', distance);
		});
	const sides = [];
	for (const distance of DISTANCES) {
		await moved(distance);
		await new Promise((resolve) => setTimeout(resolve, WARM_UP_SECONDS * 1000));
		await moved(distance);
		const stats = await engine.measure(SECONDS);
		const threads: Record<string, number | null> = {};
		for (const [name, thread] of Object.entries(stats.threads))
			threads[name] = thread.busyMs.median;
		sides.push({
			distance,
			gpuMs: stats.gpuMs?.median ?? null,
			intervalMs: stats.intervalMs.median,
			cpuMs: stats.cpuMs.median,
			threads,
		});
	}
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		window: [innerWidth, innerHeight],
		devicePixelRatio,
		sides,
		failures,
	};
});
