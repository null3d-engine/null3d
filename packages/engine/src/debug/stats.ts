// Frame figures for the stats overlay and `debug.frameStats`: means per frame over windows of about
// half a second of presented frames, read from the rings of the metrics buffer, and the memory
// figures that the sketch thread publishes in its header. Reading takes in only the records written
// since the last read and allocates nothing, so a sketch may read every frame. The figures live in a
// typed array, and the published object's properties read them, because a fraction stored in an
// object property is a new heap object in some browsers.

import type { QualityPreset } from '../quality/presets';
import {
	Counter,
	memoryFigures,
	PHASE_NAMES,
	type PhaseName,
	RingSums,
	Role,
	SUM_BUSY_MS,
	SUM_COUNTERS,
	SUM_INTERVAL_MS,
	SUM_PHASES,
	SUM_RECORDS,
} from '../shared/metrics';
import type { Tier } from '../shared/tier';

/**
 * One thread's CPU time per frame, in `FrameStats.threads`.
 *
 * @category api/debug
 */
export interface FrameStatsThread {
	/**
	 * The thread, named as `engine.measure` names it: `main`, `sketch-worker`, `render-worker`,
	 * `job-0` and so on.
	 */
	readonly name: string;
	/** Mean CPU time per frame on this thread, in milliseconds. */
	readonly busyMs: number;
	/** Mean CPU time per frame of each phase, in milliseconds: 0 for a phase that runs elsewhere. */
	readonly phases: Readonly<Record<PhaseName, number>>;
}

/**
 * Figures of the running engine, as `debug.frameStats()` returns them and the stats overlay shows
 * them. Each figure per frame is a mean over the frames of the last window: about half a second of
 * presented frames. The figures change when a window ends, and stay the same while the engine
 * presents no frames.
 *
 * @category api/debug
 */
export interface FrameStats {
	/** Frames that the engine presented in the window, or 0 before the first window ended. */
	readonly frames: number;
	/** The window's length in seconds. */
	readonly seconds: number;
	/** Frames per second that the engine presented. */
	readonly presentedFps: number;
	/**
	 * Frames per second that the GPU finished. Below `presentedFps`, frames queue on the GPU, and
	 * the display shows fewer than the presented rate suggests.
	 */
	readonly completedFps: number;
	/** Mean CPU time per frame of the busiest thread, in milliseconds. */
	readonly cpuMs: number;
	/** CPU time per frame of each engine thread. */
	readonly threads: readonly FrameStatsThread[];
	/**
	 * Mean GPU time per frame, in milliseconds, from the GPU's timer queries on one frame in eleven:
	 * from the frame's first command to the end of its last pass. Null where the GPU path has no
	 * timer queries, and until the first timed frame comes back. The window that has no timed frame
	 * keeps the figure of the window before it.
	 */
	readonly gpuMs: number | null;
	/** Mean draw calls per frame, over every pass. */
	readonly drawCalls: number;
	/**
	 * Mean triangles drawn per frame, over every pass: shadow maps and the depth prepass count as
	 * well as the passes that shade, as three.js's `renderer.info` counts them. Lines count none.
	 * On WebGPU the GPU culls most objects, and the count of their triangles comes back from the GPU
	 * on one frame in eleven, a few frames late.
	 */
	readonly triangles: number;
	/**
	 * Mean objects drawn per frame, over every pass: each draw counts its instances, so an object
	 * counts once in each pass that draws it, such as a shadow cascade, and each part of a mesh with
	 * several materials counts once. On WebGPU the count of the objects that the GPU culls comes
	 * back from the GPU on one frame in eleven, a few frames late.
	 */
	readonly objects: number;
	/** Mean bytes uploaded to the GPU per frame. */
	readonly uploadBytes: number;
	/** The GPU path the engine draws with. */
	readonly tier: Tier;
	/** The quality preset that the engine runs. */
	readonly preset: QualityPreset;
	/**
	 * The render scale of the newest frame: the share of the canvas's width and height that the
	 * scene draws at, from 0 to 1. Dynamic resolution moves it during play.
	 */
	readonly renderScale: number;
	/** The size of the engine's WebAssembly memory at the window's end, in bytes. */
	readonly wasmBytes: number;
	/**
	 * The GPU bytes that every texture takes at the window's end, with the free layers of their
	 * texture arrays: `quality.textureMemory.bytes`.
	 */
	readonly textureBytes: number;
	/** The GPU bytes that textures may take: the quality setting `textureMemoryMiB` in bytes. */
	readonly textureBudgetBytes: number;
	/** The largest mip levels that the texture memory budget dropped, over every texture. */
	readonly droppedLevels: number;
	/**
	 * The GPU bytes that every mesh takes at the window's end: the shared vertex and index buffers,
	 * which keep room to grow, and the texture of morph target deltas, as `geometry.memoryBytes`.
	 */
	readonly meshBytes: number;
}

