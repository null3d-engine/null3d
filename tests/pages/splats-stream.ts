// A device check of the splats add-on's streaming: a large cloud is cut into chunks that the draw
// takes as they arrive, and the preset's budget decides how many splats of it draw. It starts the
// engine live at the preset the engine chooses, waits for the first frame, then measures the frames.
// It reports the splats that draw against the budget, the frame rate, the first-frame time, and the
// bytes that the page downloaded before the first frame and in total. It fails when the draw is over
// budget, when the sketch reported no figures, or when the measure drew no frame.
// ?splats= sets the cloud's size, ?seconds= the measured time, and ?budget= caps the draw below the
// preset's own budget, as the image tests do.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** The splats in the cloud unless ?splats= names another count. */
const COUNT = Number(params.get('splats') ?? 400_000);
/** The seconds that the page measures after the first frame. */
const SECONDS = Number(params.get('seconds') ?? 3);
/** The draw's cap below the preset's budget, or 0 for the preset's own budget. */
const BUDGET = Number(params.get('budget') ?? 0);

/** What the sketch reported about its selection. */
interface SplatFigures {
	total: number;
	drawn: number;
	chunks: number;
	budget: number;
}

/**
 * The bytes that the page's own threads downloaded, from its resource timings. A worker's loads are
 * not in the page's timeline, so the engine's own figure of its WebAssembly file comes beside this.
 */
function downloadedBytes(): number {
	let bytes = 0;
	for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		bytes += entry.encodedBodySize;
	return bytes;
}

run('splats-stream', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/splats-sketch.ts', import.meta.url);
	sketch.searchParams.set('splats', String(COUNT));
	if (BUDGET > 0) sketch.searchParams.set('budget', String(BUDGET));
	const failures: string[] = [];
	const engine = await createEngine({ canvas, sketch });
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	let figures: SplatFigures | undefined;
	engine.onSketchMessage((name, data) => {
		if (name === 'splats') figures = data as SplatFigures;
	});
	await engine.firstFrame;
	const bytesBeforeFirstFrame = downloadedBytes();
	progress(
		`the first frame drew, ${figures ? `${figures.drawn} of ${figures.total} splats` : 'with no figures yet'}`,
	);
	const metrics = await engine.measure(SECONDS);
	const bytesTotal = downloadedBytes();
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	await engine.destroy();
	const drawn = figures;
	if (!drawn)
		throw new Error(`the sketch reported no splat figures within the measured ${SECONDS} s`);
	if (drawn.drawn > drawn.budget)
		throw new Error(`the draw took ${drawn.drawn} splats, over its budget of ${drawn.budget}`);
	if (!(metrics.presentedFps > 0))
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	return {
		tier,
		mode,
		splats: drawn,
		cloud: COUNT,
		seconds: metrics.seconds,
		frames: metrics.frames,
		presentedFps: metrics.presentedFps,
		updatedFps: metrics.updatedFps,
		refreshHz: metrics.refreshHz,
		intervalMs: {
			median: metrics.intervalMs.median,
			p95: metrics.intervalMs.p95,
			p99: metrics.intervalMs.p99,
		},
		gpuMs: metrics.gpuMs?.median ?? null,
		gpuPassMs: metrics.gpuPassMs?.map((pass) => ({ name: pass.name, ms: pass.ms.median })) ?? null,
		firstFrameMs: metrics.load.firstFrameMs,
		firstFrameDoneMs: metrics.load.firstFrameDoneMs,
		engineStartMs: metrics.load.engineStartMs,
		wasmBytes: metrics.downloadBytes.wasm,
		bytesBeforeFirstFrame,
		bytesTotal,
		failures,
	};
});
