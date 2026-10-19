// Starts a comparison with three.js on a canvas, with one engine, and gives a page what it needs to
// draw its own controls: the count, a measurement, the ramp and the stats panel. The examples page
// of a clone is one layout over these functions, and the website can draw another. One engine runs
// at a time: a page shows the other engine by loading again with `?engine=`.
//
// Both engines start with the same settings, which the fairness rules ask for:
// - the same scene description, seed and fixed-step simulation;
// - the same pixel ratio, the device class's cap, and 4x MSAA;
// - the same effects, each drawn by each engine's own technique;
// - null3D with its quality governor off and a fixed preset, and every pixel drawn;
// - three.js on the renderer that the GPU path names, in one worker with an OffscreenCanvas.

import { createEngine, type Engine } from '@null3d/engine';
import {
	MainThreadWindow,
	type PageMemory,
	PageMemorySampler,
	type StatsMainThread,
} from '@null3d/engine/stats';
import type { Comparison } from '../compare/comparisons';
import { type SceneSignature, SIGNATURE_MESSAGE } from '../compare/scene-signature';
import { threeBuildOf } from '../compare/three-builds';
import { allEffects, type CompareMode, type Effects, effectsToText } from './compare-scene';
import {
	type DeviceClass,
	deviceClass,
	type RampOptions,
	type RampPlan,
	type RampResult,
	renderPixelRatio,
	runRamp,
} from './ramp';
import { ThreeStatsMeter } from './stats-three';
import type { FromThree, ThreeRenderer, ThreeStart, ToThree } from './three-protocol';
import { threeHandler } from './three-worker';

export type EngineName = 'null3d' | 'threejs';

/** Each engine's name as a page shows it. */
export const ENGINE_TITLES: Readonly<Record<EngineName, string>> = {
	null3d: 'null3D',
	threejs: 'three.js',
};

/** Each mode's name as a page shows it. */
export const MODE_TITLES: Readonly<Record<CompareMode, string>> = {
	'scene-graph': 'Scene graph',
	instanced: 'Instanced',
};

/** The rules that keep a comparison fair, for a page's "about this comparison" panel. */
export const FAIRNESS_RULES: readonly string[] = [
	'Both engines run the same scene description: the same seed, layout, meshes, surfaces, lights, camera path and fixed-step simulation, so they show the same state at the same time.',
	'Both engines build the scene the same way in each mode: the same tree of one object per part in the scene graph mode, and one batch of copies per part kind, posed by the same loop, in the instanced mode.',
	"Both draw at the same pixel ratio, the device class's cap, with 4x MSAA, the same effects and the high-performance GPU.",
	"null3D runs with its quality governor off and a fixed preset, High or WebGL2's Medium, and draws every pixel. Ambient occlusion draws at half the size in each direction in both engines.",
	'three.js 0.186.1 runs on the renderer of the GPU path, WebGPURenderer on WebGPU and WebGLRenderer on WebGL2, in one worker with an OffscreenCanvas, with its add-ons and the methods of its official examples.',
	'One engine runs at a time: the page loads again for the other one.',
	"Memory has one definition: the browser's measurement of the whole page and its workers, with null3D's shared memory counted once.",
	"The ramp runs with the stats panel collapsed in both engines, so the figures carry none of the panel's cost.",
];

/** The GPU path that a comparison asks for: the `?gpu=` switch's values, or auto. */
export type GpuChoice = 'auto' | 'webgpu' | 'webgl2';

