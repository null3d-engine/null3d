// Makes the engine's WebGPU device fail after the start, and reports what the page hears. It draws
// on the page's thread (with ?render=main or ?threads=off), so the page can reach the device: it
// keeps the last device that the page requests, which is the renderer's.
//
// Without a switch, the device makes a buffer larger than any device allows, twice, outside any
// error scope. With ?refuse=always or ?refuse=once, the device refuses to build the pipelines of the
// standard material's template, as a GPU driver that ran out of memory refuses them: every time, or
// only the first build of each. The page then checks that the engine still captures a frame.
import { createEngine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** How long the engine draws before the error, and how long the page waits for a report. */
const DRAW_MS = 300;
const REPORT_MS = 5000;
/** A buffer size past every device's limit. */
const TOO_LARGE = 2 ** 40;
/** The name of the standard material's pipelines, which the refusing device refuses. */
const REFUSED_LABEL = 'mesh lit';

const refuse = new URLSearchParams(location.search).get('refuse');

/** Makes every device refuse the standard material's pipelines: `always`, or the first build of each. */
function refusePipelines(mode: string): void {
	const build = GPUDevice.prototype.createRenderPipelineAsync;
	const refusedOnce = new WeakSet<GPURenderPipelineDescriptor>();
	GPUDevice.prototype.createRenderPipelineAsync = function (
		this: GPUDevice,
		descriptor: GPURenderPipelineDescriptor,
	) {
		if (descriptor.label === REFUSED_LABEL && (mode === 'always' || !refusedOnce.has(descriptor))) {
			refusedOnce.add(descriptor);
			return Promise.reject(
				new GPUPipelineError('CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN', {
					reason: 'internal',
				}),
			);
		}
		return build.call(this, descriptor);
	};
}

run('gpu-errors', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	let device: GPUDevice | undefined;
	const requestDevice = GPUAdapter.prototype.requestDevice;
	GPUAdapter.prototype.requestDevice = async function (
		this: GPUAdapter,
		descriptor?: GPUDeviceDescriptor,
	) {
		device = await requestDevice.call(this, descriptor);
		return device;
	};
	if (refuse) refusePipelines(refuse);
	const engine = await createEngine({
		canvas,
		sketch: refuse
			? new URL('./sketches/boxes-sketch.ts', import.meta.url)
			: new URL('./sketches/empty-sketch.ts', import.meta.url),
	});
	const failures: EngineError[] = [];
	engine.onFailure((error) => {
		failures.push(error);
	});
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	if (!device) throw new Error('the page saw no WebGPU device');
	let captured = false;
	if (refuse) {
		// The engine draws on: a capture waits for every pipeline that still builds, and the refused
		// ones no longer count.
		await engine.capture();
		captured = true;
	} else {
		device.createBuffer({ size: TOO_LARGE, usage: GPUBufferUsage.STORAGE });
		// A second error of the same kind is not reported again.
		device.createBuffer({ size: TOO_LARGE, usage: GPUBufferUsage.STORAGE });
		const deadline = performance.now() + REPORT_MS;
		while (failures.length === 0 && performance.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	await engine.destroy();
	return {
		mode: engine.mode,
		tier: engine.capabilities.tier,
		codes: failures.map((failure) => failure.code),
		messages: failures.map((failure) => failure.message),
		captured,
	};
});
