// Starts the engine with the frame resolution sketch in the GPU path and thread mode that the
// switches ask for. The sketch fixes each render scale in turn, and after each one the page reads
// the frame back: the paint's change across and its change down must sit at the middle of the image
// at every scale. A place measured against the canvas's size rather than the size the scene drew at
// puts both changes further across and down, and at half the scale the paint does not change at all.
// With ?vignette the page reads the mean brightness of the top and bottom bands instead, which match
// only while the vignette's center lies at the middle of the drawn image.
import { createEngine } from '@null3d/engine';
import { FRAME_RESOLUTION_SCALES, VIGNETTE_SCALES } from './lib/render-scale';
import { run } from './lib/result';

/** True when the page draws the plain plane with the vignette on, as ?vignette asks. */
const VIGNETTE = new URLSearchParams(location.search).has('vignette');

interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/**
 * The place across the image where its first column of each row stops being dark, and the place
 * down it where its first row stops being dark, both as shares of the image's side. It reads a row
 * in the top quarter and a column in the left quarter, which the other change does not cross.
 */
function changePlaces({ width, height, pixels }: Frame): { across: number; down: number } {
	const red = (x: number, y: number) => pixels[4 * (y * width + x)] as number;
	const row = Math.floor(height / 4);
	const column = Math.floor(width / 4);
	return {
		across: turn(width, (x) => red(x, row)),
		down: turn(height, (y) => red(column, y)),
	};
}

/**
 * The mean brightness of a band of rows at the middle of the image: the top and bottom band are the
 * same distance from a centered vignette, whatever the tone curve does to it.
 */
function bandMean({ width, height, pixels }: Frame, top: number, bottom: number): number {
	const left = Math.floor((width * 3) / 8);
	const right = Math.floor((width * 5) / 8);
	let sum = 0;
	let count = 0;
	for (let y = top; y < bottom; y++)
		for (let x = left; x < right; x++) {
			sum += pixels[4 * (y * width + x)] as number;
			count++;
		}
	return count > 0 ? sum / count : 0;
}

/**
 * The first place along a line of `length` pixels whose value reaches halfway between the smallest
 * and the largest of them. A line that never changes gives its first place, so a frame with no
 * paint fails too.
 */
function turn(length: number, value: (place: number) => number): number {
	let low = 255;
	let high = 0;
	for (let place = 0; place < length; place++) {
		low = Math.min(low, value(place));
		high = Math.max(high, value(place));
	}
	const middle = (low + high) / 2;
	for (let place = 0; place < length; place++) if (value(place) >= middle) return place / length;
	return 1;
}

run('frame-resolution', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/frame-resolution-sketch.ts', import.meta.url);
	// The page's own switches reach the sketch, so ?vignette turns its vignette on.
	sketch.search = location.search;
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const scales: number[] = [];
	const across: number[] = [];
	const down: number[] = [];
	const top: number[] = [];
	const bottom: number[] = [];
	for (const scale of VIGNETTE ? VIGNETTE_SCALES : FRAME_RESOLUTION_SCALES) {
		const drawn = new Promise<number>((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'drawn') return;
				off();
				resolve(data as number);
			});
		});
		engine.postToSketch('scale', scale);
		scales.push(await drawn);
		const frame = await engine.captureFrame();
		if (VIGNETTE) {
			const quarter = Math.floor(frame.height / 4);
			top.push(bandMean(frame, 0, quarter));
			bottom.push(bandMean(frame, frame.height - quarter, frame.height));
		} else {
			const places = changePlaces(frame);
			across.push(places.across);
			down.push(places.down);
		}
	}
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		scales,
		across,
		down,
		top,
		bottom,
		failures,
	};
});
