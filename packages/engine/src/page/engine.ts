// createEngine: the page side of the engine. It probes the device, picks the build and the GPU tier,
// starts the workers, and hands the canvas to the thread that draws.

import { EngineError } from '../errors/engine-error';
import { GameRunner } from '../game/runner';
import { runDirectLoop } from '../render/direct-loop';
import { emptySceneInput, type RenderLoop, runRenderLoop } from '../render/loop';
import { createRenderer, type Renderer, type Tier } from '../render/renderer';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { type Build, startCore } from '../shared/core';
import type { Percentiles } from '../shared/stats';
import type { CoreHandoff, WorkerReply } from '../workers/protocol';
import { type CapabilityReport, probeCapabilities } from './capabilities';
import { captureInput } from './input';
import { loadCore } from './loader';
import { type GpuSwitch, type LatencyMode, parseSwitches } from './switches';

export interface EngineOptions {
	/** The canvas to draw into, sized by CSS. */
	canvas: HTMLCanvasElement;
	/** The game module, which runs in the game worker; `new URL('./game.ts', import.meta.url)`. */
	game: URL | string;
	/** Cap for the device pixel ratio. */
	maxPixelRatio?: number;
	/** Forces a GPU tier, for testing only. */
	gpu?: 'auto' | 'webgpu' | 'webgl2';
	/** Pipelined (the render step runs one frame behind, in its own worker) or low latency. */
	latency?: LatencyMode;
}

export interface EngineCapabilities {
	tier: Tier;
	threaded: boolean;
	features: string[];
	limits: Record<string, number | null>;
}

export interface EngineMode {
	build: Build;
	latency: LatencyMode | 'single';
	/** The thread that owns the canvas and draws. */
	renderThread: 'render-worker' | 'game-worker' | 'main';
	jobWorkers: number;
}

export interface Engine {
	readonly capabilities: EngineCapabilities;
	/** The full capability report, as plain JSON. */
	readonly report: CapabilityReport;
	readonly mode: EngineMode;
	postToGame(name: string, data?: unknown, transfer?: Transferable[]): void;
	onGameMessage(handler: (name: string, data: unknown) => void): void;
	setPaused(paused: boolean): void;
	/** Intervals between presented frames, in milliseconds. */
	frameStats(): Promise<Percentiles>;
	/** Draws one frame offscreen and returns its pixels as RGBA8 rows, top row first. */
	captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	destroy(): void;
}

const DEFAULT_MAX_PIXEL_RATIO = 2;
/** Logical cores kept free of job workers: one for the game worker, one for the render worker. */
const RESERVED_CORES = 2;

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

	constructor(
		readonly worker: Worker,
		onGameMessage: (name: string, data: unknown) => void,
	) {
		this.readyPromise = new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
		});
		worker.onmessage = (event: MessageEvent<WorkerReply>) => {
			const reply = event.data;
			if (reply.type === 'game-message') {
				onGameMessage(reply.name, reply.data);
				return;
			}
			const pending = this.waiting.shift();
			if (!pending) return;
			if (reply.type === 'error')
				pending.reject(new Error(`${reply.role} worker: ${reply.message}`));
			else pending.resolve(reply);
		};
		worker.onerror = (event) => {
			const pending = this.waiting.shift();
			pending?.reject(new Error(event.message || 'a worker failed to start'));
		};
	}

	ready(): Promise<WorkerReply> {
		return this.readyPromise;
	}

	request(message: { type: 'stats' } | { type: 'capture' }): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
			this.worker.postMessage(message);
		});
	}
}

export async function createEngine(options: EngineOptions): Promise<Engine> {
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

	const control = createControlBuffer(threaded);
	const { slots } = controlViews(control);
	Atomics.store(slots, Slot.Running, 1);
	const core = await loadCore(build);
	const gameUrl = new URL(options.game, globalThis.location?.href).href;
	const handoff: CoreHandoff = { build, module: core.module, memory: core.memory, control };
	const input = captureInput(
		options.canvas,
		control,
		options.maxPixelRatio ?? DEFAULT_MAX_PIXEL_RATIO,
	);

	const messageHandlers: ((name: string, data: unknown) => void)[] = [];
	const onGameMessage = (name: string, data: unknown) => {
		for (const handler of messageHandlers) handler(name, data);
	};

	const workers: EngineWorker[] = [];
	let game: EngineWorker | undefined;
	let rendererHost: EngineWorker | undefined;
	let localRenderer: Renderer | undefined;
	let localLoop: RenderLoop | undefined;
	let localRunner: GameRunner | undefined;
	const jobWorkers = threaded ? Math.max(1, report.hardwareConcurrency - RESERVED_CORES) : 0;

	try {
		if (latency === 'single') {
			await startCore('single', core.module);
			localRunner = new GameRunner((name, data) => onGameMessage(name, data));
			await localRunner.load(gameUrl);
			localRenderer = await createRenderer(options.canvas, { tier, forceCompat });
			localLoop = runDirectLoop(localRunner, localRenderer, control);
		} else {
			game = new EngineWorker(
				new Worker(new URL('../workers/game-worker.ts', import.meta.url), {
					type: 'module',
					name: 'sokko3d-game',
				}),
				onGameMessage,
			);
			workers.push(game);
			if (renderThread === 'game-worker') {
				const canvas = options.canvas.transferControlToOffscreen();
				game.worker.postMessage(
					{ type: 'init', ...handoff, gameUrl, renderer: { canvas, tier, forceCompat } },
					[canvas],
				);
				rendererHost = game;
			} else {
				game.worker.postMessage({ type: 'init', ...handoff, gameUrl });
				if (renderThread === 'render-worker') {
					const canvas = options.canvas.transferControlToOffscreen();
					rendererHost = new EngineWorker(
						new Worker(new URL('../workers/render-worker.ts', import.meta.url), {
							type: 'module',
							name: 'sokko3d-render',
						}),
						onGameMessage,
					);
					workers.push(rendererHost);
					rendererHost.worker.postMessage({ type: 'init', ...handoff, canvas, tier, forceCompat }, [
						canvas,
					]);
				} else {
					await startCore('threaded', core.module, core.memory);
					localRenderer = await createRenderer(options.canvas, { tier, forceCompat });
					localLoop = runRenderLoop(localRenderer, control);
				}
			}
			for (let index = 0; index < jobWorkers; index++) {
				const job = new EngineWorker(
					new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
						type: 'module',
						name: `sokko3d-job-${index}`,
					}),
					onGameMessage,
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
		mode: { build, latency, renderThread, jobWorkers },
		postToGame(name, data, transfer = []) {
			if (localRunner) localRunner.receive(name, data);
			else game?.worker.postMessage({ type: 'post', name, data }, transfer);
		},
		onGameMessage(handler) {
			messageHandlers.push(handler);
		},
		setPaused(paused) {
			Atomics.store(slots, Slot.Paused, paused ? 1 : 0);
			Atomics.notify(slots, Slot.Paused);
		},
		async frameStats() {
			if (localLoop) return localLoop.intervals.intervals.summary();
			const reply = await rendererHost?.request({ type: 'stats' });
			if (reply?.type !== 'stats') throw new Error('no frame statistics');
			return reply.intervals;
		},
		async captureFrame() {
			if (localRenderer)
				return localRenderer.capture(emptySceneInput(Atomics.load(slots, Slot.FramesPublished)));
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
