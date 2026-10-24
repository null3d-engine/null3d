// What one bake of the bark and leaf atlases costs, on each GPU path: the wall of leaf cards that
// the sketch draws through the atlas material, then through a plain unlit material, and the two
// frame intervals (tests/pages/vegetation-bake.ts). The difference is what a page pays to paint its
// plants' textures once. It runs only with NULL3D_VEGETATION_BAKE set, on a quiet computer, and
// prints the load beside its figures: the load decides whether a figure holds.
import { expect, test } from '@playwright/test';
import { load } from '../lib/cost-runs.ts';
import { pageResult } from '../lib/page-result.ts';

test.skip(!process.env.NULL3D_VEGETATION_BAKE, 'set NULL3D_VEGETATION_BAKE to time a bake');

/** What the page measured: the frame interval with the atlas and without it, in milliseconds. */
interface BakeResult {
	readonly tier: string;
	readonly withAtlas: number;
	readonly plain: number;
	readonly bake: number;
	readonly error?: string;
}

for (const gpu of ['webgpu', 'compat', 'webgl2'])
	test(`one atlas bake on ${gpu}`, async ({ page }) => {
		test.setTimeout(180_000);
		const before = load();
		await page.setViewportSize({ width: 640, height: 360 });
		await page.goto(`vegetation-bake.html?gpu=${gpu}`);
		const result = await pageResult<BakeResult>(page, 120_000);
		expect(result.error).toBeUndefined();
		console.log(
			`${result.tier}: ${result.withAtlas.toFixed(2)} ms with the atlas, ${result.plain.toFixed(2)} ms without, load ${before} before and ${load()} after`,
		);
	});
