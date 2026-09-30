// createEngine: the page side of the engine. It probes the device, picks the build and the GPU tier,
// starts the workers, and hands the canvas to the thread that draws. The page loads the renderer
// only when it draws itself, and the sketch runner and the scene API only when it runs the sketch
// itself.

import { EngineError, isErrorCode, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { messageOf } from '../errors/message';
import { type DrawModule, loadDrawModule } from '../render/load-draw';
import type { Drawing } from '../render/recovery';
import type { Renderer, Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { type Build, type CoreGlue, startCore } from '../shared/core';
import { KEY_CODES } from '../shared/key-codes';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import { loadSketch } from '../sketch/define-sketch';
import type { SketchRunner } from '../sketch/runner';
import type {
	CapturedFrame,
	CoreHandoff,
	RendererSetup,
	SketchWorkerInit,
	WorkerReply,
} from '../workers/protocol';
import { abortable } from './abortable';
import { watchCanvas } from './canvas-watch';
import { type CapabilityReport, type PowerPreference, probeCapabilities } from './capabilities';
import {
	type FrameMetrics,
	HeapSampler,
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
import {
	type DepthMode,
	type GpuSwitch,
	type LatencyMode,
	parseSwitches,
	type Switches,
} from './switches';

/**
 * Options for `createEngine`.
 *
 * @category api/engine
 */
export interface EngineOptions {
	/** The canvas to draw into, sized by CSS. */
	canvas: HTMLCanvasElement;
	/** The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. */
	sketch: URL | string;
	/** Cap for the device pixel ratio. */
	maxPixelRatio?: number;
	/** Forces a GPU tier, for testing only. */
	gpu?: 'auto' | 'webgpu' | 'webgl2';
	/**
	 * Which GPU to draw with on a device that has two, such as a laptop with a separate graphics
	 * chip: `high-performance`, the default, for the faster one, or `low-power` to save battery.
	 * The browser treats it as a request. A device with one GPU ignores it.
	 */
	powerPreference?: 'high-performance' | 'low-power';
	/** The latency mode. The default is `pipelined`. */
	latency?: LatencyMode;
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
	 * The most objects and instance rows, counted together, that a scene can draw on this device.
	 * On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws
	 * more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows:
	 * 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every device allows. Engine memory
	 * can run out first: see E1109.
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
	/** The latency mode in use, or `single` for the single-thread build. */
	latency: LatencyMode | 'single';
	/** The thread that owns the canvas and draws. */
	renderThread: 'render-worker' | 'sketch-worker' | 'main';
	/** The job workers that share the engine's parallel work. */
	jobWorkers: number;
	/** The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. */
	hold: number | null;
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
	 * Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. In hold mode,
	 * it returns the held frame.
	 */
	captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/**
	 * Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and
	 * draws the whole scene again, as it does after a real loss. Use it to test how your page
	 * handles one.
	 */
	simulateGpuLoss(): void;
	/**
	 * Stops the engine and its workers. The engine cannot start again. The promise resolves once
	 * every worker has stopped, when the browser can free the engine's memory. Wait for it before
	 * you start another engine on the same page: an iPad has room for only a few engines' memory.
	 */
	destroy(): Promise<void>;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;
/** The GPU the engine asks for on a device with two: the faster one. */
const DEFAULT_POWER_PREFERENCE: PowerPreference = 'high-performance';
/** Logical cores kept free of job workers: one for the sketch worker, one for the render worker. */
const RESERVED_CORES = 2;
/** How often the page reads the frame records while it measures. */
const DRAIN_INTERVAL_MS = 250;
/** How many sketch messages the page keeps while no handler listens. */
const MAX_EARLY_MESSAGES = 256;
/** How long stopping the engine waits for its job workers to leave the job system. */
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

/** A worker whose replies are routed: sketch messages to handlers, answers to the oldest request. */
class EngineWorker {
	private readonly waiting: Pending[] = [];
	private readyPromise: Promise<WorkerReply>;
	private readonly stoppedPromise: Promise<void>;
	private started = false;

	constructor(
		readonly worker: Worker,
		role: string,
		onSketchMessage: (name: string, data: unknown) => void,
		onFailure: (error: EngineError) => void,
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
				onSketchMessage(reply.name, reply.data);
				return;
			}
			if (reply.type === 'lost') {
				onFailure(
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
				onFailure(new EngineError('E1404', `the ${role} worker failed: ${message}.`));
		};
	}

	ready(): Promise<WorkerReply> {
		return this.readyPromise;
	}

	/** Settles once a job worker has left the job system, or once the worker has failed. */
	stopped(): Promise<void> {
		return this.stoppedPromise;
	}

	request(message: { type: 'capture' }): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
			this.worker.postMessage(message);
		});
	}
}

/**
 * Stops the workers once every job worker has left the job system, or after a timeout. A job
 * worker without work blocks its thread in a wait. When Safari stops a thread inside such a wait,
 * it keeps the thread's shared memory until the tab closes, even across reloads.
 */
async function stopWorkers(workers: readonly EngineWorker[], jobs: readonly EngineWorker[]) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		Promise.all(jobs.map((job) => job.stopped())),
		new Promise((resolve) => {
			timer = setTimeout(resolve, STOP_TIMEOUT_MS);
		}),
	]);
	clearTimeout(timer);
	for (const w of workers) w.worker.terminate();
}

