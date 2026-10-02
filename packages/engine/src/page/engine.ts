// createEngine: the page side of the engine. It probes the device, picks the build, the GPU tier
// and the quality preset, starts the workers, and hands the canvas to the thread that draws. The
// page loads the renderer only when it draws itself, and the sketch runner and the scene API only
// when it runs the sketch itself: in the single-threaded build, and with sketchThread: 'main'.

import { DEV } from '../errors/checks';
import { EngineError, isErrorCode, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { messageOf } from '../errors/message';
import { FORMAT_CANVAS } from '../generated/gpu';
import type { PresetCheck } from '../quality/check';
import {
	choosePreset,
	crashTier,
	memoryPreset,
	type PresetRequest,
	withinTier,
} from '../quality/chooser';
import {
	checkSettings,
	presetOption,
	presetSettings,
	presetValue,
	type QualityPreset,
} from '../quality/presets';
import type { DrawingSetup } from '../render/draw';
import { type DrawModule, loadDrawModule } from '../render/load-draw';
import type { Drawing } from '../render/recovery';
import type { Renderer, Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { type Build, type CoreGlue, loadGlue, startCore } from '../shared/core';
import { drawingSenders, ImageTable } from '../shared/images';
import { KEY_CODES } from '../shared/key-codes';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import { notifySlot, setWakeByMessage } from '../shared/wake';
import { loadSketch } from '../sketch/define-sketch';
import type { QualityStart, QualityUpdate } from '../sketch/quality';
import type { SketchRunner } from '../sketch/runner';
import type {
	CapturedFrame,
	CoreHandoff,
	RendererRequest,
	RendererSetup,
	SketchWorkerInit,
	WorkerReply,
} from '../workers/protocol';
import { abortable } from './abortable';
import { WEBGPU_MAX_TEXTURE_SIZE, watchCanvas } from './canvas-watch';
import {
	type CapabilityReport,
	type PowerPreference,
	probeCapabilities,
	readDeviceHints,
} from './capabilities';
import { watchDisplay } from './display';
import {
	type FrameMetrics,
	HeapSampler,
	secondRates,
	summarizeFrames,
	threadRoles,
	wasmDownloadBytes,
} from './frame-stats';
import { holdFailure, holdSeconds, publishHold } from './hold';
import { captureInput } from './input';
import { coreDevice, maxInstances } from './limits';
import { loadCore, memoryMaximumMiB } from './loader';
import { MainThreadWatch } from './main-thread';
import { watchPreferences } from './preferences';
import { NO_HISTORY, StartMarker } from './start-marker';
import { StatsSwitch } from './stats-switch';
import {
	type DepthMode,
	type GpuSwitch,
	type LatencyMode,
	parseSwitches,
	type SketchThread,
	type Switches,
} from './switches';

/**
 * Options for `createEngine`.
 *
 * @category api/engine
 */
export interface EngineOptions {
	/**
	 * The canvas to draw into, sized by CSS. On a canvas that no CSS sizes, the engine sets the CSS
	 * width and height that it shows when the engine starts.
	 */
	canvas: HTMLCanvasElement;
	/** The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. */
	sketch: URL | string;
	/**
	 * The quality preset: `auto`, the default, lets the engine choose one for the device, and
	 * `low`, `medium`, `high` or `ultra` names one. The GPU path caps it: WebGL2 and WebGPU's
	 * compatibility mode run at most `medium`. After a start that crashed the tab, the engine starts
	 * a preset lower. Another value fails with E1213. The `?preset=` switch wins over it.
	 */
	preset?: 'auto' | QualityPreset;
	/**
	 * Cap for the device pixel ratio, a number from 0.5 up. Without it, the quality preset sets the
	 * cap. `ctx.quality.set` changes it during play.
	 */
	maxPixelRatio?: number;
	/** Forces a GPU tier, for testing only. */
	gpu?: 'auto' | 'webgpu' | 'webgl2';
	/**
	 * Which GPU to draw with on a device that has two, such as a laptop with a separate graphics
	 * chip: `high-performance`, the default, for the faster one, or `low-power` to save battery.
	 * The browser treats it as a request. A device with one GPU ignores it.
	 */
	powerPreference?: 'high-performance' | 'low-power';
	/**
	 * The latency mode. The default is `pipelined`. Low latency needs a worker that draws: where
	 * no worker can draw, the engine runs in pipelined mode, and `engine.mode` says so.
	 */
	latency?: LatencyMode;
	/**
	 * How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa`
	 * smooths edges in the final pass, and `none` leaves them sharp. Without it, the quality preset
	 * sets the mode: FXAA on Low, MSAA from Medium up. Each mode works on every GPU path, and the
	 * mode stays fixed while the engine runs. Another value fails with E1213.
	 */
	antialias?: 'msaa' | 'fxaa' | 'none';
	/**
	 * True for a see-through canvas: the page shows through wherever no object draws, until the
	 * sketch sets a background color. The canvas holds premultiplied alpha, as a browser composites
	 * it. The default is false, an opaque canvas.
	 */
	transparent?: boolean;
	/**
	 * The thread that runs the sketch's code and the engine core: `worker`, the default, or `main`
	 * for the page's main thread, where the sketch can reach the DOM. Use `main` for apps that work
	 * mostly with the DOM, and for debugging. The render worker still draws in pipelined mode, and
	 * the page draws in low-latency mode. The sketch's frames then share the page's thread with the
	 * page's own work, so each can slow the other. The single-threaded build always runs the sketch
	 * on the page's thread. The `?sketch-thread=` switch wins over this option.
	 */
	sketchThread?: SketchThread;
	/**
	 * The engine's memory. `maximumMiB` sets the most memory that the engine's threads share, in
	 * MiB: a whole number from 256 to 4096, 1024 by default. Another value fails with E1409. The
	 * browser reserves address space for the whole maximum when the engine starts. So a larger
	 * maximum leaves less room for other engines and WebAssembly modules on the page. Ask for more
	 * only when a scene needs it. The single-threaded build's memory is not shared, so this option
	 * does not change it. The `?memory=<MiB>` switch wins over it.
	 */
	memory?: { maximumMiB: number };
	/**
	 * Called as the start reaches each stage, in this order: `core` once the engine core is compiled
	 * and the GPU paths are tested, `sketch` once the sketch's setup has run, and `first-frame` once the
	 * GPU has finished the first frame.
	 */
	onProgress?: (stage: StartupStage) => void;
	/**
	 * Receives the messages the sketch sends with `ctx.page.post`, from the start of the sketch's setup.
	 * Use it for progress that the sketch reports while it loads. `engine.onSketchMessage` adds more
	 * handlers once the engine has started.
	 */
	onSketchMessage?: (name: string, data: unknown) => void;
	/**
	 * Cancels a start in progress, for example when the user leaves the page. `createEngine` then
	 * stops the engine's threads and rejects with the signal's reason.
	 */
	signal?: AbortSignal;
	/**
	 * Starts the engine in hold mode for image tests, held at this many seconds of sketch time. The
	 * engine steps the sketch from 0 to the time in fixed steps of 1/60 second, with no frame loop.
	 * `math.random` and `Math.random` in the sketch's thread give the same numbers on every run, and
	 * the sketch gets no input: every key and button stays up. The engine then draws that one frame
	 * and reads it back, and `createEngine` resolves. The `?hold=<seconds>`
	 * switch overrides this time, and a bare `?hold` holds at it, or at 0 without it.
	 */
	hold?: number;
}

/**
 * A stage of the engine's start, as `onProgress` reports it.
 *
 * @category api/engine
 */
export type StartupStage = 'core' | 'sketch' | 'first-frame';

/**
 * The GPU path the engine chose, and what it offers.
 *
 * @category api/engine
 */
export interface EngineCapabilities {
	/** The GPU path the engine draws with. */
	tier: Tier;
	/** True when the engine runs the threaded build. */
	threaded: boolean;
	/** The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. */
	features: string[];
	/** The WebGPU limits, or an empty object on WebGL2. */
	limits: Record<string, number | null>;
	/**
	 * True when the scene draws high dynamic range color, which the final pass tone maps into the
	 * canvas. False on the 8-bit path, where each shader tone maps its own output: in WebGPU's
	 * compatibility mode with MSAA, and on WebGL2 devices whose float targets fail the engine's
	 * test. Both paths show the same colors. Edges differ a little with MSAA, because the 8-bit path
	 * averages the samples after the tone mapping.
	 */
	hdr: boolean;
	/**
	 * The most objects and instance rows, counted together, that a scene can draw on this device.
	 * On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws
	 * more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows:
	 * 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every WebGL2 device allows. Engine
	 * memory can run out first: see E1109.
	 */
	maxInstances: number;
	/**
	 * How the GPU path stores depth. WebGPU, and WebGL2 in browsers with `EXT_clip_control`, draw
	 * `reversed` depth, which stays precise far from the camera.
	 */
	depth: DepthMode;
}

/**
 * How the engine runs on this device: its build, its latency mode and its threads.
 *
 * @category api/engine
 */
export interface EngineMode {
	/**
	 * With `threaded`, the sketch and the render step run in workers, helped by job workers. With
	 * `single`, everything runs on the page's thread, for pages without shared memory.
	 */
	build: 'threaded' | 'single';
	/**
	 * The latency mode in use, or `single` for the single-thread build. A page that runs the sketch
	 * and draws steps the sketch right before each draw, which is `low`.
	 */
	latency: LatencyMode | 'single';
	/** The thread that runs the sketch and the engine core. */
	sketchThread: SketchThread;
	/** The thread that owns the canvas and draws. */
	renderThread: 'render-worker' | 'sketch-worker' | 'main';
	/** The job workers that share the engine's parallel work. */
	jobWorkers: number;
	/** The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. */
	hold: number | null;
	/**
	 * The quality preset that the engine runs. The preset check can lower it before `createEngine`
	 * resolves, and `ctx.quality.setPreset` in the sketch changes it later.
	 */
	preset: QualityPreset;
	/**
	 * What the preset check measured, or null when no check ran. The engine checks the preset when
	 * it chose it from the device: after the first frame, it measures the frame rate of the scene
	 * that the setup built, and lowers the preset until one holds the target.
	 */
	presetCheck: PresetCheck | null;
	/**
	 * The starts of this sketch before this one that crashed the tab, one after another, as the
	 * engine's note in `localStorage` records them. After one, the engine starts a preset lower, and
	 * after two at `low`.
	 */
	crashedStarts: number;
	/**
	 * The shared memory's maximum in MiB, or null for the single-threaded build, whose memory is not
	 * shared.
	 */
	memoryMaximumMiB: number | null;
}

/**
 * A running engine, as `createEngine` returns it.
 *
 * @category api/engine
 */
export interface Engine {
	/** The GPU path the engine chose, and what it offers. */
	readonly capabilities: EngineCapabilities;
	/** The full capability report, as plain JSON. */
	readonly report: CapabilityReport;
	/** How the engine runs on this device. */
	readonly mode: EngineMode;
	/**
	 * Resolves once the GPU has finished the first frame, so it is on screen: the moment to remove
	 * a loading screen. It never resolves when the engine is destroyed first.
	 */
	readonly firstFrame: Promise<void>;
	/** Sends a message to the sketch, which receives it through `ctx.page.onMessage`. */
	postToSketch(name: string, data?: unknown, transfer?: Transferable[]): void;
	/**
	 * Receives the messages the sketch sends with `ctx.page.post`. When no handler listened from the
	 * start, the first handler also receives the messages sent before it was registered. Returns a
	 * function that removes the handler.
	 */
	onSketchMessage(handler: (name: string, data: unknown) => void): () => void;
	/**
	 * Receives a failure after the engine started: the browser took the GPU away and the engine could
	 * not carry on with a new device (E1302), or an engine thread failed (E1404). The engine reports
	 * each failure once. Without a handler, it logs the failure to the console. Returns a function
	 * that removes the handler.
	 */
	onFailure(handler: (error: EngineError) => void): () => void;
	/**
	 * Pauses or resumes the sketch's frames. A pause also stops input: the sketch sees every key and
	 * button that was down come up, and input that comes during the pause never reaches it.
	 */
	setPaused(paused: boolean): void;
	/**
	 * Takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU
	 * resources and the scene, and stops reading input. Use it when a single-page app leaves the
	 * view that shows the canvas, and `attach` when the view comes back.
	 */
	detach(): void;
	/**
	 * Puts the canvas at the end of `container` and resumes the engine where it stopped, unless
	 * `setPaused(true)` paused it.
	 */
	attach(container: Element): void;
	/**
	 * Measures the running engine for a number of seconds, then returns CPU time per frame by thread
	 * and phase, GPU time, frame intervals, uploads, draw calls, memory and load time.
	 */
	measure(seconds: number): Promise<FrameMetrics>;
	/**
	 * Resolves with an image of the next frame that the engine draws, as a PNG file. The thread
	 * that draws reads the frame back and encodes it, so the page's thread does no work for it when
	 * a worker draws. In hold mode, and while the engine is paused, the image shows the frame on the
	 * canvas. A hidden page draws no frames, so its image comes once the page shows again. Fails
	 * with E1414 once the engine has stopped.
	 */
	capture(): Promise<Blob>;
	/**
	 * Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first, for tests. In
	 * hold mode, it returns the held frame.
	 */
	captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/**
	 * Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and
	 * draws the whole scene again, as it does after a real loss. Use it to test how your page
	 * handles one.
	 */
	simulateGpuLoss(): void;
	/**
	 * Stops the engine and its workers. The engine cannot start again. The thread that draws first
	 * destroys the engine's GPU textures and buffers and its GPU device, so the GPU's memory comes
	 * back at once. It also leaves the canvas blank, at its size, because Safari keeps the GPU
	 * memory of a canvas's last frame until the canvas shows another. The promise resolves once
	 * every worker has stopped, when the browser can free the engine's memory. Wait for it before
	 * you start another engine on the same page: an iPad has room for only a few engines' memory.
	 */
	destroy(): Promise<void>;
}

/** The global where the `?bench` switch publishes the running engine. */
const BENCH_GLOBAL = '__null3dEngine';
/** The GPU the engine asks for on a device with two: the faster one. */
const DEFAULT_POWER_PREFERENCE: PowerPreference = 'high-performance';
/** Logical cores kept free of job workers: one for the sketch worker, one for the render worker. */
const RESERVED_CORES = 2;
/** How often the page reads the frame records while it measures. */
const DRAIN_INTERVAL_MS = 250;
/** How many sketch messages the page keeps while no handler listens. */
const MAX_EARLY_MESSAGES = 256;
/** How long stopping the engine waits for its job workers and the worker that draws to stop. */
const STOP_TIMEOUT_MS = 2_000;

interface TierChoice {
	tier: Tier;
	forceCompat: boolean;
}

/** Picks the GPU tier from feature tests, never from browser or GPU names. */
export function chooseTier(
	report: CapabilityReport,
	wanted: GpuSwitch,
	inWorker: boolean,
): TierChoice | null {
	const worker = 'error' in report.worker ? undefined : report.worker;
	const webgpu =
		report.webgpu.compatibilityAdapter && (!inWorker || worker?.offscreenWebGPU === true);
	const webgl2 = inWorker ? worker?.offscreenWebGL2 === true : report.webgl2.available;
	if (wanted === 'webgl2') return webgl2 ? { tier: 'webgl2', forceCompat: false } : null;
	if (wanted === 'compat') return webgpu ? { tier: 'webgpu-compat', forceCompat: true } : null;
	if (wanted === 'webgpu')
		return webgpu && report.webgpu.coreFeaturesAndLimits
			? { tier: 'webgpu', forceCompat: false }
			: null;
	if (webgpu)
		return {
			tier: report.webgpu.coreFeaturesAndLimits ? 'webgpu' : 'webgpu-compat',
			forceCompat: false,
		};
	return webgl2 ? { tier: 'webgl2', forceCompat: false } : null;
}

type Pending = { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void };

/**
 * The error of a worker that failed to start. An engine error keeps its code and message; any
 * other failure becomes E1405.
 */
export function startError(role: string, message: string): EngineError {
	const code = /^(E\d{4}): /.exec(message)?.[1];
	if (code && isErrorCode(code)) {
		const error = new EngineError(code, '');
		error.message = message;
		return error;
	}
	return new EngineError('E1405', `the ${role} worker did not start: ${message}.`);
}

type RunnerModule = typeof import('../sketch/runner');

/** True while an engine runs its sketch on this page, where the page's copy of the core serves it. */
let pageRunsSketch = false;

/**
 * Starts loading the sketch runner and the scene API, which the page needs only when it runs the
 * sketch itself. The bundler puts them in a file of their own.
 */
function loadRunnerModule(): Promise<RunnerModule> {
	return awaitLater(import('../sketch/runner'));
}

/** WebAssembly that uses a SIMD instruction; a browser without SIMD rejects it. */
const SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
	253, 98, 11,
]);

