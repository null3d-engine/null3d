// Reads of a small region of a compute pass's texture on the sketch's thread: a read asks the next
// recorded frame to copy the region into a buffer of a ring, and answers through a promise once the
// GPU has put its bytes in engine memory. The read lands a few frames after the frame that copies
// it, because the browser maps the buffer asynchronously; the frame loop checks the read's control
// slot and no thread waits for it.
//
// The bytes come back in the target's own format, and the sketch decodes them: each texel gives
// four numbers, its red, green, blue and alpha, with 8-bit color read as a share of 255.

import { EngineError } from '../errors/engine-error';
import {
	FORMAT_BGRA8_UNORM,
	FORMAT_CANVAS,
	FORMAT_R32_FLOAT,
	FORMAT_RGBA8_UNORM,
	FORMAT_RGBA16_FLOAT,
} from '../generated/gpu';
import { PassRead0 } from '../shared/slot';
import type { CoreMemory, ViewHolder } from './memory';

/** How many reads may wait for the GPU at once. */
const RING = 4;

/** The longest side of a region, in texels, which the engine copies. */
export const MAX_PASS_READ_SIDE = 64;

/**
 * The layer that a read names when it takes the state that the pass wrote last, as the engine
 * writes it into the request.
 */
export const NEWEST_LAYER = 0xffffffff;

/** The frames a read may wait for its answer before the call fails. */
const TIMEOUT_FRAMES = 240;

/** The largest number that the core returns for a region or pass that it cannot read. */
const REFUSED = 0xffffffff;

/**
 * A frame's region: texels from the texture's stored first row.
 *
 * @category api/render
 */
export interface PassReadRegion {
	/** The region's first texel along x. It is 0 by default. */
	readonly x?: number;
	/** The region's first texel along y. It is 0 by default. */
	readonly y?: number;
	/** The region's width in texels, at most 64. */
	readonly width: number;
	/** The region's height in texels, at most 64. */
	readonly height: number;
	/**
	 * The array layer the region lies in. It is the state that the pass wrote last by default, so a
	 * pass that keeps history reads its newer state without naming a layer.
	 */
	readonly layer?: number;
}

/**
 * What a read found: four numbers for each texel, top row first, and how late it came.
 *
 * @category api/render
 */
export interface PassReadResult {
	/** The texels: red, green, blue and alpha for each, row by row from the top left. */
	readonly data: Float32Array;
	/** The region's width in texels. */
	readonly width: number;
	/** The region's height in texels. */
	readonly height: number;
	/** The frames between the request and the answer, which is at least one. */
	readonly frames: number;
}

/** A read that waits for its frame. */
interface Job {
	readonly place: number;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly layer: number;
	readonly requestedFrame: number;
	readonly resolve: (result: PassReadResult) => void;
	readonly reject: (error: unknown) => void;
}

/** A read that the core took, with the read of the ring that answers it. */
interface InFlight extends Job {
	readonly ring: number;
	readonly format: number;
}

/** The reads of compute passes' regions that a page waits for. */
export class PassReads implements ViewHolder {
	private slots: Int32Array | undefined;
	private bytes: Uint8Array | undefined;
	private address = 0;
	private stride = 0;
	private generation = -1;
	private ring = 0;
	private frame = 0;
	private inFlight: InFlight | undefined;
	private readonly queue: Job[] = [];
	private stopped = false;

	constructor(
		private readonly core: CoreMemory,
		private readonly webgl2: boolean,
	) {
		core.holdViews(this);
	}

	/** Forgets the view of the ring's regions, which the next answer makes again. */
	dropViews(): void {
		this.bytes = undefined;
		this.generation = -1;
	}

	/** @internal Gives the reads the engine's control block, when the frame loop starts. */
	attach(slots: Int32Array): void {
		this.slots = slots;
	}

	/** Waits for a region of the compute pass at `place`, and answers through the promise. */
	read(place: number, region: Required<PassReadRegion>): Promise<PassReadResult> {
		if (this.stopped)
			return Promise.reject(
				new EngineError('E1420', 'render.readPass() ran after the engine stopped.'),
			);
		return new Promise((resolve, reject) => {
			this.queue.push({
				place,
				x: region.x,
				y: region.y,
				width: region.width,
				height: region.height,
				layer: region.layer,
				requestedFrame: this.frame,
				resolve,
				reject,
			});
			this.send();
		});
	}

	/** @internal Answers each read that landed, at the end of a frame. */
	poll(slots: Int32Array): void {
		this.slots = slots;
		this.frame++;
		const job = this.inFlight;
		if (job) {
			if (Atomics.load(slots, PassRead0 + job.ring) !== 0) {
				this.inFlight = undefined;
				try {
					job.resolve(this.answer(job));
				} catch (error) {
					job.reject(error);
				}
			} else if (this.frame - job.requestedFrame > TIMEOUT_FRAMES) {
				this.inFlight = undefined;
				job.reject(
					new EngineError(
						'E1220',
						`render.readPass() waited ${TIMEOUT_FRAMES} frames for the pass "${job.place}", whose texture no frame copied. A pass that nothing shows or reads has no texture to read.`,
					),
				);
			}
		}
		this.send();
	}

