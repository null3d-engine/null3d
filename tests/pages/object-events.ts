// Starts the engine with a sketch whose objects take pointer events, then offers
// `objectEvents(message)` on the window. It sends the sketch a message ('listen', 'unlisten', 'pan'
// or any other to only ask) and resolves with the sketch's reply: the lines its handlers wrote, the
// rays that pointer events cast, and the clicks during the pan. The object events test drives the
// mouse and the touch screen over the canvas in each thread mode and on each GPU path. With
// `?setup`, the page starts a sketch whose setup waits with one of its frames on screen. The page
// sets `objectEventsSetup` on the window once the setup waits, and `objectEventsSetup.go()` lets
// it go on. They talk through a broadcast channel, since the engine's start waits for the setup.
// `__null3dSetPaused(paused)` pauses the engine, so no frame runs while the test samples the loop.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		objectEvents?: (message: string) => Promise<unknown>;
		objectEventsSetup?: { go: () => void };
		__null3dSetPaused?: (paused: boolean) => void;
	}
}

run('object-events', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const setup = new URLSearchParams(location.search).has('setup');
	if (setup) {
		const channel = new BroadcastChannel('object-events-setup');
		channel.onmessage = () => {
			window.objectEventsSetup = { go: () => channel.postMessage('go') };
		};
	}
	const engine = await createEngine({
		canvas,
		sketch: setup
			? new URL('./sketches/object-events-setup-sketch.ts', import.meta.url)
			: new URL('./sketches/object-events-sketch.ts', import.meta.url),
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
	window.__null3dSetPaused = (paused) => engine.setPaused(paused);
	return { mode: engine.mode };
});
