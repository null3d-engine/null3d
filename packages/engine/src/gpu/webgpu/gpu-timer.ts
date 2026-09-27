// GPU time per frame from WebGPU timestamp queries. The first pass of a frame writes a timestamp
// when it starts and every pass writes one when it ends, so a frame's two values span all its
// passes. Results come back through mappable buffers a few frames later. A frame that finds no free
// buffer goes untimed instead of stalling the GPU. Timing runs only while the page measures.

import { FrameRecorder, Role } from '../../shared/metrics';

/** Frames whose results can be in flight at once. */
const SLOTS = 4;
/** resolveQuerySet writes only at offsets that are multiples of 256 bytes. */
const RESOLVE_STRIDE = 256;
const RESULT_BYTES = 16;

export class GpuTimer {
	private readonly querySet: GPUQuerySet;
	private readonly resolveBuffer: GPUBuffer;
	private readonly readbacks: GPUBuffer[] = [];
	private readonly firstWrites: GPURenderPassTimestampWrites[] = [];
	private readonly laterWrites: GPURenderPassTimestampWrites[] = [];
	private readonly onMapped: (() => void)[] = [];
	private readonly onFailed: (() => void)[] = [];
	private readonly pending = new Uint8Array(SLOTS);
	private readonly frames = new Uint32Array(SLOTS);
	private slot = -1;
	private passes = 0;
	private next = 0;

	private constructor(
		device: GPUDevice,
		private readonly recorder: FrameRecorder,
	) {
		this.querySet = device.createQuerySet({ type: 'timestamp', count: SLOTS * 2 });
		this.resolveBuffer = device.createBuffer({
			size: SLOTS * RESOLVE_STRIDE,
			usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
		});
		for (let slot = 0; slot < SLOTS; slot++) {
			this.readbacks.push(
				device.createBuffer({
					size: RESULT_BYTES,
					usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
				}),
			);
			this.firstWrites.push({
				querySet: this.querySet,
				beginningOfPassWriteIndex: slot * 2,
				endOfPassWriteIndex: slot * 2 + 1,
			});
			this.laterWrites.push({ querySet: this.querySet, endOfPassWriteIndex: slot * 2 + 1 });
			this.onMapped.push(() => this.read(slot));
			this.onFailed.push(() => {
				this.pending[slot] = 0;
			});
		}
	}

	/** A timer when the device has timestamp queries, else undefined. */
	static create(device: GPUDevice, metrics: ArrayBufferLike): GpuTimer | undefined {
		if (!device.features.has('timestamp-query')) return undefined;
		return new GpuTimer(device, new FrameRecorder(metrics, Role.Gpu));
	}

	/** Starts timing a frame, if the page is measuring and a readback buffer is free. */
	beginFrame(frame: number): void {
		this.slot = -1;
		this.passes = 0;
		if (!this.recorder.measuring || this.pending[this.next] !== 0) return;
		this.slot = this.next;
		this.frames[this.slot] = frame;
		this.next = (this.next + 1) % SLOTS;
	}

	/** Timestamp writes for the frame's next pass, or undefined when the frame is not timed. */
	passWrites(): GPURenderPassTimestampWrites | undefined {
		if (this.slot < 0) return undefined;
		return this.passes++ === 0 ? this.firstWrites[this.slot] : this.laterWrites[this.slot];
	}

	/** Copies the frame's timestamps to its readback buffer. Call it before finishing the encoder. */
	resolve(encoder: GPUCommandEncoder): void {
		if (this.slot < 0) return;
		if (this.passes === 0) {
			this.slot = -1;
			return;
		}
		const offset = this.slot * RESOLVE_STRIDE;
		encoder.resolveQuerySet(this.querySet, this.slot * 2, 2, this.resolveBuffer, offset);
		encoder.copyBufferToBuffer(
			this.resolveBuffer,
			offset,
			this.readbacks[this.slot] as GPUBuffer,
			0,
			RESULT_BYTES,
		);
	}

	/** Starts reading the frame's timestamps back. Call it after the submit. */
	afterSubmit(): void {
		const slot = this.slot;
		if (slot < 0) return;
		this.slot = -1;
		this.pending[slot] = 1;
		(this.readbacks[slot] as GPUBuffer)
			.mapAsync(GPUMapMode.READ)
			.then(this.onMapped[slot], this.onFailed[slot]);
	}

	private read(slot: number): void {
		const buffer = this.readbacks[slot] as GPUBuffer;
		const times = new BigUint64Array(buffer.getMappedRange());
		const begin = times[0] as bigint;
		const end = times[1] as bigint;
		buffer.unmap();
		this.pending[slot] = 0;
		// Some drivers report an end before the start across passes; such a frame goes unrecorded.
		if (end < begin) return;
		this.recorder.begin(this.frames[slot] as number);
		this.recorder.commit(Number(end - begin) / 1e6);
	}

	destroy(): void {
		this.querySet.destroy();
		this.resolveBuffer.destroy();
		for (const buffer of this.readbacks) buffer.destroy();
	}
}
