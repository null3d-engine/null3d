import { expect, test } from 'bun:test';
import { toHalfFloat, toHalfFloats } from './half-float';

test('rounds floats to the nearest half float, with ties to even, up to the largest one', () => {
	const cases: [number, number][] = [
		[0, 0x0000],
		[-0, 0x8000],
		[1, 0x3c00],
		[-2, 0xc000],
		[0.5, 0x3800],
		[65504, 0x7bff],
		// 65,520 lies halfway to the next power of 2, and would round to infinity.
		[65520, 0x7bff],
		[1e6, 0x7bff],
		[-1e6, 0xfbff],
		[Number.POSITIVE_INFINITY, 0x7bff],
		[Number.NEGATIVE_INFINITY, 0xfbff],
		[2 ** -14, 0x0400],
		[2 ** -24, 0x0001],
		[2 ** -26, 0x0000],
		// 1 + 2^-11 lies halfway between 1 and the next half float, and rounds to even: 1.
		[1 + 2 ** -11, 0x3c00],
		[1 + 3 * 2 ** -11, 0x3c02],
		[0.1, 0x2e66],
	];
	for (const [value, half] of cases) expect([value, toHalfFloat(value)]).toEqual([value, half]);
	expect(toHalfFloat(Number.NaN) & 0x7c00).toBe(0x7c00);
	expect(toHalfFloat(Number.NaN) & 0x3ff).not.toBe(0);
	const out = new Uint16Array(2);
	toHalfFloats(new Float32Array([1, -2]), out);
	expect([...out]).toEqual([0x3c00, 0xc000]);
});
