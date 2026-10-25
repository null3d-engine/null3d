// What each relief feature costs, on each GPU path and preset: the hillside of the relief-cost page,
// timed with one feature off and on, in turns (tests/pages/relief-cost.ts). It prints each side's
// medians for D-136. It runs only with NULL3D_RELIEF_COST set, in a quiet window on a computer
// with a GPU of its own: NULL3D_RELIEF_COST=1 bun run test:browser -- relief-cost.spec.ts.
// NULL3D_RELIEF_FEATURES sets the features, NULL3D_RELIEF_PRESETS the presets, as lists. Each test
// waits for a quiet computer and prints the load beside its figures (tests/lib/cost-runs.ts).
import { expect, test } from '@playwright/test';
import {
	COST_PAGE_MS,
	COST_TEST_MS,
	type CostResult,
	costLine,
	load,
	waitForQuietLoad,
} from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';
import { TIMING_BROWSER } from '../lib/timing-browser.ts';

test.use(TIMING_BROWSER);

const features = (
	process.env.NULL3D_RELIEF_FEATURES ?? 'displacement,parallax,bump,wireframe'
).split(',');
const presets = (process.env.NULL3D_RELIEF_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const feature of features)
	for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
		for (const preset of presets)
			test(`${feature} on ${gpu} at ${preset}, timed on and off`, async ({ page }) => {
				test.skip(!process.env.NULL3D_RELIEF_COST, 'set NULL3D_RELIEF_COST to time relief');
				test.setTimeout(COST_TEST_MS);
				await waitForQuietLoad();
				const loadBefore = load();
				await page.setViewportSize({ width: 1600, height: 900 });
				await page.goto(`relief-cost.html?gpu=${gpu}&preset=${preset}&feature=${feature}`);
				const result = await pageResult<CostResult>(page, COST_PAGE_MS);
				expect(result.error).toBeUndefined();
				console.log(
					[
						`${result.tier} ${preset}, ${feature}, load ${loadBefore} before and ${load()} after`,
						costLine('off', result.off),
						costLine('on', result.on),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