	/** @internal Fails the reads that wait, when the engine stops. */
	stop(): void {
		this.stopped = true;
		if (!this.inFlight && this.queue.length === 0) return;
		const error = new EngineError('E1420', 'render.readPass() waited when the engine stopped.');
		this.inFlight?.reject(error);
		for (const job of this.queue) job.reject(error);
		this.inFlight = undefined;
		this.queue.length = 0;
	}

	/** Gives the core the first read of the queue, while no read waits. */
	private send(): void {
		const slots = this.slots;
		if (!slots || this.inFlight || this.queue.length === 0) return;
		const job = this.queue[0] as Job;
		const ring = this.ring;
		const slot = PassRead0 + ring;
		Atomics.store(slots, slot, 0);
		const request = this.core.glue.requestPassRead(
			job.place,
			job.x,
			job.y,
			job.width,
			job.height,
			job.layer,
			ring,
			slot,
		);
		if (request === 0) return;
		this.queue.shift();
		if (request === REFUSED) {
			job.reject(
				new EngineError(
					'E1220',
					`render.readPass() got a region that the compute pass at place ${job.place} cannot copy. Give a whole region from 1 to ${MAX_PASS_READ_SIDE} texels each way, within the pass's texture, at a layer that it holds.`,
				),
			);
			this.send();
			return;
		}
		this.ring = (ring + 1) % RING;
		this.inFlight = { ...job, ring, format: request - 1 };
	}

	/** The region's texels, decoded from the bytes that the GPU copied into engine memory. */
	private answer(job: InFlight): PassReadResult {
		const data = this.decode(job);
		return {
			data,
			width: job.width,
			height: job.height,
			frames: Math.max(1, this.frame - job.requestedFrame),
		};
	}

	/** Decodes one read's region into four numbers for each texel, top row first. */
	private decode(job: InFlight): Float32Array {
		const texels = job.width * job.height;
		const bytes = this.regionView(job.ring, texels * texelBytes(job.format));
		const out = new Float32Array(texels * 4);
		const rowBytes = job.width * texelBytes(job.format);
		for (let row = 0; row < job.height; row++) {
			// WebGL2 stores a target's first row at the image's bottom edge.
			const source = this.webgl2 ? job.height - 1 - row : row;
			decodeRow(out, row * job.width * 4, bytes, source * rowBytes, job.width, job.format);
		}
		return out;
	}

	/** The bytes of one read of the ring, as the core's views now stand. */
	private regionView(ring: number, length: number): Uint8Array {
		const { core } = this;
		core.refresh();
		if (!this.bytes || this.generation !== core.generation) {
			this.address = core.glue.passReadAddress();
			this.stride = core.glue.passReadStride();
			this.bytes = core.view(Uint8Array, this.address, RING * this.stride);
			this.generation = core.generation;
		}
		const all = this.bytes;
		if (!all) throw new EngineError('E1220', 'the readback ring has no view of engine memory.');
		return all.subarray(ring * this.stride, ring * this.stride + length);
	}
}

/** The bytes of one texel of a draw list format that a pass reads back. */
function texelBytes(format: number): number {
	return format === FORMAT_RGBA16_FLOAT ? 8 : 4;
}

/** Decodes `width` texels of one row into four floats each. */
function decodeRow(
	out: Float32Array,
	at: number,
	bytes: Uint8Array,
	from: number,
	width: number,
	format: number,
): void {
	if (format === FORMAT_RGBA16_FLOAT) {
		const halves = new Uint16Array(bytes.buffer, bytes.byteOffset + from, width * 4);
		for (let k = 0; k < width * 4; k++) out[at + k] = halfToFloat(halves[k] as number);
		return;
	}
	if (format === FORMAT_R32_FLOAT) {
		const floats = new Float32Array(bytes.buffer, bytes.byteOffset + from, width);
		for (let k = 0; k < width; k++) out[at + k * 4] = floats[k] as number;
		return;
	}
	const swap = format === FORMAT_BGRA8_UNORM;
	const eightBit = format === FORMAT_RGBA8_UNORM || format === FORMAT_CANVAS || swap;
	for (let k = 0; k < width; k++) {
		const texel = from + k * 4;
		const red = bytes[texel] as number;
		const green = bytes[texel + 1] as number;
		const blue = bytes[texel + 2] as number;
		const alpha = bytes[texel + 3] as number;
		const at4 = at + k * 4;
		if (eightBit) {
			out[at4] = (swap ? blue : red) / 255;
			out[at4 + 1] = green / 255;
			out[at4 + 2] = (swap ? red : blue) / 255;
			out[at4 + 3] = alpha / 255;
		} else {
			out[at4] = red;
			out[at4 + 1] = green;
			out[at4 + 2] = blue;
			out[at4 + 3] = alpha;
		}
	}
}

/** The float that a 16-bit float's bits give. */
function halfToFloat(half: number): number {
	const sign = (half & 0x8000) === 0 ? 1 : -1;
	const exponent = (half >> 10) & 0x1f;
	const mantissa = half & 0x3ff;
	if (exponent === 0) return sign * mantissa * 2 ** -24;
	if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
	return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}
