// The rows that a selection fills: each chunk's chosen prefix, in order, with nothing for a chunk
// that has not arrived or that the view no longer wants. The test watches a chunk arrive after the
// camera moved away, which must take no row.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkFrom, type SplatChunk } from './chunks';
import { growthOf, type PrefixView, packRows, type SplatRows } from './pack';

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
		coverage: new Float32Array([1]),
	};
}

/**
 * A chunk of flat opaque discs on a square sheet `side` discs wide, `gap` apart, each `size` across,
 * cut as the add-on cuts a cloud: a scan's ground, whose small splats each cover their own patch.
 */
function sheet(side: number, gap: number, size: number): SplatChunk {
	const count = side * side;
	const positions = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const scales = new Float32Array(count * 3);
	const colors = new Float32Array(count * 4);
	for (let i = 0; i < count; i++) {
		positions.set([(i % side) * gap, 0, Math.floor(i / side) * gap], i * 3);
		// A quarter turn about x lays each disc's thin axis along y, so the discs lie flat.
		rotations.set([Math.SQRT1_2, 0, 0, Math.SQRT1_2], i * 4);
		scales.set([size, size, size * 1e-3], i * 3);
		colors.set([1, 1, 1, 1], i * 4);
	}
	const middle = ((side - 1) * gap) / 2;
	return chunkFrom(
		{ count, positions, rotations, scales, colors },
		[middle, 0, middle],
		middle * 1.5,
	);
}

/** A chunk of round opaque splats crowded into a ball, which overlap many times over. */
function crowd(count: number): SplatChunk {
	const positions = new Float32Array(count * 3);
	const rotations = new Float32Array(count * 4);
	const scales = new Float32Array(count * 3);
	const colors = new Float32Array(count * 4);
	let seed = 1;
	const random = (): number => {
		seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
		return seed / 2 ** 32 - 0.5;
	};
	for (let i = 0; i < count; i++) {
		positions.set([random(), random(), random()], i * 3);
		rotations.set([0, 0, 0, 1], i * 4);
		scales.set([0.2, 0.2, 0.2], i * 3);
		colors.set([1, 1, 1, 1], i * 4);
	}
	return chunkFrom({ count, positions, rotations, scales, colors }, [0, 0, 0], 1);
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

	it('grows a sparse prefix of a sheet by the square root of the share it drops', () => {
		// Discs a spread apart each cover their own patch, so a quarter of them leaves three
		// quarters of the sheet bare, and they grow to about twice their spreads.
		const ground = sheet(40, 1, 0.5);
		expect(growthOf(ground, ground.count)).toBe(1);
		const quarter = growthOf(ground, Math.ceil(ground.count / 4));
		expect(quarter).toBeGreaterThan(1.6);
		expect(quarter).toBeLessThanOrEqual(2.2);
		expect(growthOf(ground, 1)).toBe(3);
	});

	it('barely grows a prefix of a crowd whose splats overlap many times over', () => {
		const ball = crowd(4000);
		expect(growthOf(ball, Math.ceil(ball.count / 4))).toBeLessThan(1.15);
	});

	it("writes the grown spreads into the rows and keeps the chunk's own", () => {
		const ground = sheet(20, 1, 0.5);
		const kept = Math.ceil(ground.count / 4);
		const growth = growthOf(ground, kept);
		const target = rows(kept);
		expect(packRows(target, [{ count: ground.count, data: ground }], [kept], [])).toBe(kept);
		expect(target.scales[0]).toBeCloseTo((ground.scales[0] as number) * growth, 5);
		expect(ground.scales[0]).toBeCloseTo(0.5, 6);
	});
});

// The growth rule, held to one fixture that the core's port reads too
// (`crates/null3d-core/src/chunk_rows.rs`), so a change to either pack that moves a figure fails
// on that side.
describe('the growth a prefix takes, from the fixture both packs read', () => {
	const text = readFileSync(
		fileURLToPath(new URL('./pack-growth.fixture', import.meta.url)),
		'utf8',
	);
	let count = 0;
	let coverage = new Float32Array(0);
	const expected: [number, number][] = [];
	for (const line of text.split('\n')) {
		const parts = line.trim().split(/\s+/);
		if (parts[0] === 'count') count = Number(parts[1]);
		else if (parts[0] === 'coverage') coverage = new Float32Array(parts.slice(1).map(Number));
		else if (parts[0] === 'expect') expected.push([Number(parts[1]), Number(parts[2])]);
	}
	const chunk = {
		center: [0, 0, 0] as const,
		radius: 1,
		count,
		positions: new Float32Array(count * 3),
		rotations: new Float32Array(count * 4),
		scales: new Float32Array(count * 3),
		colors: new Float32Array(count * 4),
		coverage,
	};

	for (const [prefix, growth] of expected)
		it(`grows a prefix of ${prefix} by ${growth}`, () => {
			expect(growthOf(chunk, prefix)).toBeCloseTo(growth, 6);
		});
});
