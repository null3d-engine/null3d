// The triangles and instances that the draws culled on the GPU drew. Culling shaders write the
// instance count of each indexed indirect draw on the GPU, so the thread that draws never sees it.
// While the page samples, on one frame in every SAMPLED_EVERY, the backend notes each indirect draw
// that the frame replays. At the end of the frame's commands it copies the noted draws' arguments
// into a mappable buffer, one copy for each buffer of draws, and sums them once the buffer maps a
// few frames later. Every frame then adds the newest sums to its own counts. A sampled frame that
// finds no free buffer goes unread, and the sums keep their last values. While nobody samples, the
// sums are 0, so a frame counts only the draws that the CPU issued.

import { SAMPLED_EVERY } from '../../shared/metrics';

/** Frames whose arguments can be on their way back at once. */
const SLOTS = 3;
/** Bytes of one indexed indirect draw's arguments: five 32-bit words. */
const ARGUMENT_BYTES = 20;
/** Values noted for each draw: its buffer's place in the frame's list, its offset, and 1 for lines. */
const DRAW_VALUES = 3;
/** Draws and buffers that a slot holds before it first grows. */
const FIRST_DRAWS = 64;
const FIRST_SOURCES = 8;
/** Readback buffers grow in steps of this many bytes. */
const READBACK_STEP = 4096;

/** What one sampled frame noted, and the buffer that its arguments come back in. */
interface Slot {
	/** Each draw's values, `DRAW_VALUES` each. */
	draws: Int32Array;
	drawCount: number;
	/** The buffers of draws that the frame read, each with the first and last byte it copies. */
	sources: (GPUBuffer | undefined)[];
	starts: Uint32Array;
	ends: Uint32Array;
	/** Where each buffer's copy starts in the readback buffer. */
	at: Uint32Array;
	sourceCount: number;
	readback: GPUBuffer | undefined;
	pending: boolean;
	onMapped: () => void;
	onFailed: () => void;
}

export class CulledCounts {
	/** Triangles that the culled draws of the newest frame read back drew. */
	triangles = 0;
	/** Instances that the culled draws of the newest frame read back drew. */
	instances = 0;
	/** True while the page samples, as of the newest frame. */
	private sampling = false;
	private readonly slots: Slot[] = [];
	/** The slot that notes the current frame's draws, or undefined when the frame is not sampled. */
	private current: Slot | undefined;
	private next = 0;
	private frames = 0;
	private destroyed = false;

	constructor(private readonly device: GPUDevice) {
		for (let k = 0; k < SLOTS; k++) {
			const slot: Slot = {
				draws: new Int32Array(FIRST_DRAWS * DRAW_VALUES),
				drawCount: 0,
				sources: [],
				starts: new Uint32Array(FIRST_SOURCES),
				ends: new Uint32Array(FIRST_SOURCES),
				at: new Uint32Array(FIRST_SOURCES),
				sourceCount: 0,
				readback: undefined,
				pending: false,
				onMapped: () => this.read(slot),
				onFailed: () => {
					slot.pending = false;
				},
			};
			this.slots.push(slot);
		}
	}

	/**
	 * Starts a frame: it is noted when the page samples (`sampling`), it is a sampled frame and a
	 * slot is free.
	 */
	beginFrame(sampling: boolean): void {
		this.sampling = sampling;
		// A sampled frame without culled draws copied nothing: its sums are 0.
		if (this.current) {
			this.triangles = 0;
			this.instances = 0;
		}
		this.current = undefined;
		if (!sampling) {
			this.triangles = 0;
			this.instances = 0;
			return;
		}
		if (this.frames++ % SAMPLED_EVERY !== 0) return;
		const slot = this.slots[this.next] as Slot;
		if (slot.pending) return;
		this.next = (this.next + 1) % SLOTS;
		slot.drawCount = 0;
		slot.sourceCount = 0;
		this.current = slot;
	}