/** How a comparison starts. */
export interface ComparisonOptions {
	canvas: HTMLCanvasElement;
	comparison: Comparison;
	engine: EngineName;
	/** How both engines build the scene; the scene graph by default. */
	mode?: CompareMode;
	/** The count to start at; the ramp's start count by default. */
	count?: number;
	/** The effects to draw; every one by default. */
	effects?: Effects;
	/** The GPU path, which picks three.js's renderer too; auto by default. */
	gpu?: GpuChoice;
	/** three.js's renderer on a WebGPU device, in place of the faster one for the GPU path. */
	threeRenderer?: ThreeRenderer;
	/** Draw one frame at this simulation time and keep it, for image tests. */
	hold?: number;
	/**
	 * The most the count reaches, in place of the device class's ramp maximum. The instanced mode
	 * makes room for this many at its start, so a measurement at a fixed count can hold no more.
	 */
	maxCount?: number;
	/**
	 * The stats panel: false leaves it off, and 'open' starts it open. It starts collapsed by
	 * default, as on every demo.
	 */
	stats?: boolean | 'open';
}

/** What a measurement of a running comparison gives. */
export interface ComparisonMeasurement {
	/**
	 * Frames per second whose scene update ran to its end: the rate the ramp judges. A frame whose
	 * sketch update threw still presents, so a presented rate would hide it.
	 */
	fps: number;
	/**
	 * Frames of the measurement whose scene update failed, where the engine reports it. Nonzero
	 * means the sketch's own code, or a core call in a frame, threw.
	 */
	updateErrors?: number;
	/** Why the scene's update failed during the measurement, where the engine says so. */
	error?: string;
	/** CPU time per frame on the engine's busiest thread, in milliseconds. */
	cpuMs: number | null;
	/** The engine's own figures, for a closer look: per thread and phase, draws, uploads, memory. */
	detail?: Record<string, unknown>;
	/**
	 * The page thread's long tasks, its longest task and its longest input delay over the
	 * measurement, where the browser reports them.
	 */
	mainThread?: StatsMainThread | null;
	/**
	 * True when the engine drew no frame of the scene in the measurement, such as while three.js
	 * builds its shaders. Its frame rate is then 0, not the rate of empty frames.
	 */
	noFrame?: boolean;
}

/** A comparison that runs, with one engine. */
export interface ComparisonRun {
	engine: EngineName;
	mode: CompareMode;
	/** The engine, its version and its renderer, such as `three.js 0.186.1, WebGLRenderer`. */
	label: string;
	/** The GPU path that the engine draws with. */
	gpu: 'webgpu' | 'webgl2';
	deviceClass: DeviceClass;
	/** The ramp of this device class, whose maximum is the most this run can show. */
	plan: RampPlan;
	pixelRatio: number;
	/** The count that shows now. */
	readonly count: number;
	setCount(count: number): void;
	/** Measures the next `seconds` of frames. */
	measure(seconds: number): Promise<ComparisonMeasurement>;
	/**
	 * Measures the memory of the whole page and its workers once, with null3D's shared memory
	 * counted once. It gives null where the browser offers no measurement or refuses it.
	 */
	measureMemory(): Promise<PageMemory | null>;
	/** Opens or closes the stats panel's card; the ramp runs with it closed. */
	collapseStats(collapsed: boolean): void;
	/**
	 * The most of the count that this engine can draw on this device, and why, where it finds a
	 * limit below the ramp's maximum: three.js's WebGLRenderer holds only so many lights in a
	 * shader. The ramp and `setCount` stop there.
	 */
	limit?: { count: number; reason: string };
	/** The last reason the engine gave for drawing nothing, such as a shader that failed to link. */
	readonly failure: string | null;
	/** The held frame, RGBA8 rows from the top, for a run started with `hold`. */
	held?: { width: number; height: number; pixels: Uint8Array };
	/**
	 * Asks the sketch for a signature of its scene now: its camera's place, which moves in every
	 * update. A test that checks the scene keeps moving asks at each ramp step, and a scene that
	 * stopped updating answers the same as the step before. Absent for three.js, whose half answers
	 * no such message.
	 */
	sceneSignature?(): Promise<SceneSignature>;
	/** Stops the engine and frees its memory. */
	destroy(): Promise<void>;
}

/**
 * Measures the display's refresh rate: the median interval of the page's next `frames` frames, or
 * of those that come within `limitMs`. A busy software GPU can hold the page's frames seconds apart
 * while an engine draws; the measurement then ends after two of them, not after minutes.
 */
