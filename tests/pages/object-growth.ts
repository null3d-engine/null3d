// Draws the object growth sketch twice, one engine after another on canvases of the same size:
// once growing the scene's object tables during play, from a start of room for 1,000 objects, and
// once without a growth. Reports each engine's picture before and after the growth, and the
// failures that each engine heard. With ?timing, it times growths instead (`timeGrowths`).
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** The objects that the growing engine's tables start with room for. */
const START = 1_000;

/** The timing sketch, which creates nothing until the page asks it to grow the tables. */
const TIMING_SKETCH = new URL('./sketches/object-growth-timing-sketch.ts', import.meta.url);

/**
 * With ?timing, the page reports timings in place of pictures. First the engine memory of a scene
 * of one object, with the default start and with room for 16,383 objects from the start. Then one
 * engine with the default start times the create calls that grow the tables.
 */
async function timeGrowths(canvas: HTMLCanvasElement): Promise<Record<string, unknown>> {
	const memory: Record<string, number | null> = {};
	for (const expectedObjects of [undefined, 16_383]) {
		const engine = await createEngine({ canvas, sketch: TIMING_SKETCH, expectedObjects });
		await engine.firstFrame;
		memory[String(expectedObjects ?? 'default')] = (await engine.measure(0.5)).memory.wasmBytes;
		await engine.destroy();
	}
	const engine = await createEngine({ canvas, sketch: TIMING_SKETCH, maxPixelRatio: 1 });
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	const timing = new Promise<unknown>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'timing') resolve(data);
		}),
	);
	await engine.firstFrame;
	engine.postToSketch('grow', null);
	const frames = await timing;
	await engine.destroy();
	return { memory, timing: frames, failures };
}

run('object-growth', async () => {
	const canvases = document.querySelectorAll('canvas');
	if (new URLSearchParams(location.search).has('timing') && canvases[0])
		return await timeGrowths(canvases[0]);
	const pictures: Record<
		string,
		{
			before: string;
			after: string;
			objects: number;
			during: number;
			odd: number;
			latency: string;
			failures: string[];
		}
	> = {};
	for (const [k, mode] of ['grow', 'reference'].entries()) {
		const canvas = canvases[k];
		if (!canvas) throw new Error('the page has fewer than two canvases');
		// The mode goes on after the address is made: Vite rewrites a template literal given to
		// new URL with import.meta.url, and its query would reach the sketch unfilled.
		const sketch = new URL('./sketches/object-growth-sketch.ts', import.meta.url);
		sketch.searchParams.set('mode', mode);
		const engine = await createEngine({
			canvas,
			sketch,
			maxPixelRatio: 1,
			expectedObjects: mode === 'grow' ? START : undefined,
		});
		const failures: string[] = [];
		engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
		const message = (wanted: string) =>
			new Promise<unknown>((resolve) => {
				const off = engine.onSketchMessage((name, data) => {
					if (name !== wanted) return;
					off();
					resolve(data);
				});
			});
		await message('before');
		const before = toBase64((await engine.captureFrame()).pixels);
		let done: { objects: number } | undefined;
		const after = message('after').then((data) => {
			done = data as { objects: number };
		});
		engine.postToSketch('grow', null);
		// Frames back to back while the tables grow: the thread that draws replays each frame's
		// list while the next one steps, so each one shows whether it read freed matrices.
		const during: string[] = [];
		while (done === undefined) during.push(toBase64((await engine.captureFrame()).pixels));
		await after;
		const picture = toBase64((await engine.captureFrame()).pixels);
		pictures[mode] = {
			before,
			after: picture,
			objects: done.objects,
			during: during.length,
			odd: during.filter((each) => each !== before && each !== picture).length,
			latency: engine.mode.latency,
			failures,
		};
		await engine.destroy();
	}
	return { pictures };
});
