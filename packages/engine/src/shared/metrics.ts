// Frame metrics. Each engine thread role writes one fixed-size record per frame into its own ring in
// the metrics buffer, and the page drains the rings while a measurement runs. Writing a record
// stores a few numbers and allocates nothing. In threaded mode the buffer is shared, like the
// control block, so no thread is interrupted to report its numbers.
//
// A record is written in place: the writer clears the record's sequence word, fills the fields,
// then stores the sequence number and the ring's written count. A reader keeps a record only when
// its sequence word holds the expected value before and after the fields are copied, so a record
// the writer overwrote meanwhile is counted as lost instead of read half-written.

import * as Counter from './counter';
import * as GpuCounter from './gpu-counter';
import * as Phase from './phase';
import * as Role from './role';

// The numbered names of the metrics buffer: the rings, one per thread role (job worker k writes
// ring `Role.Job + k`), the CPU phases of a frame in the order they run, the counters of a frame
// record, and what a GPU record's counter slots hold.
export { Counter, GpuCounter, Phase, Role };

export const PHASE_NAMES = [
	'update',
	'commands',
	'transforms',
	'batches',
	'cull',
	'record',
	'upload',
	'replay',
] as const;

/**
 * A step of a frame that `engine.measure` times. The `update` step is the sketch's own code, in all
 * of its callbacks, and the other steps are the engine's.
 *
 * @category api/debug
 */
export type PhaseName = (typeof PHASE_NAMES)[number];

export const COUNTER_NAMES = [
	'uploadBytes',
	'drawCalls',
	'dispatches',
	'rebuilds',
	'pipelines',
	'visibleEntries',
	'skippedDraws',
	'gpuObjects',
	'occludedEntries',
] as const;

export type CounterName = (typeof COUNTER_NAMES)[number];

/**
 * Passes that a GPU record times one by one. A GPU record's phase slots hold the time before the
 * frame's first pass, which the copies recorded there take, then the time of each of these passes
 * in order. A pass after them adds its time to the last one's.
 */
export const GPU_TIMED_PASSES = PHASE_NAMES.length - 1;

/** A GPU record's time for a part of the frame that the browser gave no timestamps for. */
export const UNTIMED = -1;

/** Records each ring holds: several seconds of frames, far longer than the page waits between drains. */
export const RING_RECORDS = 1024;

/**
 * One frame in this many has its GPU time measured while the page measures. Timing costs the
 * thread that draws about as much as drawing a small scene, so the engine samples frames instead
 * of paying it every frame.
 */
export const SAMPLED_EVERY = 8;

// 32-bit words of a record.
const SEQUENCE = 0;
const FRAME = 1;
const BUSY = 2;
const INTERVAL = 3;
const PHASES = 4;
const COUNTERS = PHASES + PHASE_NAMES.length;
const RECORD_WORDS = 21;

// Int32 words of the header, then one written count per ring.
const CAPACITY = 0;
const RINGS = 1;
const MEASURING = 2;
/** Float64 index of the epoch time, in ms, at which the first frame was presented. */
const FIRST_FRAME = 2;
/** Float64 index of the display's refresh rate in hertz, as the thread that draws measured it. */
const REFRESH_HZ = 3;
/** Float64 index of the epoch time, in ms, at which the GPU finished the first frame. */
const FIRST_FRAME_DONE = 4;
/** Float64 index of the epoch time, in ms, at which the first frame's pipelines started to build. */
const WARM_UP_START = 5;
/** Float64 index of the epoch time, in ms, at which the first frame's pipelines were all built. */
const WARM_UP_END = 6;
/** Float64 index of the number of pipelines that the first frame built. */
const FIRST_FRAME_PIPELINES = 7;
/** Float64 index of the time, in ms, that the thread that draws spent on the first frame's draw. */
const FIRST_DRAW = 8;
const HEADER_WORDS = 18;
const WRITTEN = HEADER_WORDS;

function recordsStart(rings: number): number {
	return Math.ceil((HEADER_WORDS + rings) / RECORD_WORDS) * RECORD_WORDS;
}

/** A metrics buffer with rings for the sketch, render and GPU roles and each job worker. */
export function createMetricsBuffer(
	shared: boolean,
	jobWorkers: number,
	capacity = RING_RECORDS,
): ArrayBufferLike {
	const rings = Role.Job + jobWorkers;
	const bytes = (recordsStart(rings) + rings * capacity * RECORD_WORDS) * 4;
	const buffer = shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
	const header = new Int32Array(buffer, 0, HEADER_WORDS);
	header[CAPACITY] = capacity;
	header[RINGS] = rings;
	return buffer;
}

class MetricsViews {
	readonly header: Int32Array;
	readonly times: Float64Array;
	readonly words: Uint32Array;
	readonly floats: Float32Array;
	readonly capacity: number;
	readonly rings: number;