/**
 * Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the
 * workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then
 * draws that frame and reads it back. It publishes the frame, or the error that stopped it, as
 * `window.__null3dHold` for test tools.
 *
 * @category api/engine
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
	// The page's errors end with the fixes from its own table, and each worker gets the same table
	// in its handoff.
	setErrorFixes(ERROR_FIXES);
	const switches = parseSwitches(globalThis.location?.search ?? '');
	const holding = options.hold !== undefined || switches.hold !== undefined;
	try {
		const hold = holdSeconds(options.hold, switches.hold);
		if (holding) publishHold(undefined);
		return await startEngine(options, switches, hold);
	} catch (error) {
		if (holding) publishHold(holdFailure(error));
		throw error;
	}
}

/**
 * Starts the engine with the page's switches. With a hold time, it resolves once the held frame
 * is read back, and publishes it.
 */
async function startEngine(
	options: EngineOptions,
	switches: Switches,
	hold: number | undefined,
): Promise<Engine> {
	const startedAt = performance.now();
	const { signal, onProgress } = options;
	signal?.throwIfAborted();
	const maximumMiB = memoryMaximumMiB(options.memory?.maximumMiB, switches.memoryMiB);
	// Checked before any download, so an old browser learns at once why the engine cannot run.
	if (!WebAssembly.validate(SIMD_PROBE))
		throw new EngineError('E1303', 'this browser runs WebAssembly without SIMD.');
	// The build follows from facts the page has at once, so the core downloads and compiles while
	// the probe tests the GPU paths.
	const threaded =
		globalThis.crossOriginIsolated === true &&
		typeof SharedArrayBuffer === 'function' &&
		switches.threads;
	const build: Build = threaded ? 'threaded' : 'single';
	const latency = threaded ? (switches.latency ?? options.latency ?? 'pipelined') : 'single';
	let coreMs = 0;
	const coreLoad = awaitLater(
		loadCore(build, maximumMiB).then((loaded) => {
			coreMs = performance.now() - startedAt;
			return loaded;
		}),
	);
	const sketchUrl = new URL(options.sketch, globalThis.location?.href).href;
	// The page runs the sketch itself only in single-threaded mode. It needs the sketch runner and
	// the sketch module right after the core, so both download while the core does: a later start
	// delays the first frame on a slow network. The sketch module's top-level code then runs when the
	// module arrives. Hold mode loads the module once the runner has seeded the thread's random
	// numbers, so that code draws the same numbers on every run.
	const runnerModule = latency === 'single' ? loadRunnerModule() : undefined;
	const sketchModule =
		latency === 'single' && hold === undefined ? awaitLater(loadSketch(sketchUrl)) : undefined;
	const powerPreference = options.powerPreference ?? DEFAULT_POWER_PREFERENCE;
	const report = await abortable(probeCapabilities(powerPreference), signal);
	const probeMs = performance.now() - startedAt;
	const wanted = switches.gpu !== 'auto' ? switches.gpu : (options.gpu ?? 'auto');

	let renderThread: EngineMode['renderThread'] =
		latency === 'single' || switches.renderOnMain
			? 'main'
			: latency === 'low'
				? 'sketch-worker'
				: 'render-worker';
	let choice = chooseTier(report, wanted, renderThread !== 'main');
	if (!choice && renderThread === 'render-worker') {
		// Worker rendering is unavailable here, so the page draws while the sketch worker computes.
		renderThread = 'main';
		choice = chooseTier(report, wanted, false);
	}
	if (!choice)
		throw new EngineError('E1301', `no usable GPU path for ?gpu=${wanted} in this browser.`);
	const { tier, forceCompat } = choice;
	// What the thread that draws needs besides its canvas, whichever thread that is.
	const rendererSetup: Omit<RendererSetup, 'canvas'> = {
		tier,
		forceCompat,
		powerPreference,
		fps: switches.fps,
		hold: hold !== undefined,
	};

	const jobWorkers = threaded
		? (switches.jobs ?? Math.max(1, report.hardwareConcurrency - RESERVED_CORES))
		: 0;
	const control = createControlBuffer(threaded);
	const metrics = createMetricsBuffer(threaded, jobWorkers);
	const views = controlViews(control);
	const { slots } = views;
	Atomics.store(slots, Slot.Running, 1);
	const core = await abortable(coreLoad, signal);
	onProgress?.('core');
	// A page that draws loads the renderer after the core, whose download it would slow on a slow
	// network, and while the page starts the core and the sketch.
	const drawModule = renderThread === 'main' ? loadDrawModule() : undefined;
	let wasmMemory = core.memory;
	const device = coreDevice(tier === 'webgl2', report, switches);
	const handoff: CoreHandoff = {
		build,
		module: core.module,
		memory: core.memory,
		control,
		metrics,
		device,
		errorFixes: ERROR_FIXES,
	};
	const canvasWatch = watchCanvas(
		options.canvas,
		control,
		options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO,
	);
	canvasWatch.listen(true);
	// Hold mode keeps input out, so a held frame never depends on it.
	const takesInput = hold === undefined;
	const input = captureInput(options.canvas, control);
	input.listen(takesInput);
	const stopPreferences = watchPreferences(slots);

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
	const onFailure = (error: EngineError) => {
		if (reported.has(error.message)) return;
		reported.add(error.message);
		if (failureHandlers.size === 0) console.error(error);
		for (const handler of failureHandlers) handler(error);
	};
	let userPaused = false;
	let detached = false;
	const applyPause = () => {
		const paused = userPaused || detached;
		input.listen(takesInput && !paused);
		// Counted before the flag clears, so the sketch's first step after the pause sees it.
		if (!paused && Atomics.load(slots, Slot.Paused) !== 0) Atomics.add(slots, Slot.Resumes, 1);
		Atomics.store(slots, Slot.Paused, paused ? 1 : 0);
		Atomics.notify(slots, Slot.Paused);
	};
	const pageLoss = (reason: string) =>
		onFailure(new EngineError('E1302', `the page lost its GPU: ${reason}.`));
	let draw: DrawModule | undefined;
	/**
	 * Draws on the page's thread from the draw lists in `memory`, with the renderer that the page
	 * loads for it. With a sketch, the page steps it before each draw.
	 */
	const drawOnPage = async (memory: WebAssembly.Memory | undefined, sketch?: SketchRunner) => {
		draw = await (drawModule ?? loadDrawModule());
		return draw.startDrawing({
			canvas: options.canvas,
			...rendererSetup,
			metrics,
			device,
			scene: memory && { memory, control },
			control,
			sketch,
			fail: pageLoss,
		});
	};

	const workers: EngineWorker[] = [];
	const jobs: EngineWorker[] = [];
	let sketch: EngineWorker | undefined;
	let rendererHost: EngineWorker | undefined;
	let localDrawing: Drawing<Renderer> | undefined;
	let localRunner: SketchRunner | undefined;
	/** The single-threaded build's core, which the page keeps for the next engine it starts. */
	let localCore: CoreGlue | undefined;
	/** Stops every loop and then the workers, and wakes each thread that waits, so it sees the stop. */
	const stop = () => {
		Atomics.store(slots, Slot.Running, 0);
		for (const slot of [Slot.Running, Slot.FramesTaken, Slot.Paused, Slot.JobsReady])
			Atomics.notify(slots, slot);
		localDrawing?.stop();
		localRunner?.dispose();
		localCore?.destroyEngine();
		input.listen(false);
		canvasWatch.listen(false);
		stopPreferences();
		return stopWorkers(workers, jobs);
	};

	try {
		if (latency === 'single') {
			const started = await startCore('single', core.module);
			localCore = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			wasmMemory = memory;
			const { SketchRunner } = await (runnerModule ?? loadRunnerModule());
			localRunner = new SketchRunner(
				(name, data) => onSketchMessage(name, data),
				metrics,
				{ glue: started.glue, memory, control: views, keyCodes: KEY_CODES, jobWorkers: 0, device },
				hold,
			);
			await localRunner.setup(await (sketchModule ?? loadSketch(sketchUrl)));
			localDrawing = await drawOnPage(memory, localRunner);
		} else {
			sketch = new EngineWorker(
				new Worker(new URL('../workers/sketch-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-sketch',
				}),
				'sketch',
				onSketchMessage,
				onFailure,
			);
			workers.push(sketch);
			const init: SketchWorkerInit = {
				type: 'init',
				...handoff,
				sketchUrl,
				keyCodes: KEY_CODES,
				jobWorkers,
				hold,
			};
			if (renderThread === 'sketch-worker') {
				const canvas = options.canvas.transferControlToOffscreen();
				sketch.worker.postMessage({ ...init, renderer: { canvas, ...rendererSetup } }, [canvas]);
				rendererHost = sketch;
			} else {
				sketch.worker.postMessage(init);
				if (renderThread === 'render-worker') {
					const canvas = options.canvas.transferControlToOffscreen();
					rendererHost = new EngineWorker(
						new Worker(new URL('../workers/render-worker.ts', import.meta.url), {
							type: 'module',
							name: 'null3d-render',
						}),
						'render',
						onSketchMessage,
						onFailure,
					);
					workers.push(rendererHost);
					rendererHost.worker.postMessage({ type: 'init', ...handoff, canvas, ...rendererSetup }, [
						canvas,
					]);
				} else {
					localDrawing = await drawOnPage(core.memory);
				}
			}
			// The sketch and render threads start first; the engine is ready once they are.
			const essential = [...workers];
			for (let index = 0; index < jobWorkers; index++) {
				const job = new EngineWorker(
					new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
						type: 'module',
						name: `null3d-job-${index}`,
					}),
					`job ${index}`,
					onSketchMessage,
					onFailure,
				);
				workers.push(job);
				jobs.push(job);
				job.worker.postMessage({ type: 'init', ...handoff, index });
				// Job workers join the job system as each becomes ready: until then the sketch thread
				// and the job workers already running take every chunk, so no frame waits for them.
				job.ready().catch((error: unknown) => {
					if (Atomics.load(slots, Slot.Running) !== 0)
						onFailure(
							error instanceof EngineError ? error : startError(`job ${index}`, String(error)),
						);
				});
			}
			await abortable(Promise.all(essential.map((w) => w.ready())), signal);
		}
		signal?.throwIfAborted();
	} catch (e) {
		await stop();
		throw e;
	}

	const engineStartMs = performance.now() - startedAt;
	const mode: EngineMode = { build, latency, renderThread, jobWorkers, hold: hold ?? null };
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
	const features =
		tier === 'webgl2'
			? Object.keys(report.webgl2.extensions).filter((n) => report.webgl2.extensions[n])
			: report.webgpu.features;
	/** Hold mode's frame, read back once. */
	let held: CapturedFrame | undefined;
	/** Draws a frame offscreen on the thread that draws, and reads it back. */
	const capture = async (): Promise<CapturedFrame> => {
		if (localDrawing && draw) return draw.captureFrame(localDrawing, slots);
		const reply = await rendererHost?.request({ type: 'capture' });
		if (reply?.type === 'captured')
			return { width: reply.width, height: reply.height, pixels: reply.pixels };
		const reason = reply?.type === 'capture-failed' ? `: ${reply.message}` : '';
		throw new Error(`the frame could not be captured${reason}`);
	};

	const engine: Engine = {
		capabilities: {
			tier,
			threaded,
			features,
			limits: tier === 'webgl2' ? {} : report.webgpu.limits,
			maxInstances: maxInstances(device),
			depth: device.depth,
		},
		report,
		mode,
		firstFrame,
		postToSketch(name, data, transfer = []) {
			if (localRunner) localRunner.receive(name, data);
			else sketch?.worker.postMessage({ type: 'post', name, data }, transfer);
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
				},
				downloadBytes: { wasm: wasmDownloadBytes() },
				lostRecords: reader.lost,
				completionSignal: tier === 'webgl2' ? 'fence' : 'queue',
				refreshHz: reader.refreshHz > 0 ? reader.refreshHz : null,
				mainThread: mainThread.stop(),
			};
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
	if (hold === undefined) return engine;
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
	});
	return engine;
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
