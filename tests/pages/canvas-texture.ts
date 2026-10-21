// Starts the engine live with a screen that follows a 1024 x 1024 OffscreenCanvas, and refreshes a
// 256 x 256 rectangle of it at most 30 times a second. It measures the frames while the screen
// moves, then has the sketch draw a fixed picture and upload it whole. Besides the image, it
// reports the bytes that the frames uploaded, which must stay within the preset's budget, and the
// sketch's cost of a refresh: one of the marker's rectangle and one of the whole canvas.
import { createEngine } from '@null3d/engine';
import { watchEngine } from './lib/engine-watch';
import { progress, run, toBase64 } from './lib/result';

/** What the sketch sends once its last upload is on the GPU. */
interface ScreenStats {
	budget: number;
	refreshes: number;
	rectMs: number;
	wholeMs: number;
	rectMiB: number;
	wholeMiB: number;
	largestFrameBytes: number;
	frames: number;
	size: number;
	marker: number;
}

/** Seconds that the page measures while the screen refreshes. */
const MEASURE_SECONDS = 2;
/** The most bytes one frame may upload for the refresh to count as part of the rectangle. */
const PART_BYTES = 512 * 1024;

run('canvas-texture', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stopWatch = watchEngine();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/canvas-texture-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	progress(`engine started: ${engine.mode.latency} latency, ${engine.mode.renderThread} draws`);
	const ready = new Promise<void>((resolve) =>
		engine.onSketchMessage((name) => {
			if (name === 'ready') resolve();
		}),
	);
	const done = new Promise<ScreenStats>((resolve) =>
		engine.onSketchMessage((name, data) => {
			if (name === 'done') resolve(data as ScreenStats);
		}),
	);
	// The setup's whole-canvas uploads finish before the page measures, so the measurement covers
	// the frames that refresh the marker's rectangle alone.
	await ready;
	progress('every upload of the setup is on the GPU');
	engine.postToSketch('start');
	progress('start sent');
	const metrics = await engine.measure(MEASURE_SECONDS);
	progress('measured');
	engine.postToSketch('stop');
	const stats = await done;
	progress('last upload on the GPU');
	const capture = await engine.captureFrame();
	progress('frame captured');
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	const uploads = metrics.uploadBytes;
	const seconds = MEASURE_SECONDS;
	// The refresh rate is a ceiling: no more markers than the rate allows read the canvas. A slow
	// device refreshes less often, which keeps it within the budget too.
	const rateKept = stats.refreshes <= Math.ceil(seconds * 30) + 2;
	const withinBudget = uploads.p99 <= stats.budget;
	// A refresh of the marker's rectangle uploads a quarter of a mebibyte, far below a whole
	// canvas of four.
	const partial = uploads.p99 <= PART_BYTES;
	const rectCost = stats.rectMs / stats.rectMiB;
	const wholeCost = stats.wholeMs / stats.wholeMiB;
	console.log(
		`canvas screen: ${stats.refreshes} refreshes in ${seconds} s, ${(uploads.mean / 1024).toFixed(1)} KiB a frame on average, ${(uploads.p99 / 1024).toFixed(1)} KiB at p99, budget ${(stats.budget / 1024).toFixed(0)} KiB`,
	);
	console.log(
		`refresh cost: ${stats.rectMs.toFixed(2)} ms for ${stats.rectMiB} MiB of rectangle (${rectCost.toFixed(2)} ms/MiB), ${stats.wholeMs.toFixed(2)} ms for ${stats.wholeMiB} MiB whole (${wholeCost.toFixed(2)} ms/MiB)`,
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		budget: stats.budget,
		refreshes: stats.refreshes,
		frames: stats.frames,
		rectMs: stats.rectMs,
		wholeMs: stats.wholeMs,
		uploadMiB: uploads.mean / (1024 * 1024),
		uploadP99KiB: uploads.p99 / 1024,
		largestFrameBytes: stats.largestFrameBytes,
		withinBudget,
		partial,
		rateKept,
		refreshed: stats.refreshes >= 2,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
