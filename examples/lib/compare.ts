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
import { type PageMemory, PageMemorySampler } from '@null3d/engine/stats';
import type { Comparison } from '../compare/comparisons';
import { allEffects, type Effects, effectsToText } from './compare-scene';
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

export type EngineName = 'null3d' | 'threejs';

/** Each engine's name as a page shows it. */
export const ENGINE_TITLES: Readonly<Record<EngineName, string>> = {
	null3d: 'null3D',
	threejs: 'three.js',
};

/** The rules that keep a comparison fair, for a page's "about this comparison" panel. */
export const FAIRNESS_RULES: readonly string[] = [
	'Both engines run the same scene description: the same seed, layout, meshes, surfaces, lights, camera path and fixed-step simulation, so they show the same state at the same time.',
	"Both draw at the same pixel ratio, the device class's cap, with 4x MSAA, the same effects and the high-performance GPU.",
	"null3D runs with its quality governor off and a fixed preset, High or WebGL2's Medium, and draws every pixel. Ambient occlusion draws at half the size in each direction in both engines.",
	'three.js 0.186.1 runs on the faster of its two renderers for the GPU path, in one worker with an OffscreenCanvas, with its add-ons and the methods of its official examples.',
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
	 * The most the count reaches, in place of the device class's ramp maximum. Both engines make
	 * room for this many at their start, so a measurement at a fixed count can hold no more.
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
	/** Frames presented per second. */
	fps: number;
	/** CPU time per frame on the engine's busiest thread, in milliseconds. */
	cpuMs: number | null;
	/** The engine's own figures, for a closer look: per thread and phase, draws, uploads, memory. */
	detail?: Record<string, unknown>;
}

/** A comparison that runs, with one engine. */
export interface ComparisonRun {
	engine: EngineName;
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
	/** The held frame, RGBA8 rows from the top, for a run started with `hold`. */
	held?: { width: number; height: number; pixels: Uint8Array };
	/** Stops the engine and frees its memory. */
	destroy(): Promise<void>;
}

