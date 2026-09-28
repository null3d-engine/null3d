// Measures the display's refresh rate from the times of frame callbacks. The browser calls them once
// per refresh, so the short intervals are the refresh period; longer ones come from a busy thread.

/** Callback intervals the meter keeps. */
const SAMPLES = 32;
/** The share of intervals, counted from the shortest, whose longest is the refresh period. */
const SHORT_SHARE = 0.25;
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
		const period = this.sorted[Math.floor(SAMPLES * SHORT_SHARE)] as number;
		return period > 0 ? snapToDisplayRate(1000 / period) : undefined;
	}
}
