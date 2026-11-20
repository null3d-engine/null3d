// The cloud's maps are built on the CPU from fixed seeds, so their shapes can be checked here: the
// billow and streak fields run from 0 to 1 and repeat with no seam, one seed gives one field, the
// walls' map stores the rim's radius within its byte's range and lets no heap rise before the front
// wall, and the traced cloud and its dome keep the same copy of the cloud's light.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { billowField, FRONT, RIM_RANGE, RIM_TEXELS, streakField, wallData } from './clouds';
import { rimRadius } from './land';

/** A small map, quick to build, with the same domes as the real ones. */
const SIZE = 64;

/** The largest step between neighbouring texels inside a square field, and across its wrap. */
function steps(field: Float32Array, size: number): { inside: number; wrap: number } {
	let inside = 0;
	let wrap = 0;
	const at = (i: number, j: number) => field[j * size + i] as number;
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size - 1; i++) {
			inside = Math.max(
				inside,
				Math.abs(at(i + 1, j) - at(i, j)),
				Math.abs(at(j, i + 1) - at(j, i)),
			);
		}
	for (let k = 0; k < size; k++)
		wrap = Math.max(
			wrap,
			Math.abs(at(0, k) - at(size - 1, k)),
			Math.abs(at(k, 0) - at(k, size - 1)),
		);
	return { inside, wrap };
}

describe.each([
	['billow', billowField],
	['streak', streakField],
] as const)('the %s field', (_name, build) => {
	const field = build(SIZE, 211);

	test('runs from 0 to 1', () => {
		let low = Infinity;
		let high = -Infinity;
		for (const h of field) {
			expect(Number.isFinite(h)).toBe(true);
			low = Math.min(low, h);
			high = Math.max(high, h);
		}
		expect(low).toBeGreaterThanOrEqual(0);
		expect(high).toBeLessThanOrEqual(1);
		expect(high - low).toBeGreaterThan(0.5);
	});

	test('repeats with no seam: the step across the wrap is no larger than one inside', () => {
		const { inside, wrap } = steps(field, SIZE);
		expect(wrap).toBeLessThanOrEqual(inside);
	});

	test('gives one field for one seed, and another for another', () => {
		expect(build(SIZE, 211)).toEqual(field);
		expect(build(SIZE, 307)).not.toEqual(field);
	});
});

describe("the walls' map", () => {
	const data = wallData();
	const bearing = (k: number) => (k / RIM_TEXELS - 0.5) * Math.PI * 2;
	const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

	test("the rim's radius stays within the range its byte stores, at every bearing", () => {
		for (let k = 0; k < 4096; k++) {
			const r = rimRadius((k / 4096) * Math.PI * 2);
			expect(r).toBeGreaterThan(RIM_RANGE.low);
			expect(r).toBeLessThan(RIM_RANGE.low + RIM_RANGE.span);
		}
	});

	test("each texel holds its bearing's rim radius", () => {
		for (let k = 0; k < RIM_TEXELS; k++) {
			const stored = RIM_RANGE.low + ((data[k * 4] as number) / 255) * RIM_RANGE.span;
			expect(Math.abs(stored - rimRadius(bearing(k)))).toBeLessThan(RIM_RANGE.span / 255);
		}
	});

	test('no heap rises before the front wall, and heaps rise elsewhere', () => {
		let heaped = 0;
		for (let k = 0; k < RIM_TEXELS; k++) {
			const heap = data[k * 4 + 1] as number;
			if (turn(bearing(k), FRONT.middle) <= FRONT.half) expect(heap).toBe(0);
			else if (heap > 0) heaped++;
		}
		expect(heaped).toBeGreaterThan(RIM_TEXELS / 2);
	});
});

test("the cloud and the dome hold the same copy of the cloud's light", () => {
	const source = readFileSync(new URL('./clouds.ts', import.meta.url), 'utf8');
	const copies = [...source.matchAll(/\/\/ light \{\n([\s\S]*?)\/\/ \} light/g)].map((m) => m[1]);
	expect(copies).toHaveLength(2);
	expect(copies[0]).toBe(copies[1]);
});
