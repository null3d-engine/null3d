// Measures the display's refresh rate from the times of frame callbacks. The browser calls them once
// per refresh, so most intervals are the refresh period, jittering around it; the rare longer ones
// come from a busy thread. The meter averages the intervals near the median. It keeps intervals in
// whole microseconds, so the work it does once per sample set, too rarely for the browser to
// optimize, makes no number objects. Safari runs a worker's frame callbacks from a timer instead,
// whose rate matches no display's, and the meter says when that is so. A meter can also take chosen
// intervals alone, such as those that follow a callback that drew nothing.

/** Callback intervals a meter keeps unless it is given another count. */
const SAMPLES = 32;
/** Intervals within a fifth of the median count toward the period; the rest are outliers. */
const NEAR_MEDIAN_DIVISOR = 5;
/** The longest interval the meter keeps, in microseconds: longer ones are pauses, not refreshes. */
const LONGEST_INTERVAL = 1_000_000;
/** Refresh rates that displays run at; a measurement this close to one reports that rate. */
const DISPLAY_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240, 360];
const SNAP_SHARE = 0.03;
const MICROSECONDS_PER_SECOND = 1_000_000;
/** For each display rate, the shortest and the longest mean interval, in microseconds, that snap to it. */
const SNAP_SHORTEST = Int32Array.from(DISPLAY_RATES, (rate) =>
	Math.ceil(MICROSECONDS_PER_SECOND / (rate * (1 + SNAP_SHARE))),
);
const SNAP_LONGEST = Int32Array.from(DISPLAY_RATES, (rate) =>
	Math.floor(MICROSECONDS_PER_SECOND / (rate * (1 - SNAP_SHARE))),
);

/**
 * The display rate within a few percent of the rate that `count` intervals of `sum` microseconds in
 * all measure, or 0 when no display runs near that rate. The comparisons use whole numbers only.
 */
function displayRateNear(sum: number, count: number): number {
	// Index loops, as in `tick`: an iterator would allocate on every call.
	for (let k = 0; k < DISPLAY_RATES.length; k++) {
		const shortest = (SNAP_SHORTEST[k] as number) * count;
		const longest = (SNAP_LONGEST[k] as number) * count;
		if (sum >= shortest && sum <= longest) return DISPLAY_RATES[k] as number;
	}
	return 0;
}

/**
 * The display rate within a few percent of the rate that `count` intervals of `sum` microseconds in
 * all measure, or that rate rounded.
 */
export function snapMeanInterval(sum: number, count: number): number {
	return displayRateNear(sum, count) || Math.round((MICROSECONDS_PER_SECOND * count) / sum);
}

export class RefreshMeter {
	/** Intervals between callbacks, in whole microseconds. */
	private readonly intervals: Int32Array;
	private readonly sorted: Int32Array;
	private count = 0;
	/**
	 * The last callback's timestamp, or -1 before the first. It lives in a typed array: some
	 * browsers make a new object for each fraction stored in a property.
	 */
	private readonly last = Float64Array.of(-1);
	private matched = true;

	/** `samples` is how many intervals each measurement takes. */
	constructor(private readonly samples = SAMPLES) {
		this.intervals = new Int32Array(samples);
		this.sorted = new Int32Array(samples);
	}

	/**
	 * False when the last measurement matched no display's rate, as the callbacks of a timer do;
	 * true before the first measurement.
	 */
	get onDisplayRate(): boolean {
		return this.matched;
	}

	/**
	 * Adds a frame callback's timestamp; returns the refresh rate each time the samples fill up. It
	 * runs every frame, so it stores the interval itself: a fraction passed to a call that the
	 * browser does not inline becomes a number object.
	 */
	tick(timestamp: number): number | undefined {
		const last = this.last[0] as number;
		this.last[0] = timestamp;
		if (last < 0 || timestamp <= last) return undefined;
		this.intervals[this.count++ % this.samples] = Math.min(
			Math.round((timestamp - last) * 1000),
			LONGEST_INTERVAL,
		);
		return this.measure();
	}

	/**
	 * Adds an interval between two callbacks, in ms; returns the refresh rate each time the
	 * samples fill up.
	 */
	add(ms: number): number | undefined {
		this.intervals[this.count++ % this.samples] = Math.min(Math.round(ms * 1000), LONGEST_INTERVAL);
		return this.measure();
	}

	/** The refresh rate of the samples once they fill up, or undefined until then. */
	private measure(): number | undefined {
		const { samples } = this;
		if (this.count % samples !== 0) return undefined;
		this.sorted.set(this.intervals);
		this.sorted.sort();
		const median = this.sorted[samples >> 1] as number;
		let sum = 0;
		let near = 0;
		for (let k = 0; k < samples; k++) {
			const interval = this.sorted[k] as number;
			if (Math.abs(interval - median) * NEAR_MEDIAN_DIVISOR > median) continue;
			sum += interval;
			near++;
		}
		if (near === 0 || sum === 0) return undefined;
		const display = displayRateNear(sum, near);
		this.matched = display !== 0;
		return display || Math.round((MICROSECONDS_PER_SECOND * near) / sum);
	}
}
