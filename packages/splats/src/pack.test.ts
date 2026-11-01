// The rows that a selection fills: each chunk's chosen prefix, in order, with nothing for a chunk
// that has not arrived or that the view no longer wants. The test watches a chunk arrive after the
// camera moved away, which must take no row.
import { describe, expect, it } from 'bun:test';
import type { SplatChunk } from './chunks';
import { type PrefixView, packRows, type SplatRows } from './pack';

/** A chunk whose positions name it, so the test can tell the rows apart. */
function chunk(name: number, count: number): SplatChunk {
	const positions = new Float32Array(count * 3);
	for (let i = 0; i < count; i++) positions[i * 3] = name;
	return {
		center: [0, 0, 0],
		radius: 1,
		count,
		positions,
		rotations: new Float32Array(count * 4),
		scales: new Float32Array(count * 3),
		colors: new Float32Array(count * 4),
	};
}

/** The rows of a pack, and the counts that it set. */
function rows(capacity: number): SplatRows & { dirty: number[]; active: number[] } {
	const record = {
		positions: new Float32Array(capacity * 3),
		rotations: new Float32Array(capacity * 4),
		scales: new Float32Array(capacity * 3),
		colors: new Float32Array(capacity * 4),
		dirty: [] as number[],
		active: [] as number[],
		markDirty(start: number, count: number): void {
			record.dirty.push(start, count);
		},
		setActiveCount(count: number): void {
			record.active.push(count);
		},
	};
	return record;
}

describe('packRows', () => {
	it('writes each loaded chunk prefix in order, and stops at the chosen count', () => {
		const a = chunk(1, 4);
		const c = chunk(3, 4);
		const target = rows(8);
		const prefixes: (PrefixView | undefined)[] = [];
		const at = packRows(
			target,
			[
				{ count: 4, data: a },
				{ count: 4, data: undefined },
				{ count: 4, data: c },
			],
			[2, 3, 1],
			prefixes,
		);
		expect(at).toBe(3);
		expect([...target.positions.subarray(0, 9)]).toEqual([1, 0, 0, 1, 0, 0, 3, 0, 0]);
		expect(target.active).toEqual([3]);
		expect(target.dirty).toEqual([0, 3]);
	});

	it('draws no row of a chunk that arrived after the view moved away', () => {
		const near = chunk(1, 4);
		const far = chunk(2, 4);
		const target = rows(8);
		const prefixes: (PrefixView | undefined)[] = [];
		// The selection keeps the near chunk and finds no use for the far one.
		expect(
			packRows(
				target,
				[
					{ count: 4, data: near },
					{ count: 4, data: undefined },
				],
				[4, 0],
				prefixes,
			),
		).toBe(4);
		// The far chunk arrives late, and its chosen count is still zero.
		expect(
			packRows(
				target,
				[
					{ count: 4, data: near },
					{ count: 4, data: far },
				],
				[4, 0],
				prefixes,
			),
		).toBe(4);
		expect([...target.positions.subarray(0, 12)]).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
		expect(target.active).toEqual([4, 4]);
	});

	it('draws a chunk that arrives while the selection still wants it', () => {
		const late = chunk(2, 4);
		const target = rows(8);
		const prefixes: (PrefixView | undefined)[] = [];
		expect(packRows(target, [{ count: 4, data: undefined }], [3], prefixes)).toBe(0);
		expect(packRows(target, [{ count: 4, data: late }], [3], prefixes)).toBe(3);
		expect([...target.positions.subarray(0, 9)]).toEqual([2, 0, 0, 2, 0, 0, 2, 0, 0]);
	});

	it('takes no row from a count list that is shorter than the slots', () => {
		const a = chunk(1, 2);
		const late = chunk(2, 2);
		const target = rows(4);
		const prefixes: (PrefixView | undefined)[] = [];
		expect(
			packRows(
				target,
				[
					{ count: 2, data: a },
					{ count: 2, data: late },
				],
				[2],
				prefixes,
			),
		).toBe(2);
		expect(target.active).toEqual([2]);
	});
});