/** What the page does with the replies of a worker that answer no request. */
interface WorkerEvents {
	/** A message that the sketch sent with `ctx.page.post`. */
	sketchMessage(name: string, data: unknown): void;
	/**
	 * A failure of a thread. It ends a start that is still under way, unless `endsStart` is false:
	 * the engine then runs on without the thread.
	 */
	failure(error: EngineError, endsStart?: boolean): void;
	/** The quality preset and settings after a change, and the preset check's result. */
	quality(update: QualityUpdate): void;
	/** The sketch asked to show or hide the stats overlay. */
	stats(show: boolean): void;
}

/** A worker whose replies are routed: events to the page's handlers, answers to the oldest request. */
class EngineWorker {
	private readonly waiting: Pending[] = [];
	private readyPromise: Promise<WorkerReply>;
	private readonly stoppedPromise: Promise<void>;
	private started = false;

	constructor(
		readonly worker: Worker,
		role: string,
		events: WorkerEvents,
	) {
		this.readyPromise = new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
		});
		void this.readyPromise.then(
			() => {
				this.started = true;
			},
			() => {},
		);
		let markStopped = () => {};
		this.stoppedPromise = new Promise((resolve) => {
			markStopped = resolve;
		});
		worker.onmessage = (event: MessageEvent<WorkerReply>) => {
			const reply = event.data;
			if (reply.type === 'sketch-message') {
				events.sketchMessage(reply.name, reply.data);
				return;
			}
			if (reply.type === 'quality') {
				events.quality(reply.update);
				return;
			}
			if (reply.type === 'stats') {
				events.stats(reply.show);
				return;
			}
			if (reply.type === 'lost') {
				events.failure(
					new EngineError('E1302', `the ${reply.role} worker lost its GPU: ${reply.reason}.`),
				);
				return;
			}
			if (reply.type === 'stopped' || reply.type === 'error') markStopped();
			if (reply.type === 'stopped' || reply.type === 'progress') return;
			const pending = this.waiting.shift();
			if (!pending) return;
			if (reply.type === 'error') pending.reject(startError(reply.role, reply.message));
			else pending.resolve(reply);
		};
		worker.onerror = (event) => {
			markStopped();
			const message = event.message || 'a worker failed';
			this.waiting.shift()?.reject(startError(role, message));
			if (this.started)
				events.failure(new EngineError('E1404', `the ${role} worker failed: ${message}.`));
		};
	}

	ready(): Promise<WorkerReply> {
		return this.readyPromise;
	}

	/**
	 * Settles once a job worker has left the job system, once the worker that draws has destroyed
	 * its GPU objects, or once the worker has failed.
	 */
	stopped(): Promise<void> {
		return this.stoppedPromise;
	}

	/** Stops the worker, and fails each request that still waits for its answer. */
	terminate(): void {
		this.worker.terminate();
		for (const pending of this.waiting.splice(0)) pending.reject(new Error('the engine stopped'));
	}

	request(message: RendererRequest): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
			this.worker.postMessage(message);
		});
	}
}

