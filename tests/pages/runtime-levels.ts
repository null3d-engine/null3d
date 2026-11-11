// Runs the sketch whose meshes made in code plan their levels on the job workers
// (sketches/runtime-levels-sketch.ts). It waits for the levels that the sketch reports, then counts
// the triangles that the frames draw with the camera near the bumpy grid and far from it, and at a
// corner of the large grid with pieces and of the same grid without.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** The camera's distances from the grid's middle, in metres: near, then far. */
const DISTANCES = [6, 400];

/** Where the large grid with pieces draws, and the same grid without them, by name. */
const CORNERS = { pieces: 500, whole: -500 };

/** The most measures that a view takes while the counts of the drawn triangles catch up. */
const SETTLE_WAITS = 8;

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
	const moved = (type: string, place: number) =>
		new Promise<void>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'moved' || data !== place) return;
				off();
				resolve();
			});
			engine.postToSketch(type, place);
		});
	/**
	 * The triangles that a frame draws, once the counts have caught up with the view. WebGPU takes
	 * the triangles of the draws that it culled from the GPU, on one frame in eleven and a few
	 * frames late, so a slow device still reports the count of the camera before this one. Two
	 * reads that agree can both be that stale count, so a settled count must differ from the first
	 * read of its own view, or from the view before once one has settled, and then repeat.
	 */
	let lastDrawn = -1;
	const drawn = async () => {
		let previous = -1;
		let firstRead = -1;
		let settled = -1;
		for (let k = 0; k < SETTLE_WAITS; k++) {
			await engine.measure(0.5);
			const triangles = (await engine.measure(1)).triangles.median;
			if (k === 0) firstRead = triangles;
			const baseline = lastDrawn === -1 ? firstRead : lastDrawn;
			if (triangles !== baseline && triangles > 0 && triangles === previous) {
				settled = triangles;
				break;
			}
			previous = triangles;
		}
		if (settled === -1) settled = previous > 0 ? previous : firstRead;
		lastDrawn = settled;
		return settled;
	};
	const triangles: Record<string, number> = {};
	for (const distance of DISTANCES) {
		await moved('distance', distance);
		triangles[distance] = await drawn();
		progress(`${triangles[distance]} triangles at ${distance} m`);
	}
	for (const [name, x] of Object.entries(CORNERS)) {
		await moved('corner', x);
		triangles[name] = await drawn();
		progress(`${triangles[name]} triangles at the corner of the grid ${name}`);
	}
	const tier = engine.capabilities.tier;
	const mode = engine.mode;
	await engine.destroy();
	return { tier, mode, levels, triangles };
});
