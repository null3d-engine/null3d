// Changes a material with set, one step at a time, in the mode and on the GPU path that the
// switches ask for. After each step it captures frames until it holds one that the sketch recorded
// after the change, and reports the color at the middle of that frame. A sketch records a frame
// ahead of the one that draws, so the frame a capture takes first may have been recorded before the
// step, and a scene that never moves cannot tell the two pictures apart.
import { createEngine, type Engine, type MaterialOptions } from '@null3d/engine';
import { run } from './lib/result';

/** The options of each step: none first, then each value alone, then both. */
const STEPS: readonly MaterialOptions[] = [
	{},
	{ opacity: 0.5 },
	{ color: '#0000ff' },
	{ color: '#00ff00', opacity: 1 },
];
/**
 * The captures that a step takes after its change. The engine holds one frame ahead: the first
 * capture takes the frame recorded before the change, and the second takes one recorded after it.
 */
const CAPTURES = 2;

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
		// CI's software GPU drew no frame at all in the 0.2 seconds that this page allowed, so the
		// capture that followed returned the frame drawn last, which was the step before: run
		// 39990527400 drew the fourth step's green as the third step's blue. Each capture takes a
		// newer frame than the one before, so the last of them was recorded after the change.
		let frame = await engine.captureFrame();
		for (let capture = 1; capture < CAPTURES; capture++) frame = await engine.captureFrame();
		const { width, height, pixels } = frame;
		const middle = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
		colors.push([...pixels.subarray(middle, middle + 4)]);
	}
	await engine.destroy();
	return { mode: engine.mode, tier: engine.capabilities.tier, failures, colors };
});
