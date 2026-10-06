// A frame of the frame memory probe. It makes one shared memory and holds it the way ?hold= says,
// then tells the page that holds the frame, which removes the frame and learns whether the browser
// gets the memory back. With a hold whose name ends in -released, the frame lets go of what holds
// the memory as its page leaves: it ends its worker, or stops drawing and gives its WebGL2 context
// up. ?unit= sets the memory's maximum in MiB.
import type { FrameMemoryWorkerMessage } from './lib/frame-memory-worker';

declare global {
	interface Window {
		/** What the frame holds, for the page's weak references. */
		__probeHeld?: { sentinel: object; memory?: WebAssembly.Memory; worker?: Worker };
		/** The page's beat counter, one word for each worker of each frame. */
		__probeBeats?: SharedArrayBuffer;
	}
}

/** The message that the frame sends the page that holds it. */
export interface ProbeFrameMessage {
	probeFrame: 'ready' | 'failed';
	error?: string;
}

const params = new URLSearchParams(location.search);
const hold = params.get('hold') ?? 'page';
const unit = Number(params.get('unit') ?? 256);
const beat = Number(params.get('beat') ?? 0);
const released = hold.endsWith('-released');

const tell = (message: ProbeFrameMessage) => parent.postMessage(message, location.origin);

function workerHolds(memory: WebAssembly.Memory, how: FrameMemoryWorkerMessage['hold']): Worker {
	const worker = new Worker(new URL('./lib/frame-memory-worker.ts', import.meta.url), {
		type: 'module',
	});
	const beats = parent.__probeBeats;
	if (!beats) throw new Error('the page has no beat counter');
	const canvas =
		how === 'webgl' ? document.querySelector('canvas')?.transferControlToOffscreen() : undefined;
	const message: FrameMemoryWorkerMessage = { memory, beats, beat, hold: how, canvas };
	worker.postMessage(message, canvas ? [canvas] : []);
	if (released) addEventListener('pagehide', () => worker.terminate());
	return worker;
}

function pageDraws(memory: WebAssembly.Memory): void {
	const canvas = document.querySelector('canvas');
	const gl = canvas?.getContext('webgl2');
	if (!canvas || !gl) throw new Error('the frame has no WebGL2 context');
	const kept: number[] = [];
	const onLost = (event: Event) => {
		event.preventDefault();
		kept.push(memory.buffer.byteLength);
	};
	canvas.addEventListener('webglcontextlost', onLost);
	let frame = 0;
	let request = 0;
	const draw = () => {
		frame++;
		gl.clearColor((frame % 60) / 60, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		request = requestAnimationFrame(draw);
	};
	request = requestAnimationFrame(draw);
	if (released)
		addEventListener('pagehide', () => {
			cancelAnimationFrame(request);
			canvas.removeEventListener('webglcontextlost', onLost);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		});
}

try {
	const memory = new WebAssembly.Memory({ initial: 18, maximum: unit * 16, shared: true });
	const sentinel = {};
	const kind = hold.replace(/-released$/, '');
	if (kind === 'page') window.__probeHeld = { sentinel, memory };
	else if (kind === 'page-webgl') {
		pageDraws(memory);
		window.__probeHeld = { sentinel };
	} else if (kind === 'worker' || kind === 'worker-waitasync' || kind === 'worker-webgl') {
		const how = kind === 'worker' ? 'idle' : kind === 'worker-waitasync' ? 'waitasync' : 'webgl';
		const worker = workerHolds(memory, how);
		await new Promise((resolve, reject) => {
			worker.onmessage = resolve;
			worker.onerror = (event) => reject(new Error(`the worker failed: ${event.message}`));
		});
		worker.onmessage = null;
		worker.onerror = null;
		window.__probeHeld = { sentinel, worker };
	} else throw new Error(`no hold named ${hold}`);
	tell({ probeFrame: 'ready' });
} catch (e) {
	tell({ probeFrame: 'failed', error: (e as Error).message });
}
