// Times a demo of examples/ at the GPU path and the preset that the page's switches ask for: it
// starts the demo live, waits for its first frame, measures the frames, then reads the engine's
// overlay for the triangles and the GPU memory of the same scene. It reports the preset and the
// mode the engine ran, the frame interval, CPU time per frame, GPU time per pass, triangles,
// memory, and the bytes that the page downloaded. It fails when the measure drew no frame.
// ?demo= names the demo, ?seconds= the measured time, and the engine's own ?gpu= and ?preset=
// switches choose the path and the preset. ?measure=off skips the measure and reads the overlay
// alone, which bisects a stall inside the measure from one in the scene's own draws. ?off= turns
// off the demo's shared effect switches after the first frame, such as ?off=shadows,bloom.
import { createEngine } from '@null3d/engine';
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

/** False skips `engine.measure`, so the page reads the overlay's window alone. */
const MEASURE = params.get('measure') !== 'off';
/**
 * False starts the engine without CPU copies of its textures, which a phone or tablet keeps by
 * default. ?keep-copies=off separates that mobile path from the rest of the frame.
 */
const KEEP_COPIES = params.get('keep-copies') !== 'off';
/** False shows no overlay, so a run counts the page's own frames instead of the engine's window. */
const OVERLAY = params.get('overlay') !== 'off';
/** The seconds that a run without an overlay draws for, counted by the page's own frame callbacks. */
const DRAW_SECONDS = Number(params.get('draw') ?? 12);
/** Frames that the page's own frame callbacks counted, for a run with no overlay. */
const pageFrames = { count: 0 };
requestAnimationFrame(function countFrame() {
	pageFrames.count++;
	requestAnimationFrame(countFrame);
});
/** The shared effect switches that the page turns off after the first frame. */
const OFF = (params.get('off') ?? '').split(',').filter(Boolean);
/** The HUD group that carries each shared effect switch, which the page posts to turn it off. */
const SWITCH_GROUP: Readonly<Record<string, string>> = {
	sky: 'atmosphere',
	fog: 'atmosphere',
	shafts: 'atmosphere',
	fireflies: 'atmosphere',
	shadows: 'lighting',
	ao: 'lighting',
	environment: 'lighting',
	bloom: 'post',
	dof: 'post',
	exposure: 'post',
	vignette: 'post',
};

/**
 * A figure that the overlay shows, read through its shadow root, or null when the overlay hides the
 * figure because it has no value.
 */
