// The page's switch bias: every switch distance times two to the minus bias, and exactly as the
// species gives at no bias.
import { describe, expect, it } from 'bun:test';
import { switchScale } from './place';

describe('the switch bias', () => {
	it('scales every switch distance by two to the minus bias, and 0 by exactly 1', () => {
		expect(switchScale()).toBe(1);
		expect(switchScale(0)).toBe(1);
		expect(switchScale(1)).toBeCloseTo(0.5, 12);
		expect(switchScale(-1)).toBeCloseTo(2, 12);
		expect(() => switchScale(Number.NaN)).toThrow(/stops/);
	});
});
