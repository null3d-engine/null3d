// What the probe grid's light costs, on each GPU path: the panel of tests/pages/
// probe-grid-cost-sketch.ts, timed with layers of lit planes and with a grid over them in turns. The
// grid adds four filtered reads of one 3D texture to every lit pixel, so the difference between the
// sides is that work. It runs only with NULL3D_PROBE_COST set, in a quiet window on a computer with
// a GPU of its own: NULL3D_PROBE_COST=1 bun run test:browser -- probe-grid-cost.spec.ts.
// NULL3D_PROBE_PRESETS sets the render scales, as a list. Each test waits for a quiet computer and
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

const scales = (process.env.NULL3D_PROBE_PRESETS ?? '1').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const scale of scales)
		test(`probe grid on ${gpu} at scale ${scale}, timed off and on`, async ({ page }) => {
			test.skip(!process.env.NULL3D_PROBE_COST, 'set NULL3D_PROBE_COST to time the probe grid');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(`probe-grid-cost.html?gpu=${gpu}&scale=${scale}`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`PROBEGRIDCOST ${result.tier} at scale ${scale}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
