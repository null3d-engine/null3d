// Turns the frame records of one measurement into its metrics: CPU time per frame by thread and
// phase, GPU time, frame intervals, uploads and draw calls, memory, load time and download size.

import {
	COUNTER_NAMES,
	Counter,
	PHASE_NAMES,
	type PhaseName,
	type RingRecords,
	Role,
} from '../shared/metrics';
import { type Percentiles, percentiles } from '../shared/stats';

/**
 * One thread's CPU time per frame, in `FrameSummary.threads`.
 *
 * @category api/debug
 */
export interface ThreadStats {
	/** CPU time per frame on this thread. */
	busyMs: Percentiles;
	/** CPU time per frame of each phase that ran on this thread. */
	phases: Partial<Record<PhaseName, Percentiles>>;
}

/**
 * Per-frame figures of a measurement: CPU time by thread, GPU time, frame intervals, uploads and
 * draw calls.
 *
 * @category api/debug
 */
export interface FrameSummary {
	/** Frames that the game computed and the renderer drew within the measurement. */
	frames: number;
	/** CPU time per frame of the busiest thread, the time that limits the frame rate. */
	cpuMs: Percentiles;
	/** CPU time per frame summed over every thread. */
	cpuMsAllThreads: Percentiles;
	/** Per thread, by name: `main`, `game-worker`, `render-worker`, `job-0` and so on. */
	threads: Record<string, ThreadStats>;
	/** GPU time per frame, where the device has timestamp queries. */
	gpuMs: Percentiles | null;
	/**
	 * The step between GPU times when the browser rounds its timestamps, or null when they look exact.
	 * Chrome rounds them unless its WebGPU developer features are turned on.
	 */
	gpuStepMs: number | null;
	/** Time between presented frames. */
	intervalMs: Percentiles;
	/** Frames per second that the renderer presented. */
	presentedFps: number;
	/**
	 * Frames per second that the GPU finished. Below `presentedFps`, frames queue on the GPU, and the
	 * display shows fewer than the presented rate suggests. Null when no completion arrived.
	 */
	completedFps: number | null;
	/**
	 * Time from a frame's submit to the GPU finishing it. With a WebGL2 fence, the engine sees
	 * completion at its next frame callback, so the figure rounds up to frame intervals.
	 */
	gpuLatencyMs: Percentiles | null;
	/** Bytes uploaded to the GPU per frame. */
	uploadBytes: Percentiles;
	/** Draw calls per frame. */
	drawCalls: Percentiles;
	/**
	 * Frames whose structure change rebuilt the draw tables: objects created or destroyed, meshes or
	 * materials changed, or batches created or destroyed. Steady play has none; showing or hiding
	 * objects and changing a batch's active count do not rebuild.
	 */
	rebuilds: number;
}

/**
 * Memory figures of a measurement.
 *
 * @category api/debug
 */
export interface MemoryStats {
	/** Size of the engine's WebAssembly memory at the end of the measurement. */
	wasmBytes: number | null;
	/**
	 * JavaScript heap by global scope: the page and its workers when a measurement of them finished
	 * during the run, otherwise the page alone where the browser reports that. Chrome adds shared
	 * memory, such as the engine's own, to the figure of each worker that holds it, so worker
	 * figures overlap and can far exceed the worker's own heap.
	 */
	jsHeap: { bytes: number; byScope: Record<string, number> } | null;
	/** Measurements of the page and its workers that finished during the run, for long runs. */
	jsHeapSamples: { atSeconds: number; bytes: number }[];
	/**
	 * Why the heap figures cover only the page, or null when they also cover the workers that run
	 * JavaScript each frame.
	 */
	jsHeapNote: string | null;
}

/**
 * What `engine.measure` returns: the per-frame figures, memory, load time and download size.
 *
 * @category api/debug
 */
export interface FrameMetrics extends FrameSummary {
	/** Length of the measurement. */
	seconds: number;
	/** The engine's WebAssembly memory and the JavaScript heap. */
	memory: MemoryStats;
	/** How long the engine took to start and to draw its first frame, in milliseconds. */
	load: {
		/** Time createEngine took. */
		engineStartMs: number;
		/** Time from the start of createEngine until the probe of the GPU paths finished. */
		probeMs: number;
		/** Time from the start of createEngine until the core was downloaded and compiled. */
		coreMs: number;
		/** Time from the start of page navigation to the submit of the first drawn frame. */
		firstFrameMs: number | null;
		/** Time from the start of page navigation until the GPU finished the first frame. */
		firstFrameDoneMs: number | null;
	};
	/** Bytes of the engine's WebAssembly file as the page downloaded it. */
	downloadBytes: { wasm: number | null };
	/** Frame records the page read too late; nonzero means some frames are missing from the figures. */
	lostRecords: number;
	/** How the renderer learned that the GPU finished a frame: its queue (WebGPU) or a fence (WebGL2). */
	completionSignal: 'queue' | 'fence';
	/** The display's refresh rate in hertz, as the thread that draws measured it, or null before then. */
	refreshHz: number | null;
	/** The page's own thread during the measurement, where the browser reports it, or null. */
	mainThread: MainThreadStats | null;
}

