// Frames the GPU finished, and the time from each frame's submit to its completion. A frame counter
// built on frame callbacks keeps counting at the display rate while the GPU falls behind, so the
// engine also counts completions. WebGPU reports them through the queue. WebGL2 reports them
// through a fence, which the thread that draws checks at the start of a frame callback and never
// waits on, so a fence's time rounds up to that callback. Tracking runs on every frame, all the
// time: the thread that draws holds back new frames while too many are unfinished, and the quality
// governor and the warm-up benchmark read the records during play. Each frame costs one browser
// object: the queue's promise on WebGPU, or the fence on WebGL2.

import { FrameRecorder, Role } from '../shared/metrics';

/**
 * Frames whose completion can be awaited at once. While every slot holds a frame, the tracker counts
 * them all as unfinished, so the thread that draws takes no frame that it could not track.
 */
const SLOTS = 8;
/**
 * The GPU works on the oldest unfinished frame from the latest of three times: its submit, the
 * latest completion, and the moment the tracker gave up the frame ahead of it. After this long
 * from then, in ms, the tracker gives the frame up as one whose completion the browser will never
 * report, and it stops counting it as in flight. So a lost completion slows the drawing without
 * stopping it, and the frames behind a slow frame are given up one at a time, not all at once.
 */
const STALLED_MS = 1000;
/**
 * On a GPU that needs longer for a frame, the oldest frame counts as in flight for this many of
 * the GPU's slowest recent frame times instead, so the limit holds however slow the GPU, and
 * however much its frame times vary.
 */
const STALLED_FRAME_TIMES = 4;
/** The completions whose GPU frame times set that limit. */
const RECENT_FRAME_TIMES = 8;
/**
 * Each frame given up since the latest completion doubles the limit for the next, this many times
 * at most. A GPU that takes seconds over a frame, as a software GPU does while it builds a frame's
 * pipelines, then gets few frames queued behind that one, while a completion that the browser
 * never reports still slows the drawing without stopping it.
 */
const MAX_DOUBLINGS = 3;

// The completion times that `InFlight` keeps, by index, in ms.
/** The latest completion, or -1 before the first. */
const LAST_DONE = 0;
/** The slowest of the recent GPU frame times, or 0 before the first completion. */
const SLOWEST = 1;
/** The moment the tracker last gave a frame up, or -1 before the first. */
const GIVEN_UP = 2;

/** Submit times and frame numbers of the tracked frames in flight, in submit order, and their records. */
class InFlight {
	private readonly submitted = new Float64Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	/** For each tracked frame, the count of frames submitted up to it. */
	private readonly submits = new Float64Array(SLOTS);
	/** Completion times, in a typed array, as a fraction in a property would allocate. */
	private readonly times = new Float64Array([-1, 0, -1]);
	/**
	 * The GPU's recent frame times: for each completion, the time from when the GPU took the oldest
	 * frame that it finished to the completion. A ring, which `frameTimes` counts into.
	 */
	private readonly recentFrameTimes = new Float64Array(RECENT_FRAME_TIMES);
	private frameTimes = 0;
	private head = 0;
	private tail = 0;
	/** The tracked frames before this count were given up; it never falls behind `tail`. */
	private givenUp = 0;
	/** Frames given up since the latest completion. */
	private sinceDone = 0;
	/** Frames freed from their slots that `takeForgotten` has not counted yet. */
	private forgotten = 0;
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

	/**
	 * Tracked frames that the GPU has not finished, apart from those given up. When every slot holds
	 * a frame and the oldest was given up, it frees that slot, and `takeForgotten` then counts it, so
	 * the tracker's owner drops what it keeps for that frame. A full tracker whose oldest frame is
	 * not given up counts every slot, so no frame goes untracked.
	 */
	unfinished(): number {
		if (this.givenUp < this.tail) this.givenUp = this.tail;
		if (this.givenUp < this.head) this.giveUpStalled();
		if (this.head - this.tail >= SLOTS && this.tail < this.givenUp) {
			this.tail++;
			this.forgotten++;
		}
		return this.head - this.givenUp;
	}

	/** The frames freed from their slots since the last call, oldest first. */
	takeForgotten(): number {
		const forgotten = this.forgotten;
		this.forgotten = 0;
		return forgotten;
	}

	/**
	 * Gives up each frame, oldest first, that the GPU has had for the stall limit, counted from the
	 * latest of its submit, the latest completion and the moment the frame ahead was given up. Each
	 * frame given up since the latest completion doubles the limit, up to a cap.
	 */
	private giveUpStalled(): void {
		const { times } = this;
		const slowest = STALLED_FRAME_TIMES * (times[SLOWEST] as number);
		const doublings = this.sinceDone < MAX_DOUBLINGS ? this.sinceDone : MAX_DOUBLINGS;
		const limit = (slowest > STALLED_MS ? slowest : STALLED_MS) * (1 << doublings);
		const now = performance.now();
		const submitted = this.submitted[this.givenUp % SLOTS] as number;
		const lastDone = times[LAST_DONE] as number;
		const lastGivenUp = times[GIVEN_UP] as number;
		let from = submitted > lastDone ? submitted : lastDone;
		if (lastGivenUp > from) from = lastGivenUp;
		if (now - from < limit) return;
		times[GIVEN_UP] = from + limit;
		this.givenUp++;
		this.sinceDone++;
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
		const submitted = this.submitted[this.tail % SLOTS] as number;
		this.recentFrameTimes[this.frameTimes++ % RECENT_FRAME_TIMES] =
			now - (lastDone > submitted ? lastDone : submitted);
		this.keepSlowest();
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
		times[LAST_DONE] = now;
		this.lastSubmits = submits;
		this.sinceDone = 0;
	}

	/**
	 * Keeps the slowest of the recent GPU frame times. It takes them from the ring, as a fraction
	 * passed to a call that the browser does not inline would allocate.
	 */
	private keepSlowest(): void {
		const recent = this.recentFrameTimes;
		let slowest = 0;
		for (let i = 0; i < RECENT_FRAME_TIMES; i++)
			if ((recent[i] as number) > slowest) slowest = recent[i] as number;
		this.times[SLOWEST] = slowest;
	}
}

/** WebGPU: the queue resolves one promise per frame, in submit order. */
export class QueueCompletion {
	private readonly frames: InFlight;
	/**
	 * Frames that the tracker forgot whose promises have not settled. They are the oldest, and the
	 * queue settles promises in submit order, so the next promises to settle are theirs.
	 */
	private forgotten = 0;
	private readonly onDone = () => {
		if (this.forgotten > 0) this.forgotten--;
		else this.frames.finish(1);
	};

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

	/** Frames submitted that the GPU has not finished, apart from those given up. */
	unfinished(): number {
		const unfinished = this.frames.unfinished();
		this.forgotten += this.frames.takeForgotten();
		return unfinished;
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
	 * unfinished, apart from those given up. The frames it finds finished together share the time
	 * since the last completion. A forgotten frame's fence is deleted unchecked.
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
		const unfinished = this.frames.unfinished();
		for (let forgotten = this.frames.takeForgotten(); forgotten > 0; forgotten--) {
			const slot = this.tail++ % SLOTS;
			const fence = this.fences[slot] ?? null;
			if (fence) gl.deleteSync(fence);
			this.fences[slot] = null;
		}
		return unfinished;
	}
}

/** A renderer's completion tracker. */
export type Completion = QueueCompletion | FenceCompletion;
