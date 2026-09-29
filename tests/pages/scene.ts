// Starts the engine with a small static scene, lets it draw a few frames, measures it, and
// captures the drawn frame through the engine, in the mode and on the GPU path the switches ask for.
// With ?lose-gpu, it first acts out a loss of the GPU, so the capture shows the scene the engine drew
// again on a new device.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '1');
/** How long the engine has to start a new device and draw again after a loss. */
const RECOVERY_MS = 1000;

run('scene', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/boxes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(error.code));
	if (params.has('lose-gpu')) {
		await engine.measure(seconds);
		engine.simulateGpuLoss();
		await new Promise((resolve) => setTimeout(resolve, RECOVERY_MS));
	}
	const stats = await engine.measure(seconds);
	const capture = await engine.captureFrame();
	await engine.destroy();
	return {
		mode: engine.mode,
		capabilities: engine.capabilities,
		stats,
		failures,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
