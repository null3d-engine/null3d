// Typed-array views on engine memory. A shared memory keeps its old buffer when it grows, but
// views made before the growth cannot reach past the old end; the single-threaded build's memory
// detaches every view when it grows, and a write through a detached view is lost. Each view
// therefore is re-made when the buffer changes. Every core call that can grow the memory goes
// through `checkGrowth`, and the sketch runner refreshes after the frame's steps, so sketch code
// never writes through a view from before a growth.

import { coreFailure } from '../errors/core-failure';
import type { CoreGlue } from '../shared/core';

export type ViewConstructor<T> = new (
	buffer: ArrayBufferLike,
	byteOffset: number,
	length: number,
) => T;

/** The engine core and its memory, with view helpers. */
export class CoreMemory {
	private viewsOf: ArrayBufferLike;
	/** Increments each time the views must be re-made. */
	generation = 0;
	/** The core's copy of the world matrix it read last, made again when the memory grows. */
	private worldMatrixView: Float64Array | undefined;

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

	/** A view of `length` values of `type` on engine memory from `address`. */
	view<T>(type: ViewConstructor<T>, address: number, length: number): T {
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

	i32(address: number, length: number): Int32Array {
		return this.view(Int32Array, address, length);
	}

	/**
	 * Copies an object's world matrix of the frame that last ran into `out`: 12 numbers, row by row,
	 * with the translation from the origin in 64 bits. Returns the core's status, 0 for success. The
	 * core writes the matrix into its own memory, so a read allocates nothing.
	 */
	readWorldMatrix(handle: number, out: Float64Array): number {
		const status = this.glue.worldMatrix(handle);
		if (status !== 0) return status;
		let view = this.worldMatrixView;
		if (view === undefined || view.buffer !== this.memory.buffer) {
			view = this.f64(this.glue.worldMatrixAddress(), out.length);
			this.worldMatrixView = view;
		}
		out.set(view);
		return 0;
	}

	/**
	 * Checks a core call's result: a status (0 for success) or a handle, id or address (0 for
	 * failure). Throws the core's error, naming the call.
	 */
	check(result: number, call: string, what?: string, isStatus = false): number {
		if (isStatus ? result !== 0 : result === 0) throw coreFailure(this.glue, call, what);
		return result;
	}

	/**
	 * Throws the core's error for a call that failed, after taking the memory's new buffer, if
	 * the call grew it.
	 */
	fail(call: string, what?: string): never {
		this.refresh();
		throw coreFailure(this.glue, call, what);
	}

	/**
	 * Checks the result of a core call that can grow the engine's memory, as `check` does. It first
	 * takes the memory's new buffer, if the call grew it, so every view is made again before its
	 * next read or write, whether the call failed or not.
	 */
	checkGrowth(result: number, call: string, what?: string, isStatus = false): number {
		this.refresh();
		return this.check(result, call, what, isStatus);
	}
}