/**
 * The page's own thread during a measurement: tasks that kept it busy for 50 ms or more, and the
 * delay before the page handled input.
 *
 * @category api/debug
 */
export interface MainThreadStats {
	/** Tasks of 50 ms or more on the page's thread. */
	longTasks: number;
	/** The longest of them, or 0 when there were none. */
	longestTaskMs: number;
	/** Time from each input event to the page starting to handle it, or null without input. */
	inputDelayMs: Percentiles | null;
}

/** The thread each role runs on in an engine mode, keyed by thread name. */
export function threadRoles(mode: {
	latency: string;
	renderThread: string;
	jobWorkers: number;
}): Map<string, number[]> {
	const threads = new Map<string, number[]>();
	if (mode.latency === 'single') threads.set('main', [Role.Game, Role.Render]);
	else if (mode.renderThread === 'game-worker')
		threads.set('game-worker', [Role.Game, Role.Render]);
	else {
		threads.set('game-worker', [Role.Game]);
		threads.set(mode.renderThread, [Role.Render]);
	}
	for (let k = 0; k < mode.jobWorkers; k++) threads.set(`job-${k}`, [Role.Job + k]);
	return threads;
}

const NO_RECORDS: RingRecords = {
	frames: [],
	busy: [],
	intervals: [],
	phases: PHASE_NAMES.map(() => []),
	counters: COUNTER_NAMES.map(() => []),
};

/** Joins the records of every role by frame and summarizes them per frame and per thread. */
export function summarizeFrames(
	records: readonly RingRecords[],
	threads: ReadonlyMap<string, readonly number[]>,
): FrameSummary {
	const ring = (role: number) => records[role] ?? NO_RECORDS;
	const indexes = records.map((r) => new Map(r.frames.map((frame, i) => [frame, i])));
	const drawn = indexes[Role.Render] ?? new Map<number, number>();
	const frames = ring(Role.Game).frames.filter((frame) => drawn.has(frame));

	const slowest = new Float64Array(frames.length);
	const total = new Float64Array(frames.length);
	const threadStats: Record<string, ThreadStats> = {};
	for (const [name, roles] of threads) {
		if (roles.every((role) => ring(role).frames.length === 0)) continue;
		const busy = new Float64Array(frames.length);
		const phases = PHASE_NAMES.map(() => new Float64Array(frames.length));
		frames.forEach((frame, i) => {
			for (const role of roles) {
				const at = indexes[role]?.get(frame);
				if (at === undefined) continue;
				const records = ring(role);
				busy[i] = (busy[i] as number) + (records.busy[at] as number);
				phases.forEach((values, p) => {
					values[i] = (values[i] as number) + (records.phases[p]?.[at] as number);
				});
			}
			slowest[i] = Math.max(slowest[i] as number, busy[i] as number);
			total[i] = (total[i] as number) + (busy[i] as number);
		});
		const phaseStats: ThreadStats['phases'] = {};
		phases.forEach((values, p) => {
			if (values.some((v) => v > 0)) phaseStats[PHASE_NAMES[p] as PhaseName] = percentiles(values);
		});
		threadStats[name] = { busyMs: percentiles(busy), phases: phaseStats };
	}

	const render = ring(Role.Render);
	const gpu = ring(Role.Gpu).busy;
	const completion = ring(Role.Completion);
	const intervals = render.intervals.filter((ms) => ms > 0);
	const completed = completion.intervals.filter((ms) => ms > 0);
	return {
		frames: frames.length,
		cpuMs: percentiles(slowest),
		cpuMsAllThreads: percentiles(total),
		threads: threadStats,
		gpuMs: gpu.length > 0 ? percentiles(gpu) : null,
		gpuStepMs: timerStep(gpu),
		intervalMs: percentiles(intervals),
		presentedFps: ratePerSecond(intervals) ?? 0,
		completedFps: ratePerSecond(completed),
		gpuLatencyMs: completion.busy.length > 0 ? percentiles(completion.busy) : null,
		uploadBytes: percentiles(render.counters[Counter.UploadBytes] ?? []),
		drawCalls: percentiles(render.counters[Counter.DrawCalls] ?? []),
		rebuilds: (render.counters[Counter.Rebuilds] ?? []).filter((n) => n > 0).length,
	};
}

