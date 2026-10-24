// What the lens kit's look costs, on each GPU path and preset: the wall of the lens cost sketch,
// timed with the look off and on, in turns (tests/pages/effect-cost.ts, ?effect=lens). The look
// draws the core's sharpening, vignette and grading, and the add-on's color fringes, streak, grain
// and speed blur. The 8-bit path draws no custom effect, so there its figure is the core's parts
// alone. It runs only with NULL3D_LENS_COST set, in a quiet window on a computer with a GPU of its
// own: NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts.
// NULL3D_LENS_PRESETS sets the presets, as a list. Each test waits for a quiet computer and prints
// the load beside its figures (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

const presets = (process.env.NULL3D_LENS_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`lens kit on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LENS_COST, 'set NULL3D_LENS_COST to time the lens kit');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`effect-cost.html?effect=lens&gpu=${gpu}&preset=${preset}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`LENSCOST ${result.tier} at ${preset}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
