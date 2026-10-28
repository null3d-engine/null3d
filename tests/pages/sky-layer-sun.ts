// Starts the engine with the sky layer sun sketch, live, on the GPU tier that the URL's switches ask
// for, and captures the middle of the sun's disc and a block of plain sky beside it over three
// stretches: before a layer arrives, with a layer that hides the sun, and after it is removed.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The captures of each stretch: enough for a layer to arrive and for the sky to settle. */
const CAPTURES = 12;
/** The block measured around the middle of the disc, and around a point of plain sky beside it. */
const [DISC, PLAIN] = [
	[WIDTH / 2, HEIGHT / 2],
	[WIDTH / 2 - 100, HEIGHT / 2],
] as const;

/** The mean color of the `size` x `size` pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: readonly [number, number], size: number): number[] {
	const half = (size - 1) / 2;
	const sum = [0, 0, 0];
	let count = 0;
	for (let y = py - half; y <= py + half; y++)
		for (let x = px - half; x <= px + half; x++) {
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
			count++;
		}
	return sum.map((s) => s / count);
}

interface Capture {
	/** The stretch: 0 before any layer, 1 with one that hides the sun, 2 after it was removed. */
	stretch: number;
	frame: number;
	disc: number[];
	plain: number[];
}

run('sky-layer-sun', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/sky-layer-sun-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const frames: Capture[] = [];
	const capture = async (stretch: number, frame: number) => {
		const { width, height, pixels } = await engine.captureFrame();
		if (width !== WIDTH || height !== HEIGHT) throw new Error(`a capture of ${width} x ${height}`);
		frames.push({
			stretch,
			frame,
			disc: mean(pixels, DISC, 5),
			plain: mean(pixels, PLAIN, 9),
		});
	};
	for (let k = 0; k < CAPTURES; k++) await capture(0, k);
	engine.postToSketch('hide');
	for (let k = 0; k < CAPTURES; k++) await capture(1, k);
	engine.postToSketch('show');
	for (let k = 0; k < CAPTURES; k++) await capture(2, k);
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
