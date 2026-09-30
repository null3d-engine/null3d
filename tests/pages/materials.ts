// Changes a material with set, one step at a time, in the mode and on the GPU path that the
// switches ask for. After each step, it lets the engine draw a few frames, captures one through
// the engine, and reports the color at the middle of the frame.
import { createEngine, type Engine, type MaterialOptions } from '@null3d/engine';
import { run } from './lib/result';

/** The options of each step: none first, then each value alone, then both. */
const STEPS: readonly MaterialOptions[] = [
	{},
	{ opacity: 0.5 },
	{ color: '#0000ff' },
	{ color: '#00ff00', opacity: 1 },
];
/** How long the engine draws after each step before the page captures a frame. */
const DRAW_SECONDS = 0.2;

/** Asks the sketch to pass `options` to the material's set call, and waits for its answer. */
function set(engine: Engine, options: MaterialOptions): Promise<void> {
	return new Promise((resolve) => {
		const off = engine.onSketchMessage((name) => {
			if (name !== 'set') return;
			off();
			resolve();
		});
		engine.postToSketch('set', options);
	});
}

run('materials', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/material-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	await engine.firstFrame;
	const colors: number[][] = [];
	for (const options of STEPS) {
		await set(engine, options);
		await engine.measure(DRAW_SECONDS);
		const { width, height, pixels } = await engine.captureFrame();
		const middle = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
		colors.push([...pixels.subarray(middle, middle + 4)]);
	}
	await engine.destroy();
	return { mode: engine.mode, tier: engine.capabilities.tier, failures, colors };
});
