import { describe, expect, it } from 'bun:test';
import {
	acos,
	asin,
	atan,
	atan2,
	cos,
	exp,
	log,
	normalize3,
	pow,
	quatFromFrame,
	quatMultiply,
	quatRotate,
	sin,
	tan,
	type Vector3,
} from './math';

/** Arguments across the range that geometry uses, with the reduction's edges among them. */
const ANGLES = [
	0,
	1e-9,
	0.1,
	0.5,
	Math.PI / 4,
	0.8,
	1,
	Math.PI / 2,
	2,
	3,
	Math.PI,
	4,
	5,
	2 * Math.PI,
	7,
	10,
	25.3,
	100,
	1000.5,
	12345.678,
].flatMap((x) => [x, -x]);

/** Whether `actual` is within a few units in the last place of `expected`, or tiny where it is 0. */
function close(actual: number, expected: number, ulps = 8): boolean {
	const scale = Math.max(Math.abs(expected), 1e-300);
	return Math.abs(actual - expected) <= Math.max(ulps * Number.EPSILON * scale, 1e-15);
}

describe('the deterministic functions', () => {
	it('match the engine sine, cosine and tangent to the last few bits', () => {
		for (const x of ANGLES) {
			expect(close(sin(x), Math.sin(x)), `sin(${x})`).toBe(true);
			expect(close(cos(x), Math.cos(x)), `cos(${x})`).toBe(true);
			if (Math.abs(Math.cos(x)) > 1e-3)
				expect(close(tan(x), Math.tan(x), 64), `tan(${x})`).toBe(true);
		}
	});

	it('match the exponential, the logarithm and the power', () => {
		for (const x of [-700, -50, -1, -1e-8, 0, 1e-8, 0.3465, 0.5, 1, 2, 10, 100, 700])
			expect(close(exp(x), Math.exp(x)), `exp(${x})`).toBe(true);
		for (const x of [1e-300, 1e-8, 0.1, 0.5, 0.70710678, 1, 1.41421357, 2, 10, 1e8, 1e300])
			expect(close(log(x), Math.log(x)), `log(${x})`).toBe(true);
		expect(log(0)).toBe(Number.NEGATIVE_INFINITY);
		expect(Number.isNaN(log(-1))).toBe(true);
		for (const [x, y] of [
			[2, 10],
			[2.5, 1.5],
			[10, -2],
			[0.3, 0.7],
			[-2, 3],
			[-2, 2],
		] as const)
			expect(close(pow(x, y), x ** y, 64), `pow(${x}, ${y})`).toBe(true);
		expect(Number.isNaN(pow(-2, 0.5))).toBe(true);
		expect(pow(0, 2)).toBe(0);
		expect(pow(5, 0)).toBe(1);
	});

	it('match the arctangents and the inverse sine and cosine', () => {
		for (const x of [-1e6, -10, -1, -0.5, -1e-9, 0, 1e-9, 0.3, 0.41421356, 0.5, 1, 2, 10, 1e6])
			expect(close(atan(x), Math.atan(x)), `atan(${x})`).toBe(true);
		for (const [y, x] of [
			[1, 1],
			[1, -1],
			[-1, -1],
			[-1, 1],
			[0, -1],
			[2, 0],
			[-2, 0],
			[3, 0.01],
		] as const)
			expect(close(atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x})`).toBe(true);
		for (const x of [-1, -0.7, 0, 0.3, 0.99, 1]) {
			expect(close(asin(x), Math.asin(x), 16), `asin(${x})`).toBe(true);
			expect(close(acos(x), Math.acos(x), 16), `acos(${x})`).toBe(true);
		}
	});

	it('build a frame whose +Y is the shoot and whose +Z leans toward the sky', () => {
		const up = normalize3([0.3, 0.2, -0.9]);
		const q = [0, 0, 0, 1];
		quatFromFrame(up, [0, 1, 0], q);
		const y = quatRotate(q, 0, [0, 1, 0], [0, 0, 0]);
		const z = quatRotate(q, 0, [0, 0, 1], [0, 0, 0]);
		for (let k = 0; k < 3; k++) expect(y[k]).toBeCloseTo(up[k] as number, 12);
		expect(z[0] * up[0] + z[1] * up[1] + z[2] * up[2]).toBeCloseTo(0, 12);
		expect(z[1]).toBeGreaterThan(0);
		const length = Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number);
		expect(length).toBeCloseTo(1, 12);
	});

	it('turn by a product of quaternions as by one turn after the other', () => {
		const a = [0, 0, 0, 1];
		const b = [0, 0, 0, 1];
		quatFromFrame(normalize3([1, 0.5, 0]), [0, 1, 0], a);
		quatFromFrame(normalize3([0, 0.3, 1]), [0, 1, 0], b);
		const ab = [0, 0, 0, 0];
		quatMultiply(a, 0, b, 0, ab);
		const v: Vector3 = [0.2, -0.4, 0.9];
		const once = quatRotate(ab, 0, v, [0, 0, 0]);
		const twice = quatRotate(a, 0, quatRotate(b, 0, v, [0, 0, 0]), [0, 0, 0]);
		for (let k = 0; k < 3; k++) expect(once[k]).toBeCloseTo(twice[k] as number, 12);
	});
});
