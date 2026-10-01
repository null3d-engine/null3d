// Temporary: repeats the pages that failed with an engine thread error on CI.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

const PAGES = [
	'scene.html?gpu=webgl2',
	'warm-up.html?gpu=webgl2',
	'warm-up.html?gpu=webgl2&compile=wait',
];

for (let round = 0; round < 40; round++)
	for (const url of PAGES)
		test(`debug ${round} ${url}`, async ({ page }) => {
			await page.goto(`${url}&sketch-thread=main`);
			const result = await pageResult<{ error?: string; failures: string[] }>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
		});

// Keeps this debug branch out of the merge queue.
test('debug branch never merges', () => expect(true).toBe(false));
