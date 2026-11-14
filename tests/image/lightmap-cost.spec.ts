// What a directional light map costs, on each GPU path: the curtain of lit quads of the lightmap-cost
// page, timed with a plain light map and with one that also stores the bake's direction, in turns
// (tests/pages/lightmap-cost.ts). Both sides read the same radiance and the same normal map, so the
// difference is the direction texture's read and the arithmetic that bends the baked light with the
// normal. The page also draws one frame of each side and the test requires them to differ. So a
// direction that the engine dropped, because it belongs to another texture array, fails the test
// rather than reporting a cost of nothing. It prints each side's medians for D-258. It runs only with
// NULL3D_LIGHTMAP_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_LIGHTMAP_COST=1 bun run test:browser -- lightmap-cost.spec.ts. NULL3D_LIGHTMAP_GPUS sets the
// paths, as a list. Each test waits for a quiet computer and prints the load beside its figures
// (tests/lib/cost-runs.ts).
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

test.skip(!process.env.NULL3D_LIGHTMAP_COST, 'set NULL3D_LIGHTMAP_COST to time the direction');

/** What the page publishes: the cost of each side, and how far the two pictures differ. */
type LightmapCostResult = CostResult & { directionShare: number };

/** The share of the frame that the direction must move, so a dropped direction fails the test. */
const LEAST_DIRECTION_SHARE = 0.01;

const gpus = (process.env.NULL3D_LIGHTMAP_GPUS ?? 'webgpu,compat,webgl2').split(',');

for (const gpu of gpus)
	test(`plain and directional light maps on ${gpu}, timed in turns`, async ({ page }) => {
		test.setTimeout(COST_TEST_MS);
		await waitForQuietLoad();
		const loadBefore = load();
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`lightmap-cost.html?gpu=${gpu}&preset=high&prepass=off`);
		const result = await pageResult<LightmapCostResult>(page, COST_PAGE_MS);
		expect(result.error).toBeUndefined();
		console.log(
			[
				`LIGHTMAPCOST ${result.tier}, ${(result.directionShare * 100).toFixed(2)}% of the pixels differ, load ${loadBefore} before and ${load()} after`,
				costLine('plain', result.off),
				costLine('directional', result.on),
			].join('\n'),
		);
		expect(result.failures).toEqual([]);
		expect(result.directionShare).toBeGreaterThan(LEAST_DIRECTION_SHARE);
	});
