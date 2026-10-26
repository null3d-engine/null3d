// Starts the sky layer exposure sketch and reads the sky, the lake that mirrors it and the rough
// sphere, over three stretches: at two exposures ten times apart, and at half the background's
// intensity. The layer covers the whole sky with one colour, so the sky and the lake must show the
// same value at either exposure, and the background's intensity dims the sky alone.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The screen point of the sky, of the lake below it, and of the rough sphere against the sky. */
const SKY: [number, number] = [100, 40];
const LAKE: [number, number] = [100, 180];
const ROUGH: [number, number] = [370, 71];
/** The settings of the three stretches: a bright one, ten times dimmer by exposure, and half dim. */
const STRETCHES = [
	{ exposure: 0.1, intensity: 1 },
	{ exposure: 0.01, intensity: 1 },
	{ exposure: 0.1, intensity: 0.5 },
];
/** The captures of each stretch, enough for the map's fill and a settle. */
const CAPTURES = 32;

/** The mean color of the 5 x 5 pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: [number, number]): number[] {
	const sum = [0, 0, 0];
	for (let y = py - 2; y <= py + 2; y++)
		for (let x = px - 2; x <= px + 2; x++)
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
	return sum.map((s) => s / 25);
}

run('sky-layer-exposure', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/sky-layer-exposure-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	progress('the first frame');
	const frames = [];
	for (const [stretch, settings] of STRETCHES.entries()) {
		engine.postToSketch('set', settings);
		for (let k = 0; k < CAPTURES; k++) {
			const { width, height, pixels } = await engine.captureFrame();
			if (width !== WIDTH || height !== HEIGHT)
				throw new Error(`a capture of ${width} x ${height}`);
			frames.push({
				stretch,
				frame: k,
				sky: mean(pixels, SKY),
				lake: mean(pixels, LAKE),
				rough: mean(pixels, ROUGH),
			});
			progress(`stretch ${stretch}, capture ${k}`);
		}
	}
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
