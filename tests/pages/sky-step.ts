// Starts the engine with the sky step sketch, live, on the GPU tier and in the thread mode that the
// URL's switches ask for. It captures a few frames of the still sky, asks the sketch to sweep the
// sun slowly, and captures frames back to back through the sweep and the frames after it. For each
// capture it reports the mean colour of the mirror sphere's middle and of the rough sphere's front.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const [WIDTH, HEIGHT] = [320, 180];
/** The camera's field of view and distance, and where the sketch puts each sphere it reads. */
const FOV = 40;
const DISTANCE = 6;
const MIRROR: [number, number] = [-1.2, 0];
const ROUGH: [number, number] = [1.2, 0];
/** The captures before the sweep, and the capture count that ends the page. */
const BEFORE = 2;
const MOST_CAPTURES = 100;

/** The pixel of a point of the spheres' plane. */
function pixel([x, y]: [number, number]): [number, number] {
	const half = Math.tan(((FOV / 2) * Math.PI) / 180) * DISTANCE;
	const aspect = WIDTH / HEIGHT;
	return [
		Math.round(((x / (half * aspect) + 1) / 2) * WIDTH),
		Math.round(((1 - y / half) / 2) * HEIGHT),
	];
}

/** The mean colour of the 5 x 5 pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: [number, number]): number[] {
	const sum = [0, 0, 0];
	for (let y = py - 2; y <= py + 2; y++)
		for (let x = px - 2; x <= px + 2; x++)
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
	return sum.map((s) => s / 25);
}

run('sky-step', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/sky-step-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const frames: { mirror: number[]; rough: number[] }[] = [];
	const capture = async () => {
		const { width, height, pixels } = await engine.captureFrame();
		if (width !== WIDTH || height !== HEIGHT) throw new Error(`a capture of ${width} x ${height}`);
		frames.push({
			mirror: mean(pixels, pixel(MIRROR)),
			rough: mean(pixels, pixel(ROUGH)),
		});
	};
	for (let k = 0; k < BEFORE; k++) await capture();
	engine.postToSketch('sweep');
	// A software GPU draws far slower than a real one, so the trail says how far the captures got
	// when a run ends without a result.
	for (let k = 0; k < MOST_CAPTURES; k++) {
		await capture();
		if (k % 10 === 9) progress(`captured ${k + 1}`);
	}
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
