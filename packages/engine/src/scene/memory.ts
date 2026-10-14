// The engine core and its memory, on the sketch's thread. Views of the memory come from the one
// place that makes them (`shared/memory-views.ts`), which also has every object that keeps views
// drop them when the memory grows. The scene's arrays also move within the memory when the scene
// grows, which the core counts in a word of its own. Each view therefore is made again when the
// memory grows or that count changes, which steps the generation. Every core call that can grow
// the memory or the scene goes through `checkGrowth`, and the sketch runner refreshes after the
// frame's steps, so sketch code never writes through a stale view. When the engine stops, every
// later call through the core and every view made after it fails with E1420: the page keeps its
// copy of the core for the next engine, which sketch code that outlives the engine must never
// reach.

import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import { CALL_VALUE_COUNT } from '../generated/core';
import type { CoreGlue } from '../shared/core';
import {
	type HeapConstructor,
	MemoryViews,
	type ViewConstructor,
	type ViewHolder,
} from '../shared/memory-views';

export type { HeapConstructor, ViewConstructor, ViewHolder };

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

/** The engine core and its memory, with view helpers. */
export class CoreMemory extends MemoryViews implements ViewHolder {
	/** The core's copy of the world matrix it read last, made again when the memory grows. */
	private worldMatrixView: Float64Array | undefined;
	/** The core's block of numbers for the next setter call, made again when the memory grows. */
	private callValuesView: Float64Array | undefined;
	/** The core's count of moves of viewed arrays, made again when the memory grows. */
	private movedView: Uint32Array | undefined;
	/** The count of moves that the current views were made at. */
	private moved = 0;

	private stoppedNow = false;

	/**
	 * `movedAddress` is the address of the core's count of moves of viewed arrays, or 0 for a core
	 * whose arrays move only when the memory grows.
	 */
	constructor(
		public glue: CoreGlue,
		memory: WebAssembly.Memory,
		private readonly movedAddress = 0,
	) {
		super(memory);
		this.holdViews(this);
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
		this.dropViews();
		this.glue = stoppedGlue();
		this.generation++;
	}

	/**
	 * Forgets the views of the core's own words and those of the glue, which their next
	 * use makes again.
	 */
	dropViews(): void {
		this.worldMatrixView = undefined;
		this.callValuesView = undefined;
		this.movedView = undefined;
		this.glue.dropMemoryViews?.();
	}

	/**
	 * True once after the memory grew or viewed arrays moved; the generation steps then, and
	 * callers make their views again.
	 */
	refresh(): boolean {
		if (this.stoppedNow) return false;
		if (!this.grown()) {
			const moved = this.movedCount();
			if (moved === this.moved) return false;
			this.generation++;
		}
		this.moved = this.movedCount();
		return true;
	}

	/** The core's count of moves of viewed arrays, or 0 for a core without one. */
	private movedCount(): number {
		if (this.movedAddress === 0) return 0;
		this.movedView ??= super.view(Uint32Array, this.movedAddress, 1);
		return this.movedView[0] as number;
	}

	override view<T>(type: ViewConstructor<T>, address: number, length: number): T {
		if (this.stoppedNow) throw stoppedError();
		return super.view(type, address, length);
	}

	override heap<T>(type: HeapConstructor<T>): T {
		if (this.stoppedNow) throw stoppedError();
		return super.heap(type);
	}

	/**
	 * Copies an object's world matrix of the frame that last ran into `out`: 12 numbers, row by row,
	 * with the translation from the origin in 64 bits. Returns the core's status, 0 for success. The
	 * core writes the matrix into its own memory, so a read allocates nothing.
	 */
	readWorldMatrix(handle: number, out: Float64Array): number {
		const status = this.glue.worldMatrix(handle);
		if (status !== 0) return status;
		this.grown();
		this.worldMatrixView ??= this.f64(this.glue.worldMatrixAddress(), out.length);
		out.set(this.worldMatrixView);
		return 0;
	}

	/**
	 * The numbers of the next setter call into the core, which a setter writes from the first on
	 * before it calls the core with whole numbers alone. Wherever the browser does not inline a
	 * call into the core, each fraction that the call takes as an argument becomes an object of its
	 * own, so a setter that a sketch may call in every frame passes its numbers here.
	 */
	callValues(): Float64Array {
		this.grown();
		this.callValuesView ??= this.f64(this.glue.callValues(), CALL_VALUE_COUNT);
		return this.callValuesView;
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
