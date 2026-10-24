// What the facades material costs, on each GPU path and preset: the wall of tests/pages/
// facades-cost-sketch.ts, timed with a plain wall and with the facade in turns. The facade adds the
// wall page's two reads, the window grid, the room's ray and its code lookup, and the far fallback.
// It runs only with NULL3D_FACADE_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_FACADE_COST=1 bun run test:browser -- facades-cost.spec.ts. NULL3D_FACADE_PRESETS sets the
// presets, as a list. Each test waits for a quiet computer and prints the load beside its figures
// (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

const presets = (process.env.NULL3D_FACADE_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`facades on ${gpu} at ${preset}, timed off and on`, async ({ page }) => {
			test.skip(
				!process.env.NULL3D_FACADE_COST,
				'set NULL3D_FACADE_COST to time the facades material',
			);
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`facades-cost.html?gpu=${gpu}&preset=${preset}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`FACADECOST ${result.tier} at ${preset}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
