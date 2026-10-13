// Typed-array views of a WebAssembly memory, made in one place on every thread. When a shared
// memory grows, its `buffer` returns a new `SharedArrayBuffer` object, and each view made before
// keeps the old object alive. All those objects reach the same memory, but Chrome's page memory
// figure counts each one at its full length. So one view kept from before a growth adds a copy of
// the memory, at its size then, to the figure of the thread that keeps it. Every view of the
// engine's memory therefore comes from here. A memory's views replace their own whole-memory views
// when it grows, and have each object that keeps views drop them. A static check in `bun run check`
// fails on code elsewhere that reads a memory's buffer, or that keeps views without dropping them,
// and a browser test counts the buffer objects that each thread holds.

/** An object that keeps views of a memory between calls, which it makes again at their next use. */
export interface ViewHolder {
	/** Forgets the views, so the buffer that they view can go once the memory has grown. */
	dropViews(): void;
}

export type ViewConstructor<T> = new (
	buffer: ArrayBufferLike,
	byteOffset: number,
	length: number,
) => T;

/** A typed array class whose whole-memory views `MemoryViews.heap` keeps. */
export type HeapConstructor<T> = ViewConstructor<T> & { readonly BYTES_PER_ELEMENT: number };

/** The size of `memory` in bytes, or undefined without a memory. */
export function memoryBytes(memory: WebAssembly.Memory | undefined): number | undefined {
	return memory?.buffer.byteLength;
}

/** The views of one WebAssembly memory, and the objects that keep views of it. */
export class MemoryViews {
	/** Increments each time the views must be made again. */
	generation = 0;
	/**
	 * The memory's size when the kept views were made. A memory only grows, so its size tells a
	 * new buffer apart without keeping the old one.
	 */
	private viewsAt: number;
	/** A view of the whole memory by typed array class. */
	private readonly heaps = new Map<unknown, unknown>();
	/** The objects that keep views, which drop them when the memory grows. */
	private readonly holders = new Set<WeakRef<ViewHolder>>();

	constructor(readonly memory: WebAssembly.Memory) {
		this.viewsAt = this.bytes;
	}

	/** The memory's size in bytes. */
	get bytes(): number {
		return memoryBytes(this.memory) as number;
	}

	/** A view of `length` values of `type` from `address`, for use within one call. */
	view<T>(type: ViewConstructor<T>, address: number, length: number): T {
		return new type(this.memory.buffer, address, length);
	}

	/**
	 * A view of the whole memory as `type`, which `address / type.BYTES_PER_ELEMENT` indexes. Each
	 * class's view stays until the memory grows, so a call in each frame allocates nothing.
	 */
	heap<T>(type: HeapConstructor<T>): T {
		this.grown();
		let view = this.heaps.get(type) as T | undefined;
		if (view === undefined) {
			const buffer = this.memory.buffer;
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

	/** Has `holder` drop its views each time the memory grows, for as long as it lives. */
	holdViews(holder: ViewHolder): void {
		this.holders.add(new WeakRef(holder));
	}

	/**
	 * True once after the memory grew. The generation steps then, and the memory's own views and
	 * those of every holder that is still alive go, each to be made again at its next use.
	 */
	grown(): boolean {
		const bytes = this.bytes;
		if (bytes === this.viewsAt) return false;
		this.viewsAt = bytes;
		this.generation++;
		this.heaps.clear();
		for (const ref of this.holders) {
			const holder = ref.deref();
			if (holder) holder.dropViews();
			else this.holders.delete(ref);
		}
		return true;
	}
}
