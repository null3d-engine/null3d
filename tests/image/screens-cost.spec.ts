// What the LCD look costs, on each GPU path and preset: the panel of tests/pages/
// screens-cost-sketch.ts, timed with its plain textured image and with the LCD material in turns.
// The LCD look adds the sub-pixel bars, the scan band and the row gaps, the dead-texel hash and the
// boot glitch, all driven by the texture coordinates' derivatives. It runs only with
// NULL3D_SCREEN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_SCREEN_COST=1 bun run test:browser -- screens-cost.spec.ts.
// NULL3D_SCREEN_PRESETS sets the presets, as a list. Each test waits for a quiet computer and
// prints the load beside its figures (tests/lib/effect-cost.ts).
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

const presets = (process.env.NULL3D_SCREEN_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`the LCD look on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_SCREEN_COST, 'set NULL3D_SCREEN_COST to time the LCD look');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`screens-cost.html?gpu=${gpu}&preset=${preset}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`SCREENCOST ${result.tier} at ${preset}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('plain', result.off, 3),
					sideLine('lcd', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