/**
 * Stops the workers once each worker in `waitFor` reports that it stopped, or after a timeout. A job
 * worker without work blocks its thread in a wait. When Safari stops a thread inside such a wait,
 * it keeps the thread's shared memory until the tab closes, even across reloads. The worker that
 * draws destroys its GPU objects first, because a browser frees what a stopped worker held only
 * when it collects the worker's objects, and Safari does that late.
 */
async function stopWorkers(workers: readonly EngineWorker[], waitFor: readonly EngineWorker[]) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		Promise.all(waitFor.map((worker) => worker.stopped())),
		new Promise((resolve) => {
			timer = setTimeout(resolve, STOP_TIMEOUT_MS);
		}),
	]);
	clearTimeout(timer);
	for (const w of workers) w.terminate();
}

/** The engine's workers, which the page starts before the core has compiled. */
interface EngineWorkers {
	/** The sketch worker, unless the page runs the sketch. */
	sketch: EngineWorker | undefined;
	/** The render worker, in the mode where it draws. */
	render: EngineWorker | undefined;
	jobs: EngineWorker[];
}

/** Every worker of a set, in the order the page stops them. */
function allWorkers(workers: EngineWorkers | undefined): EngineWorker[] {
	if (!workers) return [];
	return [workers.sketch, workers.render, ...workers.jobs].filter((w) => w !== undefined);
}

