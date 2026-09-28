// Clears a small target to a known color on the requested GPU path and reads it back through the
// engine. It is the first image test, and it proves that the readback works on both paths.
import { readbackWebGL2, readbackWebGPU } from '@null3d/engine/internal';
import { run, toBase64 } from './lib/result';

const SIZE = 64;
const COLOR: [number, number, number, number] = [0.2, 0.4, 0.6, 1];

async function clearWebGPU(): Promise<{ pixels: Uint8Array; adapter: string }> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	const texture = device.createTexture({
		size: [SIZE, SIZE],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const encoder = device.createCommandEncoder();
	const r = COLOR[0];
	const g = COLOR[1];
	const b = COLOR[2];
	const a = COLOR[3];
	encoder
		.beginRenderPass({
			colorAttachments: [
				{
					view: texture.createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r, g, b, a },
				},
			],
		})
		.end();
	device.queue.submit([encoder.finish()]);
	const pixels = await readbackWebGPU(device, texture);
	const { vendor, architecture, description } = adapter.info;
	device.destroy();
	return { pixels, adapter: [vendor, architecture, description].filter(Boolean).join(' ') };
}

function clearWebGL2(): { pixels: Uint8Array; adapter: string } {
	const gl = new OffscreenCanvas(SIZE, SIZE).getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');
	gl.clearColor(...COLOR);
	gl.clear(gl.COLOR_BUFFER_BIT);
	const pixels = readbackWebGL2(gl, SIZE, SIZE);
	// Read only by the test harness, to refuse a software GPU in real-GPU runs.
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	return { pixels, adapter: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '' };
}

const tier = new URLSearchParams(location.search).get('gpu') === 'webgl2' ? 'webgl2' : 'webgpu';
run('clear', async () => {
	const { pixels, adapter } = tier === 'webgpu' ? await clearWebGPU() : clearWebGL2();
	return { tier, adapter, width: SIZE, height: SIZE, pixels: toBase64(pixels) };
});
