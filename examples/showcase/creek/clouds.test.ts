// The cloud's maps are built on the CPU from fixed seeds, so their shapes can be checked here: the
// billow and streak fields run from 0 to 1 and repeat with no seam, one seed gives one field, the
// walls' map stores the rim's radius within its byte's range and lets no heap rise before the front
// wall, and the traced cloud and its dome keep the same copy of the cloud's light.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fallPlace, fallTime } from '../../../packages/water/src/fall';
import {
	billowField,
	FRONT,
	fallFoot,
	fallOut,
	RIM_RANGE,
	RIM_TEXELS,
	streakField,
	wallData,
} from './clouds';
import { CLOUD_TOP, LIPS, rimRadius, streamCurrent, streamSlope, streamZ, WATER } from './land';

/** A small map, quick to build, with the same domes as the real ones. */
const SIZE = 64;

/** The mean step between neighbouring texels inside a square field, and across its wrap. */
function steps(field: Float32Array, size: number): { inside: number; wrap: number } {
	let inside = 0;
	let wrap = 0;
	const at = (i: number, j: number) => field[j * size + i] as number;
	for (let j = 0; j < size; j++)
		for (let i = 0; i < size - 1; i++)
			inside += Math.abs(at(i + 1, j) - at(i, j)) + Math.abs(at(j, i + 1) - at(j, i));
	for (let k = 0; k < size; k++)
		wrap += Math.abs(at(0, k) - at(size - 1, k)) + Math.abs(at(k, 0) - at(k, size - 1));
	return { inside: inside / (2 * size * (size - 1)), wrap: wrap / (2 * size) };
}

/** A field that stops short of the tile's edge: its last eighth of rows and columns cut to 0. */
const clipped = (field: Float32Array, size: number) =>
	field.map((h, k) => (k % size >= (size * 7) / 8 || k / size >= (size * 7) / 8 ? 0 : h));

/** Whether a field repeats with no seam: its mean step across the wrap is near the one inside. */
const seamless = (field: Float32Array, size: number) => {
	const { inside, wrap } = steps(field, size);
	return wrap <= inside * 1.5;
};

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

	test('repeats with no seam: the mean step across the wrap is near the one inside', () => {
		expect(seamless(field, SIZE)).toBe(true);
		// A field that stops at the tile's edge fails the same check.
		expect(seamless(clipped(field, SIZE), SIZE)).toBe(false);
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

	test('no heap rises before the front wall, which the map marks, and heaps rise elsewhere', () => {
		let heaped = 0;
		for (let k = 0; k < RIM_TEXELS; k++) {
			const heap = data[k * 4 + 1] as number;
			const marker = data[k * 4 + 3] as number;
			const off = turn(bearing(k), FRONT.middle);
			if (off <= FRONT.half) {
				expect(heap).toBe(0);
				expect(marker).toBe(255);
			} else if (heap > 0) {
				heaped++;
			}
			// Bearings well past the front wall's edge are no part of it.
			if (off >= FRONT.half + FRONT.edge) expect(marker).toBe(0);
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

describe("the falls' feet in the cloud", () => {
	/** How far out the water add-on's own fall path is once the water has fallen `drop` meters. */
	const drawnOut = (speed: number, drop: number) => {
		const place: [number, number] = [0, 0];
		fallPlace(fallTime(drop), speed, place);
		return place;
	};

	test("the distance out follows the water add-on's fall path within a few centimeters", () => {
		for (const speed of [0.3, 0.8, 1.2, 2])
			for (const drop of [2, 10.5, 17, 40]) {
				const [out, fallen] = drawnOut(speed, drop);
				expect(Math.abs(fallen - drop)).toBeLessThan(0.01);
				expect(Math.abs(fallOut(speed, drop) - out)).toBeLessThan(0.03);
			}
	});

	test("each foot lies where the add-on's column meets the cloud's top, along the fall's way", () => {
		for (const lip of [LIPS.west, LIPS.east]) {
			const away = Math.sign(lip);
			const [dx, dz] = [away, away * streamSlope(lip)];
			const length = Math.hypot(dx, dz);
			const [out] = drawnOut(Math.hypot(...streamCurrent(lip - away * 0.3)), WATER - CLOUD_TOP);
			const [x, z] = fallFoot(lip);
			expect(Math.abs(x - (lip + (dx / length) * out))).toBeLessThan(0.03);
			expect(Math.abs(z - (streamZ(lip) + (dz / length) * out))).toBeLessThan(0.03);
		}
	});
});
