// What a far-tree impostor bake costs on this computer, at each preset's atlas grid: the page of
// tests/pages/impostor-bake.html bakes a conifer, a birch and an oak into both atlases at every
// grid, and reports each bake's time on the sketch thread and the bytes that its two atlases hold.
// It prints the figures for D-274. It runs only with NULL3D_IMPOSTOR_BAKE_COST set, because the
// times mean something only on a quiet computer: NULL3D_IMPOSTOR_BAKE_COST=1 bun run test:browser
// -- impostor-bake.spec.ts. Each test waits for a quiet computer and prints the load beside its
// figures (tests/lib/cost-runs.ts).
import { expect, test } from '@playwright/test';
import { load, waitForQuietLoad } from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';

/** What the page publishes: one row for each preset and plant, and the page's whole time. */
interface BakeResult {
	error?: string;
	tier: string;
	elapsedMs?: number;
	runs?: {
		preset: string;
		species: string;
		views: number;
		columns: number;
		rows: number;
		ms: number;
		bytes: number;
		triangles: number;
	}[];
	failures?: string[];
}

test.skip(
	!process.env.NULL3D_IMPOSTOR_BAKE_COST,
	'set NULL3D_IMPOSTOR_BAKE_COST to time the bakes',
);

test('a far-tree bake at each preset', async ({ page }) => {
	test.setTimeout(240_000);
	await waitForQuietLoad();
	const before = load();
	await page.goto('impostor-bake.html');
	const result = await pageResult<BakeResult>(page, 180_000);
	expect(result.error).toBeUndefined();
	const runs = result.runs ?? [];
	expect(runs.length).toBeGreaterThan(0);
	for (const run of runs)
		console.log(
			`${run.preset} ${run.species}: ${run.views} views in a ${run.columns} x ${run.rows} grid, ${run.triangles} triangles, ${run.ms.toFixed(1)} ms, ${(run.bytes / 1024).toFixed(0)} KiB`,
		);
	console.log(`${result.tier}, load ${before} before and ${load()} after`);
	expect(result.failures).toEqual([]);
});
