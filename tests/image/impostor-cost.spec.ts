// What the impostor cards cost per frame, on each GPU path: the field of cards of the
// impostor-cost page fills the view, and the page draws it with the whole batch hidden and shown
// again, in turns, and then with its three nearest views drawn and its nearest view alone. Both
// sides of each pair clear the same background and draw nothing else, so the first difference is
// the card batch's cost and the second is what the three-view blend costs against one view. It
// prints each side's medians for D-274. It runs only with NULL3D_IMPOSTOR_COST set, in a quiet
// window on a computer with a GPU of its own: NULL3D_IMPOSTOR_COST=1 bun run test:browser --
// impostor-cost.spec.ts. NULL3D_IMPOSTOR_GPUS sets the paths, as a list. Each test waits for a
// quiet computer and prints the load beside its figures (tests/lib/cost-runs.ts).
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

test.skip(!process.env.NULL3D_IMPOSTOR_COST, 'set NULL3D_IMPOSTOR_COST to time the cards');

const gpus = (process.env.NULL3D_IMPOSTOR_GPUS ?? 'webgpu,compat,webgl2').split(',');

/** What the page publishes: the shared cost sides, the cards that it drew, and the blend's sides. */
interface ImpostorCost extends CostResult {
	readonly preset?: string;
	readonly cards?: number;
	readonly blend?: CostResult['off'];
	readonly one?: CostResult['on'];
}

for (const gpu of gpus)
	test(`cards hidden and shown on ${gpu}`, async ({ page }) => {
		test.setTimeout(COST_TEST_MS);
		await waitForQuietLoad();
		const loadBefore = load();
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`impostor-cost.html?gpu=${gpu}&preset=high`);
		const result = await pageResult<ImpostorCost>(page, COST_PAGE_MS);
		expect(result.error).toBeUndefined();
		console.log(
			[
				`${result.tier} at ${result.preset ?? 'its preset'}, ${result.cards ?? 0} cards, load ${loadBefore} before and ${load()} after`,
				costLine('cards off', result.off),
				costLine('cards on', result.on),
				...(result.blend && result.one
					? [costLine('three views', result.blend), costLine('one view', result.one)]
					: []),
			].join('\n'),
		);
		expect(result.failures).toEqual([]);
	});
