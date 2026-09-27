import { expect, test } from '@playwright/test';
import { compareToReference } from '../lib/images';
import { pageResult } from '../lib/page-result.ts';

interface ClearResult {
	ok: boolean;
	error?: string;
	adapter: string;
	width: number;
	height: number;
	pixels: string;
}

/** Runs in the page: the result the test page published, once it exists. */
/** Real-GPU runs (every run outside CI) refuse a software GPU, which would hide real GPU bugs. */
const realGpu = !process.env.CI;

for (const tier of ['webgpu', 'webgl2'] as const) {
	test(`a clear color reads back unchanged on ${tier}`, async ({ page }) => {
		await page.goto(`clear.html?gpu=${tier}`);
		const result = await pageResult<ClearResult>(page, 30_000);
		expect(result.error).toBeUndefined();
		if (realGpu) expect(result.adapter.toLowerCase()).not.toContain('swiftshader');
		compareToReference(
			'clear',
			tier,
			Buffer.from(result.pixels, 'base64'),
			result.width,
			result.height,
		);
	});
}

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
