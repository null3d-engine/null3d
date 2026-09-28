// createEngine: the page side of the engine. It probes the device, picks the build and the GPU tier,
// starts the workers, and hands the canvas to the thread that draws.

import { EngineError } from '../errors/engine-error';
import { GameRunner } from '../game/runner';
import { runDirectLoop } from '../render/direct-loop';
import { emptySceneInput, type RenderLoop, runRenderLoop, stopOnLoss } from '../render/loop';
import { createRenderer, type Renderer, type Tier } from '../render/renderer';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { type Build, startCore } from '../shared/core';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import type { CoreHandoff, WorkerReply } from '../workers/protocol';
import { type CapabilityReport, probeCapabilities } from './capabilities';
import {
	type FrameMetrics,
	HeapSampler,
	summarizeFrames,
	threadRoles,
	wasmDownloadBytes,
} from './frame-stats';
import { captureInput } from './input';
import { loadCore } from './loader';
import { type GpuSwitch, type LatencyMode, parseSwitches } from './switches';

/**
 * Options for `createEngine`.
 *
 * @category api/engine
 */
export interface EngineOptions {
	/** The canvas to draw into, sized by CSS. */
	canvas: HTMLCanvasElement;
	/** The game module, which runs in the game worker; `new URL('./game.ts', import.meta.url)`. */
	game: URL | string;
	/** Cap for the device pixel ratio. */
	maxPixelRatio?: number;
	/** Forces a GPU tier, for testing only. */
	gpu?: 'auto' | 'webgpu' | 'webgl2';
	/** The latency mode. The default is `pipelined`. */
	latency?: LatencyMode;
}

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
}

/**
 * How the engine runs on this device: its build, its latency mode and its threads.
 *
 * @category api/engine
 */
export interface EngineMode {
	/**
	 * With `threaded`, the game and the render step run in workers, helped by job workers. With
	 * `single`, everything runs on the page's thread, for pages without shared memory.
	 */
	build: 'threaded' | 'single';
	/** The latency mode in use, or `single` for the single-thread build. */
	latency: LatencyMode | 'single';
	/** The thread that owns the canvas and draws. */
	renderThread: 'render-worker' | 'game-worker' | 'main';
	/** The job workers that share the engine's parallel work. */
	jobWorkers: number;
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
	/** Sends a message to the game, which receives it through `ctx.page.onMessage`. */
	postToGame(name: string, data?: unknown, transfer?: Transferable[]): void;
	/** Receives the messages the game sends with `ctx.page.post`. */
	onGameMessage(handler: (name: string, data: unknown) => void): void;
	/**
	 * Receives a failure after the engine started: the browser took the GPU away (E1302), or an
	 * engine thread failed (E1404). The engine reports each failure once. Without a handler, it logs
	 * the failure to the console.
	 */
	onFailure(handler: (error: EngineError) => void): void;
	/** Pauses or resumes the game's frames. */
	setPaused(paused: boolean): void;
	/**
	 * Measures the running engine for a number of seconds, then returns CPU time per frame by thread
	 * and phase, GPU time, frame intervals, uploads, draw calls, memory and load time.
	 */
	measure(seconds: number): Promise<FrameMetrics>;
	/** Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. */
	captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/** Stops the engine and its workers. The engine cannot start again. */
	destroy(): void;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;
/** Logical cores kept free of job workers: one for the game worker, one for the render worker. */
const RESERVED_CORES = 2;
/** How often the page reads the frame records while it measures. */
const DRAIN_INTERVAL_MS = 250;

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

/** A worker whose replies are routed: game messages to handlers, answers to the oldest request. */
class EngineWorker {
	private readonly waiting: Pending[] = [];
	private readyPromise: Promise<WorkerReply>;
	private started = false;

	constructor(
		readonly worker: Worker,
		role: string,
		onGameMessage: (name: string, data: unknown) => void,
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
		worker.onmessage = (event: MessageEvent<WorkerReply>) => {
			const reply = event.data;
			if (reply.type === 'game-message') {
				onGameMessage(reply.name, reply.data);
				return;
			}
			if (reply.type === 'lost') {
				onFailure(
					new EngineError('E1302', `the ${reply.role} worker lost its GPU: ${reply.reason}.`),
				);
				return;
			}
			const pending = this.waiting.shift();
			if (!pending) return;
			if (reply.type === 'error')
				pending.reject(new Error(`${reply.role} worker: ${reply.message}`));
			else pending.resolve(reply);
		};
		worker.onerror = (event) => {
			const message = event.message || 'a worker failed';
			this.waiting.shift()?.reject(new Error(message));
			if (this.started)
				onFailure(new EngineError('E1404', `the ${role} worker failed: ${message}.`));
		};
	}

