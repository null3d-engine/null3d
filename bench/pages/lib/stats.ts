// Summary statistics for benchmark samples, the same for every engine's report.

export interface Summary {
	median: number;
	p95: number;
	p99: number;
	mean: number;
}

/**
 * The value at a fraction of the way through sorted samples. It interpolates linearly between the
 * two nearest ranks, so the median of an even count is the mean of the middle two samples.
 */
export function percentile(sorted: Float64Array, fraction: number): number {
	if (sorted.length === 0) throw new RangeError('percentile needs at least one sample');
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	const low = sorted[lower] ?? 0;
	const high = sorted[Math.min(lower + 1, sorted.length - 1)] ?? low;
	return low + (high - low) * (position - lower);
}

/** Summarizes the first `count` samples: the median, the 95th and 99th percentiles, and the mean. */
export function summarize(samples: Float64Array, count = samples.length): Summary {
	if (count <= 0 || count > samples.length) {
		throw new RangeError(`cannot summarize ${count} of ${samples.length} samples`);
	}
	const sorted = samples.slice(0, count).sort();
	let sum = 0;
	for (let i = 0; i < count; i++) sum += sorted[i] ?? 0;
	return {
		median: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		p99: percentile(sorted, 0.99),
		mean: sum / count,
	};
}