/** Presented time that a window of frame figures covers, at least. */
export const STATS_WINDOW_MS = 500;

/** What frame figures read besides the rings, each when a window ends. */
export interface StatsSources {
	tier: Tier;
	/** The quality preset that the engine runs now. */
	preset(): QualityPreset;
	/** The render scale of the newest frame, in thousandths. */
	renderScaleThousandths(): number;
	/** The size of the engine's WebAssembly memory in bytes. */
	wasmBytes(): number;
}

// Float64 slots of the published figures, in the order of `FIGURES`, then each thread's busy time
// and phases.
const FIGURES = [
	'frames',
	'seconds',
	'presentedFps',
	'completedFps',
	'cpuMs',
	'drawCalls',
	'triangles',
	'objects',
	'uploadBytes',
	'renderScale',
	'wasmBytes',
	'textureBytes',
	'textureBudgetBytes',
	'droppedLevels',
	'meshBytes',
] as const;
const FRAMES = 0;
const SECONDS = 1;
const PRESENTED_FPS = 2;
const COMPLETED_FPS = 3;
const CPU_MS = 4;
const DRAW_CALLS = 5;
const TRIANGLES = 6;
const OBJECTS = 7;
const UPLOAD_BYTES = 8;
const RENDER_SCALE = 9;
const WASM_BYTES = 10;
/** The published memory figures, in the order of `MemoryFigure`. */
const MEMORY = 11;
/** GPU time per frame, or -1 before the first timed frame, which the property reads as null. */
const GPU_MS = FIGURES.length;
const THREADS = GPU_MS + 1;
/** Slots of each thread: its busy time, then each phase's time. */
const THREAD_VALUES = 1 + PHASE_NAMES.length;

/**
 * Gives `target` a property for each name that reads the slot of `values` at `at` plus the name's
 * place. The properties are enumerable, so a copy of the object or its JSON holds the figures.
 */
function readFigures<T extends object>(
	target: T,
	names: readonly string[],
	values: Float64Array,
	at: number,
): T {
	names.forEach((name, k) => {
		Object.defineProperty(target, name, { enumerable: true, get: () => values[at + k] });
	});
	return target;
}

/** The figures as the window writes them. */
type Published = { -readonly [Key in keyof FrameStats]: FrameStats[Key] };

/** A ring's records per second: its count over its summed intervals, or 0 without time. */
function rate(sums: Float64Array): number {
	const ms = sums[SUM_INTERVAL_MS] as number;
	return ms > 0 ? ((sums[SUM_RECORDS] as number) * 1000) / ms : 0;
}

/** The mean per record of one of a ring's sums, or 0 without records. */
function mean(sums: Float64Array, index: number): number {
	const records = sums[SUM_RECORDS] as number;
	return records > 0 ? (sums[index] as number) / records : 0;
}

/** The mean of a drawn count, triangles or objects, over the records that knew it, or 0. */
function drawnMean(sums: Float64Array, counter: number): number {
	const records =
		(sums[SUM_RECORDS] as number) - (sums[SUM_COUNTERS + Counter.UncountedFigures] as number);
	return records > 0 ? (sums[SUM_COUNTERS + counter] as number) / records : 0;
}
/**
 * Reads frame figures from a metrics buffer. Each `update` takes in the records written since the
 * last one; once the presented frames in them cover a window, it publishes the window's figures to
 * `stats` and starts the next window.
 */
export class FrameStatsWindow {
	/** The latest window's figures. The same object, updated in place. */
	readonly stats: FrameStats;
	private readonly published: Published;
	private readonly values: Float64Array;
	/** The sums of each ring that the figures read, by role. */
	private readonly rings: (RingSums | undefined)[] = [];
	private readonly render: RingSums;
	private readonly completion: RingSums;
	/** The GPU's timed frames, which the windows share until one holds a timed frame. */
	private readonly gpu: RingSums;
	/** The memory figures that the sketch thread publishes. */
	private readonly memory: Float64Array;
	/** The roles of each thread, in the order of `stats.threads`. */
	private readonly roles: readonly (readonly number[])[];

