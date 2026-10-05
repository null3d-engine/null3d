// Makes the engine's WebGPU device reject a command after the start, outside any error scope, and
// reports what the page hears. It draws on the page's thread (with ?render=main or ?threads=off),
// so the page can reach the device: it keeps the last device that the page requests, which is the
// renderer's. The device then makes a buffer larger than any device allows, twice.
import { createEngine, type EngineError } from '@null3d/engine';
import { run } from './lib/result';

/** How long the engine draws before the error, and how long the page waits for a report. */
const DRAW_MS = 300;
const REPORT_MS = 5000;
/** A buffer size past every device's limit. */
const TOO_LARGE = 2 ** 40;

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
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
	});
	const failures: EngineError[] = [];
	engine.onFailure((error) => {
		failures.push(error);
	});
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	if (!device) throw new Error('the page saw no WebGPU device');
	device.createBuffer({ size: TOO_LARGE, usage: GPUBufferUsage.STORAGE });
	// A second error of the same kind is not reported again.
	device.createBuffer({ size: TOO_LARGE, usage: GPUBufferUsage.STORAGE });
	const deadline = performance.now() + REPORT_MS;
	while (failures.length === 0 && performance.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 100));
	await new Promise((resolve) => setTimeout(resolve, DRAW_MS));
	await engine.destroy();
	return {
		mode: engine.mode,
		tier: engine.capabilities.tier,
		codes: failures.map((failure) => failure.code),
	};
});
