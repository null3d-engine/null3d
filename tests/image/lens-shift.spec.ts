// A lens shift moves a camera's view off its axis and keeps its perspective, so a shifted view is a
// crop of a wider view from the same place. The page draws a wide camera and a narrow one whose
// shift frames the wide image's top-right quarter, with each lens, on each GPU path. As a view over
// that quarter of the canvas, the narrow camera must leave the frame as the wide camera drew it. As
// the camera of a canvas of the quarter's size, it must draw the quarter of the wide camera's frame
// on a canvas twice as large each way: culling, the shadows that the sun casts for each view and the
// lighting all follow the shifted view. The cascades' fit to a shifted view has unit tests of its
// own in the core, since a narrow view's cascades reach well past its sides.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface LensShiftResult {
	error?: string;
	tier: string;
	size: [number, number];
	wideSize?: [number, number];
	pixels: number;
	differing: number;
	meanDifference: number;
	spread: number;
}

/**
 * The share of pixels that may differ by more than a small step. The two cameras place each vertex
 * through other matrices, so an edge's pixel can fall on either side, and the sun's cascades fit
 * each camera's own view, so a shadow's edge can move by a texel. A lens that ignored its shift
 * would draw another part of the scene: then between 13% and 75% of the pixels differ.
 */
const DIFFERING_SHARE = { view: 0.002, canvas: 0.02 } as const;
/**
 * The mean difference per channel that the frames may keep, in steps of 255. A view's frame
 * differs from the wide frame by a step of rounding in some pixels, which reaches about 0.2.
 */
const MEAN_DIFFERENCE = { view: 0.5, canvas: 1.5 } as const;

for (const gpu of ['webgpu', 'webgl2'] as const)
	for (const lens of ['perspective', 'orthographic'] as const)
		for (const mode of ['view', 'canvas'] as const)
			test(`a shifted ${lens} lens draws the crop of a wider view, as a ${mode}, on ${gpu}`, async ({
				page,
			}) => {
				await page.goto(`lens-shift.html?gpu=${gpu}&lens=${lens}&mode=${mode}`);
				const result = await pageResult<LensShiftResult>(page, 60_000);
				expect(result.error).toBeUndefined();
				expect(result.tier).toBe(gpu);
				expect(result.size).toEqual([320, 240]);
				if (mode === 'canvas') expect(result.wideSize).toEqual([640, 480]);
				// The frame holds a scene, not one flat color.
				expect(result.spread).toBeGreaterThan(10);
				const summary = `${result.differing} of ${result.pixels} pixels differ, by ${result.meanDifference.toFixed(3)} on average`;
				expect(result.differing / result.pixels, summary).toBeLessThanOrEqual(
					DIFFERING_SHARE[mode],
				);
				expect(result.meanDifference, summary).toBeLessThanOrEqual(MEAN_DIFFERENCE[mode]);
			});
