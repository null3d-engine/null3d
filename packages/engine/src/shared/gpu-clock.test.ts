import { describe, expect, it } from 'bun:test';
import { commonStep, gcd, MIN_STEP_MS, stepMs } from './gpu-clock';

describe('gcd', () => {
	it('divides both numbers, and treats them as positive', () => {
		expect(gcd(12, 18)).toBe(6);
		expect(gcd(-12, 18)).toBe(6);
		expect(gcd(7, 0)).toBe(7);
		expect(gcd(0, 0)).toBe(0);
	});
});

describe('commonStep', () => {
	it('divides the offsets without assuming a device constant', () => {
		// A browser that rounds to 100 us.
		expect(commonStep([100_000, 200_000, 500_000])).toBe(100_000);
		// Steps that share a factor give the divisor, not the smallest value.
		expect(commonStep([200_000, 300_000])).toBe(100_000);
		// Exact timestamps share only 1 ns.
		expect(commonStep([12_345, 67_891])).toBe(1);
		expect(commonStep([0, 0])).toBe(0);
		expect(commonStep([])).toBe(0);
	});

	it('reads only the count that the frame wrote, and skips unwritten timestamps', () => {
		expect(commonStep([100_000, 200_000, Number.NaN, -300_000], 4)).toBe(100_000);
		expect(commonStep([100_000, 200_000], 1)).toBe(100_000);
		expect(commonStep([Number.NaN, Number.POSITIVE_INFINITY])).toBe(0);
	});
});

describe('stepMs', () => {
	it('reports a step that rounding explains, and null when the times look exact', () => {
		expect(stepMs(65_536)).toBeCloseTo(0.065536, 9);
		expect(stepMs(MIN_STEP_MS * 1e6)).toBeCloseTo(MIN_STEP_MS, 12);
		expect(stepMs(1)).toBeNull();
		expect(stepMs(0)).toBeNull();
	});
});