	ready(): Promise<WorkerReply> {
		return this.readyPromise;
	}

	request(message: { type: 'capture' }): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
			this.worker.postMessage(message);
		});
	}
}

/**
 * Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the
 * workers, and runs the game module.
 *
 * @category api/engine
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
	const startedAt = performance.now();
	const switches = parseSwitches(globalThis.location?.search ?? '');
	const report = await probeCapabilities();
	const threaded = report.crossOriginIsolated && report.sharedArrayBuffer && switches.threads;
	const build: Build = threaded ? 'threaded' : 'single';
	const latency = threaded ? (switches.latency ?? options.latency ?? 'pipelined') : 'single';
	const wanted = switches.gpu !== 'auto' ? switches.gpu : (options.gpu ?? 'auto');

	let renderThread: EngineMode['renderThread'] =
		latency === 'single' || switches.renderOnMain
			? 'main'
			: latency === 'low'
				? 'game-worker'
				: 'render-worker';
	let choice = chooseTier(report, wanted, renderThread !== 'main');
	if (!choice && renderThread === 'render-worker') {
		// Worker rendering is unavailable here, so the page draws while the game worker computes.
		renderThread = 'main';
		choice = chooseTier(report, wanted, false);
	}
	if (!choice)
		throw new EngineError('E1301', `no usable GPU path for ?gpu=${wanted} in this browser.`);
	const { tier, forceCompat } = choice;

	const jobWorkers = threaded ? Math.max(1, report.hardwareConcurrency - RESERVED_CORES) : 0;
	const control = createControlBuffer(threaded);
	const metrics = createMetricsBuffer(threaded, jobWorkers);
	const { slots } = controlViews(control);
	Atomics.store(slots, Slot.Running, 1);
	const core = await loadCore(build);
	let wasmMemory = core.memory;
	const gameUrl = new URL(options.game, globalThis.location?.href).href;
	const handoff: CoreHandoff = {
		build,
		module: core.module,
		memory: core.memory,
		control,
		metrics,
	};
	const input = captureInput(
		options.canvas,
		control,
		options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO,
	);

	const messageHandlers: ((name: string, data: unknown) => void)[] = [];
	const onGameMessage = (name: string, data: unknown) => {
		for (const handler of messageHandlers) handler(name, data);
	};
	const failureHandlers: ((error: EngineError) => void)[] = [];
	const reported = new Set<string>();
	const onFailure = (error: EngineError) => {
		if (reported.has(error.message)) return;
		reported.add(error.message);
		if (failureHandlers.length === 0) console.error(error);
		for (const handler of failureHandlers) handler(error);
	};
	const pageLoss = (reason: string) =>
		onFailure(new EngineError('E1302', `the page lost its GPU: ${reason}.`));

	const workers: EngineWorker[] = [];
	let game: EngineWorker | undefined;
	let rendererHost: EngineWorker | undefined;
	let localRenderer: Renderer | undefined;
	let localLoop: RenderLoop | undefined;
	let localRunner: GameRunner | undefined;

	try {
		if (latency === 'single') {
			const started = await startCore('single', core.module);
			const memory = started.memory as WebAssembly.Memory;
			wasmMemory = memory;
			localRunner = new GameRunner((name, data) => onGameMessage(name, data), metrics, {
				glue: started.glue,
				memory,
				slots,
				jobWorkers: 0,
			});
			await localRunner.load(gameUrl);
			localRenderer = await createRenderer(options.canvas, {
				tier,
				forceCompat,
				metrics,
				scene: { memory, control },
			});
			localLoop = runDirectLoop(localRunner, localRenderer, control, metrics);
			stopOnLoss(localRenderer, localLoop, pageLoss);
		} else {
			game = new EngineWorker(
				new Worker(new URL('../workers/game-worker.ts', import.meta.url), {
					type: 'module',
					name: 'null3d-game',
				}),
				'game',
				onGameMessage,
				onFailure,
			);
			workers.push(game);
			if (renderThread === 'game-worker') {
				const canvas = options.canvas.transferControlToOffscreen();
				game.worker.postMessage(
					{
						type: 'init',
						...handoff,
						gameUrl,
						jobWorkers,
						renderer: { canvas, tier, forceCompat },
					},
					[canvas],
				);
				rendererHost = game;
			} else {
				game.worker.postMessage({ type: 'init', ...handoff, gameUrl, jobWorkers });
				if (renderThread === 'render-worker') {
					const canvas = options.canvas.transferControlToOffscreen();
					rendererHost = new EngineWorker(
						new Worker(new URL('../workers/render-worker.ts', import.meta.url), {
							type: 'module',
							name: 'null3d-render',
						}),
						'render',
						onGameMessage,
						onFailure,
					);
					workers.push(rendererHost);
					rendererHost.worker.postMessage({ type: 'init', ...handoff, canvas, tier, forceCompat }, [
						canvas,
					]);
				} else {
					localRenderer = await createRenderer(options.canvas, {
						tier,
						forceCompat,
						metrics,
						scene: core.memory && { memory: core.memory, control },
					});
					localLoop = runRenderLoop(localRenderer, control, metrics);
					stopOnLoss(localRenderer, localLoop, pageLoss);
				}
			}
			for (let index = 0; index < jobWorkers; index++) {
				const job = new EngineWorker(
					new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
						type: 'module',
						name: `null3d-job-${index}`,
					}),
					`job ${index}`,
					onGameMessage,
					onFailure,
				);
				workers.push(job);
				job.worker.postMessage({ type: 'init', ...handoff, index });
			}
			await Promise.all(workers.map((w) => w.ready()));
		}
	} catch (e) {
		Atomics.store(slots, Slot.Running, 0);
		for (const w of workers) w.worker.terminate();
		input.stop();
		throw e;
	}

	const engineStartMs = performance.now() - startedAt;
	const mode: EngineMode = { build, latency, renderThread, jobWorkers };
	const features =
		tier === 'webgl2'
			? Object.keys(report.webgl2.extensions).filter((n) => report.webgl2.extensions[n])
			: report.webgpu.features;

	return {
		capabilities: {
			tier,
			threaded,
			features,
			limits: tier === 'webgl2' ? {} : report.webgpu.limits,
		},
		report,
		mode,
		postToGame(name, data, transfer = []) {
			if (localRunner) localRunner.receive(name, data);
			else game?.worker.postMessage({ type: 'post', name, data }, transfer);
		},
		onGameMessage(handler) {
			messageHandlers.push(handler);
		},
		onFailure(handler) {
			failureHandlers.push(handler);
		},
		setPaused(paused) {
			// Counted before the flag clears, so the game's first step after the pause sees it.
			if (!paused && Atomics.load(slots, Slot.Paused) !== 0) Atomics.add(slots, Slot.Resumes, 1);
			Atomics.store(slots, Slot.Paused, paused ? 1 : 0);
			Atomics.notify(slots, Slot.Paused);
		},
		async measure(seconds) {
			const reader = new MetricsReader(metrics);
			const heap = new HeapSampler();
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
					firstFrameMs: firstFrame > 0 ? firstFrame - performance.timeOrigin : null,
				},
				downloadBytes: { wasm: wasmDownloadBytes() },
				lostRecords: reader.lost,
			};
		},
		async captureFrame() {
			if (localRenderer)
				return localRenderer.capture(emptySceneInput(Atomics.load(slots, Slot.FramesTaken)));
			const reply = await rendererHost?.request({ type: 'capture' });
			if (reply?.type !== 'captured') throw new Error('the frame could not be captured');
			return { width: reply.width, height: reply.height, pixels: reply.pixels };
		},
		destroy() {
			Atomics.store(slots, Slot.Running, 0);
			Atomics.notify(slots, Slot.FramesTaken);
			Atomics.notify(slots, Slot.Paused);
			localLoop?.stop();
			localRenderer?.destroy();
			for (const w of workers) w.worker.terminate();
			input.stop();
		},
	};
}
