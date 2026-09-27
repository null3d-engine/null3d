// Percentiles of per-frame samples. Every engine's benchmark report uses these functions, so the
// figures of sokko3d and of the engines it is compared with are computed the same way.

export interface Percentiles {
	count: number;
	median: number;
	p95: number;
	p99: number;
	mean: number;
}

/**
 * The value a fraction of the way through sorted samples, or 0 when there are none. It
 * interpolates linearly between the two nearest ranks, so the median of an even count is the mean
 * of the middle two samples.
 */
export function percentile(sorted: ArrayLike<number>, fraction: number): number {
	if (sorted.length === 0) return 0;
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const low = sorted[lower] as number;
	const high = sorted[Math.min(lower + 1, sorted.length - 1)] as number;
	return low + (high - low) * (position - lower);
}

/** The median, 95th and 99th percentiles and mean. Sorts a copy, so call it outside frame code. */
export function percentiles(samples: ArrayLike<number>): Percentiles {
	const sorted = Float64Array.from(samples).sort();
	let sum = 0;
	for (const value of sorted) sum += value;
	return {
		count: sorted.length,
		median: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		mean: sorted.length === 0 ? 0 : sum / sorted.length,
	};
}