	constructor(buffer: ArrayBufferLike) {
		this.header = new Int32Array(buffer);
		this.times = new Float64Array(buffer, 0, HEADER_WORDS / 2);
		this.words = new Uint32Array(buffer);
		this.floats = new Float32Array(buffer);
		this.capacity = this.header[CAPACITY] as number;
		this.rings = this.header[RINGS] as number;
	}

	/** First word of the record with this sequence number in a ring. */
	record(ring: number, sequence: number): number {
		return (
			recordsStart(this.rings) + (ring * this.capacity + (sequence % this.capacity)) * RECORD_WORDS
		);
	}

	/**
	 * True when the record at word `at` is the whole record with this sequence number: finished, and
	 * not being written again.
	 */
	holds(at: number, sequence: number): boolean {
		return Atomics.load(this.words, at + SEQUENCE) === sequence + 1;
	}
}

/** The display's refresh rate in hertz, as the thread that draws measured it, or 0 before then. */
export function refreshRate(buffer: ArrayBufferLike): number {
	return new Float64Array(buffer, 0, HEADER_WORDS / 2)[REFRESH_HZ] as number;
}

/** Writes one role's records. Only one thread writes a given ring. */
export class FrameRecorder {
	private readonly views: MetricsViews;
	private sequence: number;
	private at = -1;

	constructor(
		buffer: ArrayBufferLike,
		readonly ring: number,
	) {
		this.views = new MetricsViews(buffer);
		if (ring >= this.views.rings) throw new Error(`the metrics buffer has no ring ${ring}`);
		this.sequence = Atomics.load(this.views.header, WRITTEN + ring);
	}

	/** True while the page is measuring; costly timing, such as GPU queries, runs only then. */
	get measuring(): boolean {
		return Atomics.load(this.views.header, MEASURING) !== 0;
	}

	/** Starts the record of a frame, with every time and counter at zero. */
	begin(frame: number): void {
		const { words, floats } = this.views;
		const at = this.views.record(this.ring, this.sequence);
		Atomics.store(words, at + SEQUENCE, 0);
		words[at + FRAME] = frame;
		floats.fill(0, at + BUSY, at + RECORD_WORDS);
		this.at = at;
	}

	addPhase(phase: number, ms: number): void {
		const { floats } = this.views;
		const at = this.at + PHASES + phase;
		floats[at] = (floats[at] as number) + ms;
	}

	count(counter: number, value: number): void {
		this.views.words[this.at + COUNTERS + counter] = value;
	}

	/** A GPU record's pass count, and which of its passes are render passes, one bit each. */
	gpuPasses(passes: number, renderPasses: number): void {
		const { words } = this.views;
		words[this.at + COUNTERS + GpuCounter.Passes] = passes;
		words[this.at + COUNTERS + GpuCounter.RenderPasses] = renderPasses;
	}

	/** A GPU record's time in one slot: 0 for the copies before the first pass, then one per pass. */
	gpuTime(slot: number, ms: number): void {
		this.views.floats[this.at + PHASES + slot] = ms;
	}

	/** Time since the previous presented frame, recorded by the thread that presents. */
	interval(ms: number): void {
		this.views.floats[this.at + INTERVAL] = ms;
	}

	/** Finishes the record with the frame's total busy time on this thread. */
	commit(busyMs: number): void {
		const { header, words, floats } = this.views;
		floats[this.at + BUSY] = busyMs;
		this.sequence++;
		Atomics.store(words, this.at + SEQUENCE, this.sequence);
		Atomics.store(header, WRITTEN + this.ring, this.sequence);
	}

	/** Records when the GPU finished the first frame, as epoch milliseconds, once per engine. */
	markFirstFrameDone(): void {
		const { times } = this.views;
		if (times[FIRST_FRAME_DONE] === 0)
			times[FIRST_FRAME_DONE] = performance.timeOrigin + performance.now();
	}

	/** Records the display's refresh rate, which the thread that draws measures. */
	setRefreshHz(hz: number): void {
		this.views.times[REFRESH_HZ] = hz;
	}

	/**
	 * Records when the first frame reached the screen, as epoch milliseconds, once per engine, with
	 * the pipelines it built: the pipeline count of the record that `commit` has not closed yet. It
	 * also records how long the frame's draw took, which holds the compiles that the first draw
	 * waited for.
	 */
	markFirstFrame(drawMs: number): void {
		const { times, words } = this.views;
		if (times[FIRST_FRAME] !== 0) return;
		times[FIRST_FRAME] = performance.timeOrigin + performance.now();
		times[FIRST_FRAME_PIPELINES] = words[this.at + COUNTERS + Counter.Pipelines] as number;
		times[FIRST_DRAW] = drawMs;
	}

