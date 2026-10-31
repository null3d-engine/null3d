// The particle emitter in a live engine: the core's records must match the reference emitter's
// records exactly, over several seeds, every shape, a followed emitter, death and ground
// sub-emitter chains, a burst schedule that wraps the ring, and a prewarmed system.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** What one difference between the two paths is. */
interface Mismatch {
	scenario: string;
	record: number;
	field: number;
	reference: number;
	core: number;
}

/** What the page reports. */
interface Checked {
	tier: string;
	scenarios: number;
	records: number;
	mismatches: Mismatch[];
	error?: string;
}

test('the core writes the records that the TypeScript emitter writes', async ({ page }) => {
	await page.goto('particle-emit.html');
	const result = await pageResult<Checked>(page, 330_000);
	expect(result.error).toBeUndefined();
	expect(result.scenarios).toBeGreaterThanOrEqual(12);
	// Every row of every buffer the page compares: 904 rows over its fourteen scenarios.
	expect(result.records).toBe(904);
	// The first differences name the scenario and the record, so a fault reads at once.
	expect(result.mismatches.slice(0, 20)).toEqual([]);
});
