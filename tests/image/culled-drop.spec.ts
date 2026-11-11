// The culling shader refuses a copy past its slice, and the engine warns of it. Here the shader's
// slices are made too small in the browser's copy of its source alone, and a page's normal run must
// warn once, while the real shader never warns.
import { expect, type Page, test } from '@playwright/test';
import { defaultEnvironment } from '../../packages/cli/src/browser.js';

/** How long the page runs before the test reads its warnings, in milliseconds. */
const RUN_TIME = 6_000;
/**
 * How long the instances page may take to start. CI's software GPU did not start the full window
 * within 120 s, and this Mac's did not within ten minutes. The page draws a smaller window there,
 * so the wait allows more than twice the full window's failure, and the test's own limit clears it.
 */
const START_MS = 300_000;
/** True on the software GPU, where the page draws the smaller window. */
const SOFTWARE_GPU = defaultEnvironment() === 'chromium-swiftshader';

/** Runs the page on the GPU culling path and returns its warnings of dropped copies. */
async function droppedWarnings(page: Page, forced: boolean) {
	// The instances page makes 100,000 columns and tens of thousands of cars. At the full window
	// the software GPU did not start it within ten minutes, while the demo's own image test draws
	// the same scene at 320 x 180 in seconds. The warning counts the copies in the culling batch,
	// not the pixels, so a software GPU draws a smaller window; a real GPU keeps the full one.
	if (SOFTWARE_GPU) await page.setViewportSize({ width: 480, height: 320 });
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
