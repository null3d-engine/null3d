// The culling shader refuses a copy past its slice, and the engine warns of it. Here the shader's
// slices are made too small in the browser's copy of its source alone, and a page's normal run must
// warn once, while the real shader never warns.
import { expect, type Page, test } from '@playwright/test';

/** How long the page runs before the test reads its warnings, in milliseconds. */
const RUN_TIME = 6_000;

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
	const since = probeRequests(page, `instances ${forced}`);
	await page.goto('/examples/index.html?demo=instances&gpu=webgpu&direct=off');
	await page.locator('.loader').waitFor({ state: 'detached', timeout: 600_000 });
	console.log(`PROBE instances ${forced} loader gone after ${since()} ms`);
	await page.waitForTimeout(RUN_TIME);
	return warnings;
}

test('a copy that the culling shader drops warns once on a normal page', async ({ page }) => {
	test.setTimeout(1_000_000);
	const warnings = await droppedWarnings(page, true);
	expect(warnings.length).toBe(1);
	expect(warnings[0]).toContain('?direct=on');
});

test('the real culling shader drops no copy', async ({ page }) => {
	test.setTimeout(1_000_000);
	expect(await droppedWarnings(page, false)).toEqual([]);
});

function probeRequests(page: import('@playwright/test').Page, label: string) {
	const t0 = Date.now();
	page.on('requestfinished', async (request) => {
		const timing = request.timing();
		const ms = timing.responseEnd;
		if (ms > 1000) console.log(`PROBE ${label} slow ${Math.round(ms)} ms at ${Date.now() - t0} ms ${request.url().slice(0, 140)}`);
	});
	page.on('console', (message) => {
		if (/frame|ready|loaded|E1\d\d\d/.test(message.text())) console.log(`PROBE ${label} console at ${Date.now() - t0} ms ${message.text().slice(0, 200)}`);
	});
	return () => Date.now() - t0;
}
