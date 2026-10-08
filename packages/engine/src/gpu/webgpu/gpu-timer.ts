// GPU time per frame and per pass from WebGPU timestamp queries. A timed frame's commands open with
// a start mark, a compute pass of one invocation that does nothing, and each pass writes a timestamp
// when it begins and when it ends. So the timer covers the whole frame: the copies recorded before
// the first pass, each pass, and the time between passes. The timer copies a frame's timestamps out
// only once the GPU has finished the frame, in a submit of their own: Firefox writes a frame's
// timestamps when the frame's work completes, so a copy in the frame's own commands reads the
// values of an earlier frame. Results come back through mappable buffers a few frames later. A
// frame that finds no free buffer goes untimed instead of stalling the GPU. A pass that the GPU
// left untimed stays out of the frame's parts, and the frame keeps the others. Timing runs only
// while the page measures, on one drawn frame in every SAMPLED_EVERY.

import { TIMER_MARK_SHADER } from '../../generated/shaders';
import {
	FrameRecorder,
	GPU_TIMED_PASSES,
	Role,
	SAMPLED_EVERY,
	UNTIMED,
} from '../../shared/metrics';
import { wgslOf } from './pipelines';
import { submitOne } from './reusable';

/** Frames whose results can be in flight at once. */
const SLOTS = 4;
/** Timestamps of one frame: the start mark's two, then two for each pass that the timer times alone. */
const QUERIES = 2 + 2 * GPU_TIMED_PASSES;
/** Where a frame's first pass begins among its timestamps. */
const FIRST_PASS = 2;
/** resolveQuerySet writes only at offsets that are multiples of 256 bytes. */
const RESOLVE_STRIDE = 256;
const TIMESTAMP_BYTES = 8;
const NS_PER_MS = 1e6;
/** A timestamp's high 32 bits count this many nanoseconds. */
const HIGH_WORD_NS = 2 ** 32;

/**
 * Whether the GPU wrote timestamp `q`. Metal skips a pass that holds no work, and leaves its
 * timestamps at zero or at its error value, all ones.
 */
function written(words: Uint32Array, q: number): boolean {
	const low = words[2 * q] as number;
	const high = words[2 * q + 1] as number;
	return (low !== 0 || high !== 0) && (low !== 0xffffffff || high !== 0xffffffff);
}

/** Whether the GPU timed the pass whose beginning is timestamp `q`: both written, in order. */
function timedPass(words: Uint32Array, q: number): boolean {
	if (!written(words, q) || !written(words, q + 1)) return false;
	const beginHigh = words[2 * q + 1] as number;
	const endHigh = words[2 * q + 3] as number;
	return (
		endHigh > beginHigh ||
		(endHigh === beginHigh && (words[2 * q + 2] as number) >= (words[2 * q] as number))
	);
}

export class GpuTimer {
	private readonly querySet: GPUQuerySet;
	private readonly resolveBuffer: GPUBuffer;
	private readonly readbacks: GPUBuffer[] = [];
	private readonly markPipeline: GPUComputePipeline;
	private readonly markWrites: GPURenderPassTimestampWrites[] = [];
	/** Per slot, the writes of each pass the timer times alone. */
	private readonly passWriteSets: GPURenderPassTimestampWrites[][] = [];
	/** Per slot, the writes of the passes after those: each moves the last timed pass's end. */
	private readonly laterWrites: GPURenderPassTimestampWrites[] = [];
	private readonly markPass: GPUComputePassDescriptor = {};
	private readonly onDone: (() => void)[] = [];
	private readonly onMapped: (() => void)[] = [];
	private readonly onFailed: (() => void)[] = [];
	private readonly pending = new Uint8Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	private readonly passCounts = new Uint32Array(SLOTS);
	private readonly renderMasks = new Uint32Array(SLOTS);
	/** Each timestamp of a frame as read back, in nanoseconds from the beginning of its first pass. */
	private readonly times = new Float64Array(QUERIES);
	private slot = -1;
	private passes = 0;
	private renderMask = 0;
	private next = 0;
	private drawn = 0;
	private destroyed = false;

