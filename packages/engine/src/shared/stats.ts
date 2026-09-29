// Percentiles and rates of per-frame samples. Every engine's benchmark report uses these functions,
// so the figures of null3d and of the engines it is compared with are computed the same way.

/**
 * A summary of per-frame samples.
 *
 * @category api/debug
 */
export interface Percentiles {
	/** The number of samples. */
	count: number;
	/** The middle value. */
	median: number;
	/** The 95th percentile: 95% of samples are at or below it. */
	p95: number;
	/** The 99th percentile: 99% of samples are at or below it. */
	p99: number;
	/** The average. */
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

/**
 * Events per second from the intervals between them: the count over the time they took, so a few
 * long intervals lower the rate as much as they cost. Null without intervals.
 */
export function ratePerSecond(intervalsMs: ArrayLike<number>): number | null {
	if (intervalsMs.length === 0) return null;
	let sum = 0;
	for (let i = 0; i < intervalsMs.length; i++) sum += intervalsMs[i] as number;
	return sum > 0 ? (1000 * intervalsMs.length) / sum : null;
}