/**
 * Starts the engine's workers: the sketch worker unless the page runs the sketch, the render worker
 * when it draws, and the job workers. The page starts them before the core has compiled, so their
 * scripts and the core's loader download while the core does. Each worker waits for its start
 * message, which carries the core. A job worker that fails to start is reported as a failure of the
 * running engine, and never holds up the start.
 */
function startWorkers(
	sketchWorker: boolean,
	renderWorker: boolean,
	jobWorkers: number,
	slots: Int32Array,
	events: WorkerEvents,
): EngineWorkers {
	const sketch = sketchWorker
		? new EngineWorker(
				new Worker(new URL('../workers/sketch-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-sketch',
				}),
				'sketch',
				events,
			)
		: undefined;
	const render = renderWorker
		? new EngineWorker(
				new Worker(new URL('../workers/render-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-render',
				}),
				'render',
				events,
			)
		: undefined;
	const jobs = Array.from({ length: jobWorkers }, (_, index) => {
		const job = new EngineWorker(
			new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
				type: 'module',
				name: `null3d-job-${index}`,
			}),
			`job ${index}`,
			events,
		);
		// Job workers join the job system as each becomes ready: until then the sketch thread and the
		// job workers already running take every chunk, so no frame waits for them.
		job.ready().catch((error: unknown) => {
			if (Atomics.load(slots, Slot.Running) !== 0)
				events.failure(
					error instanceof EngineError ? error : startError(`job ${index}`, String(error)),
					false,
				);
		});
		return job;
	});
	return { sketch, render, jobs };
}

/**
 * Downloads a file into the browser's cache, for a worker that imports it later. A host that lets
 * the browser keep build files, as the null3D Vite plugin asks, then saves the worker a round trip.
 * A failed download only loses that head start: the worker's own import reports the failure.
 */
function prefetch(url: string): void {
	fetch(url)
		.then((response) => response.arrayBuffer())
		.catch(() => {});
}

/**
 * Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the
 * workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then
 * draws that frame and reads it back. It publishes the frame, or the error that stopped it, as
 * `window.__null3dHold` for test tools. With the `?bench` switch, it publishes the running engine
 * as `window.__null3dEngine`, where a benchmark tool calls `measure`.
 *
 * @category api/engine
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
	// The page's errors end with the fixes from its own table, and each worker gets the same table
	// in its handoff.
	setErrorFixes(ERROR_FIXES);
	const switches = parseSwitches(globalThis.location?.search ?? '');
	const holding = options.hold !== undefined || switches.hold !== undefined;
	const place = placement(options, switches);
	/** True once this start holds the page's copy of the core, which serves one engine at a time. */
	let claimed = false;
	try {
		const hold = holdSeconds(options.hold, switches.hold);
		if (holding) publishHold(undefined);
		if (place.sketchThread === 'main') {
			if (pageRunsSketch)
				throw new EngineError(
					'E1415',
					'createEngine() found another engine that runs its sketch on this page, which has not stopped.',
				);
			pageRunsSketch = claimed = true;
		}
		return await startEngine(options, switches, hold, place);
	} catch (error) {
		if (claimed) pageRunsSketch = false;
		if (holding) publishHold(holdFailure(error));
		throw error;
	}
}

/** Where the engine runs: its build, and the thread that runs the sketch and the core. */
interface Placement {
	threaded: boolean;
	sketchThread: SketchThread;
}

/**
 * Picks the build and the sketch's thread from facts the page has at once, so the core downloads
 * and compiles while the probe tests the GPU paths. The threaded build needs shared memory, and the
 * single-threaded build runs the sketch on the page's thread.
 */
function placement(options: EngineOptions, switches: Switches): Placement {
	const threaded =
		globalThis.crossOriginIsolated === true &&
		typeof SharedArrayBuffer === 'function' &&
		switches.threads;
	const main = !threaded || (switches.sketchThread ?? options.sketchThread) === 'main';
	return { threaded, sketchThread: main ? 'main' : 'worker' };
}

/**
 * Starts the engine with the page's switches. With a hold time, it resolves once the held frame
 * is read back, and publishes it.
 */
