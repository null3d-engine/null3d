// Starts the engine with a sketch whose background shade changes each frame, in the thread mode and
// on the GPU tier that the URL's switches ask for, and captures frames back to back with
// captureFrame. It reports the red value of each capture's middle pixel.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

const CAPTURES = 6;

run('capture-frames', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/frame-shade-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	const shades: number[] = [];
	for (let i = 0; i < CAPTURES; i++) {
		const { width, height, pixels } = await engine.captureFrame();
		shades.push(pixels[(Math.floor(height / 2) * width + Math.floor(width / 2)) * 4] as number);
	}
	await engine.destroy();
	return { tier: engine.capabilities.tier, mode: engine.mode, shades };
});