function overlayFigure(name: string): string | null {
	const root = document.querySelector<HTMLElement>('[data-null3d-stats]')?.shadowRoot;
	const node = root?.querySelector<HTMLElement>(`[data-figure="${name}"]`);
	// A tab that does not show still holds its figures; only a hidden figure is absent.
	if (!node || node.closest('[hidden]:not(.pane)')) return null;
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
	// A demo spells its own cost switches on its sketch's address, as the split page does, so a
	// page that compares one change at a time passes them here.
	const sketch = new URL(demo.sketch);
	for (const id of ['morph', 'still', 'follow'])
		if (params.has(id)) sketch.searchParams.set(id, params.get(id) ?? '');
	const runDemo = { ...demo, sketch };
	const failures: string[] = [];
	// No stats overlay: its sampling would take frames that this page measures.
	note(
		`starting the ${demo.name} demo at ${params.get('preset') ?? 'its preset'} on ${params.get('gpu') ?? 'its path'}`,
	);
	// A showcase scene loads its models and builds its shaders in its setup, so the start itself can
	// hold a slow phone for minutes. The wait ends, so a page that cannot start reports why.
	const started = KEEP_COPIES
		? startDemo({ canvas, demo: runDemo, stats: false })
		: createEngine({
				canvas,
				sketch: runDemo.sketch,
				largeWorld: runDemo.largeWorld,
				hdr: runDemo.hdr,
				stats: false,
				keepTextureCopies: false,
			});
	const engine = await Promise.race([
		started,
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
	// A bisect turns shared switches off before the measure, so a pass that hangs is absent from the
	// frames that follow.
	for (const id of OFF) {
		const group = SWITCH_GROUP[id];
		if (!group) throw new Error(`?off= names no shared switch: ${id}`);
		engine.postToSketch(group, id);
		note(`turned off ${id}`);
	}
	const metrics = MEASURE ? await engine.measure(SECONDS) : undefined;
	if (metrics) note(`the measure drew ${metrics.frames} frames`);
	else note(`the measure is off; waiting for the overlay`);
	const bytesTotal = downloadedBytes();
	// The overlay samples the figures that only it shows: triangles and the GPU's memory. It comes
	// after the measure, so its sampling costs none of the frames that the figures above time.
	let overlayReady = false;
	if (OVERLAY) {
		engine.stats(true);
		overlayReady = await waitForOverlay('triangles');
		note(`the overlay ${overlayReady ? 'showed' : 'did not show'} its counts`);
	} else {
		// A run with no overlay draws for a while and counts the page's own frames, so a stall in the
		// scene's draws shows apart from one in the timing that the overlay and the measure turn on.
		const startedAt = performance.now();
		pageFrames.count = 0;
		await new Promise((resolve) => setTimeout(resolve, DRAW_SECONDS * 1000));
		note(
			`the page drew ${pageFrames.count} frames in ${((performance.now() - startedAt) / 1000).toFixed(1)} s without an overlay`,
		);
	}
	const heading = OVERLAY ? overlayFigure('heading') : null;
	const triangles = OVERLAY ? overlayCount(overlayFigure('triangles')) : null;
	const objects = OVERLAY ? overlayCount(overlayFigure('objects')) : null;
	const draws = OVERLAY ? overlayCount(overlayFigure('draws')) : null;
	const memory = {
		// The overlay writes each figure in mebibytes, rounded to 0.1.
		engineBytes: OVERLAY ? overlayMiB(overlayFigure('engine-memory')) : null,
		gpuTextureBytes: OVERLAY ? overlayMiB(overlayFigure('gpu-textures')) : null,
		gpuBufferBytes: OVERLAY ? overlayMiB(overlayFigure('gpu-buffers')) : null,
		jsHeapBytes: OVERLAY ? overlayMiB(overlayFigure('js-heap')) : null,
		totalBytes: OVERLAY ? overlayMiB(overlayFigure('memory')) : null,
		wasmBytes: metrics?.memory.wasmBytes ?? null,
	};
	const { tier } = engine.capabilities;
	const mode = { ...engine.mode };
	if (OVERLAY) engine.stats(false);
	await engine.destroy();
	// The overlay's own frame rate, for a page that measures nothing.
	const overlayFps = OVERLAY
		? Number(/([\d.]+)\s*fps/.exec(overlayFigure('fps') ?? '')?.[1] ?? 0)
		: pageFrames.count / DRAW_SECONDS;
	// A frame that the engine drew without its GPU still counts, so a run that lost its device must
	// fail: its figures describe a scene that the GPU never drew.
	if (failures.length > 0) throw new Error(`the engine failed: ${failures.join('; ')}`);
	if (metrics && !(metrics.presentedFps > 0))
		throw new Error(
			`the measure drew no frame in ${metrics.seconds.toFixed(1)} s, and the first frame finished at ${metrics.load.firstFrameDoneMs} ms`,
		);
	if (!metrics && !(overlayFps > 0))
		throw new Error(
			OVERLAY
				? `the overlay showed no frame rate after ${OVERLAY_WAIT_MS / 1000} s`
				: `the page counted no frame in ${DRAW_SECONDS} s`,
		);
	return {
		tier,
		mode,
		demo: demo.name,
		heading,
		measured: metrics !== undefined,
		overlay: OVERLAY,
		keepCopies: KEEP_COPIES,
		pageFrames: pageFrames.count,
		off: OFF,
		seconds: metrics?.seconds ?? null,
		frames: metrics?.frames ?? null,
		presentedFps: metrics?.presentedFps ?? overlayFps,
		updatedFps: metrics?.updatedFps ?? null,
		refreshHz: metrics?.refreshHz ?? null,
		intervalMs: metrics?.intervalMs ?? null,
		cpuMs: metrics?.cpuMs ?? null,
		cpuMsAllThreads: metrics?.cpuMsAllThreads ?? null,
		gpuMs: metrics?.gpuMs ?? null,
		gpuStepMs: metrics?.gpuStepMs ?? null,
		gpuPassMs: metrics?.gpuPassMs ?? null,
		drawCalls: metrics?.drawCalls ?? null,
		uploadBytes: metrics?.uploadBytes ?? null,
		visibleEntries: metrics?.visibleEntries ?? null,
		overlayReady,
		triangles,
		objects,
		draws,
		memory,
		firstFrameMs: metrics?.load.firstFrameMs ?? null,
		firstFrameDoneMs: metrics?.load.firstFrameDoneMs ?? null,
		engineStartMs: metrics?.load.engineStartMs ?? null,
		warmUpMs: metrics?.load.warmUpMs ?? null,
		firstFramePipelines: metrics?.load.firstFramePipelines ?? null,
		bytesBeforeFirstFrame,
		bytesTotal,
		failures,
	};
});
