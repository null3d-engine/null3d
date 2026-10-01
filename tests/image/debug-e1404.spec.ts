// Temporary: repeats the pages that failed with an engine thread error on CI.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

const PAGES = [
	'scene.html?gpu=webgl2',
	'scene.html?gpu=webgl2&lose-gpu',
	'scene.html?gpu=webgpu&lose-gpu',
	'warm-up.html?gpu=webgl2&compile=wait',
];

for (let round = 0; round < 12; round++)
	for (const mode of ENGINE_MODES)
		for (const url of PAGES)
			test(`debug ${round} ${url} ${mode.name}`, async ({ page }) => {
				await page.goto(`${url}&${mode.query}`);
				const result = await pageResult<{ error?: string; failures: string[] }>(page, 30_000);
				expect(result.error).toBeUndefined();
				expect(result.failures).toEqual([]);
			});

// Keeps this debug branch out of the merge queue.
test('debug branch never merges', () => expect(true).toBe(false));
