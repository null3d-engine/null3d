// A short-lived worker that tests what a dedicated worker can do: the worker frame timer, WebGL2 in
// an OffscreenCanvas, and WebGPU with a canvas context. The render worker depends on all three.

export interface WorkerProbe {
	requestAnimationFrame: boolean;
	offscreenWebGL2: boolean;
	offscreenWebGPU: boolean;
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
		result.error = e instanceof Error ? e.message : String(e);
	}
	return result;
}

probe().then((result) => postMessage(result));
