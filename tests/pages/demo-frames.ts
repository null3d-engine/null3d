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
	const failures: string[] = [];
	// No stats overlay: its sampling would take frames that this page measures.
	const engine = await startDemo({ canvas, demo, stats: false });
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	await engine.firstFrame;
	const bytesBeforeFirstFrame = downloadedBytes();
	progress('the first frame drew');
	const metrics = await engine.measure(SECONDS);
	const bytesTotal = downloadedBytes();
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	await engine.destroy();
	if (!(metrics.presentedFps > 0))
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	return {
		tier,
		mode,
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
		wasmBytes: metrics.downloadBytes.wasm,
		bytesBeforeFirstFrame,
		bytesTotal,
		failures,
	};
});
