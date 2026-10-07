// Starts the engine with the row raycast sketch, on the GPU path the switches ask for. The sketch
// casts the same rays through null3D and three.js against sprites, points and lines, and posts how
// their hits differ. Then the page reads a frame back and checks it against a ray through each
// pixel: where the frame draws a row, the ray hits that row, and where it draws none, the ray hits
// nothing. Pixels at a row's edge, where rays close to the center disagree, are left out. Then it
// offers `rowRaycast(message)` on the window, which asks the sketch for its click targets
// ('targets') or the clicks its handlers saw ('clicks').
import { createEngine } from '@null3d/engine';
import {
	ROW_BATCHES,
	ROW_COLORS,
	ROW_PIXEL_EDGE,
	ROW_PIXEL_NONE,
	ROWS_HEIGHT,
	ROWS_WIDTH,
	type RowRaycastResults,
} from './lib/raycast-rows';
import { run } from './lib/result';

declare global {
	interface Window {
		rowRaycast?: (message: string) => Promise<unknown>;
	}
}

/** A pixel this dark shows the background. */
const DARK = 60;
/** A pixel farther than this from every batch's color shows none of them, as at a blended edge. */
const FAR_COLOR = 60 * 60 * 3;

/** The batch whose color a pixel shows, `ROW_PIXEL_NONE` for the background, or -1 for neither. */
function shownAt(pixels: Uint8Array, at: number): number {
	const rgb = [pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number];
	if (Math.max(...rgb) < DARK) return ROW_PIXEL_NONE;
	let best = -1;
	let bestDistance = FAR_COLOR;
	ROW_COLORS.forEach((color, k) => {
		const d = color.reduce((sum, c, i) => sum + (c - (rgb[i] as number)) ** 2, 0);
		if (d < bestDistance) [best, bestDistance] = [k, d];
	});
	return best;
}

run('raycast-rows', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/raycast-rows-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code} ${error.message}`));
	const ask = <T>(message: string) =>
		new Promise<T>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== message) return;
				off();
				resolve(data as T);
			});
			engine.postToSketch(message);
		});
	const results = await ask<RowRaycastResults>('results');
	const frame = await engine.captureFrame();
	if (frame.width !== ROWS_WIDTH || frame.height !== ROWS_HEIGHT)
		throw new Error(`the frame is ${frame.width} x ${frame.height}`);
	const classes = await ask<Uint8Array>('picture');
	const picture = {
		judged: 0,
		edges: 0,
		drawn: 0,
		missing: 0,
		extra: 0,
		swapped: 0,
		examples: [] as string[],
	};
	for (let i = 0; i < classes.length; i++) {
		const ray = classes[i] as number;
		if (ray === ROW_PIXEL_EDGE) {
			picture.edges++;
			continue;
		}
		const shown = shownAt(frame.pixels, i * 4);
		if (shown < 0) continue;
		picture.judged++;
		if (shown !== ROW_PIXEL_NONE) picture.drawn++;
		const name = (k: number) => (k === ROW_PIXEL_NONE ? 'nothing' : ROW_BATCHES[k]);
		const where = `(${i % ROWS_WIDTH}, ${Math.floor(i / ROWS_WIDTH)})`;
		if (shown === ray) continue;
		if (ray === ROW_PIXEL_NONE) picture.missing++;
		else if (shown === ROW_PIXEL_NONE) picture.extra++;
		else picture.swapped++;
		if (picture.examples.length < 12)
			picture.examples.push(`${where} shows ${name(shown)}, the ray hits ${name(ray)}`);
	}
	window.rowRaycast = (message) => ask(message);
	return { tier: engine.capabilities.tier, mode: engine.mode, results, picture, failures };
});
