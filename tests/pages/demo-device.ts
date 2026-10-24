// Times a demo of examples/ at the GPU path and the preset that the page's switches ask for: it
// starts the demo live, waits for its first frame, measures the frames, then reads the engine's
// overlay for the triangles and the GPU memory of the same scene. It reports the preset and the
// mode the engine ran, the frame interval, CPU time per frame, GPU time per pass, triangles,
// memory, and the bytes that the page downloaded. It fails when the measure drew no frame.
// ?demo= names the demo, ?seconds= the measured time, and the engine's own ?gpu= and ?preset=
// switches choose the path and the preset.
import { DEMOS } from '../../examples/demos';
import { startDemo } from '../../examples/lib/run';
import { progress, run } from './lib/result';

const params = new URLSearchParams(location.search);

/** The seconds that the page measures after the first frame. */
const SECONDS = Number(params.get('seconds') ?? 5);
/**
 * How long the page waits for the overlay's figures after it shows the overlay. The figures need
 * about half a second of frames, and on WebGPU the count of the triangles comes back from the GPU
 * on one frame in eleven.
 */
const OVERLAY_WAIT_MS = 30_000;
/**
 * How long the page waits for the first frame before it reports what it has. A page that waits
 * without a limit holds a cloud session, and a device that cannot draw the scene would never
 * report why.
 */
const FIRST_FRAME_LIMIT_MS = 600_000;

/**
 * A figure that the overlay shows, read through its shadow root, or null when the overlay hides the
 * figure because it has no value.
 */
function overlayFigure(name: string): string | null {
	const root = document.querySelector<HTMLElement>('[data-null3d-stats]')?.shadowRoot;
	const node = root?.querySelector<HTMLElement>(`[data-figure="${name}"]`);
	if (!node || node.closest('[hidden]')) return null;
	const text = node.textContent?.trim() ?? '';
	return text.length > 0 ? text : null;
}

/** Bytes from a figure that the overlay wrote in mebibytes, or null. The overlay rounds to 0.1. */
function overlayMiB(text: string | null): number | null {
	const value = text?.match(/([\d.]+)\s*MiB/);
	return value?.[1] ? Math.round(Number(value[1]) * 1024 * 1024) : null;
}

/** A count from a figure that the overlay wrote, such as `12.4 k` or `2.31 M`, or null. */
function overlayCount(text: string | null): number | null {
	const value = text?.match(/([\d.]+)\s*([kM])?/);
	if (!value?.[1]) return null;
	const factor = value[2] === 'k' ? 1000 : value[2] === 'M' ? 1_000_000 : 1;
	return Math.round(Number(value[1]) * factor);
}

/**
 * Notes a step of the page's work in its trail, and posts it to the dev server under a name of its
 * own. A browser that reloads a tab whose page stopped answering loses the trail, so the server's
 * copy says where the page stopped.
 */
function note(step: string): void {
	progress(step);
	const name = [
		'steps',
		params.get('demo') ?? 'demo',
		params.get('preset') ?? 'preset',
		params.get('gpu') ?? 'auto',
	]
		.join('-')
		.toLowerCase();
	void fetch(`/__null3d/report?name=${encodeURIComponent(name)}`, {
		method: 'POST',
		body: JSON.stringify({ at: new Date().toISOString(), step }),
	}).catch(() => undefined);
}

/**
 * Waits for the overlay to show a count above zero, up to a time limit. The figures read zero until
 * the engine has a window of sampled frames, so a page that reads at once gets no count at all.
 */