/** Events per second from the intervals between them, or null without intervals. */
export function ratePerSecond(intervalsMs: readonly number[]): number | null {
	if (intervalsMs.length === 0) return null;
	let sum = 0;
	for (const ms of intervalsMs) sum += ms;
	return sum > 0 ? (1000 * intervalsMs.length) / sum : null;
}

/** Below this, a step between GPU times is timer precision, not rounding. */
const MIN_ROUNDING_STEP_MS = 0.01;

/** The smallest GPU time, when every other time is a whole multiple of it. */
export function timerStep(times: readonly number[]): number | null {
	let step = Number.POSITIVE_INFINITY;
	for (const ms of times) if (ms > 0 && ms < step) step = ms;
	if (!Number.isFinite(step) || step < MIN_ROUNDING_STEP_MS) return null;
	const whole = times.every((ms) => Math.abs(ms / step - Math.round(ms / step)) < 1e-3);
	return whole ? step : null;
}

interface MemoryMeasurement {
	bytes: number;
	breakdown: { bytes: number; attribution: { url?: string; scope?: string }[] }[];
}

type MeasureMemory = () => Promise<MemoryMeasurement>;

/** Time from one heap sample's arrival to the request for the next. */
const HEAP_SAMPLE_GAP_MS = 5000;

/**
 * Samples the JavaScript heap of the page and its workers, where the browser offers a measurement
 * that covers workers (Chrome, on a cross-origin isolated page). Chrome answers when every worker
 * has run the measurement as a task, or after a minute. Job workers never return to their event
 * loop while the engine runs, so each sample takes about a minute and leaves them out. They run no
 * JavaScript after they start, so their heap stays the same size. A shorter run reports the page's
 * own heap, where the browser offers that.
 */
export class HeapSampler {
	private readonly samples: MemoryStats['jsHeapSamples'] = [];
	private last: MemoryMeasurement | undefined;
	private running = false;
	private supported = false;
	private failure: string | null = null;

	start(): void {
		const measure = (performance as { measureUserAgentSpecificMemory?: MeasureMemory })
			.measureUserAgentSpecificMemory;
		// The browser offers the measurement only on a cross-origin isolated page.
		if (!measure) return;
		this.supported = true;
		this.running = true;
		const started = performance.now();
		const sample = async () => {
			while (this.running) {
				const result = await measure.call(performance);
				if (!this.running) return;
				this.last = result;
				this.samples.push({ atSeconds: (performance.now() - started) / 1000, bytes: result.bytes });
				await new Promise((resolve) => setTimeout(resolve, HEAP_SAMPLE_GAP_MS));
			}
		};
		sample().catch((error: unknown) => {
			this.running = false;
			const reason = error instanceof Error ? error.message : String(error);
			this.failure = `the browser refused the measurement: ${reason}`;
		});
	}

	stop(): Pick<MemoryStats, 'jsHeap' | 'jsHeapSamples' | 'jsHeapNote'> {
		this.running = false;
		if (!this.last)
			return {
				jsHeap: pageHeap(),
				jsHeapSamples: this.samples,
				jsHeapNote:
					this.failure ??
					(this.supported
						? 'no measurement of the workers finished during the run; each takes about a minute'
						: 'this browser does not measure the heap of workers'),
			};
		const byScope: Record<string, number> = {};
		for (const entry of this.last.breakdown) {
			const where = entry.attribution[0];
			const name = where ? `${where.scope ?? 'unknown'} ${where.url ?? ''}`.trim() : 'shared';
			byScope[name] = (byScope[name] ?? 0) + entry.bytes;
		}
		return {
			jsHeap: { bytes: this.last.bytes, byScope },
			jsHeapSamples: this.samples,
			jsHeapNote: null,
		};
	}
}

/** The page's own heap, in browsers that report it (Chrome). */
function pageHeap(): MemoryStats['jsHeap'] {
	const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
	return memory
		? { bytes: memory.usedJSHeapSize, byScope: { Window: memory.usedJSHeapSize } }
		: null;
}

/** Bytes of WebAssembly the page downloaded, from the browser's resource timing entries. */
export function wasmDownloadBytes(): number | null {
	let bytes = 0;
	for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
		if (new URL(entry.name).pathname.endsWith('.wasm')) bytes += entry.encodedBodySize;
	}
	return bytes > 0 ? bytes : null;
}
