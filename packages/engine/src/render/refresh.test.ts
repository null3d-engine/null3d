import { describe, expect, it } from 'bun:test';
import { RefreshMeter, snapToDisplayRate } from './refresh';

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

	it('ignores the long intervals of a busy thread', () => {
		const intervals = Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? 2000 / 144 : 1000 / 144));
		expect(feed(new RefreshMeter(), intervals)).toBe(144);
	});

	it('reports nothing until it has enough samples', () => {
		expect(feed(new RefreshMeter(), Array(10).fill(16.7))).toBeUndefined();
	});

	it('reports a common display rate when the measurement is within a few percent of one', () => {
		expect(snapToDisplayRate(146.3)).toBe(144);
		expect(snapToDisplayRate(59.94)).toBe(60);
		expect(snapToDisplayRate(110)).toBe(110);
	});
});
