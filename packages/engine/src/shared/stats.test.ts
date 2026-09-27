import { describe, expect, it } from 'bun:test';
import { percentile, percentiles } from './stats';

describe('percentiles', () => {
	it('gives the count, median, percentiles and mean of the samples, in any order', () => {
		const samples = Float64Array.from({ length: 101 }, (_, i) => 100 - i);
		expect(percentiles(samples)).toEqual({ count: 101, median: 50, p95: 95, p99: 99, mean: 50 });
	});

	it('interpolates between the nearest ranks', () => {
		const sorted = Float64Array.of(1, 2, 3, 4);
		expect(percentile(sorted, 0.5)).toBe(2.5);
		expect(percentile(sorted, 0.95)).toBeCloseTo(3.85, 12);
		expect(percentile(sorted, 1)).toBe(4);
		expect(percentile(Float64Array.of(7), 0.99)).toBe(7);
	});

	it('leaves the samples unchanged', () => {
		const samples = Float64Array.of(3, 1, 2);
		const summary = percentiles(samples);
		expect(summary.median).toBe(2);
		expect(summary.p95).toBeCloseTo(2.9, 12);
		expect(summary.p99).toBeCloseTo(2.98, 12);
		expect([...samples]).toEqual([3, 1, 2]);
	});

	it('reports zeros for no samples', () => {
		expect(percentiles([])).toEqual({ count: 0, median: 0, p95: 0, p99: 0, mean: 0 });
	});
});
