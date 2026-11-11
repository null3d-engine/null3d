// The culling shader refuses a copy past its slice, and the engine warns of it. Here the shader's
// slices are made too small in the browser's copy of its source alone, and a page's normal run must
// warn once, while the real shader never warns.
import { expect, type Page, test } from '@playwright/test';

/** How long the page runs before the test reads its warnings, in milliseconds. */
const RUN_TIME = 6_000;
/**
 * How long the instances page may take to start. It makes 100,000 columns and tens of thousands of
 * cars, and CI's software GPU needs more than two minutes to start it. This Mac's software GPU took
 * more than five minutes under other helpers' load, so the wait takes ten minutes, the ceiling that
 * the large demos use. The test's own limit clears the wait.
 */
const START_MS = 600_000;

/** Runs the page on the GPU culling path and returns its warnings of dropped copies. */
async function droppedWarnings(page: Page, forced: boolean) {
	if (forced)
		await page.route(/generated\/shaders[^/]*wgsl[^/]*\.js/, async (route) => {
			const response = await route.fetch();
			const text = await response.text();
			await route.fulfill({
				response,
				body: text.replace(/(>= )(bucket\w*\.capacity)/g, '$1min($2, 3u)'),
			});
		});
	const warnings: string[] = [];
	page.on('console', (message) => {
		if (message.text().includes('the culling shader dropped')) warnings.push(message.text());
	});
	await page.goto('/examples/index.html?demo=instances&gpu=webgpu&direct=off');
	await page.locator('.loader').waitFor({ state: 'detached', timeout: START_MS });
	await page.waitForTimeout(RUN_TIME);
	return warnings;
}

test('a copy that the culling shader drops warns once on a normal page', async ({ page }) => {
	test.setTimeout(START_MS + RUN_TIME + 60_000);
	const warnings = await droppedWarnings(page, true);
	expect(warnings.length).toBe(1);
	expect(warnings[0]).toContain('?direct=on');
});

test('the real culling shader drops no copy', async ({ page }) => {
	test.setTimeout(START_MS + RUN_TIME + 60_000);
	expect(await droppedWarnings(page, false)).toEqual([]);
});
