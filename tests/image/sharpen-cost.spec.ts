// What the sharpening costs, on each GPU path and render scale: the effect cost page's sharpen
// scene, timed with the sharpening off and on, in turns (tests/pages/effect-cost.ts). At the whole
// canvas's render scale the on side adds the two-step pass's first step, its target and the RCAS
// itself; below it the upscale sharpens already, so the value adds nothing. It runs only with
// NULL3D_SHARPEN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_SHARPEN_COST=1 bun run test:browser -- sharpen-cost.spec.ts.
// Each test waits for a quiet computer, within a time limit, and prints the load beside its
// figures (tests/lib/effect-cost.ts).
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
	for (const scale of [1, 0.5])
		test(`sharpening on ${gpu} at scale ${scale}, timed on and off`, async ({ page }) => {
			test.skip(!process.env.NULL3D_SHARPEN_COST, 'set NULL3D_SHARPEN_COST to time the sharpening');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`effect-cost.html?effect=sharpen&gpu=${gpu}&scale=${scale}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`SHARPENCOST ${result.tier} at scale ${scale}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
