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
	/** Why the WebGPU check failed, when it threw. The WebGL2 check's answer still holds. */
	webgpuError?: string;
}

/**
 * What the probe worker posts: `loaded` as soon as its script runs, then its answer. The page waits
 * for the script without a time limit, so a slow download never reads as a worker that cannot draw.
 */
export type ProbeMessage = 'loaded' | WorkerProbe;

const post = (message: ProbeMessage) => postMessage(message);

async function probe(): Promise<WorkerProbe> {
	const result: WorkerProbe = {
		requestAnimationFrame:
			typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ===
			'function',
		offscreenWebGL2: false,
		offscreenWebGPU: false,
	};
	try {
		const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
		result.offscreenWebGL2 = gl !== null;
		// A browser holds only a few WebGL contexts at once, and frees this one when it collects it.
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	} catch {
		result.offscreenWebGL2 = false;
	}
	try {
		const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
		if (adapter) {
			const device = await adapter.requestDevice();
			const context = new OffscreenCanvas(1, 1).getContext('webgpu');
			if (context) {
				context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
				result.offscreenWebGPU = true;
			}
			device.destroy();
		}
	} catch (e) {
		result.webgpuError = messageOf(e);
	}
	return result;
}

post('loaded');
probe().then(post);