	/**
	 * Records, once per engine, when the first frame's pipelines started to build and when none was
	 * building any longer, as epoch milliseconds. The thread that draws calls it each time it
	 * checks the first frame, until that frame draws.
	 */
	markWarmUp(building: boolean): void {
		const { times } = this.views;
		const now = performance.timeOrigin + performance.now();
		if (times[WARM_UP_START] === 0) times[WARM_UP_START] = now;
		if (!building && times[WARM_UP_END] === 0) times[WARM_UP_END] = now;
	}
}

/** The records of one ring, collected by a reader. Per-phase and per-counter arrays share the frame order. */
export interface RingRecords {
	frames: number[];
	busy: number[];
	intervals: number[];
	phases: number[][];
	counters: number[][];
}

function emptyRecords(): RingRecords {
	return {
		frames: [],
		busy: [],
		intervals: [],
		phases: PHASE_NAMES.map(() => []),
		counters: COUNTER_NAMES.map(() => []),
	};
}

/** Drains every ring into growing arrays. It runs on the page, outside the engine's frame code. */
export class MetricsReader {
	private readonly views: MetricsViews;
	private readonly read: number[];
	records: RingRecords[] = [];
	/** Records overwritten before they were drained. */
	lost = 0;

	constructor(buffer: ArrayBufferLike) {
		this.views = new MetricsViews(buffer);
		this.read = Array.from({ length: this.views.rings }, () => 0);
	}

	get rings(): number {
		return this.views.rings;
	}

	/** Epoch milliseconds at which the first frame was presented, or 0 before that. */
	get firstFrameTime(): number {
		return this.views.times[FIRST_FRAME] as number;
	}

	/** Epoch milliseconds at which the GPU finished the first frame, or 0 before that. */
	get firstFrameDoneTime(): number {
		return this.views.times[FIRST_FRAME_DONE] as number;
	}

	/**
	 * Milliseconds from the start of the first frame's pipeline builds until none was building, or
	 * null before then.
	 */
	get warmUpMs(): number | null {
		const { times } = this.views;
		const end = times[WARM_UP_END] as number;
		return end > 0 ? end - (times[WARM_UP_START] as number) : null;
	}

	/** Milliseconds that the first frame's draw took on the thread that draws, or null before it. */
	get firstDrawMs(): number | null {
		const { times } = this.views;
		return (times[FIRST_FRAME] as number) > 0 ? (times[FIRST_DRAW] as number) : null;
	}

	/** Pipelines that the first frame built, or null before the first frame. */
	get firstFramePipelines(): number | null {
		const { times } = this.views;
		return (times[FIRST_FRAME] as number) > 0 ? (times[FIRST_FRAME_PIPELINES] as number) : null;
	}

	/** The display's refresh rate in hertz, or 0 before the thread that draws has measured it. */
	get refreshHz(): number {
		return this.views.times[REFRESH_HZ] as number;
	}

	/**
	 * Keeps the records that the rings still hold, without turning the costly timing on: the frames
	 * of a hold, which the engine stepped before the page could read them.
	 */
	readWritten(): RingRecords[] {
		this.records = Array.from({ length: this.views.rings }, emptyRecords);
		this.drain();
		return this.records;
	}

	/** Forgets older records, then keeps every record written from now on. */
	begin(): void {
		const { header } = this.views;
		for (let ring = 0; ring < this.views.rings; ring++)
			this.read[ring] = Atomics.load(header, WRITTEN + ring);
		this.records = Array.from({ length: this.views.rings }, emptyRecords);
		this.lost = 0;
		Atomics.store(header, MEASURING, 1);
	}

	drain(): void {
		const { header, words, floats, capacity } = this.views;
		for (let ring = 0; ring < this.views.rings; ring++) {
			const written = Atomics.load(header, WRITTEN + ring);
			const from = Math.max(this.read[ring] as number, written - capacity);
			this.lost += from - (this.read[ring] as number);
			const out = this.records[ring] as RingRecords;
			for (let sequence = from; sequence < written; sequence++) {
				const at = this.views.record(ring, sequence);
				if (!this.views.holds(at, sequence)) {
					this.lost++;
					continue;
				}
				out.frames.push(words[at + FRAME] as number);
				out.busy.push(floats[at + BUSY] as number);
				out.intervals.push(floats[at + INTERVAL] as number);
				for (let p = 0; p < PHASE_NAMES.length; p++)
					out.phases[p]?.push(floats[at + PHASES + p] as number);
				for (let c = 0; c < COUNTER_NAMES.length; c++)
					out.counters[c]?.push(words[at + COUNTERS + c] as number);
				if (!this.views.holds(at, sequence)) {
					dropLast(out);
					this.lost++;
				}
			}
			this.read[ring] = written;
		}
	}

