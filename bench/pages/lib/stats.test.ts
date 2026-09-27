import { describe, expect, test } from 'bun:test';
import { percentile, summarize } from './stats';

describe('summarize', () => {
	test('gives the median, percentiles and mean of the samples', () => {
		const samples = Float64Array.from({ length: 101 }, (_, i) => 100 - i);
		expect(summarize(samples)).toEqual({ median: 50, p95: 95, p99: 99, mean: 50 });
	});

	test('interpolates between the nearest ranks', () => {
		const sorted = Float64Array.of(1, 2, 3, 4);
		expect(percentile(sorted, 0.5)).toBe(2.5);
		expect(percentile(sorted, 0.95)).toBeCloseTo(3.85, 12);
		expect(percentile(sorted, 1)).toBe(4);
		expect(percentile(Float64Array.of(7), 0.99)).toBe(7);
	});

	test('reads only the first samples, and leaves them unchanged', () => {
		const samples = Float64Array.of(3, 1, 2, 1000, 1000);
		const summary = summarize(samples, 3);
		expect(summary.median).toBe(2);
		expect(summary.p95).toBeCloseTo(2.9, 12);
		expect(summary.p99).toBeCloseTo(2.98, 12);
		expect(summary.mean).toBe(2);
		expect([...samples]).toEqual([3, 1, 2, 1000, 1000]);
	});

	test('refuses an empty set of samples', () => {
		expect(() => summarize(new Float64Array(4), 0)).toThrow(RangeError);
		expect(() => percentile(new Float64Array(0), 0.5)).toThrow(RangeError);
	});
});
