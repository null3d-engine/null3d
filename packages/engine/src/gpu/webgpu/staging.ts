// Uploads through a ring of staging buffers that the browser keeps mapped for writing: a frame
// copies its data into one of them, and the GPU copies it into place. This skips the transfer
// memory that queue.writeBuffer goes through. In Chrome it is 3 to 6 times faster than writeBuffer
// for uploads from 64 KiB to 4 MiB, where writeBuffer waits for that memory to drain. Smaller
// uploads, and uploads of 4 MiB or more, are as fast or faster through writeBuffer, so they stay on
// it.

/** Uploads smaller than this go through queue.writeBuffer. */
export const STAGING_MIN_BYTES = 64 * 1024;
/** Uploads this large or larger go through queue.writeBuffer, which copies them fastest. */
export const STAGING_MAX_BYTES = 4 * 1024 * 1024;
/** Staging buffers at most. The GPU runs a frame or two behind, so a frame rarely finds none free. */
const MAX_SLOTS = 3;
/** The smallest staging buffer; the ring makes bigger ones when frames need more. */
const MIN_CAPACITY = 1024 * 1024;

interface Slot {
	buffer: GPUBuffer;
	capacity: number;
	/** True while the buffer is mapped and no frame is using it. */
	free: boolean;
	onMapped: () => void;
	onFailed: () => void;
}

/** The staging buffers of one device, and the one the current frame writes into. */
export class StagingRing {
	private readonly slots: Slot[] = [];
	private slot: Slot | undefined;
	/** The current slot's mapped bytes. */
	private bytes: Uint8Array | undefined;
	/** The next free byte in the current slot. */
	private used = 0;
	/** The capacity that recent frames needed, which the slots grow to. */
	private wanted = MIN_CAPACITY;
	/** The slot of the frame just submitted, which is mapped again once the GPU is done with it. */
	private submitted: Slot | undefined;

	constructor(private readonly device: GPUDevice) {}

	/** True when an upload of this many bytes goes through the ring. */
	static suits(size: number): boolean {
		return size >= STAGING_MIN_BYTES && size < STAGING_MAX_BYTES;
	}

	/**
	 * Copies `size` bytes of `source` from `sourceOffset` into this frame's staging buffer, and
	 * records the copy into `target` at `targetOffset` on `encoder`, which no pass may hold. Returns
	 * false when the ring has no room for it this frame; the caller then writes through the queue.
	 */
	write(
		encoder: GPUCommandEncoder,
		target: GPUBuffer,
		targetOffset: number,
		source: ArrayBufferLike,
		sourceOffset: number,
		size: number,
	): boolean {
		if (!this.slot && !this.take(size)) return false;
		const slot = this.slot as Slot;
		const at = this.used;
		if (at + size > slot.capacity) {
			this.wanted = Math.max(this.wanted, at + size);
			return false;
		}
		(this.bytes as Uint8Array).set(new Uint8Array(source, sourceOffset, size), at);
		encoder.copyBufferToBuffer(slot.buffer, at, target, targetOffset, size);
		// Copies between buffers start at multiples of 4 bytes.
		this.used = at + ((size + 3) & ~3);
		return true;
	}

	/** Ends the frame's writes. The GPU copies from the staging buffer only once it is unmapped. */
	beforeSubmit(): void {
		const slot = this.slot;
		if (!slot) return;
		slot.buffer.unmap();
		this.slot = undefined;
		this.bytes = undefined;
		this.submitted = slot;
	}

	/** Asks for the submitted frame's staging buffer back, mapped, once the GPU has copied from it. */
	afterSubmit(): void {
		const slot = this.submitted;
		if (!slot) return;
		this.submitted = undefined;
		slot.buffer.mapAsync(GPUMapMode.WRITE).then(slot.onMapped, slot.onFailed);
	}

	destroy(): void {
		for (const slot of this.slots) slot.buffer.destroy();
		this.slots.length = 0;
		this.slot = undefined;
		this.bytes = undefined;
		this.submitted = undefined;
	}

	/**
	 * Takes a free slot for this frame. A free slot too small for recent frames is replaced by a
	 * bigger one, and a new slot is made while the ring has room.
	 */
	private take(size: number): boolean {
		const needed = Math.max(this.wanted, size);
		let slot: Slot | undefined;
		let small = -1;
		for (let i = 0; i < this.slots.length && !slot; i++) {
			const candidate = this.slots[i] as Slot;
			if (!candidate.free) continue;
			if (candidate.capacity >= needed) slot = candidate;
			else small = i;
		}
		if (!slot) {
			if (small >= 0) {
				(this.slots[small] as Slot).buffer.destroy();
				this.slots.splice(small, 1);
			}
			if (this.slots.length >= MAX_SLOTS) return false;
			slot = this.create(2 ** Math.ceil(Math.log2(needed)));
		}
		slot.free = false;
		this.slot = slot;
		this.bytes = new Uint8Array(slot.buffer.getMappedRange());
		this.used = 0;
		return true;
	}

	private create(capacity: number): Slot {
		const buffer = this.device.createBuffer({
			size: capacity,
			usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
			mappedAtCreation: true,
		});
		const slot: Slot = {
			buffer,
			capacity,
			free: true,
			onMapped: () => {
				slot.free = true;
			},
			// A lost device or a destroyed ring rejects the mapping; the slot is gone for good.
			onFailed: () => {
				const index = this.slots.indexOf(slot);
				if (index >= 0) this.slots.splice(index, 1);
			},
		};
		this.slots.push(slot);
		return slot;
	}
}
