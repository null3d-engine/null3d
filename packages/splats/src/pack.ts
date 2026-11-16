// The TypeScript reference of the pack: each chunk's chosen prefix, written one after another into
// the batch that the engine sorts. A chunk whose data has not arrived takes no row, and a chunk
// whose chosen count is zero takes none either, so a chunk that arrives after the camera looked
// away never draws where it no longer belongs.
//
// The draw packs through the engine's chunked row writer, whose pack runs in the core's memory
// under hard rule 42 (`crates/null3d-core/src/chunk_rows.rs`). This reference keeps the same rules
// for the unit tests and for a reader who wants the shape of the pack in TypeScript.
//
// A prefix that keeps part of a chunk can leave holes where the splats it drops covered the surface.
// So the pack grows the splats that it keeps by the square root of the share of the chunk's surface
// that the prefix leaves uncovered, which the chunk measured as it was built. A dense cloud whose
// splats overlap keeps its surface covered and barely grows, and a scan's ground of small flat
// splats grows until its holes close, so a coarse level draws the same surface with fewer, larger
// splats rather than a sparse one.
import type { SplatChunk } from './chunks';
import { coverageAt } from './coverage';

/** The most that a prefix's splats grow, so a chunk far away never draws as a few large blobs. */
const MOST_GROWTH = 3;

/** The batch rows that a pack writes, and the calls that tell the engine what changed. */
export interface SplatRows {
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
	colors: Float32Array;
	markDirty(start: number, count: number): void;
	setActiveCount(count: number): void;
}

/** A chunk as the pack sees it: its whole count and the data that has arrived, if any. */
export interface SplatSlot {
	readonly count: number;
	readonly data: SplatChunk | undefined;
}

/** The prefix view of one chunk, which changes only when its chosen count does. */
export interface PrefixView {
	count: number;
	positions: Float32Array;
	rotations: Float32Array;
	scales: Float32Array;
	colors: Float32Array;
}

/**
 * Writes each slot's chosen prefix into the rows in order, and sets the number that draws. Returns
 * that number. A slot without data, or with a chosen count of zero or less, writes nothing.
 */
export function packRows(
	rows: SplatRows,
	slots: readonly SplatSlot[],
	counts: ArrayLike<number>,
	prefixes: (PrefixView | undefined)[],
): number {
	let at = 0;
	for (let i = 0; i < slots.length; i++) {
		const slot = slots[i] as SplatSlot;
		const chunk = slot.data;
		if (!chunk) {
			prefixes[i] = undefined;
			continue;
		}
		const chosen = i < counts.length ? (counts[i] as number) : 0;
		// A chunk that arrived after the worker chose takes its turn in the next selection.
		const count = Math.min(chosen, chunk.count);
		if (!(count > 0)) {
			prefixes[i] = undefined;
			continue;
		}
		let prefix = prefixes[i];
		if (!prefix || prefix.count !== count) {
			const growth = growthOf(chunk, count);
			const scales = chunk.scales.subarray(0, count * 3);
			prefix = {
				count,
				positions: chunk.positions.subarray(0, count * 3),
				rotations: chunk.rotations.subarray(0, count * 4),
				scales: growth === 1 ? scales : scales.map((value) => value * growth),
				colors: chunk.colors.subarray(0, count * 4),
			};
			prefixes[i] = prefix;
		}
		rows.positions.set(prefix.positions, at * 3);
		rows.rotations.set(prefix.rotations, at * 4);
		rows.scales.set(prefix.scales, at * 3);
		rows.colors.set(prefix.colors, at * 4);
		at += count;
	}
	if (at > 0) rows.markDirty(0, at);
	rows.setActiveCount(at);
	return at;
}

/**
 * The factor that a chunk's first `count` splats grow by, so that together they cover what the
 * whole chunk covers: 1 for the whole chunk or a prefix that covers its surface already, and at
 * most the cap for a prefix that leaves most of it bare.
 */
export function growthOf(chunk: SplatChunk, count: number): number {
	if (count >= chunk.count) return 1;
	const share = coverageAt(chunk.coverage, chunk.count, count);
	if (!(share > 0)) return MOST_GROWTH;
	return Math.min(MOST_GROWTH, Math.max(1, Math.sqrt(1 / share)));
}
