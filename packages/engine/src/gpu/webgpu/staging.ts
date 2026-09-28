// Uploads through a ring of staging buffers that the browser keeps mapped for writing: a frame
// copies its data into one of them, and the GPU copies it into place. This skips the transfer
// memory that queue.writeBuffer goes through, which makes mid-size uploads 3 to 6 times faster in
// Chrome. The upload route chooser decides which uploads take the ring.
//
// The copies of a frame wait in a list until the frame records its next command, and are recorded
// then, after the staging buffer is unmapped. Safari rejects a submit whose commands hold more than
// one copy from a buffer that was still mapped when the copies were recorded.

/** Staging buffers at most. The GPU runs a frame or two behind, so a frame rarely finds none free. */
const MAX_SLOTS = 3;
/** The smallest staging buffer; the ring makes bigger ones when frames need more. */
const MIN_CAPACITY = 1024 * 1024;
/** Waiting copies the list holds before it first grows. */
const INITIAL_COPIES = 64;
/** Numbers per waiting copy: the target offset, the staging offset and the size. */
const COPY_FIELDS = 3;

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
	/** The targets of the copies that wait for the current slot to be unmapped. */
	private targets: (GPUBuffer | undefined)[] = new Array(INITIAL_COPIES).fill(undefined);
	/** The offsets and size of each waiting copy. */
	private fields = new Float64Array(INITIAL_COPIES * COPY_FIELDS);
	private waiting = 0;
	/** The slots the current frame copied from, which are mapped again once the frame is submitted. */
	private readonly flushed: (Slot | undefined)[] = new Array(MAX_SLOTS).fill(undefined);
	private flushedCount = 0;
	/** True after the ring made a staging buffer, until `takeMadeBuffer` reads it. */
	private madeBuffer = false;

	constructor(private readonly device: GPUDevice) {}

	/** True while copies wait for `flush`. */
	get pending(): boolean {
		return this.waiting > 0;
	}

	/**
	 * Copies `size` bytes of `source` from `sourceOffset` into this frame's staging buffer, and adds
	 * the copy into `target` at `targetOffset` to the waiting copies. Returns false when the ring has
	 * no room for it this frame; the caller then writes through the queue.
	 */
	write(
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
		if (this.waiting === this.targets.length) this.grow();
		const field = this.waiting * COPY_FIELDS;
		this.targets[this.waiting] = target;
		this.fields[field] = targetOffset;
		this.fields[field + 1] = at;
		this.fields[field + 2] = size;
		this.waiting++;
		// Copies between buffers start at multiples of 4 bytes.
		this.used = at + ((size + 3) & ~3);
		return true;
	}

	/**
	 * Unmaps the current staging buffer and records its waiting copies on `encoder`. Call it before
	 * any other command goes into the encoder, so the copies keep their place in the frame, and
	 * before the encoder is finished. Later uploads in the frame take another staging buffer.
	 */
	flush(encoder: GPUCommandEncoder): void {
		const slot = this.slot;
		if (!slot) return;
		slot.buffer.unmap();
		const { targets, fields } = this;
		for (let i = 0; i < this.waiting; i++) {
			const field = i * COPY_FIELDS;
			encoder.copyBufferToBuffer(
				slot.buffer,
				fields[field + 1] as number,
				targets[i] as GPUBuffer,
				fields[field] as number,
				fields[field + 2] as number,
			);
			targets[i] = undefined;
		}
		this.waiting = 0;
		this.slot = undefined;
		this.bytes = undefined;
		this.flushed[this.flushedCount++] = slot;
	}

	/** Asks for the staging buffers of the frame just submitted back, mapped, once the GPU is done. */
	afterSubmit(): void {
		for (let i = 0; i < this.flushedCount; i++) {
			const slot = this.flushed[i] as Slot;
			this.flushed[i] = undefined;
			slot.buffer.mapAsync(GPUMapMode.WRITE).then(slot.onMapped, slot.onFailed);
		}
		this.flushedCount = 0;
	}

	/** True once after the ring made a staging buffer, a one-time cost that route timing skips. */
	takeMadeBuffer(): boolean {
		const made = this.madeBuffer;
		this.madeBuffer = false;
		return made;
	}

	destroy(): void {
		for (const slot of this.slots) slot.buffer.destroy();
		this.slots.length = 0;
		this.slot = undefined;
		this.bytes = undefined;
		this.targets.fill(undefined);
		this.waiting = 0;
		this.flushed.fill(undefined);
		this.flushedCount = 0;
	}

	/** Doubles the room for waiting copies, for frames with more staged uploads than any before. */
	private grow(): void {
		const count = this.targets.length * 2;
		const fields = new Float64Array(count * COPY_FIELDS);
		fields.set(this.fields);
		this.fields = fields;
		this.targets = this.targets.concat(new Array(count - this.targets.length).fill(undefined));
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
		this.madeBuffer = true;
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
