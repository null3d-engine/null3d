import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

test('the page is cross-origin isolated and loads the threaded build', async ({ page }) => {
	await page.goto('isolation.html');
	const result = await pageResult<{
		error?: string;
		crossOriginIsolated: boolean;
		threaded: boolean;
	}>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.crossOriginIsolated).toBe(true);
	expect(result.threaded).toBe(true);
});
