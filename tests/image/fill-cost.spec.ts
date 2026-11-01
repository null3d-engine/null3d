// What one more directional light costs on each GPU path: the effect cost page's floor of shapes,
// timed with N-1 fill lights and with N, in turns, for N from 1 to 4. The difference between the
// two sides is one fill light's cost. The first light holds the main slot, which casts the
// shadows; the scene draws none. It prints the medians for D-270. It runs only with
// NULL3D_FILL_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_FILL_COST=1 bun run test:browser -- fill-cost.spec.ts.
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

const COUNTS = [1, 2, 3, 4] as const;

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const count of COUNTS)
		test(`one more directional light on ${gpu}: ${count} against ${count - 1}`, async ({
			page,
		}) => {
			test.skip(!process.env.NULL3D_FILL_COST, 'set NULL3D_FILL_COST to time the fills');
			test.setTimeout(costTimeout(600_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.goto(`effect-cost.html?effect=fills&gpu=${gpu}&count=${count}&scale=1`);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			// The extra light's cost, from each side's GPU time where the device times it.
			const extra =
				result.on.gpuMs !== null && result.off.gpuMs !== null
					? `${(result.on.gpuMs - result.off.gpuMs).toFixed(3)} ms GPU`
					: 'no GPU timer';
			console.log(
				[
					`FILLCOST ${result.tier} ${gpu}, ${count} against ${count - 1} lights, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('all but one', result.off, 3),
					sideLine('all', result.on, 3),
					`one more light: ${extra}`,
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