async function waitForOverlay(name: string): Promise<boolean> {
	const deadline = performance.now() + OVERLAY_WAIT_MS;
	while (performance.now() < deadline) {
		if ((overlayCount(overlayFigure(name)) ?? 0) > 0) return true;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
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

// A browser that measures the page's memory waits for every worker and walks the whole heap. On a
// phone with a heavy scene, Safari stalls the page's thread for minutes in that walk, and the page
// never reports. The engine's own memory figure and the overlay's figures stay, so the heap
// measurement goes.
for (const name of ['measureUserAgentSpecificMemory'])
	Object.defineProperty(performance, name, { value: undefined, configurable: true });

run('demo-device', async () => {
	const name = params.get('demo');
	const demo = DEMOS.find((candidate) => candidate.name === name);
	if (!demo) throw new Error(`Add ?demo= with the name of a demo, not ${name}.`);
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	const failures: string[] = [];
	// No stats overlay: its sampling would take frames that this page measures.
	note(
		`starting the ${demo.name} demo at ${params.get('preset') ?? 'its preset'} on ${params.get('gpu') ?? 'its path'}`,
	);
	// A showcase scene loads its models and builds its shaders in its setup, so the start itself can
	// hold a slow phone for minutes. The wait ends, so a page that cannot start reports why.
	const engine = await Promise.race([
		startDemo({ canvas, demo, stats: false }),
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(`the demo did not start within ${FIRST_FRAME_LIMIT_MS / 1000} s`)),
				FIRST_FRAME_LIMIT_MS,
			),
		),
	]);
	engine.onFailure((error) => failures.push(`${error.code}: ${error.message}`));
	note(
		`the engine started at ${engine.mode.preset} on ${engine.capabilities.tier} in the ${engine.mode.build} build`,
	);
	const drew = await Promise.race([
		engine.firstFrame.then(() => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), FIRST_FRAME_LIMIT_MS)),
	]);
	if (!drew)
		throw new Error(
			`the first frame did not draw within ${FIRST_FRAME_LIMIT_MS / 1000} s${failures.length > 0 ? `; the engine failed with ${failures.join('; ')}` : ''}`,
		);
	const bytesBeforeFirstFrame = downloadedBytes();
	note('the first frame drew');
	const metrics = await engine.measure(SECONDS);
	note(`the measure drew ${metrics.frames} frames`);
	const bytesTotal = downloadedBytes();
	// The overlay samples the figures that only it shows: triangles and the GPU's memory. It comes
	// after the measure, so its sampling costs none of the frames that the figures above time.
	engine.stats(true);
	const overlayReady = await waitForOverlay('triangles');
	note(`the overlay ${overlayReady ? 'showed' : 'did not show'} its counts`);
	const heading = overlayFigure('heading');
	const triangles = overlayCount(overlayFigure('triangles'));
	const objects = overlayCount(overlayFigure('objects'));
	const draws = overlayCount(overlayFigure('draws'));
	const memory = {
		// The overlay writes each figure in mebibytes, rounded to 0.1.
		engineBytes: overlayMiB(overlayFigure('engine-memory')),
		gpuTextureBytes: overlayMiB(overlayFigure('gpu-textures')),
		gpuBufferBytes: overlayMiB(overlayFigure('gpu-buffers')),
		jsHeapBytes: overlayMiB(overlayFigure('js-heap')),
		totalBytes: overlayMiB(overlayFigure('memory')),
		wasmBytes: metrics.memory.wasmBytes,
	};
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	engine.stats(false);
	await engine.destroy();
	if (!(metrics.presentedFps > 0))
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	return {
		tier,
		mode,
		demo: demo.name,
		heading,
		seconds: metrics.seconds,
		frames: metrics.frames,
		presentedFps: metrics.presentedFps,
		updatedFps: metrics.updatedFps,
		refreshHz: metrics.refreshHz,
		intervalMs: metrics.intervalMs,
		cpuMs: metrics.cpuMs,
		cpuMsAllThreads: metrics.cpuMsAllThreads,
		gpuMs: metrics.gpuMs,
		gpuStepMs: metrics.gpuStepMs,
		gpuPassMs: metrics.gpuPassMs,
		drawCalls: metrics.drawCalls,
		uploadBytes: metrics.uploadBytes,
		visibleEntries: metrics.visibleEntries,
		overlayReady,
		triangles,
		objects,
		draws,
		memory,
		firstFrameMs: metrics.load.firstFrameMs,
		firstFrameDoneMs: metrics.load.firstFrameDoneMs,
		engineStartMs: metrics.load.engineStartMs,
		warmUpMs: metrics.load.warmUpMs,
		firstFramePipelines: metrics.load.firstFramePipelines,
		bytesBeforeFirstFrame,
		bytesTotal,
		failures,
	};
});
