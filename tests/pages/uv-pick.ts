// Starts the engine with the in-world screen sketch, then offers `uvPick(message)` on the window:
// it sends the sketch a message and resolves with the reply that names it. The uv pick test asks
// for the canvas point of each aimed texel, clicks the canvas there, and asks for the texels that
// the clicks landed on.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		uvPick?: (message: string) => Promise<unknown>;
	}
}

run('uv-pick', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/uv-pick-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.uvPick = (message) =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== message) return;
				off();
				resolve(data);
			});
			engine.postToSketch(message);
		});
	return { mode: engine.mode };
});
