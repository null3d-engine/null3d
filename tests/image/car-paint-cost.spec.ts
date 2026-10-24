// What the car paint costs, on each GPU path and preset: the panel of tests/pages/
// car-paint-cost-sketch.ts, timed with a plain clear-coated metal and with the paint in turns. The
// paint adds the metal flakes, the panel seams and the carbon weave, whose highlight the engine's
// stretched lobe lights. It runs only with NULL3D_PAINT_COST set, in a quiet window on a computer
// with a GPU of its own: NULL3D_PAINT_COST=1 bun run test:browser -- car-paint-cost.spec.ts.
// NULL3D_PAINT_PRESETS sets the presets, as a list. Each test waits for a quiet computer and prints
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
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

const presets = (process.env.NULL3D_PAINT_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`car paint on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_PAINT_COST, 'set NULL3D_PAINT_COST to time the car paint');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`car-paint-cost.html?gpu=${gpu}&preset=${preset}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`PAINTCOST ${result.tier} at ${preset}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
