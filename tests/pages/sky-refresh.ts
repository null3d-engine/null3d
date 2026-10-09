// Starts the engine with the sky refresh sketch, live, on the GPU tier and in the thread mode that
// the URL's switches ask for. It captures frames before the sun moves, asks the sketch to move it,
// then captures frames back to back until the frame count of the sketch's squares stops. For each
// capture it reports the frames since the move (or -1 before it), and the mean color of the
// mirror sphere's middle and of the rough sphere's front.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The camera's field of view and distance, and where the sketch puts each thing it reads. */
const FOV = 40;
const DISTANCE = 6;
const MIRROR: [number, number] = [-1.2, 0];
const ROUGH: [number, number] = [1.2, 0];
/** The squares' first center, their spacing and the plane they lie in. */
const SQUARE: [number, number] = [-1.6, -1.3];
const SQUARE_STEP = 0.16;
const SQUARE_DEPTH = 2;
const CAPTURES_BEFORE = 3;
const MOST_CAPTURES = 60;

/** The pixel of a point of the scene's plane `z` units in front of the spheres' plane. */
function pixel([x, y]: [number, number], z = 0): [number, number] {
	const half = Math.tan(((FOV / 2) * Math.PI) / 180) * (DISTANCE - z);
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

/** The frames since the move that a capture's squares show, or -1 before it. */
function since(pixels: Uint8Array): number {
	const lit = (k: number) => {
		const [x, y] = pixel([SQUARE[0] + SQUARE_STEP * k, SQUARE[1]], SQUARE_DEPTH);
		return (pixels[(y * WIDTH + x) * 4] as number) > 128;
	};
	if (!lit(4)) return -1;
	return [0, 1, 2, 3].reduce((count, k) => count | (lit(k) ? 1 << k : 0), 0);
}

run('sky-refresh', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/sky-refresh-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const frames: { since: number; mirror: number[]; rough: number[] }[] = [];
	const capture = async () => {
		const { width, height, pixels } = await engine.captureFrame();
		if (width !== WIDTH || height !== HEIGHT) throw new Error(`a capture of ${width} x ${height}`);
		const frame = {
			since: since(pixels),
			mirror: mean(pixels, pixel(MIRROR)),
			rough: mean(pixels, pixel(ROUGH)),
		};
		frames.push(frame);
		return frame;
	};
	for (let k = 0; k < CAPTURES_BEFORE; k++) await capture();
	engine.postToSketch('move');
	for (let k = 0; k < MOST_CAPTURES; k++) if ((await capture()).since === 15) break;
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
