// Starts the engine with the probe grid's day cycle sketch on the GPU tier that the URL's switches
// ask for, and captures frames before and after the sketch is told to turn the day to night. Each
// capture reports the frames since the move and the mean color of the floor in the middle of the
// view, which the grid lights. The floor must darken as the sky does, with no new bake: the light
// of the sky around it is the live sky's, times how much of the sky each probe saw.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const [WIDTH, HEIGHT] = [480, 270];
/** The captures before the move, which show the day's settled light. */
const CAPTURES_BEFORE = 3;
/** The captures after it, which cover the sky map's refresh and the frames past it. */
const MOST_CAPTURES = 80;

/** The mean color of the 5 x 5 pixels around `at`. */
function mean(pixels: Uint8Array, [px, py]: [number, number]): number[] {
	const sum = [0, 0, 0];
	for (let y = py - 2; y <= py + 2; y++)
		for (let x = px - 2; x <= px + 2; x++)
			for (let c = 0; c < 3; c++)
				sum[c] = (sum[c] as number) + (pixels[(y * WIDTH + x) * 4 + c] as number);
	return sum.map((s) => s / 25);
}

run('probe-grid-time', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/probe-grid-time-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const frames: { since: number; floor: number[] }[] = [];
	let since = -1;
	const capture = async () => {
		const { width, height, pixels } = await engine.captureFrame();
		if (width !== WIDTH || height !== HEIGHT) throw new Error(`a capture of ${width} x ${height}`);
		const frame = { since, floor: mean(pixels, [WIDTH / 2, HEIGHT / 2]) };
		frames.push(frame);
		return frame;
	};
	for (let k = 0; k < CAPTURES_BEFORE; k++) await capture();
	engine.postToSketch('move');
	since = 0;
	for (let k = 0; k < MOST_CAPTURES; k++) {
		await capture();
		since++;
	}
	await engine.destroy();
	return { tier: engine.capabilities.tier, frames };
});
