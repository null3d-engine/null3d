import { expect, test } from 'bun:test';
import { toHalfFloat } from './half-float';
import {
	FEWEST_PROBES,
	fibonacciDirections,
	gridBytes,
	gridTexels,
	l1Irradiance,
	PROBE_FLOATS,
	packProbes,
	sampleGrid,
} from './light-probes';

test('fibonacci directions are unit length and spread evenly', () => {
	const count = 64;
	const directions = new Float32Array(count * 3);
	fibonacciDirections(count, directions);
	let sx = 0;
	let sy = 0;
	let sz = 0;
	for (let i = 0; i < count; i++) {
		const x = directions[i * 3] as number;
		const y = directions[i * 3 + 1] as number;
		const z = directions[i * 3 + 2] as number;
		expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
		sx += x;
		sy += y;
		sz += z;
	}
	// Evenly spread directions cancel out: every axis's mean is near zero.
	for (const axis of [sx, sy, sz]) expect(Math.abs(axis / count)).toBeLessThan(0.05);
});

test('the L0 coefficient lights every normal the same', () => {
	const coefficients = new Float32Array(PROBE_FLOATS);
	coefficients[0] = 1;
	coefficients[1] = 2;
	coefficients[2] = 4;
	const out = new Float32Array(3);
	l1Irradiance(coefficients, 0, 0, 1, 0, out);
	expect(out[0]).toBeCloseTo(0.886227, 5);
	expect(out[1]).toBeCloseTo(2 * 0.886227, 5);
	expect(out[2]).toBeCloseTo(4 * 0.886227, 5);
	// A normal that faces the other way gives the same light.
	l1Irradiance(coefficients, 0, 0, -1, 0, out);
	expect(out[0]).toBeCloseTo(0.886227, 5);
});

test('the L1 coefficient along x lights the +x normal and darkens the -x one', () => {
	const coefficients = new Float32Array(PROBE_FLOATS);
	coefficients[3] = 1;
	const out = new Float32Array(3);
	l1Irradiance(coefficients, 0, 1, 0, 0, out);
	expect(out[0]).toBeCloseTo(1.023328, 5);
	l1Irradiance(coefficients, 0, -1, 0, 0, out);
	expect(out[0]).toBeCloseTo(-1.023328, 5);
	// A normal across x reads nothing of that coefficient.
	l1Irradiance(coefficients, 0, 0, 0, 1, out);
	expect(out[0]).toBeCloseTo(0, 5);
});

test('packing puts each coefficient in its sub-volume and leaves the padding zero', () => {
	const counts = [2, 2, 2] as [number, number, number];
	const coefficients = new Float32Array(counts[0] * counts[1] * counts[2] * PROBE_FLOATS);
	// Probe (1, 0, 0) holds its twelve values, one per coefficient.
	for (let c = 0; c < PROBE_FLOATS; c++) coefficients[PROBE_FLOATS + c] = c + 1;
	const [w, h, d] = gridTexels(counts);
	expect([w, h, d]).toEqual([2, 2, 12]);
	const texels = new Uint16Array(w * h * d * 4);
	packProbes(counts, coefficients, texels, toHalfFloat);
	const at = (x: number, y: number, z: number, c: number) =>
		texels[((z * h + y) * w + x) * 4 + c] as number;
	// Probe (1, 0, 0) sits one slice in, so its first texel is at x 1, y 0, z 1.
	for (let s = 0; s < 3; s++)
		for (let c = 0; c < 4; c++) expect(at(1, 0, s * 4 + 1, c)).toBe(toHalfFloat(s * 4 + c + 1));
	// Every padding slice is zero, at both ends of each sub-volume.
	for (let s = 0; s < 3; s++)
		for (let c = 0; c < 4; c++) {
			expect(at(1, 0, s * 4, c)).toBe(0);
			expect(at(1, 0, s * 4 + 3, c)).toBe(0);
		}
});

test('a uniform grid gives every surface the same light as one probe does', () => {
	const counts = [3, 3, 3] as [number, number, number];
	const coefficients = new Float32Array(27 * PROBE_FLOATS);
	for (let p = 0; p < 27; p++) {
		coefficients[p * PROBE_FLOATS] = 1;
		coefficients[p * PROBE_FLOATS + 3] = 0.5;
	}
	const origin = new Float32Array([0, 0, 0]);
	const spacing = new Float32Array([1, 1, 1]);
	const one = new Float32Array(3);
	l1Irradiance(coefficients, 0, 1, 0, 0, one);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	for (const [px, py, pz] of [
		[0, 0, 0],
		[1.4, 2.2, 0.6],
		[-5, 9, 9],
	])
		for (const normal of [
			[1, 0, 0],
			[0, 1, 0],
			[0.3, -0.7, 0.6],
		]) {
			l1Irradiance(
				coefficients,
				0,
				normal[0] as number,
				normal[1] as number,
				normal[2] as number,
				one,
			);
			sampleGrid(
				coefficients,
				counts,
				origin,
				spacing,
				px as number,
				py as number,
				pz as number,
				normal[0] as number,
				normal[1] as number,
				normal[2] as number,
				work,
				out,
			);
			expect(out[0]).toBeCloseTo(one[0] as number, 4);
			expect(out[1]).toBeCloseTo(one[1] as number, 4);
		}
});

test('the grid interpolates the light between two probes', () => {
	const counts = [FEWEST_PROBES, 1, 1] as [number, number, number];
	const coefficients = new Float32Array(2 * PROBE_FLOATS);
	coefficients[0] = 0; // the first probe is dark
	coefficients[PROBE_FLOATS] = 1; // the second is bright
	const origin = new Float32Array([0, 0, 0]);
	const spacing = new Float32Array([1, 1, 1]);
	const out = new Float32Array(3);
	const work = new Float32Array(12);
	const at = (x: number) => {
		// The sample point moves half a spacing along +x, so the answer lags the position by 0.5.
		sampleGrid(coefficients, counts, origin, spacing, x, 0, 0, 1, 0, 0, work, out);
		return out[0] as number;
	};
	expect(at(-1)).toBeCloseTo(0, 5);
	expect(at(0)).toBeCloseTo(0.886227 / 2, 4); // sample point 0.5: halfway between the probes
	expect(at(0.6)).toBeCloseTo(0.886227, 4); // sample point 1.1, past the bright probe, clamps
});

test('the byte count is 24 per probe plus the padding slices', () => {
	expect(gridBytes([2, 2, 2])).toBe(2 * 2 * 12 * 8);
	expect(gridBytes([16, 4, 16])).toBe(16 * 4 * (3 * 18) * 8);
});
