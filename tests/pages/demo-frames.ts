// Times a demo of examples/ as a person plays it: it starts the demo live at the preset that the
// page's own switches ask for, waits for the first frame, then measures the frames. It reports the
// preset and the mode the engine ran, the frame rate, the first-frame time and the bytes that the
// page downloaded before the first frame and in total. ?demo= names the demo, ?seconds= the measured
// time. It fails when the measure drew no frame.
import { DEMOS } from '../../examples/demos';
import { startDemo } from '../../examples/lib/run';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** The seconds that the page measures after the first frame. */
const SECONDS = Number(params.get('seconds') ?? 5);
/** How long the page waits for the preset check's result before it measures anyway. */
const CHECK_WAIT_MS = 30_000;
/**
 * The shadow shape that the page fixes at the engine's start, for a measurement: the cascade
 * count, map size, tile atlas, hero tile and morph cap that each preset gives.
 */
const SHADOW_SHAPE = params.get('shadow-shape');
const SHADOW_SETTINGS =
	SHADOW_SHAPE === 'medium'
		? {
				shadowCascades: 3,
				shadowMapSize: 2048,
				shadowTiles: 8,
				heroTileSize: 2048,
				morphTargets: 16,
			}
		: SHADOW_SHAPE === 'low'
			? {
					shadowCascades: 2,
					shadowMapSize: 1024,
					shadowTiles: 4,
					heroTileSize: 1024,
					morphTargets: 8,
				}
			: undefined;
if (SHADOW_SHAPE !== null && SHADOW_SETTINGS === undefined)
	throw new Error(`the page takes no shadow shape ${SHADOW_SHAPE}`);

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

run('demo-frames', async () => {
	const name = params.get('demo');
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (!demo) throw new Error(`Add ?demo= with the name of a demo, not ${name}.`);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	// The demo's own cost switches reach its sketch, as the device page passes them.
	const sketch = new URL(demo.sketch);
	for (const id of [
		'morph',
		'still',
		'follow',
		'mood',
		'storm',
		'lens',
		'governor',
		'render-scale',
		'without',
	])
		if (params.has(id)) sketch.searchParams.set(id, params.get(id) ?? '');
	const runDemo = { ...demo, sketch };
	const failures: string[] = [];
	// No stats overlay: its sampling would take frames that this page measures.
	const engine = await startDemo({
		canvas,
		demo: runDemo,
		stats: false,
		settings: SHADOW_SETTINGS,
	});
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	const bytesBeforeFirstFrame = downloadedBytes();
	progress('the first frame drew');
	// The preset check draws its rounds after the first frame, and a lowering rebuilds the scene's
	// settings. Wait for its result, so the measure covers the preset the session runs rather than
	// the check's own frames. A page that names its preset checks nothing.
	if (!params.has('preset')) {
		const limit = performance.now() + CHECK_WAIT_MS;
		while (engine.mode.presetCheck === null && performance.now() < limit)
			await new Promise((resolve) => setTimeout(resolve, 50));
	}
	// The frame figures' code loads on the measure's first use. A tunnel can fail that one request
	// and take the measure with it, so warm it in a very short measure that is not reported, and
	// try the timed measure once more if its first attempt fails.
	await engine.measure(0.05).catch(() => undefined);
	const metrics = await engine.measure(SECONDS).catch(async (error) => {
		progress(`the measure failed (${(error as Error).message}); trying once more`);
		await new Promise((resolve) => setTimeout(resolve, 1000));
		return engine.measure(SECONDS);
	});
	const bytesTotal = downloadedBytes();
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	const directDraws = engine.capabilities.directDraws;
	await engine.destroy();
	if (!(metrics.presentedFps > 0))
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	return {
		tier,
		mode,
		directDraws,
		demo: demo.name,
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
		firstFrameMs: metrics.load.firstFrameMs,
		firstFrameDoneMs: metrics.load.firstFrameDoneMs,
		engineStartMs: metrics.load.engineStartMs,
		// The GPU's own split of the frame, where the device times passes.
		gpuMs: metrics.gpuMs,
		gpuStepMs: metrics.gpuStepMs,
		gpuPassMs: metrics.gpuPassMs,
		cpuMs: metrics.cpuMs,
		drawCalls: metrics.drawCalls,
		// The engine's own stages of the start, so a slow first frame names its one-time cost.
		load: metrics.load,
		wasmBytes: metrics.downloadBytes.wasm,
		bytesBeforeFirstFrame,
		bytesTotal,
		failures,
	};
});
