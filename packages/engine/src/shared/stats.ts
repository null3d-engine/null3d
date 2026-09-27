// Frame statistics in fixed buffers, so recording a frame allocates nothing.

const DEFAULT_CAPACITY = 4096;

export interface Percentiles {
	count: number;
	median: number;
	p95: number;
	p99: number;
	mean: number;
}

/** A ring of the most recent samples, in milliseconds. */
export class SampleRing {
	private readonly samples: Float64Array;
	private written = 0;

	constructor(capacity = DEFAULT_CAPACITY) {
		this.samples = new Float64Array(capacity);
	}

	add(value: number): void {
		this.samples[this.written % this.samples.length] = value;
		this.written++;
	}

	clear(): void {
		this.written = 0;
	}

	get count(): number {
		return Math.min(this.written, this.samples.length);
	}

	/** Percentiles of the stored samples. Allocates, so call it outside the frame loop. */
	summary(): Percentiles {
		const values = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
		const at = (q: number) =>
			values[Math.min(values.length - 1, Math.floor(q * values.length))] ?? 0;
		const mean = values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
		return { count: values.length, median: at(0.5), p95: at(0.95), p99: at(0.99), mean };
	}
}

/** Intervals between successive frame timestamps. */
export class FrameIntervals {
	readonly intervals = new SampleRing();
	private last = -1;

	frame(timestamp: number): void {
		if (this.last >= 0) this.intervals.add(timestamp - this.last);
		this.last = timestamp;
	}

	reset(): void {
		this.intervals.clear();
		this.last = -1;
	}
}
