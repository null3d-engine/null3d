// What the terrain add-on's block morph costs, on each GPU path: the valley of the terrain-morph-cost
// page, timed with the morph off and on in turns. It prints each side's medians of GPU time, frame
// interval and CPU time, with each thread's. It runs only with NULL3D_TERRAIN_MORPH_COST set, in a
// quiet window on a computer with a GPU of its own:
//   NULL3D_TERRAIN_MORPH_COST=1 bun run test:browser -- terrain-morph-cost.spec.ts
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	test(`the terrain block morph, timed on and off on ${gpu}`, async ({ page }) => {
		test.skip(!process.env.NULL3D_TERRAIN_MORPH_COST, 'set NULL3D_TERRAIN_MORPH_COST to time it');
		test.setTimeout(costTimeout(600_000));
		const loadBefore = await waitForQuiet();
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`terrain-morph-cost.html?gpu=${gpu}`);
		const result = await pageResult<CostResult>(page, 200_000);
		expect(result.error).toBeUndefined();
		console.log(
			[
				`${result.tier}, load ${loadBefore} before and ${loadNow()} after`,
				sideLine('morph off', result.off, 2, true),
				sideLine('morph on', result.on, 2, true),
			].join('\n'),
		);
		expect(result.failures).toEqual([]);
	});
