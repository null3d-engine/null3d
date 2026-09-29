// Frames the GPU finished, and the time from each frame's submit to its completion. A frame counter
// built on frame callbacks keeps counting at the display rate while the GPU falls behind, so the
// engine also counts completions. WebGPU reports them through the queue. WebGL2 reports them
// through a fence, which the renderer checks at the start of its next frame and never waits on, so
// a fence's time rounds up to that frame. Tracking runs only while the page measures, on one
// submitted frame in every SAMPLED_EVERY: the GPU finishes frames in order, so a tracked frame's
// completion also completes the frames submitted before it.

import { FrameRecorder, Role, SAMPLED_EVERY } from '../shared/metrics';

/** How a renderer learns that the GPU finished a frame. */
export type CompletionSignal = 'queue' | 'fence';

/** Frames whose completion can be awaited at once; a frame that finds none free goes untracked. */
const SLOTS = 8;

/** Submit times and frame numbers of the tracked frames in flight, in submit order, and their records. */
class InFlight {
	private readonly submitted = new Float64Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	/** For each tracked frame, the count of frames submitted up to it. */
	private readonly submits = new Float64Array(SLOTS);
	private head = 0;
	private tail = 0;
	private lastDone = -1;
	private lastSubmits = 0;
	private submitCount = 0;

	constructor(private readonly recorder: FrameRecorder) {}

	get measuring(): boolean {
		return this.recorder.measuring;
	}

	get count(): number {
		return this.head - this.tail;
	}

	/**
	 * Counts a submitted frame and remembers it when it is a sampled one; false when it is not
	 * sampled or every slot is taken.
	 */
	push(frame: number): boolean {
		if (this.submitCount++ % SAMPLED_EVERY !== 0 || this.count >= SLOTS) return false;
		const slot = this.head % SLOTS;
		this.submitted[slot] = performance.now();
		this.frames[slot] = frame;
		this.submits[slot] = this.submitCount;
		this.head++;
		return true;
	}

	/**
	 * Records the oldest tracked frame as finished now. The time since the previous completion
	 * covers every frame submitted in between, so each frame's share of it is its interval.
	 */
	finish(): void {
		if (this.count === 0) return;
		const slot = this.tail % SLOTS;
		const now = performance.now();
		const submits = this.submits[slot] as number;
		this.recorder.begin(this.frames[slot] as number);
		if (this.lastDone >= 0)
			this.recorder.interval((now - this.lastDone) / (submits - this.lastSubmits));
		this.recorder.commit(now - (this.submitted[slot] as number));
		this.lastDone = now;
		this.lastSubmits = submits;
		this.tail++;
	}
}

/** WebGPU: the queue resolves one promise per tracked frame, in submit order. */
export class QueueCompletion {
	readonly signal: CompletionSignal = 'queue';
	private readonly frames: InFlight;
	private readonly onDone = () => this.frames.finish();

	constructor(
		private readonly queue: GPUQueue,
		metrics: ArrayBufferLike,
	) {
		this.frames = new InFlight(new FrameRecorder(metrics, Role.Completion));
	}

	/** Tracks the frame just submitted, while the page measures, when it is a sampled frame. */
	afterSubmit(frame: number): void {
		if (!this.frames.measuring || !this.frames.push(frame)) return;
		this.queue.onSubmittedWorkDone().then(this.onDone, this.onDone);
	}

	poll(): void {}
}

/** WebGL2: a fence after each tracked frame, checked without waiting at the start of the next. */
export class FenceCompletion {
	readonly signal: CompletionSignal = 'fence';
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

	/** Places a fence after the frame just submitted, while the page measures, when it is a sampled frame. */
	afterSubmit(frame: number): void {
		if (!this.frames.measuring || !this.frames.push(frame)) return;
		this.fences[this.head++ % SLOTS] = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		this.gl.flush();
	}

	/** Records every fence that has signaled, oldest first. */
	poll(): void {
		const { gl } = this;
		while (this.tail < this.head) {
			const slot = this.tail % SLOTS;
			const fence = this.fences[slot] ?? null;
			// A fence the browser could not make counts as finished, so the count cannot stick.
			if (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
			if (fence) gl.deleteSync(fence);
			this.fences[slot] = null;
			this.frames.finish();
			this.tail++;
		}
	}
}

export type Completion = QueueCompletion | FenceCompletion;
