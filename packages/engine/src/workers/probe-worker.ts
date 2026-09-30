// A short-lived worker that tests what a dedicated worker can do: the worker frame timer, WebGL2 in
// an OffscreenCanvas, and WebGPU with a canvas context. The render worker depends on all three.

import { messageOf } from '../errors/message';

/**
 * What a dedicated worker can do, in `CapabilityReport.worker`. A render worker needs the frame
 * timer and an offscreen canvas for its GPU path.
 *
 * @category api/engine
 */
export interface WorkerProbe {
	/** True when workers have `requestAnimationFrame`. */
	requestAnimationFrame: boolean;
	/** True when a worker can draw with WebGL2 into an `OffscreenCanvas`. */
	offscreenWebGL2: boolean;
	/** True when a worker can draw with WebGPU into an `OffscreenCanvas`. */
	offscreenWebGPU: boolean;
	/** Why the probe failed, when it did. */
	error?: string;
}

async function probe(): Promise<WorkerProbe> {
	const result: WorkerProbe = {
		requestAnimationFrame:
			typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ===
			'function',
		offscreenWebGL2: false,
		offscreenWebGPU: false,
	};
	try {
		result.offscreenWebGL2 = new OffscreenCanvas(4, 4).getContext('webgl2') !== null;
	} catch {
		result.offscreenWebGL2 = false;
	}
	try {
		const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
		if (adapter) {
			const device = await adapter.requestDevice();
			const context = new OffscreenCanvas(4, 4).getContext('webgpu');
			if (context) {
				context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
				result.offscreenWebGPU = true;
			}
			device.destroy();
		}
	} catch (e) {
		result.error =
			messageOf(e) ||
			'The worker probe failed without a message while it tested the frame timer, WebGL2 and WebGPU in an offscreen canvas. Open the browser console of the worker for the cause.';
	}
	return result;
}

probe().then((result) => postMessage(result));
