// Development builds only: finds writes to a static object's transform that skipped a setter. The
// engine recomputes a static object only in a frame where a setter marked it dirty, so such a write
// reaches the screen late or never. Before each transform update, the check hashes the position,
// rotation, scale and bounding radius of every static object, and compares each hash with the one
// from the update before. A hash that changed while the object's dirty bit is clear is a write that
// skipped a setter. The check reads the values that sketch code writes, never the world matrices,
// so the grid cell that holds an object does not change its hashes.

import { EngineError } from '../errors/engine-error';

/** The values the check hashes for each object, in the order that the error message names them. */
const FIELDS = ['position', 'rotation', 'scale', 'bounding radius'] as const;

// Odd multipliers. Multiplying by an odd number maps 32-bit words one to one, so a hash that XORs
// each word times its own multiplier changes whenever any single word changes. The products do
// not wait on each other, which keeps the hashes fast.
const K0 = 0x9e3779b1 | 0;
const K1 = 0x85ebca77 | 0;
const K2 = 0xc2b2ae3d | 0;
const K3 = 0x27d4eb2f | 0;

/** The scene arrays that the check reads: the transform inputs and the dirty bits. */
export interface TransformInputs {
	readonly positions: Float32Array;
	readonly rotations: Float32Array;
	readonly scales: Float32Array;
	readonly radii: Float32Array;
	readonly dirty: Uint32Array;
}

/** An object that the check watches. */
export interface Watched {
	readonly slot: number;
	describe(): string;
}

/** A view of the same memory as 32-bit words, so the hashes see every bit of each value. */
const wordsOf = (f: Float32Array) => new Int32Array(f.buffer, f.byteOffset, f.length);

/** Hashes three words from `at`. */
function hash3(w: Int32Array, at: number): number {
	return (
		Math.imul(w[at] as number, K0) ^
		Math.imul(w[at + 1] as number, K1) ^
		Math.imul(w[at + 2] as number, K2)
	);
}

/** Finds static objects whose transform changed without a setter. Development builds only. */
export class UnmarkedWrites {
	/** The watched static objects by slot. A dynamic or destroyed object leaves its slot empty. */
	private readonly statics: (Watched | undefined)[] = [];
	/** Each slot's hash of each field, as the last transform update read them. */
	private seen = new Int32Array(0);
	/** The scene arrays the word views below were made from. */
	private viewsOf: TransformInputs | undefined;
	private positions: Int32Array = new Int32Array(0);
	private rotations: Int32Array = new Int32Array(0);
	private scales: Int32Array = new Int32Array(0);
	private radii: Int32Array = new Int32Array(0);

	constructor(private readonly scene: { readonly views: TransformInputs }) {}

	/** The current scene arrays, with word views and room for every slot. */
	private refresh(): TransformInputs {
		const views = this.scene.views;
		if (views === this.viewsOf) return views;
		this.viewsOf = views;
		this.positions = wordsOf(views.positions);
		this.rotations = wordsOf(views.rotations);
		this.scales = wordsOf(views.scales);
		this.radii = wordsOf(views.radii);
		const size = views.radii.length * FIELDS.length;
		if (this.seen.length < size) {
			const seen = new Int32Array(size);
			seen.set(this.seen);
			this.seen = seen;
		}
		return views;
	}

	/** Stores the hashes of a slot's fields, and returns the first field that changed, or -1. */
	private record(slot: number): number {
		const { seen, rotations: r } = this;
		const at = slot * FIELDS.length;
		const q = slot * 4;
		const position = hash3(this.positions, slot * 3);
		const rotation = hash3(r, q) ^ Math.imul(r[q + 3] as number, K3);
		const scale = hash3(this.scales, slot * 3);
		const radius = this.radii[slot] as number;
		const changed =
			position !== seen[at]
				? 0
				: rotation !== seen[at + 1]
					? 1
					: scale !== seen[at + 2]
						? 2
						: radius !== seen[at + 3]
							? 3
							: -1;
		if (changed < 0) return -1;
		seen[at] = position;
		seen[at + 1] = rotation;
		seen[at + 2] = scale;
		seen[at + 3] = radius;
		return changed;
	}

	/**
	 * Watches a static object from its current values, or stops watching an object that became
	 * dynamic or was destroyed. Recording the values here means that an object whose creation
	 * fails in the engine core never shows as a write. An object it already watches keeps the
	 * values of the last update, so a write before the call is still reported.
	 */
	watch(object: Watched, isStatic: boolean): void {
		if (!isStatic) {
			this.statics[object.slot] = undefined;
			return;
		}
		if (this.statics[object.slot] === object) return;
		this.refresh();
		this.statics[object.slot] = object;
		this.record(object.slot);
	}

	/**
	 * Hashes every static object's values, and returns E1110 when any changed with its dirty bit
	 * clear. Call it right before each transform update: the update clears the dirty bits, and the
	 * hashes stored here are the values it reads.
	 */
	check(): EngineError | undefined {
		const { dirty } = this.refresh();
		const { statics } = this;
		let first: Watched | undefined;
		let field = 0;
		let more = 0;
		for (let slot = 1; slot < statics.length; slot++) {
			const object = statics[slot];
			if (object === undefined) continue;
			const changed = this.record(slot);
			if (changed < 0 || ((dirty[slot >>> 5] as number) & (1 << (slot & 31))) !== 0) continue;
			if (first === undefined) {
				first = object;
				field = changed;
			} else more++;
		}
		if (first === undefined) return undefined;
		const others =
			more === 0 ? '' : ` ${more} more static object${more === 1 ? '' : 's'} changed that way too.`;
		return new EngineError(
			'E1110',
			`the ${FIELDS[field]} of ${first.describe()} changed without a setter.${others}`,
		);
	}
}
