// What screen-space bounce light costs, on both GPU paths, at each preset, in the page's light
// scene and in a busy one of 200 boxes: the effect cost page's bounce scene, timed with the bounce
// off and on, in turns (tests/pages/effect-cost.ts). It prints each side's medians for D-244. It
// runs only with NULL3D_BOUNCE_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_BOUNCE_COST=1 bun run test:browser -- bounce-cost.spec.ts. Each test waits for a quiet
// computer, within a time limit, and prints the load beside its figures (tests/lib/effect-cost.ts).
import { expect, test } from '@playwright/test';
import {
	type CostResult,
	costTimeout,
	loadNow,
	sideLine,
	waitForQuiet,
} from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const preset of ['low', 'medium', 'high', 'ultra'] as const)
		for (const count of [0, 200])
			test(`bounce on ${gpu} at ${preset}, ${count === 0 ? 'a light scene' : `${count} boxes`}, timed on and off`, async ({
				page,
			}) => {
				test.skip(
					!process.env.NULL3D_BOUNCE_COST,
					'set NULL3D_BOUNCE_COST to time the bounce light',
				);
				test.setTimeout(costTimeout(180_000));
				const loadBefore = await waitForQuiet();
				await page.setViewportSize({ width: 1920, height: 1080 });
				await page.goto(
					`effect-cost.html?effect=bounce&gpu=${gpu}&preset=${preset}&count=${count}&scale=1`,
				);
				const result = await pageResult<CostResult>(page, 120_000);
				expect(result.error).toBeUndefined();
				console.log(
					[
						`BOUNCECOST ${result.tier} ${preset} ${count === 0 ? 'light' : 'busy'}, load ${loadBefore} before and ${loadNow()} after`,
						sideLine('off', result.off, 3),
						sideLine('on', result.on, 3),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
