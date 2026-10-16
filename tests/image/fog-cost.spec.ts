// What the volumetric fog costs, on each GPU path, at each slice count, in the sun scene and the
// night scene: the effect cost page's fog scene, timed with the lit fog off and on, in turns
// (tests/pages/effect-cost.ts). It prints each side's medians for D-133. It runs only with
// NULL3D_FOG_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_FOG_COST=1 bun run test:browser -- fog-cost.spec.ts. Each test waits for a quiet computer,
// within a time limit, and prints the load beside its figures (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const slices of [32, 64, 96])
		for (const night of [false, true])
			test(`volumetric fog on ${gpu}, ${slices} slices${night ? ' at night' : ''}, timed on and off`, async ({
				page,
			}) => {
				test.skip(!process.env.NULL3D_FOG_COST, 'set NULL3D_FOG_COST to time the volumetric fog');
				test.setTimeout(costTimeout(300_000));
				const loadBefore = await waitForQuiet();
				await page.setViewportSize({ width: 1920, height: 1080 });
				await page.goto(
					`effect-cost.html?effect=fog&gpu=${gpu}&slices=${slices}&scale=1${night ? '&night' : ''}`,
				);
				const result = await pageResult<CostResult>(page, 200_000);
				expect(result.error).toBeUndefined();
				console.log(
					[
						`FOGCOST ${result.tier} ${slices} slices${night ? ' night' : ' sun'}, load ${loadBefore} before and ${loadNow()} after`,
						sideLine('off', result.off, 3),
						sideLine('on', result.on, 3),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
