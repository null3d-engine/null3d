// The rows that a selection fills: each chunk's chosen prefix, written one after another into the
// batch that the engine sorts. A chunk whose data has not arrived takes no row, and a chunk whose
// chosen count is zero takes none either, so a chunk that arrives after the camera looked away
// never draws where it no longer belongs.
import type { SplatChunk } from './chunks';

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
			prefix = {
				count,
				positions: chunk.positions.subarray(0, count * 3),
				rotations: chunk.rotations.subarray(0, count * 4),
				scales: chunk.scales.subarray(0, count * 3),
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
