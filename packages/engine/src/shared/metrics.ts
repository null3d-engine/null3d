// Frame metrics. Each engine thread role writes one fixed-size record per frame into its own ring in
// the metrics buffer, and the page drains the rings while a measurement runs. Writing a record
// stores a few numbers and allocates nothing. In threaded mode the buffer is shared, like the
// control block, so no thread is interrupted to report its numbers.
//
// A record is written in place: the writer clears the record's sequence word, fills the fields,
// then stores the sequence number and the ring's written count. A reader keeps a record only when
// its sequence word holds the expected value before and after the fields are copied, so a record
// the writer overwrote meanwhile is counted as lost instead of read half-written.

/** The rings of the metrics buffer, one per thread role. Job worker k writes ring `Role.Job + k`. */
export enum Role {
	Game = 0,
	Render = 1,
	/** GPU time per frame from timestamp queries, written by the thread that draws. */
	Gpu = 2,
	/**
	 * Frames the GPU finished: each record's busy time is the time from the frame's submit to its
	 * completion, and its interval the time since the previous completion.
	 */
	Completion = 3,
	Job = 4,
}

/** CPU phases of a frame, in the order they run. */
export enum Phase {
	/** The game's update callback. */
	Update = 0,
	/** Structural changes applied from the command ring. */
	Commands = 1,
	Transforms = 2,
	Batches = 3,
	Cull = 4,
	/** Draw-list recording. */
	Record = 5,
	/** Writes of changed data to GPU buffers. */
	Upload = 6,
	/** Draw-list replay into GPU commands, including the submit. */
	Replay = 7,
}

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
 * A step of a frame that `engine.measure` times. The `update` step is the game's own code, and the
 * other steps are the engine's.
 *
 * @category api/debug
 */
export type PhaseName = (typeof PHASE_NAMES)[number];

export enum Counter {
	UploadBytes = 0,
	DrawCalls = 1,
	Dispatches = 2,
	/** Draw bundles recorded: nonzero in a frame whose structure change rebuilt the draw tables. */
	Rebuilds = 3,
}

export const COUNTER_NAMES = ['uploadBytes', 'drawCalls', 'dispatches', 'rebuilds'] as const;

export type CounterName = (typeof COUNTER_NAMES)[number];

/** Records each ring holds: several seconds of frames, far longer than the page waits between drains. */
export const RING_RECORDS = 1024;

// 32-bit words of a record.
const SEQUENCE = 0;
const FRAME = 1;
const BUSY = 2;
const INTERVAL = 3;
const PHASES = 4;
const COUNTERS = PHASES + PHASE_NAMES.length;
const RECORD_WORDS = 16;

// Int32 words of the header, then one written count per ring.
const CAPACITY = 0;
const RINGS = 1;
const MEASURING = 2;
/** Float64 index of the epoch time, in ms, at which the first frame was presented. */
const FIRST_FRAME = 2;
/** Float64 index of the display's refresh rate in hertz, as the thread that draws measured it. */
const REFRESH_HZ = 3;
const HEADER_WORDS = 8;
const WRITTEN = HEADER_WORDS;

function recordsStart(rings: number): number {
	return Math.ceil((HEADER_WORDS + rings) / RECORD_WORDS) * RECORD_WORDS;
}

/** A metrics buffer with rings for the game, render and GPU roles and each job worker. */
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

	addPhase(phase: Phase, ms: number): void {
		const { floats } = this.views;
		const at = this.at + PHASES + phase;
		floats[at] = (floats[at] as number) + ms;
	}

	count(counter: Counter, value: number): void {
		this.views.words[this.at + COUNTERS + counter] = value;
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

	/** Records the display's refresh rate, which the thread that draws measures. */
	setRefreshHz(hz: number): void {
		this.views.times[REFRESH_HZ] = hz;
	}

	/** Records when the first frame reached the screen, as epoch milliseconds, once per engine. */
	markFirstFrame(): void {
		const { times } = this.views;
		if (times[FIRST_FRAME] === 0) times[FIRST_FRAME] = performance.timeOrigin + performance.now();
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

	/** The display's refresh rate in hertz, or 0 before the thread that draws has measured it. */
	get refreshHz(): number {
		return this.views.times[REFRESH_HZ] as number;
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
				if (Atomics.load(words, at + SEQUENCE) !== sequence + 1) {
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
				if (Atomics.load(words, at + SEQUENCE) !== sequence + 1) {
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

function dropLast(records: RingRecords): void {
	records.frames.pop();
	records.busy.pop();
	records.intervals.pop();
	for (const values of records.phases) values.pop();
	for (const values of records.counters) values.pop();
}
