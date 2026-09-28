// Measures the display's refresh rate from the times of frame callbacks. The browser calls them once
// per refresh, so most intervals are the refresh period, jittering around it; the rare longer ones
// come from a busy thread. The meter averages the intervals near the median.

/** Callback intervals the meter keeps. */
const SAMPLES = 32;
/** Intervals within this share of the median count toward the period; the rest are outliers. */
const NEAR_MEDIAN = 0.2;
/** Refresh rates that displays run at; a measurement this close to one reports that rate. */
const DISPLAY_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
const SNAP_SHARE = 0.03;

/** The display rate within a few percent of a measured rate, or the measured rate rounded. */
export function snapToDisplayRate(hz: number): number {
	for (const rate of DISPLAY_RATES) if (Math.abs(hz - rate) <= rate * SNAP_SHARE) return rate;
	return Math.round(hz);
}

export class RefreshMeter {
	private readonly intervals = new Float64Array(SAMPLES);
	private readonly sorted = new Float64Array(SAMPLES);
	private count = 0;
	private last = -1;

	/** Adds a frame callback's timestamp; returns the refresh rate each time the samples fill up. */
	tick(timestamp: number): number | undefined {
		if (this.last >= 0 && timestamp > this.last)
			this.intervals[this.count++ % SAMPLES] = timestamp - this.last;
		this.last = timestamp;
		if (this.count === 0 || this.count % SAMPLES !== 0) return undefined;
		this.sorted.set(this.intervals);
		this.sorted.sort();
		const median = this.sorted[SAMPLES >> 1] as number;
		let sum = 0;
		let near = 0;
		for (const interval of this.sorted) {
			if (Math.abs(interval - median) > median * NEAR_MEDIAN) continue;
			sum += interval;
			near++;
		}
		return near > 0 && sum > 0 ? snapToDisplayRate((1000 * near) / sum) : undefined;
	}
}
