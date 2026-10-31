// What screen-space bounce light costs, on each GPU path at each preset, at the whole render scale
// and at half of it: the effect cost page's bounce scene, timed with the light off and on in turns
// (tests/pages/effect-cost.ts). It prints each side's medians for D-284. It runs only with
// NULL3D_BOUNCE_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_BOUNCE_COST=1 bun run test:browser -- bounce-cost.spec.ts.
// The light draws on ambient occlusion's grid at half the render size, so its cost follows the
// render scale. The cases are the presets that turn it on: High and Ultra on WebGPU, and WebGL2's
// Medium, where WebGPU's Medium draws none.
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

/** Each case: the GPU path and the preset that turns the light on. */
const CASES = [
	['webgpu', 'high'],
	['webgpu', 'ultra'],
	['webgl2', 'medium'],
] as const;

for (const [gpu, preset] of CASES)
	for (const scale of [1, 0.5])
		test(`bounce light on ${gpu}, ${preset} at scale ${scale}, timed on and off`, async ({
			page,
		}) => {
			test.skip(!process.env.NULL3D_BOUNCE_COST, 'set NULL3D_BOUNCE_COST to time the bounce light');
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`effect-cost.html?effect=bounce&gpu=${gpu}&preset=${preset}&scale=${scale}&fixed`,
			);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`BOUNCECOST ${result.tier} ${preset}, scale ${scale}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
