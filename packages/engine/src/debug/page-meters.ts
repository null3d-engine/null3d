// The page's own meters for the stats overlay: the load of the page's thread, and the memory of the
// whole page and its workers. They live apart from the engine's start, which loads none of them, and
// `@null3d/engine/stats` exports them, so a page that draws with another engine measures its own
// figures with the same code. `engine.measure` keeps small meters of its own in the start.
//
// The page thread's load comes from the browser's long task and event timing entries, which only
// Chromium reports.
//
// The memory of the whole page and its workers comes from the browser's own measurement:
// `performance.measureUserAgentSpecificMemory`, which only Chromium offers, and only on a
// cross-origin isolated page. The browser answers once every worker has run the measurement as a
// task, or after about a minute, so samples follow each other with a gap of a few seconds.
//
// Chromium adds a shared memory, such as the engine's WebAssembly memory, to the figure of each
// thread that holds it. The corrected figure counts it once: it takes the shared memory's size away
// for each holder but the first. A thread holds it when its figure is at least the shared memory's
// size, since no thread's own heap comes near the engine's memory.

import type { StatsMainThread } from './stats-text';

/**
 * The memory of the whole page and its workers, from the browser's own measurement, in
 * `StatsMemory.page`.
 *
 * @category api/debug
 */
export interface PageMemory {
	/**
	 * The page's memory in bytes, with a memory that several threads share counted once, or null
	 * until the first measurement ends.
	 */
	readonly bytes: number | null;
	/**
	 * The browser's own figure in bytes, which counts a shared memory once for each thread that
	 * holds it, or null until the first measurement ends.
	 */
	readonly browserBytes: number | null;
}

/**
 * What the browser's measurement of the page's memory, `performance.measureUserAgentSpecificMemory`,
 * resolves with: the bytes of the whole page, and the bytes of each part, with the scope and the
 * script address of the thread that the part belongs to.
 *
 * @category api/debug
 */
export interface MemoryMeasurement {
	/** The memory of the whole page and its workers, in bytes. */
	bytes: number;
	/** Each part of the memory in bytes, with the threads that it belongs to. */
	breakdown: { bytes: number; attribution: { url?: string; scope?: string }[] }[];
}

type MeasureMemory = () => Promise<MemoryMeasurement>;

/** Time from one sample's arrival to the request for the next. */
const SAMPLE_GAP_MS = 5000;

/**
 * The page's memory with a shared memory of `sharedBytes` counted once: the browser's figure, less
 * the shared memory for each thread past the first whose figure holds it.
 */
export function countSharedOnce(measurement: MemoryMeasurement, sharedBytes: number): number {
	if (sharedBytes <= 0) return measurement.bytes;
	let holders = 0;
	for (const entry of measurement.breakdown) if (entry.bytes >= sharedBytes) holders++;
	return measurement.bytes - Math.max(0, holders - 1) * sharedBytes;
}

/**
 * Samples the memory of the whole page and its workers, one measurement after another with a gap
 * of a few seconds, where the browser offers the measurement. `page` holds the newest figures.
 *
 * @category api/debug
 */
export class PageMemorySampler {
	/** The newest measurement as the browser gave it, or undefined before the first. */
	last: MemoryMeasurement | undefined;
	/** Why the browser refused a measurement, or null. */
	failure: string | null = null;
	private running = false;
	private readonly figures = { bytes: null as number | null, browserBytes: null as number | null };

	/**
	 * `sharedBytes` gives the size of a memory that several of the page's threads share, which the
	 * corrected figure counts once, such as the engine's WebAssembly memory. A page without one
	 * passes nothing. `onSample` hears of each measurement as it arrives.
	 */
	constructor(
		private readonly sharedBytes: () => number = () => 0,
		private readonly onSample?: (measurement: MemoryMeasurement) => void,
	) {}

	/** True where the browser offers the measurement: Chromium, on a cross-origin isolated page. */
	static get supported(): boolean {
		return typeof measureOf() === 'function';
	}

	/** The newest figures, or null where the browser offers no measurement. */
	get page(): PageMemory | null {
		return this.running || this.last ? this.figures : null;
	}

	/** Starts the samples. It does nothing where the browser offers no measurement. */
	start(): void {
		const measure = measureOf();
		if (!measure || this.running) return;
		this.running = true;
		const sample = async () => {
			while (this.running) {
				const result = await measure.call(performance);
				if (!this.running) return;
				this.last = result;
				this.figures.browserBytes = result.bytes;
				this.figures.bytes = countSharedOnce(result, this.sharedBytes());
				this.onSample?.(result);
				await new Promise((resolve) => setTimeout(resolve, SAMPLE_GAP_MS));
			}
		};
		sample().catch((error: unknown) => {
			this.running = false;
			this.failure = `the browser refused the measurement: ${error instanceof Error ? error.message : String(error)}`;
		});
	}

	/** Stops the samples. A measurement under way still ends, and its figures stay out. */
	stop(): void {
		this.running = false;
	}
}

/** The browser's measurement of the page's memory, where it offers one. */
function measureOf(): MeasureMemory | undefined {
	return (performance as { measureUserAgentSpecificMemory?: MeasureMemory })
		.measureUserAgentSpecificMemory;
}

/**
 * The JavaScript heap of the page's own thread in bytes, from `performance.memory`, or null where
 * the browser does not report it. Only Chromium reports it.
 *
 * @category api/debug
 */
export function pageHeapBytes(): number | null {
	const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
	return memory ? memory.usedJSHeapSize : null;
}

interface EventTimingEntry extends PerformanceEntry {
	processingStart: number;
}

/**
 * Watches the page's own thread in windows, one after another: its long tasks and its longest
 * input delay, from the browser's performance entries, where the browser reports them (Chromium).
 *
 * @category api/debug
 */
export class MainThreadWindow {
	private readonly observers: PerformanceObserver[] = [];
	private readonly supported: boolean;
	private start = performance.now();
	private longTasks = 0;
	private longestTask = 0;
	private delay = -1;

	/** Starts watching. */
	constructor() {
		const types = globalThis.PerformanceObserver?.supportedEntryTypes ?? [];
		this.supported = types.includes('longtask');
		if (!this.supported) return;
		const longTasks = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				this.longTasks++;
				this.longestTask = Math.max(this.longestTask, entry.duration);
			}
		});
		longTasks.observe({ type: 'longtask' });
		this.observers.push(longTasks);
		if (!types.includes('event')) return;
		const events = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as EventTimingEntry[])
				this.delay = Math.max(this.delay, entry.processingStart - entry.startTime);
		});
		events.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
		this.observers.push(events);
	}

	/**
	 * The long tasks and the longest input delay since the last call, or since the watch began,
	 * and starts the next window. Null where the browser does not report long tasks.
	 */
	take(): StatsMainThread | null {
		if (!this.supported) return null;
		const now = performance.now();
		const figures = {
			seconds: (now - this.start) / 1000,
			longTasks: this.longTasks,
			longestTaskMs: this.longestTask,
			inputDelayMs: this.delay >= 0 ? this.delay : null,
		};
		this.start = now;
		this.longTasks = 0;
		this.longestTask = 0;
		this.delay = -1;
		return figures;
	}

	/** Stops watching. */
	stop(): void {
		for (const observer of this.observers) observer.disconnect();
	}
}
