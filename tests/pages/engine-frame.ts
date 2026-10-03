// Starts the engine in a frame of the shared memory page, as an app's page in a frame would, and
// tells the page once the engine has drawn its first frame. With ?stop=destroy it stops the engine
// first. Otherwise the engine still runs when the page removes the frame, as when a visitor leaves
// a page that never stops its engine. Opened on its own, the page publishes the same message on
// window, and its trail notes each worker's replies. The page that holds the frame can read the
// engine's control slots, to learn which thread a start that never ends waits for, and it hears how
// many job workers were still inside the job loop when the frame's page left.
import { createEngine, EngineError } from '@null3d/engine';
import * as Slot from '../../packages/engine/src/shared/slot';
import { progress } from './lib/result';

declare global {
	interface Window {
		__engineFrame?: EngineFrameMessage;
		/** The engine's control slots by name, once the page has sent them to a worker. */
		__engineFrameSlots?: () => string;
		/** The job workers inside the job loop as each frame's page left, on the holding page. */
		__jobsServingAtLeave?: number[];
	}
}

/** The engine's control block, from the first message to a worker that carries it. */
let control: SharedArrayBuffer | undefined;
const post = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
	const sent = (message as { control?: unknown } | null)?.control;
	if (!control && sent instanceof SharedArrayBuffer) control = sent;
	return (post as (...args: unknown[]) => void).call(this, message, ...rest);
};
window.__engineFrameSlots = () => {
	if (!control) return 'no control block yet';
	const slots = new Int32Array(control);
	return Object.entries(Slot)
		.map(([name, slot]) => `${name} ${Atomics.load(slots, slot)}`)
		.join(', ');
};

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
	} else {
		// Runs after the engine's own handler, which ends the job workers' loops and waits a moment.
		addEventListener('pagehide', () => {
			if (control)
				parent.__jobsServingAtLeave?.push(Atomics.load(new Int32Array(control), Slot.JobsServing));
		});
		tell({ engineFrame: 'running' });
	}
} catch (e) {
	tell({
		engineFrame: 'failed',
		error: (e as Error).message,
		code: e instanceof EngineError ? e.code : undefined,
	});
}
