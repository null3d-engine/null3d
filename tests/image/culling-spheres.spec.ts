// The debug switch that draws culling spheres runs the engine's own traversal and hands the spheres
// to the core's line writer. The page reports the figure that the switch's last frame drew, so a
// switch that drew nothing reports zero and fails: the count is read from the engine, not inferred
// from the picture. The same page with the switch left alone must report zero.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The copies of the level mesh that the page draws, one culling sphere each. */
const COPIES = 5;

interface SpheresResult {
	error?: string;
	tier: string;
	drawn: number;
	frames: number;
	failures: string[];
}

for (const tier of ['webgpu', 'compat', 'webgl2'])
	test(`the debug switch draws a culling sphere per level mesh on ${tier}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`culling-spheres.html?gpu=${tier}&spheres=on`);
		const on = await pageResult<SpheresResult>(page, 60_000);
		expect(on.error).toBeUndefined();
		expect(on.failures).toEqual([]);
		expect(on.drawn, 'the spheres that the switch drew').toBe(COPIES);
		await page.goto(`culling-spheres.html?gpu=${tier}&spheres=off`);
		const off = await pageResult<SpheresResult>(page, 60_000);
		expect(off.error).toBeUndefined();
		expect(off.failures).toEqual([]);
		expect(off.drawn, 'the spheres with the switch left alone').toBe(0);
	});