export function measureDisplayHz(frames = 40, limitMs = 1000): Promise<number> {
	return new Promise((resolve) => {
		const intervals: number[] = [];
		let first = -1;
		let last = -1;
		const tick = (time: number) => {
			if (last >= 0) intervals.push(time - last);
			else first = time;
			last = time;
			if (intervals.length < frames && (intervals.length === 0 || time - first < limitMs)) {
				requestAnimationFrame(tick);
				return;
			}
			intervals.sort((a, b) => a - b);
			const median = intervals[Math.floor(intervals.length / 2)] ?? 1000 / 60;
			resolve(Math.round(1000 / median));
		};
		requestAnimationFrame(tick);
	});
}

/** One measurement of the whole page's memory, with a memory of `sharedBytes` counted once. */
function pageMemoryOnce(sharedBytes: number): Promise<PageMemory | null> {
	if (!PageMemorySampler.supported) return Promise.resolve(null);
	return new Promise((resolve) => {
		const done = (memory: PageMemory | null) => {
			clearInterval(refused);
			sampler.stop();
			resolve(memory);
		};
		const sampler = new PageMemorySampler(
			() => sharedBytes,
			() => done(sampler.page),
		);
		// The sampler hears of a refusal, or of a browser that never answers, without a call, so the
		// wait looks for either.
		const refused = setInterval(() => {
			if (sampler.failure || !sampler.page) done(null);
		}, 1000);
		sampler.start();
	});
}

/** This device's class, by its screen and its pointer. */
export function thisDeviceClass(): DeviceClass {
	return deviceClass({
		shortSideCss: Math.min(screen.width, screen.height),
		coarsePointer: matchMedia('(pointer: coarse)').matches,
	});
}

/** The GPU path that both engines take: the one asked for, or WebGPU where the browser has it. */
async function gpuPath(choice: GpuChoice): Promise<'webgpu' | 'webgl2'> {
	if (choice !== 'auto') return choice;
	const gpu = (navigator as { gpu?: GPU }).gpu;
	const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' });
	return adapter ? 'webgpu' : 'webgl2';
}

/**
 * three.js's renderer on a GPU path: WebGLRenderer on WebGL2 and WebGPURenderer on WebGPU, so an
 * engine on a path meets the other engine on the same path. `?renderer=webgl` puts the WebGPU path
 * on WebGLRenderer, to compare the two renderers.
 */
function threeRendererFor(gpu: 'webgpu' | 'webgl2', asked?: ThreeRenderer): ThreeRenderer {
	if (gpu === 'webgl2') return 'webgl';
	return asked ?? 'webgpu';
}

/** Starts a comparison with one engine, and resolves once it draws. */
export async function startComparison(options: ComparisonOptions): Promise<ComparisonRun> {
	const { canvas, comparison } = options;
	const cls = thisDeviceClass();
	const classPlan = comparison.ramps[cls];
	const plan = options.maxCount ? { ...classPlan, max: options.maxCount } : classPlan;
	const count = Math.min(plan.max, options.count ?? plan.start);
	const effects = options.effects ?? allEffects();
	const pixelRatio = renderPixelRatio(cls, devicePixelRatio);
	const gpu = await gpuPath(options.gpu ?? 'auto');
	// The demos zoom with the wheel and a trackpad pinch, which would otherwise scroll the page.
	canvas.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
	const mode = options.mode ?? 'scene-graph';
	const common = { comparison, mode, count, effects, plan, pixelRatio, cls, gpu };
	if (options.engine === 'null3d') return startNull3d(canvas, options, common);
	// A mode that only WebGPURenderer can draw takes it on both GPU paths: in its WebGL2 mode on
	// the WebGL2 path.
	const needed = comparison.threeRenderers?.[mode];
	const renderer = needed ?? threeRendererFor(gpu, options.threeRenderer);
	return startThree(canvas, options, common, renderer, needed !== undefined && gpu === 'webgl2');
}

