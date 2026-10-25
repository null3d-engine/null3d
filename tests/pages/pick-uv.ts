// Starts the engine with the pick texture coordinate sketch, then offers `pickUv()` on the window:
// it asks the sketch for the answers of every probe. The test compares the pick's texture
// coordinates with the raycast's and with the coordinates that each surface's geometry gives.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		pickUv?: () => Promise<unknown>;
	}
}

run('pick-uv', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/pick-uv-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.pickUv = () =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'probes' && name !== 'error') return;
				off();
				resolve({ error: name === 'error' ? data : undefined, answers: data });
			});
			engine.postToSketch('probes');
		});
	return { mode: engine.mode };
});
