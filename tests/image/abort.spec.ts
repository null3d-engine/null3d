// A start that the page cancels rejects with the signal's reason, before or after the core loads,
// and stops the workers it started, with no false report of a job worker that did not start. A
// later start still runs.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

test('a cancelled start rejects, and the next start runs', async ({ page }) => {
	// A cancelled start reports no failure of its job workers: it ends them itself.
	const startFailures: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && message.text().includes('E1405'))
			startFailures.push(message.text());
	});
	await page.goto('abort.html');
	const result = await pageResult<{
		early: string;
		late: string;
		framesAfter: number;
		error?: string;
	}>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.early).toBe('cancelled early');
	expect(result.late).toBe('cancelled after the core');
	expect(result.framesAfter).toBeGreaterThan(0);
	expect(startFailures).toEqual([]);
	// The cancelled starts stopped every worker they started, and the last engine stopped its own,
	// but for the workers that kept the canvases, which stop as the canvases leave the page.
	await expect.poll(() => page.workers().length).toBe(0);
});
