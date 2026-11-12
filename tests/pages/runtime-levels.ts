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

/** The most measures that a view takes while its frames and counts catch up. */
const SETTLE_WAITS = 90;
/**
 * Frames that a view draws before it reads its count. The GPU samples the triangles of the draws
 * that it culled on one frame in eleven, so this covers a sample drawn after the camera moved,
 * and the few frames that its sums take to come back.
 */
const SETTLE_FRAMES = 16;
/** The most reads that a view takes to repeat its count. */
const REPEAT_READS = 4;

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
	 * The triangles that a frame draws, once the GPU's counts describe the view. WebGPU takes the
	 * triangles of the draws that it culled from the GPU, on one frame in eleven and a few frames
	 * late, so a slow device still reports the count of the camera before this one. Waiting a
	 * wall-clock time can pass no frames at all on such a device, so the page first draws enough
	 * frames for a later sample to describe the view, then reads until a count differs from the
	 * view before and repeats.
	 */
	let lastDrawn = -1;
	const drawn = async () => {
		let frames = 0;
		for (let k = 0; k < SETTLE_WAITS && frames < SETTLE_FRAMES; k++)
			frames += (await engine.measure(0.5)).frames;
		let triangles = -1;
		for (let k = 0; k < REPEAT_READS; k++) {
			const read = (await engine.measure(1)).triangles.median;
			if (read > 0 && read !== lastDrawn && read === triangles) break;
			triangles = read;
		}
		lastDrawn = triangles;
		return triangles;
	};
	// The count of the camera before the first view, which a stale read can still repeat.
	const before = (await engine.measure(1)).triangles.median;
	if (before > 0) lastDrawn = before;
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
