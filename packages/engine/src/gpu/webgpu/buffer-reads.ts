// The reads of GPU buffers that draw lists ask for (`ReadBuffer`) on the WebGPU path. Each read maps
// its buffer once the frame's commands are submitted, copies the bytes into engine memory through
// the read sink, and unmaps the buffer before its control slot rises, so the code that waits for
// the slot may use the buffer again at once. Reads come from a pool, each with its callbacks made
// once, so a read in every frame allocates nothing but the view of the mapped bytes.

import { messageOf } from '../../errors/message';
import { DEV } from '../../shared/dev';
import type { ReadSink } from '../readback';

/** One read: its buffer's range, and where its bytes go. */
class BufferRead {
	buffer: GPUBuffer | undefined;
	offset = 0;
	size = 0;
	destination = 0;
	slot = 0;
	sink: ReadSink | undefined;

	constructor(private readonly reads: BufferReads) {}

	/** Copies the mapped bytes into engine memory, then frees the buffer and raises the slot. */
	readonly mapped = (): void => {
		const { buffer, sink, slot } = this;
		if (!buffer) return;
		if (sink)
			sink.bytes.set(
				new Uint8Array(buffer.getMappedRange(this.offset, this.size)),
				this.destination,
			);
		buffer.unmap();
		this.reads.release(this);
		sink?.done(slot);
	};

	/**
	 * A map fails when the buffer is destroyed during it, which drops the read on purpose, and
	 * when the device is lost, which the loss path reports. A map that WebGPU rejects also reports
	 * a validation error, which the renderer's watch of uncaught GPU errors reports in every build.
	 */
	readonly failed = (error: unknown): void => {
		this.reads.release(this);
		if (DEV && (error as { name?: string } | null)?.name !== 'AbortError')
			console.warn(`null3D: a read of a GPU buffer failed: ${messageOf(error)}`);
	};
}

/** The reads of a WebGPU backend: those of the frame being replayed, and the pool. */
export class BufferReads {
	/** The reads of the list being replayed, which map once its commands are submitted. */
	private readonly queued: BufferRead[] = [];
	private readonly free: BufferRead[] = [];

	/** Queues a read of `size` bytes of `buffer` from `offset`, for `start` to map. */
	add(buffer: GPUBuffer, offset: number, size: number, destination: number, slot: number): void {
		const read = this.free.pop() ?? new BufferRead(this);
		read.buffer = buffer;
		read.offset = offset;
		read.size = size;
		read.destination = destination;
		read.slot = slot;
		this.queued.push(read);
	}

	/**
	 * Starts the map of each queued read, now that the commands before it are submitted. Without a
	 * sink, as when a test replays a list outside a running engine, the buffer still maps, and its
	 * bytes go nowhere.
	 */
	start(sink: ReadSink | undefined): void {
		const { queued } = this;
		if (queued.length === 0) return;
		for (const read of queued) {
			read.sink = sink;
			(read.buffer as GPUBuffer)
				.mapAsync(GPUMapMode.READ, read.offset, read.size)
				.then(read.mapped, read.failed);
		}
		queued.length = 0;
	}

	/**
	 * Drops the queued reads of a buffer that is destroyed, whose map would fail, so their slots
	 * never rise. A map under way fails by itself when the buffer is destroyed.
	 */
	drop(buffer: GPUBuffer): void {
		const { queued } = this;
		let kept = 0;
		for (const read of queued) {
			if (read.buffer === buffer) this.release(read);
			else queued[kept++] = read;
		}
		queued.length = kept;
	}

	/** Returns a finished read to the pool. */
	release(read: BufferRead): void {
		read.buffer = undefined;
		read.sink = undefined;
		this.free.push(read);
	}
}
