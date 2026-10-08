// The memory of the whole page and its workers, from the browser's own measurement:
// `performance.measureUserAgentSpecificMemory`, which only Chromium offers, and only on a
// cross-origin isolated page. The browser answers once every worker has run the measurement as a
// task, or after about a minute, so samples follow each other with a gap of a few seconds.
//
// Chromium adds a shared memory, such as the engine's WebAssembly memory, to the figure of each
// thread that holds it. The corrected figure counts it once: it takes the shared memory's size away
// for each holder but the first. A thread holds it when its figure is at least the shared memory's
// size, since no thread's own heap comes near the engine's memory.

import { messageOf } from '../errors/message';

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
			this.failure = `the browser refused the measurement: ${messageOf(error)}`;
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
