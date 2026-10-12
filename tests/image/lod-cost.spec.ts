// What levels of detail save, on each GPU path and preset: the forest of the lod-cost page, timed
// with every tree at its base mesh and with each at its own level, in turns (tests/pages/lod-cost.ts).
// It prints each side's medians for D-137. It runs only with NULL3D_LOD_COST set, in a quiet window
// on a computer with a GPU of its own: NULL3D_LOD_COST=1 bun run test:browser -- lod-cost.spec.ts.
// NULL3D_LOD_COUNT sets the trees, 40,000 by default, and NULL3D_LOD_PRESETS the presets, as a
// list. Each test waits for a quiet computer and prints the load beside its figures
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

const count = process.env.NULL3D_LOD_COUNT ?? '40000';
const presets = (process.env.NULL3D_LOD_PRESETS ?? 'low,medium,high,ultra').split(',');

for (const gpu of ['webgpu', 'compat', 'webgl2'] as const)
	for (const preset of presets)
		test(`levels of detail on ${gpu} at ${preset}, timed on and off`, async ({ page }) => {
			test.skip(!process.env.NULL3D_LOD_COST, 'set NULL3D_LOD_COST to time the levels');
			test.setTimeout(COST_TEST_MS);
			await waitForQuietLoad();
			const loadBefore = load();
			await page.setViewportSize({ width: 1600, height: 900 });
			await page.goto(`lod-cost.html?gpu=${gpu}&preset=${preset}&count=${count}`);
			const result = await pageResult<CostResult>(page, COST_PAGE_MS);
			expect(result.error).toBeUndefined();
			console.log(
				[
					`${result.tier} ${preset}, ${count} trees, load ${loadBefore} before and ${load()} after`,
					costLine('base meshes', result.off),
					costLine('levels', result.on),
				].join('\n'),
			);
			expect(result.failures).toEqual([]);
		});
