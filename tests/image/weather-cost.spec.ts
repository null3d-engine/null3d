// What the weather add-on costs, on each GPU path and preset: the ground of tests/pages/
// weather-cost-sketch.ts, timed with the wet surface off and on, and with the planar reflection off
// and on. The wet surface adds the puddles, the ripple rings and the water's tone to whatever
// surface a scene hands it; the planar pass adds the mirror. It runs only with NULL3D_WEATHER_COST
// set, in a quiet window on a computer with a GPU of its own:
// NULL3D_WEATHER_COST=1 bun run test:browser -- weather-cost.spec.ts.
// NULL3D_WEATHER_PRESETS sets the presets, as a list. Each test waits for a quiet computer and
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

const presets = (process.env.NULL3D_WEATHER_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const mirror of [false, true])
	for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
		for (const preset of presets)
			test(`weather ${mirror ? 'reflection ' : ''}on ${gpu} at ${preset}, timed off and on`, async ({
				page,
			}) => {
				test.skip(
					!process.env.NULL3D_WEATHER_COST,
					'set NULL3D_WEATHER_COST to time the weather add-on',
				);
				test.setTimeout(costTimeout(300_000));
				const loadBefore = await waitForQuiet();
				await page.setViewportSize({ width: 1920, height: 1080 });
				await page.goto(
					`weather-cost.html?gpu=${gpu}&preset=${preset}${mirror ? '&mirror=1' : ''}`,
				);
				const result = await pageResult<CostResult & { mirror: boolean }>(page, 200_000);
				expect(result.error).toBeUndefined();
				console.log(
					[
						`WEATHERCOST ${result.tier} at ${preset}${result.mirror ? ', planar reflection' : ''}, load ${loadBefore} before and ${loadNow()} after`,
						sideLine('off', result.off, 3),
						sideLine('on', result.on, 3),
					].join('\n'),
				);
				expect(result.failures).toEqual([]);
			});
