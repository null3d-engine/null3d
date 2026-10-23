// What an alpha-masked lit fragment costs under MSAA, on each GPU path: the curtain of masked lit
// quads of the alpha-mask-cost page, timed with every quad opaque and masked in turns, with MSAA
// and with no antialiasing (tests/pages/alpha-mask-cost.ts). The difference between the two sides
// at each antialiasing mode is the masked build's cost, and the difference between those two
// differences is what MSAA adds to a fragment shader that discards. It prints each side's medians
// for D-226. It runs only with NULL3D_ALPHA_MASK_COST set, in a quiet window on a computer with a
// GPU of its own: NULL3D_ALPHA_MASK_COST=1 bun run test:browser -- alpha-mask-cost.spec.ts.
// NULL3D_ALPHA_MASK_GPUS and NULL3D_ALPHA_MASK_MODES set the paths and the antialiasing modes, as
// lists. Each test waits for a quiet computer and prints the load beside its figures
// (tests/lib/cost-runs.ts).
import { expect, test } from '@playwright/test';
import { browserOptions, WEBGPU_DEVELOPER_FEATURES } from '../../packages/cli/src/browser.js';
import {
	COST_PAGE_MS,
	COST_TEST_MS,
	type CostResult,
	costLine,
	load,
	waitForQuietLoad,
} from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';

// Chrome rounds the GPU timestamps it reports unless its developer features are on, and a rounded
// figure cannot show a cost of a few hundredths of a millisecond.
test.use({
	launchOptions: {
		...browserOptions('chrome-real-gpu'),
		args: [WEBGPU_DEVELOPER_FEATURES],
	},
});

test.skip(!process.env.NULL3D_ALPHA_MASK_COST, 'set NULL3D_ALPHA_MASK_COST to time the mask');

const gpus = (process.env.NULL3D_ALPHA_MASK_GPUS ?? 'webgpu,compat,webgl2').split(',');
const modes = (process.env.NULL3D_ALPHA_MASK_MODES ?? 'msaa,none').split(',');

for (const gpu of gpus)
	for (const antialias of modes)
		test(`${antialias} on ${gpu}, opaque and masked in turns`, async ({ page }) => {
			test.setTimeout(COST_TEST_MS);
			await waitForQuietLoad();
			const loadBefore = load();
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.goto(`alpha-mask-cost.html?gpu=${gpu}&aa=${antialias}&preset=high&prepass=off`);
			const result = await pageResult<CostResult>(page, COST_PAGE_MS);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`${result.tier} ${antialias}, load ${loadBefore} before and ${load()} after`,
					costLine('opaque', result.off),
					costLine('masked', result.on),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
