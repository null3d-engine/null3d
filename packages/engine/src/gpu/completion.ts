// Frames the GPU finished, and the time from each frame's submit to its completion. A frame counter
// built on frame callbacks keeps counting at the display rate while the GPU falls behind, so the
// engine also counts completions. WebGPU reports them through the queue. WebGL2 reports them
// through a fence, which the thread that draws checks at the start of a frame callback and never
// waits on, so a fence's time rounds up to that callback. Tracking runs on every frame, all the
// time: the thread that draws holds back new frames while too many are unfinished, and the quality
// governor and the warm-up benchmark read the records during play. Each frame costs one browser
// object: the queue's promise on WebGPU, or the fence on WebGL2.

import { FrameRecorder, Role } from '../shared/metrics';

/** Frames whose completion can be awaited at once; a frame that finds none free goes untracked. */
const SLOTS = 8;
/**
 * How long a frame may stay unfinished and still count as in flight, in ms, from its submit or from
 * the latest completion, whichever came later. A completion that the browser never reports then
 * slows the drawing without stopping it, and a frame that waits behind others keeps counting while
 * the GPU finishes frames.
 */
const STALLED_MS = 1000;
/**
 * On a GPU that needs longer than that for each frame, a frame counts as in flight for this many of
 * the intervals between the latest two completions instead, so the limit holds however slow the GPU.
 */
const STALLED_INTERVALS = 2;

// The completion times that `InFlight` keeps, by index, in ms.
/** The latest completion, or -1 before the first. */
const LAST_DONE = 0;
/** The time between the latest two completions, or 0 before the second. */
const DONE_INTERVAL = 1;

/** Submit times and frame numbers of the tracked frames in flight, in submit order, and their records. */
class InFlight {
	private readonly submitted = new Float64Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	/** For each tracked frame, the count of frames submitted up to it. */
	private readonly submits = new Float64Array(SLOTS);
	/** Completion times, in a typed array, as a fraction in a property would allocate. */
	private readonly times = new Float64Array([-1, 0]);
	private head = 0;
	private tail = 0;
	private lastSubmits = 0;
	private submitCount = 0;

	constructor(private readonly recorder: FrameRecorder) {}

	/** Counts a submitted frame and remembers it; false when every slot is taken. */
	push(frame: number): boolean {
		this.submitCount++;
		if (this.head - this.tail >= SLOTS) return false;
		const slot = this.head % SLOTS;
		this.submitted[slot] = performance.now();
		this.frames[slot] = frame;
		this.submits[slot] = this.submitCount;
		this.head++;
		return true;
	}

	/** Tracked frames that the GPU has not finished, apart from any stalled for too long. */
	unfinished(): number {
		if (this.head === this.tail) return 0;
		const { times } = this;
		const slowest = STALLED_INTERVALS * (times[DONE_INTERVAL] as number);
		const stalledBefore = performance.now() - (slowest > STALLED_MS ? slowest : STALLED_MS);
		if ((times[LAST_DONE] as number) >= stalledBefore) return this.head - this.tail;
		let oldest = this.tail;
		while (oldest < this.head && (this.submitted[oldest % SLOTS] as number) < stalledBefore)
			oldest++;
		return this.head - oldest;
	}

	/**
	 * Records the `count` oldest tracked frames as finished now. The time since the previous
	 * completion covers every frame submitted in between, so each frame's share of it is its
	 * interval. The first frames to finish have no earlier completion to measure from, so they
	 * start the count and leave no record.
	 */
	finish(count: number): void {
		const done = Math.min(count, this.head - this.tail);
		if (done === 0) return;
		const now = performance.now();
		const { times } = this;
		const lastDone = times[LAST_DONE] as number;
		const submits = this.submits[(this.tail + done - 1) % SLOTS] as number;
		const interval = (now - lastDone) / (submits - this.lastSubmits);
		const recorded = lastDone >= 0;
		for (let k = 0; k < done; k++, this.tail++) {
			if (!recorded) continue;
			const slot = this.tail % SLOTS;
			this.recorder.begin(this.frames[slot] as number);
			this.recorder.interval(interval);
			this.recorder.commit(now - (this.submitted[slot] as number));
		}
		if (recorded) times[DONE_INTERVAL] = now - lastDone;
		times[LAST_DONE] = now;
		this.lastSubmits = submits;
	}
}

/** WebGPU: the queue resolves one promise per frame, in submit order. */
export class QueueCompletion {
	private readonly frames: InFlight;
	private readonly onDone = () => this.frames.finish(1);

	constructor(
		private readonly queue: GPUQueue,
		metrics: ArrayBufferLike,
	) {
		this.frames = new InFlight(new FrameRecorder(metrics, Role.Completion));
	}

	/** Tracks the frame just submitted. */
	afterSubmit(frame: number): void {
		if (this.frames.push(frame)) this.queue.onSubmittedWorkDone().then(this.onDone, this.onDone);
	}

	/** Frames submitted that the GPU has not finished. */
	unfinished(): number {
		return this.frames.unfinished();
	}
}

/** WebGL2: a fence after each frame, checked without waiting before the next frame is drawn. */
export class FenceCompletion {
	private readonly frames: InFlight;
	private readonly fences: (WebGLSync | null)[] = new Array(SLOTS).fill(null);
	private head = 0;
	private tail = 0;

	constructor(
		private readonly gl: WebGL2RenderingContext,
		metrics: ArrayBufferLike,
	) {
		this.frames = new InFlight(new FrameRecorder(metrics, Role.Completion));
	}

	/** Places a fence after the frame just submitted. */
	afterSubmit(frame: number): void {
		if (!this.frames.push(frame)) return;
		this.fences[this.head++ % SLOTS] = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		this.gl.flush();
	}

	/**
	 * Records the frames whose fences have signaled, oldest first, and returns the frames still
	 * unfinished. The frames it finds finished together share the time since the last completion.
	 */
	unfinished(): number {
		const { gl } = this;
		let done = 0;
		while (this.tail < this.head) {
			const slot = this.tail % SLOTS;
			const fence = this.fences[slot] ?? null;
			// A fence the browser could not make counts as finished, so the count cannot stick.
			if (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) break;
			if (fence) gl.deleteSync(fence);
			this.fences[slot] = null;
			this.tail++;
			done++;
		}
		this.frames.finish(done);
		return this.frames.unfinished();
	}
}

/** A renderer's completion tracker. */
export type Completion = QueueCompletion | FenceCompletion;
