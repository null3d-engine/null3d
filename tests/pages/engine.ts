// Starts the engine with an empty sketch in the mode the URL's switches ask for, on the GPU that
// ?power prefers, and measures it for a few seconds. Then it reports the mode, the capabilities,
// the frame metrics, how many times the sketch updated, its largest step, the names of the
// messages it sent, how long the engine took to stop, and the page's steps. With ?pause, it pauses
// and resumes the sketch before it asks, and reports the frames drawn during the pause and after.
// It also reports when it called createEngine, from navigation start, which places the engine's
// own start times on the page's timeline. With ?memory-option=<MiB>, it passes that maximum in the
// memory option of createEngine, and reports the maximum of each shared memory that the engine
// asked the browser for. With ?downloads, it reports when the page asked for each file and when the
// file arrived, from the browser's resource timing.
import { createEngine, type Engine, type FrameMetrics } from '@null3d/engine';
import type { FrameCounts } from '../lib/engine-checks';
import { progress, run, toBase64 } from './lib/result';

const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? '2');
/** How long `?pause` pauses the sketch. */
const PAUSE_MS = 600;
/**
 * Time for a frame that was under way when the pause began to reach the screen, before the page
 * counts the frames of the pause.
 */
const SETTLE_MS = 100;
/** How long the page counts frames after the sketch resumes. */
const RESUMED_MS = 500;
/** The maximum that ?memory-option= asks the page to pass in createEngine's memory option. */
const memoryOption = params.has('memory-option') ? Number(params.get('memory-option')) : undefined;

/**
 * Records the maximum in MiB of each shared memory that the page creates from now on, as the
 * browser is asked for it.
 */
function recordSharedMemories(): number[] {
	const maxima: number[] = [];
	WebAssembly.Memory = new Proxy(WebAssembly.Memory, {
		construct(target, args: [WebAssembly.MemoryDescriptor]) {
			const [{ shared, maximum }] = args;
			if (shared && maximum !== undefined) maxima.push(maximum / 16);
			return Reflect.construct(target, args);
		},
	});
	return maxima;
}

const frameCounts = (stats: FrameMetrics): FrameCounts => ({
	frames: stats.frames,
	presented: stats.intervalMs.count,
});

/**
 * Pauses the sketch, resumes it, and counts the frames drawn during the pause and after it. The
 * sketch must not see the pause as one long step, and nothing may be drawn during it.
 */
async function pauseAndCount(engine: Engine) {
	engine.setPaused(true);
	await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
	const paused = await engine.measure((PAUSE_MS - SETTLE_MS) / 1000);
	engine.setPaused(false);
	const resumed = await engine.measure(RESUMED_MS / 1000);
	return { paused: frameCounts(paused), resumed: frameCounts(resumed) };
}

run('engine', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const stages: string[] = [];
	const sharedMemoryMiB = memoryOption === undefined ? undefined : recordSharedMemories();
	const createEngineAtMs = performance.now();
	const engine = await createEngine({
		canvas,
		sketch: new URL('./sketches/empty-sketch.ts', import.meta.url),
		onProgress: (stage) => {
			stages.push(stage);
			progress(stage);
		},
		powerPreference: (params.get('power') ?? undefined) as
			| 'high-performance'
			| 'low-power'
			| undefined,
		memory: memoryOption === undefined ? undefined : { maximumMiB: memoryOption },
	});
	await engine.firstFrame;
	const stats = await engine.measure(seconds);
	const pause = params.has('pause') ? await pauseAndCount(engine) : undefined;
	const messages: string[] = [];
	const count = await new Promise<unknown>((resolve) => {
		engine.onSketchMessage((name, data) => {
			messages.push(name);
			if (name === 'count') resolve(data);
		});
		engine.postToSketch('count');
	});
	const capture = params.has('capture') ? await engine.captureFrame() : undefined;
	const stopStarted = performance.now();
	await engine.destroy();
	const stopMs = performance.now() - stopStarted;
	return {
		mode: engine.mode,
		capabilities: engine.capabilities,
		report: engine.report,
		createEngineAtMs,
		stats,
		stages,
		messages,
		count,
		pause,
		stopMs,
		sharedMemoryMiB,
		downloads: params.has('downloads')
			? (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map(
					({ name, startTime, responseEnd }) => ({ name, startTime, responseEnd }),
				)
			: undefined,
		trail: window.__null3dProgress,
		capture: capture && {
			width: capture.width,
			height: capture.height,
			pixels: toBase64(capture.pixels),
		},
	};
});
