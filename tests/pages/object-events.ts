// Starts the engine with a sketch whose objects take pointer events, then offers
// `objectEvents(message)` on the window. It sends the sketch a message ('listen', 'unlisten', 'pan'
// or any other to only ask) and resolves with the sketch's reply: the lines its handlers wrote, the
// rays that pointer events cast, and the clicks during the pan. The object events test drives the
// mouse and the touch screen over the canvas in each thread mode and on each GPU path.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		objectEvents?: (message: string) => Promise<unknown>;
	}
}

run('object-events', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/object-events-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	await engine.firstFrame;
	window.objectEvents = (message) =>
		new Promise((resolve) => {
			const off = engine.onSketchMessage((name, data) => {
				if (name !== 'reply') return;
				off();
				resolve(data);
			});
			engine.postToSketch(message);
		});
	return { mode: engine.mode };
});
