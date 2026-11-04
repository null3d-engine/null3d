// Starts the engine with a still scene and the temporal resolve on, and reads a frame back with
// captureFrame. ?antialias=msaa or none picks the samples per pixel, ?taa=0 starts the resolve off
// and ?jitter=0 keeps the camera still. ?size= sets the canvas, ?wait= the milliseconds before the
// first capture and ?captures= how many frames to read back to back. The page leaves the engine
// drawing, so a test can take a screenshot of the live canvas and turn the resolve off and on
// again while the engine runs.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);

/** The mean red value of a frame's pixels, in 8-bit levels. */
function redMean(pixels: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] as number;
	return sum / (pixels.length / 4);
}

run('taa-capture', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const size = params.get('size');
	const parts = size ? size.split('x').map(Number) : [];
	const width = parts[0] ?? 320;
	const height = parts[1] ?? 180;
	canvas.width = width;
	canvas.height = height;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const sketch = new URL('./sketches/taa-capture-sketch.ts', import.meta.url);
	sketch.search = params.get('taa') === '0' ? '?taa=0' : '?taa=1';
	if (params.get('jitter') === '0') sketch.search += '&jitter=0';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: 'high',
		antialias: (params.get('antialias') ?? 'msaa') as 'msaa' | 'none',
	});
	const failures: string[] = [];
	engine.onFailure(({ code }) => failures.push(code));
	await engine.firstFrame;
	// Let the resolve's history fill, so the frame is steady.
	const wait = Number(params.get('wait') ?? 800);
	if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
	const captures = Math.max(1, Number(params.get('captures') ?? 1));
	let frame = await engine.captureFrame();
	const means = [redMean(frame.pixels)];
	for (let index = 1; index < captures; index++) {
		frame = await engine.captureFrame();
		means.push(redMean(frame.pixels));
	}
	// The frame the live canvas shows, once the run's result is read.
	(globalThis as Record<string, unknown>).__taaCapture = {
		async capture() {
			const next = await engine.captureFrame();
			return { width: next.width, height: next.height, pixels: toBase64(next.pixels) };
		},
		set(on: boolean) {
			engine.postToSketch('taa', on);
		},
		toggle() {
			engine.postToSketch('toggle');
		},
		failures,
	};
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		hdr: engine.capabilities.hdr,
		width: frame.width,
		height: frame.height,
		pixels: toBase64(frame.pixels),
		means,
		failures,
	};
});
