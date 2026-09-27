// Percentiles of per-frame samples.

export interface Percentiles {
	count: number;
	median: number;
	p95: number;
	p99: number;
	mean: number;
}

/** Nearest-rank percentiles. Sorts a copy, so call it outside frame code. */
export function percentiles(samples: ArrayLike<number>): Percentiles {
	const values = Float64Array.from(samples).sort();
	const count = values.length;
	const at = (q: number) => values[Math.min(count - 1, Math.floor(q * count))] ?? 0;
	let sum = 0;
	for (const value of values) sum += value;
	return {
		count,
		median: at(0.5),
		p95: at(0.95),
		p99: at(0.99),
		mean: count === 0 ? 0 : sum / count,
	};
}