async function startEngine(
	options: EngineOptions,
	switches: Switches,
	hold: number | undefined,
	{ threaded, sketchThread }: Placement,
): Promise<Engine> {
	const startedAt = performance.now();
	const { signal, onProgress } = options;
	signal?.throwIfAborted();
	const pageUrl = globalThis.location?.href;
	const sketchUrl = new URL(options.sketch, pageUrl).href;
	// The quality preset follows the device hints and the crash marker, which the page has at once,
	// so its memory maximum is known before the core loads. Hold mode and the ?preset= switch fix
	// the preset for tests, so they neither read nor write the marker.
	const marker =
		hold === undefined && switches.preset === undefined ? new StartMarker(sketchUrl) : undefined;
	const history = marker?.read() ?? NO_HISTORY;
	const optionPreset = presetOption(options.preset);
	const pageSettings = { maxPixelRatio: options.maxPixelRatio, antialias: options.antialias };
	checkSettings('createEngine()', pageSettings);
	const presetRequest: PresetRequest = {
		wanted: switches.preset ?? optionPreset,
		hints: readDeviceHints(),
		crashedStarts: history.crashed,
	};
	const maximumMiB = memoryMaximumMiB(
		options.memory?.maximumMiB,
		switches.memoryMiB,
		presetValue('memoryMaximumMiB', memoryPreset(presetRequest)),
	);
	// Checked before any download, so an old browser learns at once why the engine cannot run.
	if (!WebAssembly.validate(SIMD_PROBE))
		throw new EngineError('E1303', 'this browser runs WebAssembly without SIMD.');
	const build: Build = threaded ? 'threaded' : 'single';
	let latency: EngineMode['latency'] = threaded
		? (switches.latency ?? options.latency ?? 'pipelined')
		: 'single';
	const sketchOnPage = sketchThread === 'main';
	let coreMs = 0;
	const coreLoad = awaitLater(
		loadCore(build, maximumMiB).then((loaded) => {
			coreMs = performance.now() - startedAt;
			return loaded;
		}),
	);
	// A page that runs the sketch itself needs the core's loader, the sketch runner and the sketch
	// module right after the core, so they download while the core does: each later start delays the
	// first frame by a round trip on a slow network. The sketch module's top-level code then runs when
	// the module arrives. Hold mode loads the module once the runner has seeded the thread's random
	// numbers, so that code draws the same numbers on every run.
	if (sketchOnPage) void awaitLater(loadGlue(build));
	const runnerModule = sketchOnPage ? loadRunnerModule() : undefined;
	const sketchModule =
		sketchOnPage && hold === undefined ? awaitLater(loadSketch(sketchUrl)) : undefined;
	const powerPreference = options.powerPreference ?? DEFAULT_POWER_PREFERENCE;

	const messageHandlers = new Set<(name: string, data: unknown) => void>();
	if (options.onSketchMessage) messageHandlers.add(options.onSketchMessage);
	// Messages sent before the page listens wait for the first handler. The newest are kept when a
	// sketch sends many.
	let earlyMessages: [string, unknown][] | undefined = options.onSketchMessage ? undefined : [];
	const onSketchMessage = (name: string, data: unknown) => {
		if (earlyMessages) {
			if (earlyMessages.push([name, data]) > MAX_EARLY_MESSAGES) earlyMessages.shift();
			return;
		}
		for (const handler of messageHandlers) handler(name, data);
	};
	const failureHandlers = new Set<(error: EngineError) => void>();
	const reported = new Set<string>();
	/**
	 * Ends the start when the caller cancels it, or when a thread fails before the engine has
	 * started. A thread that fails then, such as the one that draws, leaves the start waiting for
	 * frames that never come, and the page could never stop the engine that it never got.
	 */
	const start = new AbortController();
	let starting = true;
	const cancelStart = () => start.abort(signal?.reason);
	signal?.addEventListener('abort', cancelStart, { once: true });
	const onFailure = (error: EngineError, endsStart = true) => {
		if (reported.has(error.message)) return;
		reported.add(error.message);
		if (starting && endsStart) {
			start.abort(error);
			return;
		}
		if (failureHandlers.size === 0) console.error(error);
		for (const handler of failureHandlers) handler(error);
	};
	const events: WorkerEvents = {
		sketchMessage: onSketchMessage,
		failure: onFailure,
		// The page applies the settings that it owns: the pixel ratio cap sizes the canvas. The
		// engine's mode reports the preset and the preset check.
		quality: (update) => {
			canvasWatch.setMaxPixelRatio(update.settings.maxPixelRatio);
			mode.preset = update.preset;
			if (update.check) mode.presetCheck = update.check;
		},
		stats: (show) => statsSwitch.show(show),
	};

	const jobWorkers = threaded
		? (switches.jobs ?? Math.max(1, (navigator.hardwareConcurrency ?? 1) - RESERVED_CORES))
		: 0;
	const control = createControlBuffer(threaded);
	const metrics = createMetricsBuffer(threaded, jobWorkers);
	const views = controlViews(control);
	const { slots } = views;
	const statsSwitch = new StatsSwitch(() => ({
		canvas: options.canvas,
		metrics,
		threads: engineThreads,
		sources: {
			tier,
			preset: () => mode.preset,
			renderScaleThousandths: () => Atomics.load(slots, Slot.RenderScale),
		},
	}));
	Atomics.store(slots, Slot.Running, 1);
	/**
	 * The thread that draws, unless the probe finds that a worker cannot draw here. In low-latency
	 * mode the thread that runs the sketch draws too.
	 */
	let renderThread: EngineMode['renderThread'] =
		latency === 'single' || switches.renderOnMain
			? 'main'
			: latency === 'low'
				? sketchOnPage
					? 'main'
					: 'sketch-worker'
				: 'render-worker';
	// A page that draws loads the renderer while the core downloads too. When the probe finds that a
	// worker cannot draw here, the page loads it later, once it knows.
	const drawModule = renderThread === 'main' ? loadDrawModule() : undefined;
	// With worker threads the page starts the workers now. A sketch worker gets the sketch module
	// into the browser's cache, and still runs the module only after it has started the core.
	const threads = threaded
		? startWorkers(!sketchOnPage, renderThread === 'render-worker', jobWorkers, slots, events)
		: undefined;
	if (threads?.sketch) {
		prefetch(sketchUrl);
		// In low-latency mode the sketch worker draws, so it loads the renderer now too.
		if (renderThread === 'sketch-worker')
			threads.sketch.worker.postMessage({ type: 'load-renderer' });
	}
	/**
	 * Stops the workers when the start fails before they get the core. None waits in the job system
	 * yet, so they stop at once.
	 */
	const failEarly = (error: unknown) => {
		for (const worker of allWorkers(threads)) worker.terminate();
		return error;
	};
	const report = await abortable(
		probeCapabilities(powerPreference, presetRequest.hints),
		signal,
	).catch((e: unknown) => {
		throw failEarly(e);
	});
	const probeMs = performance.now() - startedAt;
	const requested = switches.gpu !== 'auto' ? switches.gpu : (options.gpu ?? 'auto');
	// After starts that crashed on WebGPU, WebGL2 comes first, unless the page names a GPU path.
	const safeGpu = requested === 'auto' ? crashTier(history.crashed, history.lastTier) : undefined;
	const pickTier = (inWorker: boolean) =>
		(safeGpu && chooseTier(report, safeGpu, inWorker)) || chooseTier(report, requested, inWorker);

	let choice = pickTier(renderThread !== 'main');
	if (!choice && renderThread !== 'main') {
		// Worker rendering is unavailable here, so the page draws while the sketch worker computes
		// the frames, in pipelined mode. Low latency needs the sketch worker to draw.
		if (DEV && latency === 'low')
			console.warn(
				'null3D: low latency needs a worker that draws, and this browser cannot draw in a worker. The engine runs in pipelined mode, and the page draws.',
			);
		latency = 'pipelined';
		renderThread = 'main';
		choice = pickTier(false);
		threads?.render?.terminate();
		if (threads) threads.render = undefined;
	}
	if (!choice)
		throw failEarly(
			new EngineError('E1301', `no usable GPU path for ?gpu=${requested} in this browser.`),
		);
	const { tier, forceCompat } = choice;
	const preset = choosePreset(presetRequest, tier);
	const quality: QualityStart = {
		preset,
		settings: presetSettings(preset, pageSettings),
		options: pageSettings,
		highest: withinTier('ultra', tier),
		// The engine checks a preset that it chose itself, when a lighter one exists. A preset that
		// the page, a switch or hold mode fixes stays as it is.
		check:
			optionPreset === 'auto' &&
			switches.preset === undefined &&
			hold === undefined &&
			preset !== 'low'
				? { fps: switches.fps }
				: undefined,
	};
	const mode: EngineMode = {
		build,
		latency: latency === 'pipelined' && sketchOnPage && renderThread === 'main' ? 'low' : latency,
		sketchThread,
		renderThread,
		jobWorkers,
		hold: hold ?? null,
		preset,
		presetCheck: null,
		crashedStarts: history.crashed,
		memoryMaximumMiB: threaded ? maximumMiB : null,
	};
	/** Each engine thread's name and the roles it runs, for the frame figures. */
	const engineThreads = [...threadRoles(mode)];
	// What the thread that draws needs besides its canvas, whichever thread that is.
	const rendererSetup: Omit<RendererSetup, 'canvas'> = {
		tier,
		forceCompat,
		powerPreference,
		fps: switches.fps,
		queue: switches.queue,
		hold: hold !== undefined,
	};

	const core = await abortable(coreLoad, signal).catch((e: unknown) => {
		throw failEarly(e);
	});
	onProgress?.('core');
	let wasmMemory = core.memory;
	const device = coreDevice(tier, report, {
		...switches,
		antialias: quality.settings.antialias,
		transparent: options.transparent === true,
	});
	const capabilities: EngineCapabilities = {
		tier,
		threaded,
		features:
			tier === 'webgl2'
				? Object.keys(report.webgl2.extensions).filter((n) => report.webgl2.extensions[n])
				: report.webgpu.features,
		limits: tier === 'webgl2' ? {} : report.webgpu.limits,
		hdr: device.sceneColor !== FORMAT_CANVAS,
		maxInstances: maxInstances(device),
		depth: device.depth,
	};
	// Where the browser lacks Atomics.waitAsync, the threads wake each other with messages.
	const wakeByMessage = switches.wakeByMessage || !report.atomicsWaitAsync;
	setWakeByMessage(wakeByMessage);
	const handoff: CoreHandoff = {
		build,
		module: core.module,
		memory: core.memory,
		control,
		metrics,
		device,
		errorFixes: ERROR_FIXES,
		wakeByMessage,
	};
	const canvasWatch = watchCanvas(
		options.canvas,
		control,
		quality.settings.maxPixelRatio,
		device.webgl2 ? device.maxTextureSize : WEBGPU_MAX_TEXTURE_SIZE,
	);
	canvasWatch.listen(true);
	// Hold mode keeps input out, so a held frame never depends on it.
	const takesInput = hold === undefined;
	const input = captureInput(options.canvas, control);
	input.listen(takesInput);
	const stopPreferences = watchPreferences(slots);
	// A worker that draws holds its frames to the display's rate, which only the page can measure.
	const stopDisplay =
		renderThread !== 'main' && hold === undefined ? watchDisplay(slots) : undefined;

	let userPaused = false;
	let detached = false;
	const applyPause = () => {
		const paused = userPaused || detached;
		input.listen(takesInput && !paused);
		// Counted before the flag clears, so the sketch's first step after the pause sees it.
		if (!paused && Atomics.load(slots, Slot.Paused) !== 0) Atomics.add(slots, Slot.Resumes, 1);
		Atomics.store(slots, Slot.Paused, paused ? 1 : 0);
		notifySlot(slots, Slot.Paused, threads?.sketch?.worker);
	};
	const pageLoss = (reason: string) =>
		onFailure(new EngineError('E1302', `the page lost its GPU: ${reason}.`));
	let draw: DrawModule | undefined;
	/**
	 * Draws on the page's thread from the draw lists in `memory`, with the renderer that the page
	 * loads for it. With a sketch, the page steps it before each draw. Texture images come into the
	 * page's table from that sketch, or through a port from the sketch worker.
	 */
	const drawOnPage = async (
		memory: WebAssembly.Memory | undefined,
		images: Pick<DrawingSetup, 'imageTable' | 'imagePort'>,
		sketch?: SketchRunner,
	) => {
		draw = await (drawModule ?? loadDrawModule());
		return draw.startDrawing({
			canvas: options.canvas,
			...rendererSetup,
			metrics,
			device,
			scene: memory && { memory, control },
			control,
			sketch,
			...images,
			fail: pageLoss,
			fault: (error) =>
				onFailure(new EngineError('E1404', `the drawing on the page failed: ${messageOf(error)}.`)),
		});
	};

	let rendererHost: EngineWorker | undefined;
	let localDrawing: Drawing<Renderer> | undefined;
	let localRunner: SketchRunner | undefined;
	/**
	 * The page's core, when the page runs the sketch. The page keeps the single-threaded build's core
	 * for the next engine it starts. The threaded build's core lives in the engine's own shared
	 * memory, so each engine starts a core of its own.
	 */
	let localCore: CoreGlue | undefined;
	let stopping: Promise<void> | undefined;
	/**
	 * Stops every loop and then the workers, and wakes each thread that waits, so it sees the stop.
	 * Then it drops the page's engine and lets go of the page's threaded core. A second call returns
	 * the first call's promise.
	 */
	const stop = () => {
		stopping ??= (async () => {
			Atomics.store(slots, Slot.Running, 0);
			statsSwitch.show(false);
			for (const slot of [
				Slot.Running,
				Slot.FramesTaken,
				Slot.Paused,
				Slot.JobsReady,
				Slot.PipelinesBuilt,
			])
				notifySlot(slots, slot, threads?.sketch?.worker);
			await localDrawing?.stop();
			localRunner?.dispose();
			input.listen(false);
			canvasWatch.listen(false);
			stopPreferences();
			stopDisplay?.();
			// A start that fails or stops has not crashed the tab.
			marker?.end();
			rendererHost?.worker.postMessage({ type: 'stop-drawing' } satisfies RendererRequest);
			const waitFor = threads?.jobs ?? [];
			await stopWorkers(allWorkers(threads), rendererHost ? [...waitFor, rendererHost] : waitFor);
			// The render worker may have been inside a frame when the engine stopped, replaying a draw
			// list that the page's engine holds, so the engine stays until that worker has stopped.
			localCore?.destroyEngine();
			// The job workers have left the job system, so the page's threaded core has no more work,
			// and the browser can free the engine's memory once the page lets go of the core.
			localCore?.releaseInstance?.();
			if (sketchOnPage) pageRunsSketch = false;
		})();
		return stopping;
	};

	/**
	 * Hands the core to the job workers. A stop waits until each job worker reports that it left the
	 * job system, which one without the core never does.
	 */
	const startJobs = (jobs: readonly EngineWorker[]) => {
		for (const [index, job] of jobs.entries())
			job.worker.postMessage({ type: 'init', ...handoff, index });
	};
	/** Hands the canvas and the core to the render worker, with the port that images come through. */
	const startRenderWorker = (render: EngineWorker, imagePort: MessagePort) => {
		const canvas = options.canvas.transferControlToOffscreen();
		render.worker.postMessage({ type: 'init', ...handoff, canvas, ...rendererSetup, imagePort }, [
			canvas,
			imagePort,
		]);
		rendererHost = render;
	};

	marker?.begin(history, tier);
	try {
		if (sketchOnPage) {
			// The page starts its core before the workers get theirs. The first core in a new shared
			// memory fills it with the core's data, and a core that starts while another fills it
			// waits, which the page's thread must never do.
			const started = await abortable(startCore(build, core.module, core.memory), start.signal);
			localCore = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			wasmMemory = memory;
			const imageTable = new ImageTable();
			const render = threads?.render;
			if (threads) startJobs(threads.jobs);
			let imagePort: MessagePort | undefined;
			if (render) {
				// Texture images and custom materials' shaders go from the page straight to the render
				// worker.
				const images = new MessageChannel();
				imagePort = images.port1;
				startRenderWorker(render, images.port2);
			}
			const senders = drawingSenders(imageTable, slots, imagePort);
			const { SketchRunner, runPipelined } = await (runnerModule ?? loadRunnerModule());
			localRunner = new SketchRunner(
				(name, data) => onSketchMessage(name, data),
				metrics,
				{
					glue: started.glue,
					memory,
					control: views,
					keyCodes: KEY_CODES,
					jobWorkers,
					device,
					quality,
					applyQuality: events.quality,
					capabilities,
					...senders,
					pageUrl: pageUrl ?? sketchUrl,
					fps: switches.fps,
					threads: engineThreads,
					showStats: events.stats,
				},
				hold,
			);
			// In hold mode the sketch module loads only now, after the runner seeded the random
			// numbers. The renderer starts before the setup, so a warm-up in the setup has a renderer
			// to build its pipelines.
			const sketchLoad = sketchModule ?? awaitLater(loadSketch(sketchUrl));
			if (!render)
				localDrawing = await abortable(
					drawOnPage(memory, { imageTable }, localRunner),
					start.signal,
				);
			const setup = sketchLoad.then((sketch) => localRunner?.setup(sketch));
			await abortable(setup, start.signal);
			if (render) {
				await abortable(render.ready(), start.signal);
				if (hold === undefined) void runPipelined(localRunner, control);
			}
		} else if (threads?.sketch) {
			const { sketch, render, jobs } = threads;
			startJobs(jobs);
			const init: SketchWorkerInit = {
				type: 'init',
				...handoff,
				sketchUrl,
				pageUrl: pageUrl ?? sketchUrl,
				keyCodes: KEY_CODES,
				jobWorkers,
				capabilities,
				hold,
				quality,
				fps: switches.fps,
				threads: engineThreads,
			};
			if (renderThread === 'sketch-worker') {
				const canvas = options.canvas.transferControlToOffscreen();
				sketch.worker.postMessage({ ...init, renderer: { canvas, ...rendererSetup } }, [canvas]);
				rendererHost = sketch;
			} else {
				// Texture images go from the sketch worker straight to the thread that draws.
				const images = new MessageChannel();
				sketch.worker.postMessage({ ...init, imagePort: images.port1 }, [images.port1]);
				if (render) startRenderWorker(render, images.port2);
				else
					localDrawing = await abortable(
						drawOnPage(core.memory, { imagePort: images.port2 }),
						start.signal,
					);
			}
			// The engine is ready once the sketch worker and the render worker are.
			const essential = render ? [sketch, render] : [sketch];
			await abortable(Promise.all(essential.map((w) => w.ready())), start.signal);
		}
		start.signal.throwIfAborted();
	} catch (e) {
		await stop();
		throw e;
	} finally {
		starting = false;
		signal?.removeEventListener('abort', cancelStart);
	}

	const engineStartMs = performance.now() - startedAt;
	onProgress?.('sketch');
	// The thread that draws writes the time the GPU finished the first frame; the page checks for
	// it once per animation frame until it appears.
	const header = new MetricsReader(metrics);
	const firstFrame = new Promise<void>((resolve) => {
		const check = () => {
			if (Atomics.load(slots, Slot.Running) === 0) return;
			if (header.firstFrameDoneTime > 0) {
				onProgress?.('first-frame');
				resolve();
				return;
			}
			requestAnimationFrame(check);
		};
		requestAnimationFrame(check);
	});
	marker?.endAfter(firstFrame);
	/** Hold mode's frame, read back once. */
	let held: CapturedFrame | undefined;
	/** The error of a thread that draws when it could not capture a frame. */
	const captureFailure = (reply: WorkerReply | undefined) =>
		new Error(
			`the frame could not be captured${reply?.type === 'capture-failed' ? `: ${reply.message}` : ''}`,
		);
	/** Draws a frame offscreen on the thread that draws, and reads it back. */
	const capture = async (): Promise<CapturedFrame> => {
		if (localDrawing && draw) return draw.captureFrame(localDrawing, slots);
		const reply = await rendererHost?.request({ type: 'capture' });
		if (reply?.type === 'captured')
			return { width: reply.width, height: reply.height, pixels: reply.pixels };
		throw captureFailure(reply);
	};
	/** Draws a frame offscreen on the thread that draws, which encodes it as a PNG file. */
	const captureImage = async (): Promise<Blob> => {
		if (localDrawing && draw) return draw.captureImage(localDrawing, slots);
		const reply = await rendererHost?.request({ type: 'capture', image: true });
		if (reply?.type === 'captured-image') return reply.image;
		throw captureFailure(reply);
	};
	const stopped = () => Atomics.load(slots, Slot.Running) === 0;

	const engine: Engine = {
		capabilities,
		report,
		mode,
		firstFrame,
		postToSketch(name, data, transfer = []) {
			if (localRunner) localRunner.receive(name, data);
			else threads?.sketch?.worker.postMessage({ type: 'post', name, data }, transfer);
		},
		onSketchMessage(handler) {
			messageHandlers.add(handler);
			const early = earlyMessages;
			earlyMessages = undefined;
			if (early) for (const [name, data] of early) handler(name, data);
			return () => messageHandlers.delete(handler);
		},
		onFailure(handler) {
			failureHandlers.add(handler);
			return () => failureHandlers.delete(handler);
		},
		setPaused(paused) {
			userPaused = paused;
			applyPause();
		},
		detach() {
			if (detached) return;
			detached = true;
			canvasWatch.listen(false);
			applyPause();
			options.canvas.remove();
		},
		attach(container) {
			container.append(options.canvas);
			if (!detached) return;
			detached = false;
			canvasWatch.listen(true);
			applyPause();
		},
		async measure(seconds) {
			const reader = new MetricsReader(metrics);
			const heap = new HeapSampler();
			const mainThread = new MainThreadWatch();
			reader.begin();
			heap.start();
			const started = performance.now();
			const drain = setInterval(() => reader.drain(), DRAIN_INTERVAL_MS);
			await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
			clearInterval(drain);
			reader.end();
			const firstFrame = reader.firstFrameTime;
			return {
				seconds: (performance.now() - started) / 1000,
				...summarizeFrames(reader.records, threadRoles(mode)),
				memory: { wasmBytes: wasmMemory?.buffer.byteLength ?? null, ...heap.stop() },
				load: {
					engineStartMs,
					probeMs,
					coreMs,
					firstFrameMs: firstFrame > 0 ? firstFrame - performance.timeOrigin : null,
					firstFrameDoneMs:
						reader.firstFrameDoneTime > 0
							? reader.firstFrameDoneTime - performance.timeOrigin
							: null,
					warmUpMs: reader.warmUpMs,
					firstFramePipelines: reader.firstFramePipelines,
				},
				downloadBytes: { wasm: wasmDownloadBytes() },
				lostRecords: reader.lost,
				completionSignal: tier === 'webgl2' ? 'fence' : 'queue',
				refreshHz: reader.refreshHz > 0 ? reader.refreshHz : null,
				mainThread: mainThread.stop(),
				perSecond: secondRates(reader.records),
			};
		},
		async capture() {
			try {
				if (!stopped()) await nextFrame(slots, hold !== undefined);
				if (stopped()) throw new Error('the engine has stopped');
				return await captureImage();
			} catch (error) {
				throw new EngineError('E1414', `engine.capture() failed: ${messageOf(error)}.`);
			}
		},
		async captureFrame() {
			return held ? { ...held, pixels: held.pixels.slice() } : capture();
		},
		simulateGpuLoss() {
			if (localDrawing) localDrawing.simulateLoss();
			else rendererHost?.worker.postMessage({ type: 'lose-gpu' });
		},
		destroy() {
			return stop();
		},
	};
	if (hold === undefined) {
		if (switches.bench) (globalThis as Record<string, unknown>)[BENCH_GLOBAL] = engine;
		return engine;
	}
	try {
		held = await abortable(holdFrame(capture, failureHandlers), signal);
	} catch (error) {
		await stop();
		throw error;
	}
	publishHold({
		ok: true,
		time: hold,
		frame: Atomics.load(slots, Slot.FramesTaken),
		tier,
		...held,
		stats: summarizeFrames(new MetricsReader(metrics).readWritten(), threadRoles(mode)),
	});
	return engine;
}

