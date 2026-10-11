// Development builds only: finds writes to a static object's transform that skipped a setter. The
// engine recomputes a static object only in a frame where a setter marked it dirty, so such a write
// reaches the screen late or never. Before each transform update, the check hashes the position,
// rotation, scale and bounding sphere of every static object, and compares each hash with the one
// from the update before. A hash that changed while the object's dirty bit is clear is a write that
// skipped a setter. The check reads the values that sketch code writes, never the world matrices,
// so the grid cell that holds an object does not change its hashes.

import { EngineError } from '../errors/engine-error';
import * as C from '../generated/core';

/** The values the check hashes for each object, in the order that the error message names them. */
const FIELDS = ['position', 'rotation', 'scale', 'bounding sphere'] as const;

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
	readonly centers: Float32Array;
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
	private centers: Int32Array = new Int32Array(0);

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
		this.centers = wordsOf(views.centers);
		const size = views.radii.length * FIELDS.length;
		if (this.seen.length < size) {
			const seen = new Int32Array(size);
			seen.set(this.seen);
			this.seen = seen;
		}
		return views;
	}

	/** The hash of a slot's bounding sphere: its center and radius. */
	private sphere(slot: number): number {
		return hash3(this.centers, slot * 3) ^ Math.imul(this.radii[slot] as number, K3);
	}

	/** Stores the hashes of a slot's fields, and returns the first field that changed, or -1. */
	private record(slot: number): number {
		const { seen, rotations: r } = this;
		const at = slot * FIELDS.length;
		const q = slot * 4;
		const position = hash3(this.positions, slot * 3);
		const rotation = hash3(r, q) ^ Math.imul(r[q + 3] as number, K3);
		const scale = hash3(this.scales, slot * 3);
		const sphere = this.sphere(slot);
		const changed =
			position !== seen[at]
				? 0
				: rotation !== seen[at + 1]
					? 1
					: scale !== seen[at + 2]
						? 2
						: sphere !== seen[at + 3]
							? 3
							: -1;
		if (changed < 0) return -1;
		seen[at] = position;
		seen[at + 1] = rotation;
		seen[at + 2] = scale;
		seen[at + 3] = sphere;
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
	 * Takes a watched object's bounding sphere as it is now, after a call wrote it and queued a
	 * change that marks the object. The engine applies that change when the next frame starts, so
	 * after a call in the late update, the late check comes first. Only the sphere is taken, so
	 * the check still reports another field that changed without a setter.
	 */
	boundsWritten(object: Watched): void {
		if (this.statics[object.slot] !== object) return;
		this.refresh();
		this.seen[object.slot * FIELDS.length + 3] = this.sphere(object.slot);
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

/** What the batch check reads of the engine's memory. */
export interface BatchMemory {
	readonly generation: number;
	readonly glue: { batchArrays(batch: number, field: number): number };
	i32(address: number, length: number): Int32Array;
}

/** A static batch that the check watches. */
export interface WatchedBatch {
	readonly id: number;
	/** The batch's rows: its capacity. */
	readonly count: number;
	/** The rows that draw, from the first. */
	readonly activeRows: number;
	describe(): string;
}

/** A row field of a batch: the field that `batchArrays` takes, and its 32-bit words per row. */
export type RowField = readonly [field: number, words: number];

/** The most rows of one batch that the check hashes in a frame. */
export const ROWS_PER_CHECK = 8192;

/** A watched batch, with word views of its row arrays and its dirty bits, and a hash per row. */
interface BatchWatch {
	readonly batch: WatchedBatch;
	readonly fields: readonly RowField[];
	/** The words of each row field, then the dirty bits', from the memory of `generation`. */
	readonly views: Int32Array[];
	generation: number;
	/** Each row's hash, as the check last read it. */
	readonly seen: Int32Array;
	/** One bit a row: marked dirty since the check last read the row. */
	readonly marked: Int32Array;
	/** The first row that the next check hashes. */
	next: number;
}

/**
 * Development builds only: finds rows of a static instance, sprite or point batch that changed
 * without `markDirty`. A static batch recomputes and uploads only its marked rows, so such a write
 * reaches the screen late or never. Before each batch update, which clears the marks, the check
 * notes every marked row. It then hashes a slice of the drawn rows, and compares each hash with the
 * one it read before. A row whose hash changed while no mark was noted since is a write that
 * skipped `markDirty`. The slices take turns, so a large batch costs a bounded time per frame, and
 * a write to one of its rows is found within a few frames.
 */
export class UnmarkedRows {
	private readonly watched: BatchWatch[] = [];

	/** `rowsPerCheck` is the most rows of one batch that a check hashes. */
	constructor(
		private readonly core: BatchMemory,
		private readonly rowsPerCheck = ROWS_PER_CHECK,
	) {}

	/**
	 * Watches a static batch whose rows have `fields`. Its rows start dirty, so the first checks
	 * take their hashes.
	 */
	watch(batch: WatchedBatch, fields: readonly RowField[]): void {
		this.watched.push({
			batch,
			fields,
			views: [],
			generation: -1,
			seen: new Int32Array(batch.count),
			marked: new Int32Array(Math.ceil(batch.count / 32)),
			next: 0,
		});
	}

	/** Stops watching a batch, once it is destroyed. */
	forget(batch: WatchedBatch): void {
		const at = this.watched.findIndex((watch) => watch.batch === batch);
		if (at >= 0) this.watched.splice(at, 1);
	}

	/** The word views of a watched batch's rows and dirty bits, made again after memory grew. */
	private viewsOf(watch: BatchWatch): Int32Array[] {
		const { core } = this;
		if (watch.generation === core.generation) return watch.views;
		const { id, count } = watch.batch;
		watch.views.length = 0;
		for (const [field, words] of watch.fields)
			watch.views.push(core.i32(core.glue.batchArrays(id, field), count * words));
		watch.views.push(
			core.i32(core.glue.batchArrays(id, C.BATCH_FIELD_DIRTY_WORDS), Math.ceil(count / 64) * 2),
		);
		watch.generation = core.generation;
		return watch.views;
	}

	/**
	 * Notes each static batch's marked rows, hashes its next slice of drawn rows, and returns E1110
	 * when a row in it changed with no mark. Call it right before the batch update.
	 */
	check(): EngineError | undefined {
		let first: WatchedBatch | undefined;
		let firstRow = 0;
		let more = 0;
		for (let b = 0; b < this.watched.length; b++) {
			const watch = this.watched[b] as BatchWatch;
			const views = this.viewsOf(watch);
			const { fields, seen, marked } = watch;
			const dirty = views[fields.length] as Int32Array;
			for (let w = 0; w < marked.length; w++)
				marked[w] = (marked[w] as number) | (dirty[w] as number);
			const rows = watch.batch.activeRows;
			const start = watch.next < rows ? watch.next : 0;
			const end = Math.min(rows, start + this.rowsPerCheck);
			watch.next = end;
			for (let row = start; row < end; row++) {
				let hash = 0;
				for (let f = 0; f < fields.length; f++) {
					const words = (fields[f] as RowField)[1];
					const view = views[f] as Int32Array;
					for (let k = row * words, last = k + words; k < last; k++)
						hash = (Math.imul(hash, 31) + (view[k] as number)) | 0;
				}
				const bit = 1 << (row & 31);
				const word = row >>> 5;
				const wasMarked = ((marked[word] as number) & bit) !== 0;
				marked[word] = (marked[word] as number) & ~bit;
				if (hash === seen[row]) continue;
				seen[row] = hash;
				if (wasMarked) continue;
				if (first === undefined) {
					first = watch.batch;
					firstRow = row;
				} else more++;
			}
		}
		if (first === undefined) return undefined;
		const others =
			more === 0 ? '' : ` ${more} more row${more === 1 ? '' : 's'} changed that way too.`;
		return new EngineError(
			'E1110',
			`row ${firstRow} of ${first.describe()} changed without markDirty.${others}`,
		);
	}
}
