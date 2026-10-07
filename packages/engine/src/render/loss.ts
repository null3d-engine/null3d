// Signals that the browser took the GPU away from a renderer. A renderer that releases its own GPU
// on purpose never signals, so shutting the engine down is not reported as a loss. Neither signal
// keeps a released renderer, and the engine memory it reads, reachable: the page's canvas and the
// GPU device outlive the renderer. WebGPU errors that the device reports later, outside any error
// scope, are heard here too.

import { LOST_EVENTS, RESTORED_EVENTS } from '../gpu/webgl2/context';
import { DEV } from '../shared/dev';

/** How long a lost WebGL2 context may take to come back before the engine gives up on it. */
const RESTORE_TIMEOUT_MS = 5000;

/**
 * Resolves with the browser's reason when the device is lost. A device the renderer destroyed
 * itself never signals, unless `simulated` says it did so to act out a loss.
 */
export function deviceLoss(device: GPUDevice, simulated: () => boolean): Promise<string> {
	return new Promise((resolve) => {
		void device.lost.then((info) => {
			if (info.reason !== 'destroyed' || simulated())
				resolve(info.message || 'the GPU device was lost');
		});
	});
}

/**
 * Resolves when the browser takes the WebGL2 context away. Once `released` aborts, as when the
 * renderer gives the context up itself, it stops listening and never resolves.
 */
export function contextLoss(
	canvas: OffscreenCanvas | HTMLCanvasElement,
	released: AbortSignal,
): Promise<string> {
	return new Promise((resolve) => {
		const onLost = (event: Event) => {
			// Without this, the browser never offers the context back.
			event.preventDefault();
			resolve('the WebGL2 context was lost');
		};
		for (const name of LOST_EVENTS)
			(canvas as EventTarget).addEventListener(name, onLost, { signal: released });
	});
}

/** Waits until a lost WebGL2 context comes back, and fails if it does not in time. */
export function contextRestored(gl: WebGL2RenderingContext): Promise<void> {
	if (!gl.isContextLost()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const target = gl.canvas as EventTarget;
		const done = () => {
			clearTimeout(timer);
			for (const name of RESTORED_EVENTS) target.removeEventListener(name, done);
			resolve();
		};
		const timer = setTimeout(() => {
			for (const name of RESTORED_EVENTS) target.removeEventListener(name, done);
			reject(new Error('the WebGL2 context did not come back'));
		}, RESTORE_TIMEOUT_MS);
		for (const name of RESTORED_EVENTS) target.addEventListener(name, done);
	});
}

/**
 * Hears a WebGPU error that no error scope caught: with `outOfMemory`, the GPU had no room for an
 * object, else it rejected a command. `message` is the GPU path's own text.
 */
export type GpuErrorReport = (outOfMemory: boolean, message: string) => void;

/** Says a GPU error when no report was asked for, so that it never goes unheard. */
function logGpuError(outOfMemory: boolean, message: string): void {
	console.error(
		`null3D: ${outOfMemory ? 'the GPU ran out of memory' : 'the GPU rejected a command'}: ${message}`,
	);
}

/**
 * Listens for a device's uncaptured errors, which cost nothing per frame. The first error of each
 * kind, out of memory or rejected, goes to `report`. Later ones are counted, and development
 * builds say once that more came.
 */
export class GpuErrorWatch {
	/** The errors of a kind that was reported already. */
	repeated = 0;
	private reported = { outOfMemory: false, rejected: false };
	private warned = false;

	constructor(
		private readonly device: GPUDevice,
		report: GpuErrorReport = logGpuError,
	) {
		device.onuncapturederror = (event) => {
			const { error } = event;
			// Older browsers, and some workers, lack the class.
			const outOfMemory =
				typeof GPUOutOfMemoryError === 'function' && error instanceof GPUOutOfMemoryError;
			const kind = outOfMemory ? 'outOfMemory' : 'rejected';
			if (!this.reported[kind]) {
				this.reported[kind] = true;
				report(outOfMemory, error.message);
				return;
			}
			this.repeated++;
			if (DEV && !this.warned) {
				this.warned = true;
				console.warn(`null3D: the GPU reported more errors after the first: ${error.message}`);
			}
		};
	}

	/**
	 * Stops listening, for a renderer that is destroyed. A page can keep a device reachable after
	 * the engine stops, and the listener would keep the engine's memory with it.
	 */
	stop(): void {
		this.device.onuncapturederror = null;
	}
}