interface Common {
	comparison: Comparison;
	mode: CompareMode;
	count: number;
	effects: Effects;
	plan: RampPlan;
	pixelRatio: number;
	cls: DeviceClass;
	gpu: 'webgpu' | 'webgl2';
}

async function startNull3d(
	canvas: HTMLCanvasElement,
	options: ComparisonOptions,
	{ comparison, mode, count, effects, plan, pixelRatio, cls, gpu }: Common,
): Promise<ComparisonRun> {
	// The sketch reads its settings from its own address; the plugin ships it by the literal one.
	const sketch = new URL(comparison.sketch);
	const capacity = options.hold === undefined ? plan.max : count;
	sketch.searchParams.set('capacity', String(capacity));
	sketch.searchParams.set('count', String(count));
	sketch.searchParams.set('mode', mode);
	sketch.searchParams.set('effects', effectsToText(effects));
	const stats = options.stats ?? true;
	// The last error that the sketch's own code threw, which a step whose update failed reports.
	let sketchError: string | undefined;
	const engine: Engine = await createEngine({
		canvas,
		sketch,
		gpu,
		onSketchError: (error) => {
			sketchError = error.message;
		},
		// A fixed preset: High, which WebGL2 caps at Medium. The sketch turns the governor off.
		preset: 'high',
		maxPixelRatio: pixelRatio,
		antialias: 'msaa',
		shadowTiles: comparison.shadowTiles,
		shadowTileSize: 1024,
		// Room for the objects at the start count: the scene grows with the count.
		expectedObjects: comparison.objectsAt(count, mode) + 1024,
		stats: stats !== false && { collapsed: stats !== 'open' },
		hold: options.hold,
	});
	let shown = count;
	// Scene-signature requests in flight, matched to the sketch's answers by token.
	const signatures = new Map<number, (signature: SceneSignature) => void>();
	let signatureToken = 0;
	engine.onSketchMessage((name, data) => {
		if (name !== SIGNATURE_MESSAGE) return;
		const signature = data as SceneSignature;
		const resolve = signatures.get(signature.token);
		if (!resolve) return;
		signatures.delete(signature.token);
		resolve(signature);
	});
	const run: ComparisonRun = {
		engine: 'null3d',
		mode,
		label: `null3D, ${engine.capabilities.tier}, ${engine.mode.preset}`,
		gpu: engine.capabilities.tier === 'webgl2' ? 'webgl2' : 'webgpu',
		deviceClass: cls,
		plan,
		pixelRatio,
		failure: null,
		get count() {
			return shown;
		},
		setCount(next) {
			shown = Math.min(plan.max, next);
			engine.postToSketch('count', shown);
		},
		async measure(seconds) {
			const watch = new MainThreadWindow();
			const metrics = await engine.measure(seconds);
			const mainThread = watch.take();
			watch.stop();
			const threads = Object.fromEntries(
				Object.entries(metrics.threads).map(([name, { busyMs, phases }]) => [
					name,
					{
						busyMs: busyMs.mean,
						phases: Object.fromEntries(
							Object.entries(phases).map(([phase, ms]) => [phase, ms?.mean]),
						),
					},
				]),
			);
			return {
				fps: metrics.updatedFps,
				updateErrors: metrics.updateErrors,
				...(metrics.updateErrors > 0 && {
					error: sketchError ?? 'its update threw before it moved the scene',
				}),
				cpuMs: metrics.cpuMs.mean,
				mainThread,
				detail: {
					threads,
					cpuMsAllThreads: metrics.cpuMsAllThreads.mean,
					gpuMs: metrics.gpuMs?.mean ?? null,
					gpuPassMs: metrics.gpuPassMs?.map(({ name, ms }) => ({ name, ms: ms.mean })) ?? null,
					drawCalls: metrics.drawCalls.mean,
					uploadBytes: metrics.uploadBytes.mean,
					wasmBytes: metrics.memory.wasmBytes,
					jsHeap: metrics.memory.jsHeap,
				},
			};
		},
		async measureMemory() {
			// A short measurement gives the size of the engine's memory, which its threads share.
			const { memory } = await engine.measure(0.25);
			return pageMemoryOnce(memory.wasmBytes ?? 0);
		},
		collapseStats(collapsed) {
			if (stats !== false) engine.stats({ collapsed });
		},
		sceneSignature() {
			const token = ++signatureToken;
			return new Promise((resolve) => {
				signatures.set(token, resolve);
				engine.postToSketch(SIGNATURE_MESSAGE, token);
			});
		},
		destroy: () => engine.destroy({ release: true }),
	};
	if (options.hold !== undefined) run.held = await engine.captureFrame();
	else await engine.firstFrame;
	return run;
}

