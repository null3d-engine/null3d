// Starts the engine with the sky layer light sketch, live, on the GPU tier that the URL's switches
// ask for, and captures the mirror sphere's middle and the rough sphere's front over three stretches
// of frames: before a sky layer arrives, with the layer installed, and after it is removed. Each
// capture also reports the stage of the stretch, so a test can tell when each place took the layer.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The camera's field of view and distance, and where the sketch puts each sphere. */
const FOV = 40;
const DISTANCE = 6;
const MIRROR: [number, number] = [-1.2, 0];
const ROUGH: [number, number] = [1.2, 0];
/** The captures of each stretch: enough for a map's refresh, its light, and a settle. */
const CAPTURES = 32;

/** The pixel of a point of the spheres' plane. */
function pixel([x, y]: [number, number]): [number, number] {
	const half = Math.tan(((FOV / 2) * Math.PI) / 180) * DISTANCE;
	const aspect = WIDTH / HEIGHT;
	return [
		Math.round(((x / (half * aspect) + 1) / 2) * WIDTH),
		Math.round(((1 - y / half) / 2) * HEIGHT),
	];
}

/** The mean color of the 5 x 5 pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: [number, number]): number[] {
	const sum = [0, 0, 0];
	for (let y = py - 2; y <= py + 2; y++)
		for (let x = px - 2; x <= px + 2; x++)
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
	return sum.map((s) => s / 25);
}

interface Capture {
	/** The stretch: 0 before any layer, 1 with one, 2 after it was removed. */
	stretch: number;
	frame: number;
	mirror: number[];
	rough: number[];
}

run('sky-layer-light', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/sky-layer-light-sketch.ts', import.meta.url),
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
			mirror: mean(pixels, pixel(MIRROR)),
			rough: mean(pixels, pixel(ROUGH)),
		});
	};
	for (let k = 0; k < CAPTURES; k++) await capture(0, k);
	engine.postToSketch('layer');
	for (let k = 0; k < CAPTURES; k++) await capture(1, k);
	engine.postToSketch('clear');
	for (let k = 0; k < CAPTURES; k++) await capture(2, k);
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
