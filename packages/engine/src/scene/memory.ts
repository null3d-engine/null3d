// Typed-array views on engine memory. A shared memory keeps its old buffer when it grows, but
// views made before the growth cannot reach past the old end; the single-threaded build's memory
// detaches every view when it grows, and a write through a detached view is lost. The scene's
// arrays also move within the memory when the scene grows, which the core counts in a word of its
// own. Each view therefore is re-made when the buffer changes or that count does. Every core call
// that can grow the memory or the scene goes through `checkGrowth`, and the sketch runner
// refreshes after the frame's steps, so sketch code never writes through a stale view. When the engine stops, every later call
// through the core and every view made after it fails with E1420: the page keeps its copy of the
// core for the next engine, which sketch code that outlives the engine must never reach.

import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import type { CoreGlue } from '../shared/core';

/** The error of a call that reached an engine after it stopped. */
function stoppedError(): EngineError {
	return new EngineError('E1420', 'a call reached the engine after it stopped.');
}

/** A stand-in for the core whose every function fails with E1420. */
function stoppedGlue(): CoreGlue {
	return new Proxy({} as CoreGlue, {
		get: () => () => {
			throw stoppedError();
		},
	});
}

export type ViewConstructor<T> = new (
	buffer: ArrayBufferLike,
	byteOffset: number,
	length: number,
) => T;

/** A typed array class whose views `CoreMemory.heap` keeps. */
export type HeapConstructor<T> = ViewConstructor<T> & { readonly BYTES_PER_ELEMENT: number };

/** The engine core and its memory, with view helpers. */
export class CoreMemory {
	private viewsOf: ArrayBufferLike;
	/** Increments each time the views must be re-made. */
	generation = 0;
	/** The core's copy of the world matrix it read last, made again when the memory grows. */
	private worldMatrixView: Float64Array | undefined;
	/** The core's count of moves of viewed arrays, made again when the memory grows. */
	private movedView: Uint32Array | undefined;
	/** The count of moves that the current views were made at. */
	private moved = 0;

	private stoppedNow = false;

	/** Views of the whole memory by typed array class, and the buffer they view. */
	private readonly heaps = new Map<unknown, unknown>();
	private heapsOf: ArrayBufferLike | undefined;

	/**
	 * `movedAddress` is the address of the core's count of moves of viewed arrays, or 0 for a core
	 * whose arrays move only when the memory grows.
	 */
	constructor(
		public glue: CoreGlue,
		readonly memory: WebAssembly.Memory,
		private readonly movedAddress = 0,
	) {
		this.viewsOf = memory.buffer;
		this.moved = this.movedCount();
	}

	/** True once the engine has stopped. */
	get stopped(): boolean {
		return this.stoppedNow;
	}

	/**
	 * Cuts this engine's calls off from the core when the engine stops. Views that callers made
	 * are made again at their next use, which fails.
	 */
	stop(): void {
		this.stoppedNow = true;
		this.glue = stoppedGlue();
		this.generation++;
		this.worldMatrixView = undefined;
	}

	/**
	 * True once after the memory's buffer changed or viewed arrays moved; callers then re-make their
	 * views.
	 */
	refresh(): boolean {
		if (this.stoppedNow) return false;
		const buffer = this.memory.buffer;
		if (buffer !== this.viewsOf) {
			this.viewsOf = buffer;
			this.movedView = undefined;
		} else {
			const moved = this.movedCount();
			if (moved === this.moved) return false;
		}
		this.moved = this.movedCount();
		this.generation++;
		return true;
	}

	/** The core's count of moves of viewed arrays, or 0 for a core without one. */
	private movedCount(): number {
		if (this.movedAddress === 0) return 0;
		let view = this.movedView;
		if (view === undefined) {
			view = new Uint32Array(this.memory.buffer, this.movedAddress, 1);
			this.movedView = view;
		}
		return view[0] as number;
	}

	/** A view of `length` values of `type` on engine memory from `address`. */
	view<T>(type: ViewConstructor<T>, address: number, length: number): T {
		if (this.stoppedNow) throw stoppedError();
		return new type(this.memory.buffer, address, length);
	}

	/**
	 * A view of the whole memory as `type`, which `address / type.BYTES_PER_ELEMENT` indexes. Each
	 * class's view stays until the memory's buffer changes, so a call in each frame allocates
	 * nothing.
	 */
	heap<T>(type: HeapConstructor<T>): T {
		if (this.stoppedNow) throw stoppedError();
		const buffer = this.memory.buffer;
		if (buffer !== this.heapsOf) {
			this.heaps.clear();
			this.heapsOf = buffer;
		}
		let view = this.heaps.get(type) as T | undefined;
		if (view === undefined) {
			view = new type(buffer, 0, buffer.byteLength / type.BYTES_PER_ELEMENT);
			this.heaps.set(type, view);
		}
		return view;
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
