// Runs the sketch whose meshes made in code plan their levels on the job workers
// (sketches/runtime-levels-sketch.ts). It waits for the levels that the sketch reports, then counts
// the triangles that the frames draw with the camera near the bumpy grid and far from it, and at a
// corner of the large grid with pieces and of the same grid without.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

/** The camera's distances from the grid's middle, in metres: near, then far. */
const DISTANCES = [6, 400];

/** Frames after a move before a window may count the new view: three periods of WebGPU's counts. */
const SETTLED_FRAMES = 33;
/** Windows that a count may take to settle before the page takes the last one as it is. */
const MAX_WINDOWS = 40;

/** Where the large grid with pieces draws, and the same grid without them, by name. */
const CORNERS = { pieces: 500, whole: -500 };

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
	// WebGPU counts the triangles that the GPU culled on one frame in eleven, a few frames late, and
	// the frames before a count lands repeat the count of the view before the move. A software GPU
	// draws so few frames a second, and can pause for seconds while the planned levels land, that a
	// window of a fixed time can hold only those frames, or none. So the page lets a few sampling
	// periods' frames pass after the move, then takes the first window whose frames all count the
	// same.
	const drawn = async () => {
		let frames = 0;
		for (let window = 0; ; window++) {
			const measured = await engine.measure(0.5);
			frames += measured.frames;
			const { triangles } = measured;
			const settled =
				frames >= SETTLED_FRAMES && measured.frames > 0 && triangles.min === triangles.max;
			if (settled || window === MAX_WINDOWS) return triangles.median;
		}
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