	private constructor(
		private readonly device: GPUDevice,
		private readonly recorder: FrameRecorder,
	) {
		this.querySet = device.createQuerySet({ type: 'timestamp', count: SLOTS * QUERIES });
		this.resolveBuffer = device.createBuffer({
			size: SLOTS * RESOLVE_STRIDE,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		});
		this.markPipeline = device.createComputePipeline({
			label: 'gpu timer start mark',
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: wgslOf(TIMER_MARK_SHADER.webgpu).source }),
				entryPoint: 'main',
			},
		});
		for (let slot = 0; slot < SLOTS; slot++) {
			const base = slot * QUERIES;
			this.readbacks.push(
				device.createBuffer({
					size: QUERIES * TIMESTAMP_BYTES,
					usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
				}),
			);
			this.markWrites.push(this.writes(base, base + 1));
			const passWrites: GPURenderPassTimestampWrites[] = [];
			for (let pass = 0; pass < GPU_TIMED_PASSES; pass++)
				passWrites.push(
					this.writes(base + FIRST_PASS + 2 * pass, base + FIRST_PASS + 1 + 2 * pass),
				);
			this.passWriteSets.push(passWrites);
			this.laterWrites.push(this.writes(undefined, base + QUERIES - 1));
			this.onDone.push(() => this.copyOut(slot));
			this.onMapped.push(() => this.read(slot));
			this.onFailed.push(() => {
				this.pending[slot] = 0;
			});
		}
	}

	private writes(begin: number | undefined, end: number): GPURenderPassTimestampWrites {
		return { querySet: this.querySet, beginningOfPassWriteIndex: begin, endOfPassWriteIndex: end };
	}

	/** A timer when the device has timestamp queries, else undefined. */
	static create(device: GPUDevice, metrics: ArrayBufferLike): GpuTimer | undefined {
		if (!device.features.has('timestamp-query')) return undefined;
		return new GpuTimer(device, new FrameRecorder(metrics, Role.Gpu));
	}

	/** Starts timing a frame, if the page is measuring, it is a sampled frame, and a readback buffer is free. */
	beginFrame(frame: number): void {
		this.slot = -1;
		this.passes = 0;
		this.renderMask = 0;
		if (!this.recorder.measuring || this.drawn++ % SAMPLED_EVERY !== 0) return;
		if (this.pending[this.next] !== 0) return;
		this.slot = this.next;
		this.frames[this.slot] = frame;
		this.next = (this.next + 1) % SLOTS;
	}

	/** Opens a timed frame's commands with the start mark. Call it on the frame's new encoder. */
	markStart(encoder: GPUCommandEncoder): void {
		if (this.slot < 0) return;
		this.markPass.timestampWrites = this.markWrites[this.slot];
		const pass = encoder.beginComputePass(this.markPass);
		pass.setPipeline(this.markPipeline);
		pass.dispatchWorkgroups(1);
		pass.end();
	}

	/**
	 * Timestamp writes for the frame's next pass, a render pass or a compute pass, or undefined when
	 * the frame is not timed.
	 */
	passWrites(render: boolean): GPURenderPassTimestampWrites | undefined {
		if (this.slot < 0) return undefined;
		const pass = this.passes++;
		if (pass >= GPU_TIMED_PASSES) return this.laterWrites[this.slot];
		if (render) this.renderMask |= 1 << pass;
		return this.passWriteSets[this.slot]?.[pass];
	}

	/** Ends the frame's timing. Call it before finishing the frame's encoder. */
	endFrame(): void {
		const slot = this.slot;
		if (slot < 0) return;
		if (this.passes === 0) {
			this.slot = -1;
			return;
		}
		this.passCounts[slot] = this.passes;
		this.renderMasks[slot] = this.renderMask;
	}

	/** Reads the frame's timestamps back once the GPU has finished it. Call it after the submit. */
	afterSubmit(): void {
		const slot = this.slot;
		if (slot < 0) return;
		this.slot = -1;
		this.pending[slot] = 1;
		this.device.queue.onSubmittedWorkDone().then(this.onDone[slot], this.onFailed[slot]);
	}

	/** Copies a finished frame's timestamps to its readback buffer, and maps the buffer. */
	private copyOut(slot: number): void {
		if (this.destroyed) return;
		const count = FIRST_PASS + 2 * Math.min(this.passCounts[slot] as number, GPU_TIMED_PASSES);
		const offset = slot * RESOLVE_STRIDE;
		const readback = this.readbacks[slot] as GPUBuffer;
		const encoder = this.device.createCommandEncoder();
		encoder.resolveQuerySet(this.querySet, slot * QUERIES, count, this.resolveBuffer, offset);
		encoder.copyBufferToBuffer(this.resolveBuffer, offset, readback, 0, count * TIMESTAMP_BYTES);
		submitOne(this.device.queue, encoder.finish());
		readback.mapAsync(GPUMapMode.READ).then(this.onMapped[slot], this.onFailed[slot]);
	}

	private read(slot: number): void {
		const buffer = this.readbacks[slot] as GPUBuffer;
		const passes = this.passCounts[slot] as number;
		const timed = Math.min(passes, GPU_TIMED_PASSES);
		const count = FIRST_PASS + 2 * timed;
		const words = new Uint32Array(buffer.getMappedRange(0, count * TIMESTAMP_BYTES));
		// The frame's times count from the beginning of its first pass that the GPU timed. Each
		// timestamp is two 32-bit words, low word first. Differences from that beginning stay exact
		// as numbers, where whole timestamps may not.
		let first = FIRST_PASS;
		while (first < count && !timedPass(words, first)) first += 2;
		const times = this.times;
		const low = words[2 * first] as number;
		const high = words[2 * first + 1] as number;
		for (let q = 0; q < count; q++)
			times[q] = written(words, q)
				? ((words[2 * q + 1] as number) - high) * HIGH_WORD_NS + ((words[2 * q] as number) - low)
				: Number.NaN;
		buffer.unmap();
		this.pending[slot] = 0;
		// A frame with no timed pass goes unrecorded.
		if (first >= count) return;
		// A start mark that a browser left unwritten, or that ends after the first pass begins, as
		// Firefox's passes on the Mac can, leaves the frame starting at its first timed pass, with its
		// copies untimed.
		const markBegin = times[0] as number;
		const markEnd = times[1] as number;
		const marked = markBegin <= markEnd && markEnd <= 0;
		const recorder = this.recorder;
		recorder.begin(this.frames[slot] as number);
		recorder.gpuPasses(passes, this.renderMasks[slot] as number);
		recorder.gpuTime(0, marked ? -markEnd / NS_PER_MS : UNTIMED);
		// Passes that do not depend on each other may overlap. A pass that the GPU left untimed, or
		// timed out of order, stays out of the frame's parts, and the frame keeps the others.
		let last = 0;
		for (let pass = 0; pass < timed; pass++) {
			const at = FIRST_PASS + 2 * pass;
			const begin = times[at] as number;
			const end = times[at + 1] as number;
			const ordered = begin >= 0 && end >= begin;
			recorder.gpuTime(1 + pass, ordered ? (end - begin) / NS_PER_MS : UNTIMED);
			if (ordered && end > last) last = end;
		}
		recorder.commit((last - (marked ? markBegin : 0)) / NS_PER_MS);
	}

	destroy(): void {
		this.destroyed = true;
		this.querySet.destroy();
		this.resolveBuffer.destroy();
		for (const buffer of this.readbacks) buffer.destroy();
	}
}
