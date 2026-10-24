// What the sun's contact shadows cost, on each GPU path, at each step count and render scale: the
// effect cost page's contact scene, timed with contact shadows off and on, in turns
// (tests/pages/effect-cost.ts). It prints each side's medians for D-135. It runs only with
// NULL3D_CONTACT_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_CONTACT_COST=1 bun run test:browser -- contact-cost.spec.ts.
// On WebGPU the depth prepass follows contact shadows, so the on side pays it too. A second run of
// each WebGPU case keeps the prepass on for both sides, and the difference between the two runs is
// the prepass's own cost. WebGL2 draws the prepass on every preset. Compatibility mode stops at
// Medium, so it runs Medium's 4 steps alone. Each test waits for a quiet computer, within a time
// limit, and prints the load beside its figures (tests/lib/effect-cost.ts).
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

/** Each case: the GPU path, the preset, the steps per march and whether the prepass stays on. */
const CASES = [
	...[4, 8, 16].flatMap((steps) => [
		['webgpu', 'high', steps, false],
		['webgpu', 'high', steps, true],
		['webgl2', 'high', steps, false],
	]),
	['compat', 'medium', 4, false],
] as const;

for (const [gpu, preset, steps, prepass] of CASES)
	for (const scale of [1, 0.5])
		test(`contact shadows on ${gpu}, ${steps} steps at scale ${scale}${prepass ? ' with the prepass on' : ''}, timed on and off`, async ({
			page,
		}) => {
			test.skip(
				!process.env.NULL3D_CONTACT_COST,
				'set NULL3D_CONTACT_COST to time contact shadows',
			);
			test.setTimeout(costTimeout(300_000));
			const loadBefore = await waitForQuiet();
			await page.setViewportSize({ width: 1920, height: 1080 });
			await page.goto(
				`effect-cost.html?effect=contact&gpu=${gpu}&preset=${preset}&steps=${steps}&scale=${scale}${prepass ? '&prepass=on' : ''}`,
			);
			const result = await pageResult<CostResult>(page, 200_000);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`CONTACTCOST ${result.tier} ${steps} steps, scale ${scale}, prepass ${prepass ? 'on' : 'follows'}, load ${loadBefore} before and ${loadNow()} after`,
					sideLine('off', result.off, 3),
					sideLine('on', result.on, 3),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
