import { describe, expect, it } from 'bun:test';
import { KEPT_SECONDS, pageTimesOf } from './page-times.ts';

describe('pageTimesOf', () => {
	it("keeps each slow page's median, and gives every other page their mean", () => {
		const times = pageTimesOf([
			{
				browser: 'Safari',
				pages: [
					{ id: 'slow', seconds: 30 },
					{ id: 'quick', seconds: 1 },
				],
			},
			{
				browser: 'Safari',
				pages: [
					{ id: 'slow', seconds: 50 },
					{ id: 'other', seconds: 2 },
				],
			},
			{ browser: 'Safari', pages: [{ id: 'slow', seconds: 40 }] },
			{
				browser: 'Firefox',
				pages: [
					{ id: 'slow', seconds: 10 },
					{ id: 'quick', seconds: 3 },
				],
			},
		]);
		expect(times).toEqual({
			Firefox: { fallback: 3, pages: { slow: 10 } },
			Safari: { fallback: 1.5, pages: { slow: 40 } },
		});
	});

	it('keeps a page whose median reaches the line, and takes the mean of two middle times', () => {
		const times = pageTimesOf([
			{ browser: 'Safari', pages: [{ id: 'edge', seconds: KEPT_SECONDS - 1 }] },
			{ browser: 'Safari', pages: [{ id: 'edge', seconds: KEPT_SECONDS + 1 }] },
		]);
		expect(times.Safari?.pages).toEqual({ edge: KEPT_SECONDS });
	});
});