/** Measures the display's refresh rate over about half a second: the median interval of frames. */
export function measureDisplayHz(frames = 40): Promise<number> {
	return new Promise((resolve) => {
		const intervals: number[] = [];
		let last = -1;
		const tick = (time: number) => {
			if (last >= 0) intervals.push(time - last);
			last = time;
			if (intervals.length < frames) {
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
 * three.js's renderer on a GPU path: WebGLRenderer on WebGL2, and the faster of its two renderers
 * on WebGPU. In Chrome on the Mac, WebGLRenderer took a quarter of WebGPURenderer's CPU time per
 * frame on Factory, so it is the default until a device sitting shows otherwise; `?renderer=webgpu`
 * picks the other.
 */
function threeRendererFor(gpu: 'webgpu' | 'webgl2', asked?: ThreeRenderer): ThreeRenderer {
	if (gpu === 'webgl2') return 'webgl';
	return asked ?? FASTER_THREE_RENDERER;
}

/** three.js's faster renderer on a WebGPU device, from the measured ramps. */
export const FASTER_THREE_RENDERER: ThreeRenderer = 'webgl';

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
	const common = { comparison, count, effects, plan, pixelRatio, cls, gpu };
	return options.engine === 'null3d'
		? startNull3d(canvas, options, common)
		: startThree(canvas, options, common, threeRendererFor(gpu, options.threeRenderer));
}

interface Common {
	comparison: Comparison;
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
	{ comparison, count, effects, plan, pixelRatio, cls, gpu }: Common,
): Promise<ComparisonRun> {
	// The sketch reads its settings from its own address; the plugin ships it by the literal one.
	const sketch = new URL(comparison.sketch);
	const capacity = options.hold === undefined ? plan.max : count;
	sketch.searchParams.set('capacity', String(capacity));
	sketch.searchParams.set('count', String(count));
	sketch.searchParams.set('effects', effectsToText(effects));
	const stats = options.stats ?? true;
	const engine: Engine = await createEngine({
		canvas,
		sketch,
		gpu,
		// A fixed preset: High, which WebGL2 caps at Medium. The sketch turns the governor off.
		preset: 'high',
		maxPixelRatio: pixelRatio,
		antialias: 'msaa',
		shadowTiles: comparison.shadowTiles,
		shadowTileSize: 1024,
		expectedObjects: comparison.objectsAt(capacity) + 1024,
		stats: stats !== false && { collapsed: stats !== 'open' },
		hold: options.hold,
	});
	let shown = count;
	const run: ComparisonRun = {
		engine: 'null3d',
		label: `null3D, ${engine.capabilities.tier}, ${engine.mode.preset}`,
		gpu: engine.capabilities.tier === 'webgl2' ? 'webgl2' : 'webgpu',
		deviceClass: cls,
		plan,
		pixelRatio,
		get count() {
			return shown;
		},
		setCount(next) {
			shown = Math.min(plan.max, next);
			engine.postToSketch('count', shown);
		},
		async measure(seconds) {
			const metrics = await engine.measure(seconds);
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
				fps: metrics.presentedFps,
				cpuMs: metrics.cpuMs.mean,
				detail: {
					threads,
					cpuMsAllThreads: metrics.cpuMsAllThreads.mean,
					gpuMs: metrics.gpuMs?.mean ?? null,
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
		destroy: () => engine.destroy({ release: true }),
	};
	if (options.hold !== undefined) run.held = await engine.captureFrame();
	else await engine.firstFrame;
	return run;
}

async function startThree(
	canvas: HTMLCanvasElement,
	options: ComparisonOptions,
	{ comparison, count, effects, plan, pixelRatio, cls, gpu }: Common,
	renderer: ThreeRenderer,
): Promise<ComparisonRun> {
	const worker = comparison.startThree();
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
		effects,
		renderer,
		width,
		height,
		pixelRatio: held ? 1 : pixelRatio,
		hold: options.hold ?? null,
		// three.js's timestamps cost time in every frame, so it times the GPU only when the page
		// starts with the panel open.
		gpuTimer: stats === 'open',
	};
	const offscreen = canvas.transferControlToOffscreen();
	const measurements = new Map<number, (result: ComparisonMeasurement) => void>();
	let nextMeasurement = 0;
	let started: (value: { label: string; held?: ComparisonRun['held'] }) => void;
	let failed: (error: Error) => void;
	const ready = new Promise<{ label: string; held?: ComparisonRun['held'] }>((resolve, reject) => {
		started = resolve;
		failed = reject;
	});
	let label = '';
	worker.onmessage = ({ data }: MessageEvent<FromThree>) => {
		switch (data.type) {
			case 'started':
				label = `${data.version}, ${data.renderer}`;
				meter?.started(data.renderer, data.version, data.gpuTimer);
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
				});
				measurements.delete(data.id);
				return;
		}
	};
	worker.onerror = (event) => failed(new Error(event.message || 'the three.js worker failed'));
	send({ type: 'start', canvas: offscreen, options: start }, [offscreen]);
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
	let shown = count;
	return {
		engine: 'threejs',
		label: result.label,
		gpu,
		deviceClass: cls,
		plan,
		pixelRatio,
		held: result.held,
		get count() {
			return shown;
		},
		setCount(next) {
			shown = Math.min(plan.max, next);
			send({ type: 'count', count: shown });
		},
		measure(seconds) {
			const id = nextMeasurement++;
			return new Promise((resolve) => {
				measurements.set(id, resolve);
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
	options: Omit<RampOptions, 'displayHz'> & { plan?: RampPlan; warmupSeconds?: number } = {},
): Promise<RampResult> {
	run.collapseStats(true);
	const plan = options.plan ?? run.plan;
	run.setCount(plan.start);
	await new Promise((resolve) => setTimeout(resolve, (options.warmupSeconds ?? 2) * 1000));
	const displayHz = await measureDisplayHz();
	return runRamp(run, plan, { ...options, displayHz });
}
