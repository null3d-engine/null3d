// Runs the WebGPU replay's render pass setup in a loop, for the test that checks that the browser's
// reading of its clear color makes no number objects. Each iteration sets a color target that
// clears to a color of fractions, as the scene pass clears to the background, and hands the setup's
// clear color to `setBlendConstant`. That call reads a color as `beginRenderPass` reads a clear
// color, through the browser's conversion of the dictionary, and makes no object of its own, so
// whatever the loop allocates is the reading's.
import { RenderPassSetup } from '../../packages/engine/src/gpu/webgpu/reusable';
import { run } from './lib/result';

declare global {
	interface Window {
		/** Runs the loop for `iterations` iterations in one render pass. */
		__null3dPassSetupLoop?: (iterations: number) => void;
	}
}

/** A background in fractions, as the draw list gives it, and a depth to clear to. */
const COLOR = Float32Array.of(0.051, 0.106, 0.161, 1, 0);

run('pass-setup', async () => {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	const view = device
		.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT })
		.createView();
	const setup = new RenderPassSetup();
	setup.setColor(view, undefined, false, true, COLOR, 0);
	const loads = (setup.descriptor.colorAttachments as GPURenderPassColorAttachment[])[0];
	const clearsWhenLoading = loads?.clearValue !== undefined;
	window.__null3dPassSetupLoop = (iterations) => {
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass(setup.descriptor);
		const targets = setup.descriptor.colorAttachments as GPURenderPassColorAttachment[];
		for (let i = 0; i < iterations; i++) {
			setup.setColor(view, undefined, true, true, COLOR, 0);
			pass.setBlendConstant((targets[0] as GPURenderPassColorAttachment).clearValue as GPUColor);
		}
		pass.end();
		encoder.finish();
	};
	return { clearsWhenLoading };
});
