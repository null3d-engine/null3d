// A device check of the splats add-on's streaming: a large cloud is cut into chunks, and the add-on
// downloads only the chunks that the view needs. It starts the engine live at the preset the engine
// chooses, waits for the sketch's first report, then measures the frames. It reports the splats that
// draw against the budget, the chunks and bytes that arrived, the frame rate and the first-frame
// time. It fails when the draw is over budget, when a chunk stayed unreachable, when the sketch
// reported no figures, or when the measure drew no frame.
// ?splats= sets the cloud's size, ?seconds= the measured time, ?budget= caps the draw below the
// preset's own budget, as the image tests do, and ?stream=0 draws the whole file instead.
import { createEngine } from '@null3d/engine';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** The splats in the cloud unless ?splats= names another count. */
const COUNT = Number(params.get('splats') ?? 400_000);
/** The seconds that the page measures after the first report. */
const SECONDS = Number(params.get('seconds') ?? 3);
/** The draw's cap below the preset's budget, or 0 for the preset's own budget. */
const BUDGET = Number(params.get('budget') ?? 0);
/** Whether the cloud streams from an index, or downloads as one file. */
const STREAM = params.get('stream') !== '0';

/** What the sketch reported about its selection. */
interface SplatFigures {
	total: number;
	drawn: number;
	chunks: number;
	loaded: number;
	failed: number;
	budget: number;
	bytes: number;
	loadedBytes: number;
}

/**
 * The bytes that the page's own threads downloaded, from its resource timings. A worker's loads are
 * not in the page's timeline, so the sketch's own byte figures stand beside this.
 */
function downloadedBytes(): number {
	let bytes = 0;
	for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		bytes += entry.encodedBodySize;
	return bytes;
}

/** Waits for the sketch's report, with a limit, so a page that never reports fails clearly. */
async function reported(
	figures: () => SplatFigures | undefined,
	timeoutMs: number,
): Promise<SplatFigures> {
	const start = Date.now();
	for (;;) {
		const value = figures();
		if (value) return value;
		if (Date.now() - start > timeoutMs)
			throw new Error(`the sketch reported no splat figures within ${timeoutMs} ms`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

run('splats-stream', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const sketch = new URL('./sketches/splats-sketch.ts', import.meta.url);
	sketch.searchParams.set('splats', String(COUNT));
	if (BUDGET > 0) sketch.searchParams.set('budget', String(BUDGET));
	sketch.searchParams.set('stream', STREAM ? '1' : '0');
	const failures: string[] = [];
	const engine = await createEngine({ canvas, sketch });
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	let figures: SplatFigures | undefined;
	engine.onSketchMessage((name, data) => {
		if (name === 'splats') figures = data as SplatFigures;
	});
	await engine.firstFrame;
	const first = await reported(() => figures, 180_000);
	progress(
		`the first report drew ${first.drawn} of ${first.total} splats, with ${first.loadedBytes} of ${first.bytes} bytes of the cloud`,
	);
	const bytesBeforeFirstFrame = downloadedBytes();
	const metrics = await engine.measure(SECONDS);
	const bytesTotal = downloadedBytes();
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	await engine.destroy();
	const drawn = figures ?? first;
	if (drawn.failed > 0)
		throw new Error(
			`${drawn.failed} of the cloud's ${drawn.chunks} chunks stayed unreachable, so the cloud has a hole`,
		);
	if (drawn.drawn > drawn.budget)
		throw new Error(`the draw took ${drawn.drawn} splats, over its budget of ${drawn.budget}`);
	if (metrics.frames === 0)
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	return {
		tier,
		mode,
		streamed: STREAM,
		splats: drawn,
		first: {
			drawn: first.drawn,
			loaded: first.loaded,
			chunks: first.chunks,
			loadedBytes: first.loadedBytes,
			bytes: first.bytes,
		},
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
