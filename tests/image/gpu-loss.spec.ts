// When the browser takes the GPU away, the engine stops drawing and tells the page with E1302.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

for (const query of ['threads=off', 'render=main']) {
	test(`a lost WebGL2 context reaches onFailure, ${query}`, async ({ page }) => {
		await page.goto(`gpu-loss.html?gpu=webgl2&${query}`);
		const result = await pageResult<{ tier: string; code: string | null; error?: string }>(
			page,
			30_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe('webgl2');
		expect(result.code).toBe('E1302');
	});
}