	/** Notes an indirect draw of the frame: its arguments at `offset` in `buffer`. */
	note(buffer: GPUBuffer, offset: number, lines: boolean): void {
		const slot = this.current;
		if (!slot) return;
		let source = 0;
		while (source < slot.sourceCount && slot.sources[source] !== buffer) source++;
		if (source === slot.sourceCount) {
			if (source === slot.starts.length) growSources(slot);
			slot.sources[source] = buffer;
			slot.starts[source] = offset;
			slot.ends[source] = offset + ARGUMENT_BYTES;
			slot.sourceCount++;
		} else {
			slot.starts[source] = Math.min(slot.starts[source] as number, offset);
			slot.ends[source] = Math.max(slot.ends[source] as number, offset + ARGUMENT_BYTES);
		}
		let at = slot.drawCount * DRAW_VALUES;
		if (at === slot.draws.length) {
			const draws = new Int32Array(slot.draws.length * 2);
			draws.set(slot.draws);
			slot.draws = draws;
		}
		const { draws } = slot;
		draws[at++] = source;
		draws[at++] = offset;
		draws[at] = lines ? 1 : 0;
		slot.drawCount++;
	}

	/**
	 * Copies the noted draws' arguments into the slot's readback buffer. Call it before finishing
	 * an encoder of the frame. A submit before the frame's first draw, as for texture copies that
	 * must land before uploads, copies nothing, and the frame's last submit copies its draws.
	 */
	copy(encoder: GPUCommandEncoder): void {
		const slot = this.current;
		if (!slot || slot.drawCount === 0) return;
		let bytes = 0;
		for (let k = 0; k < slot.sourceCount; k++) {
			slot.at[k] = bytes;
			bytes += (slot.ends[k] as number) - (slot.starts[k] as number);
		}
		if (!slot.readback || slot.readback.size < bytes) {
			slot.readback?.destroy();
			slot.readback = this.device.createBuffer({
				label: 'culled draw counts',
				size: Math.ceil(bytes / READBACK_STEP) * READBACK_STEP,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			});
		}
		for (let k = 0; k < slot.sourceCount; k++) {
			const start = slot.starts[k] as number;
			encoder.copyBufferToBuffer(
				slot.sources[k] as GPUBuffer,
				start,
				slot.readback,
				slot.at[k] as number,
				(slot.ends[k] as number) - start,
			);
		}
	}

	/** Maps the frame's readback buffer once the GPU has run its copies. Call it after the submit. */
	afterSubmit(): void {
		const slot = this.current;
		if (!slot?.readback || slot.drawCount === 0) return;
		this.current = undefined;
		slot.pending = true;
		slot.readback.mapAsync(GPUMapMode.READ).then(slot.onMapped, slot.onFailed);
	}

	private read(slot: Slot): void {
		slot.pending = false;
		const readback = slot.readback;
		if (this.destroyed || !readback) return;
		const words = new Uint32Array(readback.getMappedRange());
		const sums = sumDraws(slot, words);
		readback.unmap();
		for (let k = 0; k < slot.sourceCount; k++) slot.sources[k] = undefined;
		// Sums that arrive after the page stopped sampling stay out, so the counts never go stale.
		if (!this.sampling) return;
		this.triangles = sums.triangles;
		this.instances = sums.instances;
	}

	destroy(): void {
		this.destroyed = true;
		for (const slot of this.slots) slot.readback?.destroy();
	}
}

/** The sums that `sumDraws` returns, one object for every call. */
const drawSums = { triangles: 0, instances: 0 };

/**
 * Sums the triangles and instances of a slot's noted draws from their copied arguments: each draw's
 * index count, then its instance count. A draw of lines adds instances and no triangles.
 */
export function sumDraws(
	slot: Pick<Slot, 'draws' | 'drawCount' | 'starts' | 'at'>,
	words: Uint32Array,
): { triangles: number; instances: number } {
	let triangles = 0;
	let instances = 0;
	for (let d = 0; d < slot.drawCount; d++) {
		const v = d * DRAW_VALUES;
		const source = slot.draws[v] as number;
		const offset = slot.draws[v + 1] as number;
		const word = ((slot.at[source] as number) + offset - (slot.starts[source] as number)) / 4;
		const indices = words[word] as number;
		const count = words[word + 1] as number;
		instances += count;
		if (slot.draws[v + 2] === 0) triangles += Math.floor(indices / 3) * count;
	}
	drawSums.triangles = triangles;
	drawSums.instances = instances;
	return drawSums;
}

function growSources(slot: Slot): void {
	const size = slot.starts.length * 2;
	for (const key of ['starts', 'ends', 'at'] as const) {
		const grown = new Uint32Array(size);
		grown.set(slot[key]);
		slot[key] = grown;
	}
}
