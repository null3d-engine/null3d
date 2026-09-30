// The frame's draw list as the renderers of both GPU paths read it.

import { controlViews, Slot } from '../shared/control';

/**
 * The frame's draw list, as the sketch thread published it: views on engine memory, rebuilt only
 * when memory grows, and the list's range of words in them.
 */
export class DrawLists {
	words = new Uint32Array(0);
	floats = new Float32Array(0);
	start = 0;
	end = 0;
	private viewsOf: ArrayBufferLike | undefined;
	private readonly slots: Int32Array;

	constructor(
		private readonly memory: WebAssembly.Memory,
		control: ArrayBufferLike,
	) {
		this.slots = controlViews(control).slots;
	}

	/** Finds the list of `frame`, and returns the engine memory its uploads read from. */
	select(frame: number): ArrayBufferLike {
		const buffer = this.memory.buffer;
		if (buffer !== this.viewsOf) {
			this.words = new Uint32Array(buffer);
			this.floats = new Float32Array(buffer);
			this.viewsOf = buffer;
		}
		const parity = frame & 1;
		this.start = Atomics.load(this.slots, Slot.DrawListAddress0 + parity) / 4;
		this.end = this.start + Atomics.load(this.slots, Slot.DrawListWords0 + parity);
		return buffer;
	}
}
