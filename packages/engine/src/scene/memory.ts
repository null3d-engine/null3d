// Typed-array views on engine memory. A shared memory keeps its old buffer when it grows, but
// views made before the growth cannot reach past the old end; the single-threaded build's memory
// detaches every view when it grows. Each view therefore is re-made when the buffer changes.

import { coreFailure } from '../errors/core-failure';
import type { CoreGlue } from '../shared/core';

type ViewConstructor<T> = new (buffer: ArrayBufferLike, byteOffset: number, length: number) => T;

/** The engine core and its memory, with view helpers. */
export class CoreMemory {
	private viewsOf: ArrayBufferLike;
	/** Increments each time the views must be re-made. */
	generation = 0;

	constructor(
		readonly glue: CoreGlue,
		readonly memory: WebAssembly.Memory,
	) {
		this.viewsOf = memory.buffer;
	}

	/** True once after the memory's buffer changed; callers then re-make their views. */
	refresh(): boolean {
		const buffer = this.memory.buffer;
		if (buffer === this.viewsOf) return false;
		this.viewsOf = buffer;
		this.generation++;
		return true;
	}

	private view<T>(type: ViewConstructor<T>, address: number, length: number): T {
		return new type(this.memory.buffer, address, length);
	}

	f32(address: number, length: number): Float32Array {
		return this.view(Float32Array, address, length);
	}

	f64(address: number, length: number): Float64Array {
		return this.view(Float64Array, address, length);
	}

	u32(address: number, length: number): Uint32Array {
		return this.view(Uint32Array, address, length);
	}

	/**
	 * Checks a core call's result: a status (0 for success) or a handle, id or address (0 for
	 * failure). Throws the core's error, naming the call.
	 */
	check(result: number, call: string, what?: string, isStatus = false): number {
		if (isStatus ? result !== 0 : result === 0) throw coreFailure(this.glue, call, what);
		return result;
	}
}
