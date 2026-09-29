// Signals that the browser took the GPU away from a renderer. A renderer that releases its own GPU
// on purpose never signals, so shutting the engine down is not reported as a loss. Neither signal
// keeps a released renderer, and the engine memory it reads, reachable: the page's canvas and the
// GPU device outlive the renderer.

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

/** Both names of each context event: an offscreen canvas and a canvas element name them apart. */
const LOST_EVENTS = ['contextlost', 'webglcontextlost'];
const RESTORED_EVENTS = ['contextrestored', 'webglcontextrestored'];

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
