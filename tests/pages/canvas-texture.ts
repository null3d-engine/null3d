// Starts the engine live with a screen that follows a 1024 x 1024 OffscreenCanvas, and refreshes a
// 256 x 256 rectangle of it at most 30 times a second. It measures the frames while the screen
// moves, then has the sketch upload a fixed base whole and refresh one rectangle of it, which the
// captured picture shows. A second window with no refresh tells the upload's share of the frame's
// cost. Besides the image, it reports the bytes that the frames uploaded, which must stay within
// the preset's budget, and the sketch's cost of a refresh: one of the marker's rectangle and one
// of the whole canvas.
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
	/** The part of the canvas's size that the engine drew the scene at. */
	renderScale: number;
}

/** Seconds that one measured window covers. */
const MEASURE_SECONDS = 2;
/** The fewest frames a window must hold, so a slow GPU still gives the screen several refreshes. */
const LEAST_FRAMES = 8;
/** The most seconds the page measures for: a loaded software GPU may take seconds over a frame. */
const MEASURE_CAP_SECONDS = 30;
/** True when two frames hold the same pixels. */
function samePixels(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false;
	return true;
}

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
	// A window that holds a frame or two measures the refresh by chance: a software GPU can take
	// seconds over one frame, and the rectangle path then never comes round. The window doubles
	// until it holds enough frames, the last, longest window standing for the screen, and the rate
	// check counts every second that the page measured.
	let window = MEASURE_SECONDS;
	let metrics = await engine.measure(window);
	let seconds = window;
	while (metrics.frames < LEAST_FRAMES && seconds < MEASURE_CAP_SECONDS) {
		window *= 2;
		metrics = await engine.measure(window);
		seconds += window;
	}
	progress('measured');
	engine.postToSketch('stop');
	const stats = await done;
	progress('last upload on the GPU');
	// A window with the same drawing and no refresh tells the upload's share of the frame's cost
	// from everything else in it. It stays short, because a slow GPU would spend as long again as
	// the refresh window, and the comparison needs only a few of its frames.
	const idle = await engine.measure(Math.min(window, 4));
	progress('idle window measured');
	// A slow GPU may draw the last rows of the canvas a frame or two after the sketch sees them
	// land. Every thread mode must draw the same picture, so the capture waits until two frames
	// agree rather than reading whichever frame comes first.
	let capture = await engine.captureFrame();
	for (let tryAgain = 0; tryAgain < 4; tryAgain++) {
		const next = await engine.captureFrame();
		if (samePixels(next.pixels, capture.pixels)) break;
		capture = next;
	}
	progress('frame captured');
	await engine.destroy();
	progress('engine destroyed');
	stopWatch();
	const uploads = metrics.uploadBytes;
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
	const gpuMs = metrics.gpuMs?.median ?? null;
	const gpuIdleMs = idle.gpuMs?.median ?? null;
	console.log(
		`frame cost with refreshes and without: GPU ${gpuMs === null ? 'none' : gpuMs.toFixed(3)} ms and ${gpuIdleMs === null ? 'none' : gpuIdleMs.toFixed(3)} ms, CPU ${metrics.cpuMs.median.toFixed(3)} ms and ${idle.cpuMs.median.toFixed(3)} ms, interval ${metrics.intervalMs.median.toFixed(2)} ms and ${idle.intervalMs.median.toFixed(2)} ms`,
	);
	return {
		tier: engine.capabilities.tier,
		mode: engine.mode,
		budget: stats.budget,
		refreshes: stats.refreshes,
		frames: stats.frames,
		intervalMs: metrics.intervalMs.median,
		idleIntervalMs: idle.intervalMs.median,
		gpuMs,
		gpuIdleMs,
		cpuMs: metrics.cpuMs.median,
		cpuIdleMs: idle.cpuMs.median,
		rectMs: stats.rectMs,
		wholeMs: stats.wholeMs,
		uploadMiB: uploads.mean / (1024 * 1024),
		uploadP99KiB: uploads.p99 / 1024,
		largestFrameBytes: stats.largestFrameBytes,
		renderScale: stats.renderScale,
		withinBudget,
		partial,
		rateKept,
		refreshed: stats.refreshes >= 2,
		width: capture.width,
		height: capture.height,
		pixels: toBase64(capture.pixels),
	};
});
