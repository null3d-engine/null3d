// Starts the engine with a sketch whose camera pans fast and which casts a ray through each click,
// then offers `screenRays()` on the window, which gives the clicks that the sketch saw. The screen
// rays test clicks the canvas during the pan in each thread mode.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		screenRays?: () => Promise<unknown>;
	}
}

run('screen-rays', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/screen-rays-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.screenRays = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'clicks') return;
				off();
				resolve(data);
			});
			engine.postToSketch('clicks');
		});
	return { mode: engine.mode };
});
