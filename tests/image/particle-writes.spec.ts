// The particle record writer in a live engine: a block of births must give exactly the records
// that writing them one at a time gives, a batch that starts near the end must wrap around the
// buffer, and a shift must move the birth times that the time base leaves behind.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What the page reports. */
interface Checked {
	tier: string;
	single: number[];
	throughBlock: number[];
	equal: boolean;
	wrapped: number[];
	wrappedSeeds: number[];
	shifted: number;
	error?: string;
}

test('the block writer gives the records that the single write gives', async ({ page }) => {
	await page.goto('particle-writes.html');
	const result = await pageResult<Checked>(page, 120_000);
	expect(result.error).toBeUndefined();
	// The two paths pack the same birth: the record's seven numbers, the lifetime as a 16-bit
	// float, and the seed.
	expect(result.equal).toBe(true);
	expect(result.single.slice(0, 7)).toEqual([1, 2, 3, 4.5, -1, 0.5, 0]);
	expect(result.single[7] as number).toBeCloseTo(1.75, 3);
	expect(result.single[8]).toBe(0x1234);
	// Records 6, 7, 0 and 1 take the batch's four births, in that order.
	expect(result.wrapped).toEqual([10, 11, 12, 13]);
	expect(result.wrappedSeeds).toEqual([0, 1, 2, 3]);
	// The shift took 1000 seconds off the birth time.
	expect(result.shifted).toBeCloseTo(0.5, 5);
});
