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
 * What a GPU failure that the engine draws on after was: the GPU had no room for an object, it
 * rejected a command, or its driver could not build a pipeline that draws objects of the scene.
 */
export type GpuErrorKind = 'memory' | 'rejected' | 'pipeline';

/** Hears a GPU failure that the engine draws on after: its kind, and the GPU path's own text. */
export type GpuErrorReport = (kind: GpuErrorKind, message: string) => void;

const KIND_TEXT: Readonly<Record<GpuErrorKind, string>> = {
	memory: 'the GPU ran out of memory',
	rejected: 'the GPU rejected a command',
	pipeline: "the GPU's driver could not build a pipeline",
};

/**
 * The message of a pipeline that the driver refused twice, as `GpuErrorReport` hears it: the
 * pipeline's name, then the driver's reason, without the browser's lines of where in its code the
 * reason arose.
 */
export function refusalText(pipeline: string, reason: string): string {
	const said = reason.split('\n')[0]?.trim() || 'the driver gave no reason';
	return `${pipeline}, so the objects that draw with it are missing. It failed twice, the second time alone: ${said.replace(/\.$/, '')}`;
}

/** Says a GPU failure when no report was asked for, so that it never goes unheard. */
function logGpuError(kind: GpuErrorKind, message: string): void {
	console.error(`null3D: ${KIND_TEXT[kind]}: ${message}`);
}

/**
 * Reports the first GPU failure of each kind on one device to `report`. Later ones are counted,
 * and development builds say once that more came.
 */
export class GpuReports {
	/** The failures of a kind that was reported already. */
	repeated = 0;
	private readonly reported = { memory: false, rejected: false, pipeline: false };
	private warned = false;

	constructor(private readonly report: GpuErrorReport = logGpuError) {}

	/** Hears a failure of `kind`, with the GPU path's own text. */
	hear(kind: GpuErrorKind, message: string): void {
		if (!this.reported[kind]) {
			this.reported[kind] = true;
			this.report(kind, message);
			return;
		}
		this.repeated++;
		if (DEV && !this.warned) {
			this.warned = true;
			console.warn(`null3D: the GPU reported more failures after the first: ${message}`);
		}
	}
}

/**
 * Listens for a device's uncaptured errors, which cost nothing per frame, and reports them as
 * `GpuReports` does: an error that a `GPUOutOfMemoryError` carries as out of memory, and any other
 * as rejected.
 */
export class GpuErrorWatch extends GpuReports {
	constructor(
		private readonly device: GPUDevice,
		report?: GpuErrorReport,
	) {
		super(report);
		device.onuncapturederror = (event) => {
			const { error } = event;
			// Older browsers, and some workers, lack the class.
			const outOfMemory =
				typeof GPUOutOfMemoryError === 'function' && error instanceof GPUOutOfMemoryError;
			this.hear(outOfMemory ? 'memory' : 'rejected', error.message);
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
