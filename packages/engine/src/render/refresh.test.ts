import { describe, expect, it } from 'bun:test';
import { RefreshMeter, snapMeanInterval } from './refresh';

function feed(meter: RefreshMeter, intervals: number[]): number | undefined {
	let time = 0;
	let hz: number | undefined;
	meter.tick(time);
	for (const interval of intervals) {
		time += interval;
		hz = meter.tick(time) ?? hz;
	}
	return hz;
}

describe('RefreshMeter', () => {
	it('finds the refresh rate from steady callbacks', () => {
		expect(feed(new RefreshMeter(), Array(32).fill(1000 / 120))).toBe(120);
		expect(feed(new RefreshMeter(), Array(32).fill(1000 / 60))).toBe(60);
	});

	it('averages out the jitter of real frame callbacks', () => {
		const period = 1000 / 144;
		const intervals = Array.from({ length: 32 }, (_, i) => period + (i % 2 === 0 ? -0.6 : 0.6));
		expect(feed(new RefreshMeter(), intervals)).toBe(144);
	});

	it('ignores the long intervals of a busy thread', () => {
		const intervals = Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? 2000 / 144 : 1000 / 144));
		expect(feed(new RefreshMeter(), intervals)).toBe(144);
	});

	it('reports nothing until it has enough samples', () => {
		expect(feed(new RefreshMeter(), Array(10).fill(16.7))).toBeUndefined();
	});

	it('reports a common display rate when the measurement is within a few percent of one', () => {
		const snapped = (hz: number) => snapMeanInterval(Math.round(1_000_000 / hz), 1);
		expect(snapped(146.3)).toBe(144);
		expect(snapped(59.94)).toBe(60);
		expect(snapped(110)).toBe(110);
		// The mean of several intervals counts the same as one interval of that length.
		expect(snapMeanInterval(4 * 16_683, 4)).toBe(60);
	});

	it('keeps a long pause from swamping the samples', () => {
		const intervals = Array.from({ length: 32 }, (_, i) => (i === 5 ? 3_600_000 : 1000 / 120));
		expect(feed(new RefreshMeter(), intervals)).toBe(120);
	});
});