/**
 * Resolves once the thread that draws has taken a frame after this call. It resolves at once when
 * no new frame comes: in hold mode, and while the engine is paused or stopped.
 */
function nextFrame(slots: Int32Array, holding: boolean): Promise<void> {
	const taken = Atomics.load(slots, Slot.FramesTaken);
	return new Promise((resolve) => {
		const check = () => {
			if (
				holding ||
				Atomics.load(slots, Slot.Paused) !== 0 ||
				Atomics.load(slots, Slot.Running) === 0 ||
				Atomics.load(slots, Slot.FramesTaken) !== taken
			)
				resolve();
			else requestAnimationFrame(check);
		};
		check();
	});
}

/**
 * Draws the held frame and reads it back through `capture`. The first failure that the engine
 * reports meanwhile, such as a lost GPU, ends the hold instead. A failure without a code becomes
 * E1408.
 */
async function holdFrame<T>(
	capture: () => Promise<T>,
	failureHandlers: Set<(error: EngineError) => void>,
): Promise<T> {
	let fail: (error: EngineError) => void = () => {};
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	failureHandlers.add(fail);
	try {
		return await Promise.race([capture(), failed]);
	} catch (error) {
		if (error instanceof EngineError) throw error;
		throw new EngineError(
			'E1408',
			`hold mode stopped before it read the held frame back: ${messageOf(error)}.`,
		);
	} finally {
		failureHandlers.delete(fail);
	}
}
