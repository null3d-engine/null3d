// The debug switch that draws culling spheres runs the engine's own traversal and hands the spheres
// to the core's line writer. The page turns the switch on, reports the figure that its last frame
// drew, then turns it off in the same page load and reports again. A switch that drew nothing
// reports zero and fails, a count that outlived the turn-off reports five and fails, and a mesh
// without levels in the row must add no sphere. The count is read from the engine, not inferred
// from the picture.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The copies of the level mesh that the page draws, one culling sphere each. */
const COPIES = 5;
/** The tier that the engine reports for each ?gpu= that a page may ask for. */
const TIERS: Record<string, string> = {
	webgpu: 'webgpu',
	compat: 'webgpu-compat',
	webgl2: 'webgl2',
};

interface SpheresResult {
	error?: string;
	tier: string;
	/** The spheres that the last frame drew before the switch turned off. */
	drawn: number;
	/** The count after the switch turned off, which must be zero. */
	off: number;
	frames: number;
	failures: string[];
}

for (const tier of ['webgpu', 'compat', 'webgl2'])
	test(`the debug switch draws a culling sphere per level mesh on ${tier}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`culling-spheres.html?gpu=${tier}&spheres=on`);
		const result = await pageResult<SpheresResult>(page, 60_000);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		expect(result.tier, 'the tier the page drew on').toBe(TIERS[tier]);
		expect(result.drawn, 'the spheres that the switch drew').toBe(COPIES);
		expect(result.off, 'the spheres after the switch turned off').toBe(0);
	});