	/**
	 * `threads` names each engine thread with the roles it runs, as `engine.measure` names them.
	 * The figures cover the records written after this call.
	 */
	constructor(
		buffer: ArrayBufferLike,
		threads: Iterable<readonly [string, readonly number[]]>,
		private readonly sources: StatsSources,
	) {
		const list = [...threads];
		this.values = new Float64Array(THREADS + list.length * THREAD_VALUES);
		this.values[RENDER_SCALE] = sources.renderScaleThousandths() / 1000;
		this.values[GPU_MS] = -1;
		this.gpu = new RingSums(buffer, Role.Gpu);
		this.memory = memoryFigures(buffer);
		const ring = (role: number): RingSums => {
			let sums = this.rings[role];
			if (!sums) {
				sums = new RingSums(buffer, role, true);
				this.rings[role] = sums;
			}
			return sums;
		};
		this.render = ring(Role.Render);
		this.completion = ring(Role.Completion);
		for (const [, roles] of list) for (const role of roles) ring(role);
		this.roles = list.map(([, roles]) => roles);
		const values = this.values;
		const stats = readFigures({} as Published, FIGURES, values, 0);
		Object.defineProperty(stats, 'gpuMs', {
			enumerable: true,
			get: () => ((values[GPU_MS] as number) >= 0 ? values[GPU_MS] : null),
		});
		stats.threads = list.map(([name], k) => {
			const at = THREADS + k * THREAD_VALUES;
			const thread = readFigures({ name } as FrameStatsThread, ['busyMs'], values, at);
			return Object.assign(thread, {
				phases: readFigures({} as Record<PhaseName, number>, PHASE_NAMES, values, at + 1),
			});
		});
		stats.tier = sources.tier;
		stats.preset = sources.preset();
		this.published = stats;
		this.stats = stats;
	}

	/** Takes in the new records, and publishes a window when one has ended. True when it did. */
	update(): boolean {
		for (const sums of this.rings) sums?.add();
		this.gpu.add();
		const render = this.render.sums;
		if ((render[SUM_INTERVAL_MS] as number) < STATS_WINDOW_MS) return false;
		const { values, rings } = this;
		values[FRAMES] = render[SUM_RECORDS] as number;
		values[SECONDS] = (render[SUM_INTERVAL_MS] as number) / 1000;
		values[PRESENTED_FPS] = rate(render);
		values[COMPLETED_FPS] = rate(this.completion.sums);
		values[DRAW_CALLS] = mean(render, SUM_COUNTERS + Counter.DrawCalls);
		values[TRIANGLES] = drawnMean(render, Counter.Triangles);
		values[OBJECTS] = drawnMean(render, Counter.DrawnObjects);
		values[UPLOAD_BYTES] = mean(render, SUM_COUNTERS + Counter.UploadBytes);
		values[RENDER_SCALE] = this.sources.renderScaleThousandths() / 1000;
		values[WASM_BYTES] = this.sources.wasmBytes();
		values.set(this.memory, MEMORY);
		const gpu = this.gpu.sums;
		if ((gpu[SUM_RECORDS] as number) > 0) {
			values[GPU_MS] = mean(gpu, SUM_BUSY_MS);
			this.gpu.clear();
		}
		let busiest = 0;
		for (let k = 0; k < this.roles.length; k++) {
			const at = THREADS + k * THREAD_VALUES;
			values.fill(0, at, at + THREAD_VALUES);
			for (const role of this.roles[k] as readonly number[]) {
				const sums = (rings[role] as RingSums).sums;
				values[at] = (values[at] as number) + mean(sums, SUM_BUSY_MS);
				for (let p = 0; p < PHASE_NAMES.length; p++)
					values[at + 1 + p] = (values[at + 1 + p] as number) + mean(sums, SUM_PHASES + p);
			}
			busiest = Math.max(busiest, values[at] as number);
		}
		values[CPU_MS] = busiest;
		this.published.preset = this.sources.preset();
		for (const sums of rings) sums?.clear();
		return true;
	}
}
