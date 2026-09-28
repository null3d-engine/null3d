// Signals that the browser took the GPU away from a renderer. A renderer that releases its own GPU
// on purpose never signals, so shutting the engine down is not reported as a loss.

/** A promise that never settles. */
const NEVER = new Promise<string>(() => {});

/** Resolves with the browser's reason when the device is lost, unless the renderer destroyed it. */
export function deviceLoss(device: GPUDevice): Promise<string> {
	return device.lost.then((info) =>
		info.reason === 'destroyed' ? NEVER : info.message || 'the GPU device was lost',
	);
}

/**
 * Resolves when the browser takes the WebGL2 context away, unless `released` says the renderer
 * gave it up itself.
 */
export function contextLoss(
	canvas: OffscreenCanvas | HTMLCanvasElement,
	released: () => boolean,
): Promise<string> {
	return new Promise((resolve) => {
		const onLost = (event: Event) => {
			// Without this, the browser never offers the context back.
			event.preventDefault();
			if (!released()) resolve('the WebGL2 context was lost');
		};
		// An offscreen canvas names the event contextlost; a canvas element names it webglcontextlost.
		const target = canvas as EventTarget;
		target.addEventListener('contextlost', onLost);
		target.addEventListener('webglcontextlost', onLost);
	});
}
