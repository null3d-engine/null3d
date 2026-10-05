// Starts the sketch, and gives the hot update test what it reads on the page: the color at the
// middle of each of the three columns of the frame, read back through the engine, and a number
// that is new each time the page loads.
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas');
if (!canvas) throw new Error('the page has no canvas');
const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });

/** The red, green and blue of the middle pixel of each column: left, middle and right. */
async function colors(): Promise<number[][]> {
	const { width, height, pixels } = await engine.captureFrame();
	const row = Math.floor(height / 2);
	return [1, 3, 5].map((sixth) => {
		const at = (row * width + Math.floor((width * sixth) / 6)) * 4;
		return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
	});
}

Object.assign(globalThis, { __hot: { engine, colors, load: Math.random() } });