/** The thread that runs three.js: a worker of its own, or the page's own thread. */
interface ThreeThread {
	/** True when three.js runs on the page's thread and draws into the canvas itself. */
	onPage: boolean;
	postMessage(message: ToThree, transfer?: Transferable[]): void;
	onmessage: ((event: { data: FromThree }) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	terminate(): void;
}

/**
 * Starts the thread that runs a comparison's three.js half: its worker, or, for a comparison that
 * runs three.js on the page's thread as three.js's own examples do, the same code on the page.
 */
async function threeThread(comparison: Comparison): Promise<ThreeThread> {
	if (comparison.threeOnPage) {
		const builder = await threeBuildOf(comparison);
		const thread: ThreeThread = {
			onPage: true,
			onmessage: null,
			onerror: null,
			postMessage: (message) => handle(message),
			terminate: () => {},
		};
		// Replies arrive as a worker's would, after the call that caused them returns.
		const handle = threeHandler(
			builder,
			(reply) => queueMicrotask(() => thread.onmessage?.({ data: reply })),
			() => {},
		);
		return thread;
	}
	const worker = comparison.startThree();
	return {
		onPage: false,
		postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
		set onmessage(listener: ThreeThread['onmessage']) {
			worker.onmessage = listener as Worker['onmessage'];
		},
		get onmessage() {
			return worker.onmessage as ThreeThread['onmessage'];
		},
		set onerror(listener: ThreeThread['onerror']) {
			worker.onerror = listener;
		},
		get onerror() {
			return worker.onerror;
		},
		terminate: () => worker.terminate(),
	};
}

async function startThree(
	canvas: HTMLCanvasElement,
	options: ComparisonOptions,
	{ comparison, mode, count, effects, plan, pixelRatio, cls, gpu }: Common,
	renderer: ThreeRenderer,
	forceWebGL: boolean,
): Promise<ComparisonRun> {
	const worker = await threeThread(comparison);
	const send = (message: ToThree, transfer: Transferable[] = []) =>
		worker.postMessage(message, transfer);
	const held = options.hold !== undefined;
	const stats = held ? false : (options.stats ?? true);
	const meter =
		stats === false
			? null
			: new ThreeStatsMeter({
					canvas,
					collapsed: stats !== 'open',
					sample: (on) => send({ type: 'sample', on }),
					refreshHz: await measureDisplayHz(),
				});
	const width = canvas.clientWidth || canvas.width;
	const height = canvas.clientHeight || canvas.height;
	const start: ThreeStart = {
		capacity: held ? count : plan.max,
		count,
		mode,
		effects,
		renderer,
		forceWebGL,
		width,
		height,
		pixelRatio: held ? 1 : pixelRatio,
		hold: options.hold ?? null,
		// three.js's timestamps cost time in every frame, so it times the GPU only when the page
		// starts with the panel open.
		gpuTimer: stats === 'open',
	};
	// A worker draws into the canvas's offscreen twin; three.js on the page draws into the canvas.
	const offscreen = worker.onPage
		? (canvas as unknown as OffscreenCanvas)
		: canvas.transferControlToOffscreen();
	const measurements = new Map<number, (result: ComparisonMeasurement) => void>();
	let nextMeasurement = 0;
	let started: (value: { label: string; held?: ComparisonRun['held'] }) => void;
	let failed: (error: Error) => void;
	let limit: ComparisonRun['limit'];
	const ready = new Promise<{ label: string; held?: ComparisonRun['held'] }>((resolve, reject) => {
		started = resolve;
		failed = reject;
	});
	let label = '';
	let failure: string | null = null;
	worker.onmessage = ({ data }) => {
		switch (data.type) {
			case 'started':
				label = `${data.version}, ${data.renderer}`;
				limit = data.limit && data.limit.count < plan.max ? data.limit : undefined;
				meter?.started(data.renderer, data.version, data.gpuTimer);
				return;
			case 'failure':
				failure = data.message;
				return;
			case 'drawn':
				// A live run starts at its first frame that draws, as null3D's starts at its first frame.
				if (!held) started({ label });
				return;
			case 'held':
				started({ label, held: { width: data.width, height: data.height, pixels: data.pixels } });
				return;
			case 'failed':
				failed(new Error(data.message));
				return;
			case 'rate':
				meter?.rate(data.frames, data.fps);
				return;
			case 'figures':
				meter?.figures(data.figures);
				return;
			case 'measured':
				measurements.get(data.id)?.({
					fps: data.fps,
					cpuMs: data.cpuMs,
					detail: { codeMs: data.codeMs, renderMs: data.renderMs },
					...(data.frames === 0 && { noFrame: true }),
				});
				measurements.delete(data.id);
				return;
		}
	};
	worker.onerror = (event) => failed(new Error(event.message || 'the three.js worker failed'));
	send({ type: 'start', canvas: offscreen, options: start }, worker.onPage ? [] : [offscreen]);
	const resize = new ResizeObserver(() => {
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w > 0 && h > 0) send({ type: 'resize', width: w, height: h, pixelRatio });
	});
	if (!held) resize.observe(canvas);
	const result = await ready.catch((error: Error) => {
		resize.disconnect();
		meter?.remove();
		worker.terminate();
		throw error;
	});
	const runPlan = limit ? { ...plan, max: limit.count } : plan;
	let shown = Math.min(count, runPlan.max);
	return {
		engine: 'threejs',
		mode,
		label: result.label,
		gpu,
		deviceClass: cls,
		plan: runPlan,
		limit,
		pixelRatio,
		held: result.held,
		get failure() {
			return failure;
		},
		get count() {
			return shown;
		},
		setCount(next) {
			shown = Math.min(runPlan.max, next);
			send({ type: 'count', count: shown });
		},
		measure(seconds) {
			const id = nextMeasurement++;
			const watch = new MainThreadWindow();
			return new Promise((resolve) => {
				measurements.set(id, (result) => {
					resolve({ ...result, mainThread: watch.take() });
					watch.stop();
				});
				send({ type: 'measure', id, seconds });
			});
		},
		// three.js shares no memory between threads.
		measureMemory: () => pageMemoryOnce(0),
		collapseStats(collapsed) {
			meter?.setCollapsed(collapsed);
		},
		async destroy() {
			resize.disconnect();
			meter?.remove();
			send({ type: 'stop' });
			worker.terminate();
		},
	};
}

/**
 * Runs the ramp on a running comparison, with its stats panel collapsed so the figures carry no
 * cost of the panel, after a short warm-up at the start count.
 */
export async function rampComparison(
	run: ComparisonRun,
	options: RampOptions & { plan?: RampPlan; warmupSeconds?: number } = {},
): Promise<RampResult> {
	const started = performance.now();
	run.collapseStats(true);
	const plan = options.plan ?? run.plan;
	run.setCount(plan.start);
	// The warm-up takes the caller's wait, so a page's stop ends it at once.
	const wait =
		options.wait ??
		((seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)));
	await wait(options.warmupSeconds ?? 2);
	const result = await runRamp(run, plan, options);
	if (result.stopReason === 'no-frame')
		result.failure = run.failure ?? 'it drew no frame within the step';
	result.seconds = (performance.now() - started) / 1000;
	return result;
}
