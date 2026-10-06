// Starts the engine with a small static scene in the mode and on the GPU path the switches ask for,
// and captures the drawn frame through the engine. With ?hold, the engine's hold mode draws the
// frame. Without it, the page measures the engine's frames for a second first. With ?lose-gpu, it
// also acts out a loss of the GPU before that, so the capture shows the scene the engine drew again
// on a new device. ?sketch= draws another sketch module, by its path from this page, with the
// sketch's own query after it. ?stop-after= sets a pause in ms between the capture and the stop,
// while the engine goes on drawing. ?frames= sets the fewest frames to measure: the page measures
// again until its measurements hold that many, so a slow runner still gives a test enough frames.
import { createEngine, type Engine, type FrameMetrics } from '@null3d/engine';
import { measureUntil } from './lib/measure';
import { run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '1');
const stopAfterMs = Number(params.get('stop-after') ?? '0');
const minFrames = Number(params.get('frames') ?? '0');
/** How long the engine has to start a new device and draw again after a loss. */
const RECOVERY_MS = 1000;
/**
 * The most times the page doubles its measurement to reach the fewest frames: from one second, the
 * measurements then take 15 seconds in all, within the test's wait.
 */
const MAX_DOUBLINGS = 3;

/**
 * Measures the engine's frames until the measurements hold the fewest frames. The frames and the
 * rebuilds add up over the measurements; the other figures are the first measurement's.
 */
async function measureFrames(engine: Engine): Promise<FrameMetrics> {
	let stats: FrameMetrics | undefined;
	await measureUntil(
		engine,
		seconds,
		MAX_DOUBLINGS,
		(more) => {
			if (!stats) stats = more;
			else {
				stats.frames += more.frames;
				stats.rebuilds += more.rebuilds;
			}
		},
		() => (stats?.frames ?? 0) >= minFrames,
	);
	if (!stats) throw new Error('the page took no measurement');
	return stats;
}

run('scene', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const engine = await createEngine({
		canvas,
		sketch: new URL(params.get('sketch') ?? './sketches/boxes-sketch.ts', import.meta.url),
		maxPixelRatio: 1,
	});
	const failures: string[] = [];
	engine.onFailure((error) => failures.push(`${error.code} ${error.message}`));
	const live = engine.mode.hold === null;
	if (live && params.has('lose-gpu')) {
		await engine.measure(seconds);
		engine.simulateGpuLoss();
		await new Promise((resolve) => setTimeout(resolve, RECOVERY_MS));
	}
	const stats = live ? await measureFrames(engine) : undefined;
	const capture = await engine.captureFrame();
	if (stopAfterMs > 0) await new Promise((resolve) => setTimeout(resolve, stopAfterMs));
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
