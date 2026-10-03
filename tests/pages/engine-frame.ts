// Starts the engine in a frame of the shared memory page, as an app's page in a frame would, and
// tells the page once the engine has drawn its first frame. With ?stop=destroy it stops the engine
// first. Otherwise the engine still runs when the page removes the frame, as when a visitor leaves
// a page that never stops its engine. Opened on its own, the page publishes the same message on
// window, and its trail notes each worker's replies.
import { createEngine, EngineError } from '@null3d/engine';
import { progress } from './lib/result';

declare global {
	interface Window {
		__engineFrame?: EngineFrameMessage;
	}
}

/** The message that the frame sends the page that holds it. */
export interface EngineFrameMessage {
	engineFrame: 'running' | 'stopped' | 'failed';
	error?: string;
	code?: string;
}

const tell = (message: EngineFrameMessage) => {
	window.__engineFrame = message;
	parent.postMessage(message, location.origin);
};

try {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
		onProgress: progress,
	});
	await engine.firstFrame;
	progress('first frame');
	if (new URLSearchParams(location.search).get('stop') === 'destroy') {
		await engine.destroy();
		tell({ engineFrame: 'stopped' });
	} else tell({ engineFrame: 'running' });
} catch (e) {
	tell({
		engineFrame: 'failed',
		error: (e as Error).message,
		code: e instanceof EngineError ? e.code : undefined,
	});
}
