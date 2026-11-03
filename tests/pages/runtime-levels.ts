// Runs the sketch whose meshes made in code plan their levels on the job workers
// (sketches/runtime-levels-sketch.ts). It waits for the levels that the sketch reports, then counts
// the triangles that the frames draw with the camera near the bumpy grid and far from it.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** The camera's distances from the grid's middle, in metres: near, then far. */
const DISTANCES = [6, 400];

run('runtime-levels', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/runtime-levels-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
		preset: 'low',
	});
	await engine.firstFrame;
	const levels = await new Promise<Record<string, unknown>>((resolve, reject) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'levels') resolve(data as Record<string, unknown>);
			else if (name === 'failed') reject(new Error((data as { message: string }).message));
		});
	});
	progress('levels arrived');
	const moved = (distance: number) =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'moved' || data !== distance) return;
				off();
				resolve();
			});
			engine.postToSketch('distance', distance);
		});
	const triangles: Record<number, number> = {};
	for (const distance of DISTANCES) {
		await moved(distance);
		// WebGPU counts the triangles that the GPU culled on one frame in eleven, a few frames late.
		await engine.measure(0.5);
		triangles[distance] = (await engine.measure(1)).triangles.median;
		progress(`${triangles[distance]} triangles at ${distance} m`);
	}
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	await engine.destroy();
	return { tier, mode, levels, triangles };
});
