import { describe, expect, it } from 'bun:test';
import { FramePacer } from './pacer';

/** When a display's callbacks start, and how far each one's timestamp strays from its refresh. */
interface Callbacks {
	start?: number;
	jitter?: (callback: number) => number;
}

/** The timestamps of the callbacks that draw, of `count` callbacks from a display at `hz`. */
function drawn(
	pacer: FramePacer,
	hz: number,
	count: number,
	{ start = 0, jitter = () => 0 }: Callbacks = {},
): number[] {
	const times: number[] = [];
	for (let k = 0; k < count; k++) {
		const timestamp = start + (k * 1000) / hz + jitter(k);
		if (pacer.take(timestamp)) times.push(timestamp);
	}
	return times;
}

/** Frames per second from the first drawn frame to the last. */
function rate(times: number[]): number {
	return ((times.length - 1) * 1000) / ((times.at(-1) ?? 0) - (times[0] ?? 0));
}

/** Each gap between drawn frames, in whole refresh periods of a display at `hz`. */
function periods(times: number[], hz: number): number[] {
	return times.slice(1).map((t, i) => Math.round(((t - (times[i] ?? 0)) * hz) / 1000));
}

describe('FramePacer', () => {
	it('draws at every callback without a rate', () => {
		expect(drawn(new FramePacer(undefined), 60, 100)).toHaveLength(100);
	});

	it('draws one callback in two at 60 Hz and one in four at 120 Hz for 30 frames per second', () => {
		const at60 = drawn(new FramePacer(30), 60, 240);
		expect(new Set(periods(at60, 60))).toEqual(new Set([2]));
		const at120 = drawn(new FramePacer(30), 120, 480);
		expect(new Set(periods(at120, 120))).toEqual(new Set([4]));
		expect(rate(at120)).toBeCloseTo(30, 6);
	});

	it('keeps the average rate when the refresh period does not divide the frame interval', () => {
		const sixty = drawn(new FramePacer(60), 144, 1440);
		expect(rate(sixty)).toBeCloseTo(60, 0);
		expect(new Set(periods(sixty, 144))).toEqual(new Set([2, 3]));
		const thirty = drawn(new FramePacer(30), 144, 1440);
		expect(rate(thirty)).toBeCloseTo(30, 0);
		expect(new Set(periods(thirty, 144))).toEqual(new Set([4, 5]));
	});

	it('ignores the jitter of real callback timestamps', () => {
		const jitter = (callback: number) => ((callback * 7919) % 11) / 10 - 0.5;
		const times = drawn(new FramePacer(30), 60, 600, { jitter });
		expect(new Set(periods(times, 60))).toEqual(new Set([2]));
	});

	it('draws at every callback when the rate is above the display rate', () => {
		expect(drawn(new FramePacer(200), 60, 100)).toHaveLength(100);
	});

	it('holds callbacks from a timer to the display rate, one frame per refresh on average', () => {
		const pacer = new FramePacer(undefined);
		pacer.holdToDisplay(1000 / 60);
		const times = drawn(pacer, 1000 / 15, 900);
		expect(rate(times)).toBeCloseTo(60, 0);
		// The gaps are whole callback periods: one, or two where a callback is skipped.
		expect(new Set(periods(times, 1000 / 15))).toEqual(new Set([1, 2]));
	});

	it('keeps the lower of the ?fps= rate and the display rate', () => {
		const fps = new FramePacer(30);
		fps.holdToDisplay(1000 / 60);
		expect(rate(drawn(fps, 60, 240))).toBeCloseTo(30, 6);
		const display = new FramePacer(60);
		display.holdToDisplay(1000 / 30);
		expect(rate(drawn(display, 60, 240))).toBeCloseTo(30, 6);
		display.holdToDisplay(0);
		expect(periods(drawn(display, 60, 240, { start: 10_000 }), 60)).not.toContain(2);
	});

	it('starts a new schedule after a pause instead of drawing a burst to catch up', () => {
		const pacer = new FramePacer(30);
		const before = drawn(pacer, 60, 20);
		const after = drawn(pacer, 60, 20, { start: (before.at(-1) ?? 0) + 5000 });
		expect(after[0]).toBe((before.at(-1) ?? 0) + 5000);
		expect(new Set(periods(after, 60))).toEqual(new Set([2]));
	});
});
