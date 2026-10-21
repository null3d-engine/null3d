// The cost of a canvas texture's refresh on each GPU path: the sketch times twenty refreshes of a
// 256 x 256 rectangle of a 1024 x 1024 canvas against four of the whole canvas, and the page prints
// the middle time of each and the milliseconds per mebibyte that it works out to. The test also
// checks that the frames that refresh the rectangle stayed within the preset's upload budget. The
// figures are for D-204.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	budget: number;
	refreshes: number;
	frames: number;
	rectMs: number;
	wholeMs: number;
	uploadMiB: number;
	uploadP99KiB: number;
	withinBudget: boolean;
	partial: boolean;
	rateKept: boolean;
	refreshed: boolean;
}

/** Texels of the rectangle, in mebibytes of RGBA8 texels. */
const RECT_MIB = (256 * 256 * 4) / (1024 * 1024);
/** Texels of the whole canvas, in mebibytes of RGBA8 texels. */
const WHOLE_MIB = (1024 * 1024 * 4) / (1024 * 1024);

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a canvas screen's refresh cost on ${gpu}`, async ({ page }) => {
		test.setTimeout(180_000);
		await page.goto(`canvas-texture.html?gpu=${gpu}&preset=high`);
		const result = await pageResult<Result>(page, 120_000);
		expect(result.error).toBeUndefined();
		const rectCost = result.rectMs / RECT_MIB;
		const wholeCost = result.wholeMs / WHOLE_MIB;
		console.log(
			`canvas refresh on ${result.tier}: ${result.rectMs.toFixed(2)} ms for ${RECT_MIB} MiB of rectangle (${rectCost.toFixed(2)} ms/MiB); ${result.wholeMs.toFixed(2)} ms for ${WHOLE_MIB} MiB whole (${wholeCost.toFixed(2)} ms/MiB); ${result.refreshes} refreshes in ${result.frames} frames, ${result.uploadMiB.toFixed(2)} MiB a frame on average, ${result.uploadP99KiB.toFixed(0)} KiB at p99 of ${(result.budget / 1024).toFixed(0)} KiB`,
		);
		expect(result.withinBudget).toBe(true);
		expect(result.partial).toBe(true);
		expect(result.rateKept).toBe(true);
		expect(result.refreshed).toBe(true);
	});
