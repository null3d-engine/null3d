import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { type StatsResult, statsProblems } from '../lib/stats-checks.ts';

/** The overlay's element, which the page adds to its body. */
const OVERLAY = '[data-null3d-stats]';

const MODES = [
	...ENGINE_MODES.map((mode) => ({ ...mode, query: `gpu=webgpu&${mode.query}` })),
	{ ...ENGINE_MODES[0], name: 'pipelined, WebGL2', query: 'gpu=webgl2' },
	{
		...ENGINE_MODES[0],
		name: 'pipelined, WebGL2, from the ?stats switch',
		query: 'gpu=webgl2&stats',
	},
];

/** Runs in the page: asks the sketch to show or hide the overlay. */
const show = (on: boolean) =>
	(globalThis as { showStats?: (show: boolean) => void }).showStats?.(on);
/** Runs in the page: asks the page to show or hide the overlay. */
const showFromPage = (on: boolean) =>
	(globalThis as { showPageStats?: (show: boolean) => void }).showPageStats?.(on);

for (const mode of MODES)
	test(`the stats overlay and the sketch's frame figures, ${mode.name}`, async ({ page }) => {
		await page.goto(`stats.html?${mode.query}`);
		const result = await pageResult<StatsResult & { error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(statsProblems(result)).toEqual([]);
		// Chrome's GPU paths time frames wherever they offer the timer.
		if (result.gpuTimer) expect(result.figures.gpuMs).not.toBeNull();

		// Hidden and shown again by the sketch and by the page, then gone with the engine.
		const overlay = page.locator(OVERLAY);
		await page.evaluate(show, false);
		await expect(overlay).toHaveCount(0);
		await page.evaluate(show, true);
		await expect(overlay).toHaveCount(1);
		await page.evaluate(showFromPage, false);
		await expect(overlay).toHaveCount(0);
		await page.evaluate(showFromPage, true);
		await expect(overlay).toHaveCount(1);
		await page.evaluate(() => (globalThis as { stopEngine?: () => Promise<void> }).stopEngine?.());
		await expect(overlay).toHaveCount(0);
	});