	/** Drains the last records and turns costly timing off again. */
	end(): void {
		this.drain();
		Atomics.store(this.views.header, MEASURING, 0);
	}
}

// What `RingSums.sums` holds, by index.
/** Records taken in. */
export const SUM_RECORDS = 0;
/** Their busy times, summed. */
export const SUM_BUSY_MS = 1;
/** The longest of their busy times. */
export const SUM_LONGEST_BUSY_MS = 2;
/** Their intervals, summed. */
export const SUM_INTERVAL_MS = 3;
/** With detail: each phase's time, summed, in the order of `PHASE_NAMES`. */
export const SUM_PHASES = 4;
/** With detail: each counter's values, summed, in the order of `COUNTER_NAMES`. */
export const SUM_COUNTERS = SUM_PHASES + PHASE_NAMES.length;
/** The values of a record that the detail sums add up: its phases, then its counters. */
const DETAIL_VALUES = PHASE_NAMES.length + COUNTER_NAMES.length;

/**
 * The display's refresh rate that the thread that draws measured, for code on any thread that
 * holds the metrics buffer, such as dynamic resolution.
 */
export class RefreshRate {
	private readonly times: Float64Array;

	constructor(buffer: ArrayBufferLike) {
		this.times = new Float64Array(buffer, 0, HEADER_WORDS / 2);
	}

	/** The refresh rate in hertz, or 0 before the thread that draws has measured it. */
	get hz(): number {
		return this.times[REFRESH_HZ] as number;
	}
}

/**
 * Sums the records that one ring receives, for code that judges the frames during play, such as
 * the quality governor. `add` takes in the records written since its last call, and `clear` starts
 * a new window. It allocates nothing and leaves the page's costly timing off, so any thread that
 * holds the metrics buffer can call it as often as every frame. A record that the writer
 * overwrote before `add` read it is left out. The records' count over their summed intervals is
 * their rate. Every completion record has an interval, which is 0 for a frame that the GPU
 * finished with the one before. The render ring's first record has none, so a window that holds
 * the first presented frame counts one frame more than its intervals cover.
 */
export class RingSums {
	/** The window's sums, by the `SUM_` indices. */
	readonly sums: Float64Array;
	private readonly views: MetricsViews;
	private next: number;

	/** With detail, a record's phases and counters, copied before the check that the record held. */
	private readonly detail: Float64Array | undefined;

	/**
	 * Sums `ring`'s records from those written after this call. With `detail`, the sums also hold
	 * each phase and each counter.
	 */
	constructor(
		buffer: ArrayBufferLike,
		readonly ring: number,
		detail = false,
	) {
		this.views = new MetricsViews(buffer);
		this.next = Atomics.load(this.views.header, WRITTEN + ring);
		this.sums = new Float64Array(detail ? SUM_COUNTERS + COUNTER_NAMES.length : SUM_PHASES);
		this.detail = detail ? new Float64Array(DETAIL_VALUES) : undefined;
	}

	/** Takes in the records written since the last call. */
	add(): void {
		const { views, sums, detail } = this;
		const { floats, words } = views;
		const written = Atomics.load(views.header, WRITTEN + this.ring);
		const from = Math.max(this.next, written - views.capacity);
		for (let sequence = from; sequence < written; sequence++) {
			const at = views.record(this.ring, sequence);
			if (!views.holds(at, sequence)) continue;
			const busy = floats[at + BUSY] as number;
			const interval = floats[at + INTERVAL] as number;
			if (detail) {
				for (let p = 0; p < PHASE_NAMES.length; p++) detail[p] = floats[at + PHASES + p] as number;
				for (let c = 0; c < COUNTER_NAMES.length; c++)
					detail[PHASE_NAMES.length + c] = words[at + COUNTERS + c] as number;
			}
			if (!views.holds(at, sequence)) continue;
			sums[SUM_RECORDS] = (sums[SUM_RECORDS] as number) + 1;
			sums[SUM_BUSY_MS] = (sums[SUM_BUSY_MS] as number) + busy;
			sums[SUM_LONGEST_BUSY_MS] = Math.max(sums[SUM_LONGEST_BUSY_MS] as number, busy);
			sums[SUM_INTERVAL_MS] = (sums[SUM_INTERVAL_MS] as number) + interval;
			if (detail)
				for (let k = 0; k < DETAIL_VALUES; k++)
					sums[SUM_PHASES + k] = (sums[SUM_PHASES + k] as number) + (detail[k] as number);
		}
		this.next = written;
	}

	/** Starts a new window: the sums go back to zero, and the place in the ring stays. */
	clear(): void {
		this.sums.fill(0);
	}
}

function dropLast(records: RingRecords): void {
	records.frames.pop();
	records.busy.pop();
	records.intervals.pop();
	for (const values of records.phases) values.pop();
	for (const values of records.counters) values.pop();
}
