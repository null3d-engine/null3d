// The size a shader reads for the render target is the size the scene drew at, at every render
// scale the governor reaches. A material that covers the view paints its place as
// `input.fragCoord.xy / frame.resolution`, so the change across and the change down sit at the
// middle of the image only while that size is the render size. Below the whole scale a value that
// reported the canvas would move both changes to a share of the canvas, and at half the scale the
// paint would not change at all. The page fixes the whole scale and the floor of each preset, in
// every thread mode and on every GPU path.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { FRAME_RESOLUTION_SCALES } from '../pages/lib/render-scale.ts';

interface FrameResolutionResult {
	error?: string;
	tier: string;
	scales: number[];
	across: number[];
	down: number[];
	failures: string[];
}

/**
 * How far the paint's change may sit from the middle of the image, as a share of its side. The
 * upscale's filter moves the change by a pixel or two. A value that reported the canvas moves it a
 * twentieth of the image at 0.9, a sixth at 0.75 and a third at 0.6, and at Low's floor the paint
 * does not change at all.
 */
const PLACE_TOLERANCE = 0.02;

const TIERS = [
	{ tier: 'webgpu', query: 'gpu=webgpu' },
	{ tier: 'webgpu-compat', query: 'gpu=compat' },
	{ tier: 'webgl2', query: 'gpu=webgl2' },
] as const;

for (const { tier, query } of TIERS)
	for (const mode of ENGINE_MODES)
		test(`a shader reads the size the scene drew at on ${tier}, ${mode.name}`, async ({ page }) => {
			await page.goto(`frame-resolution.html?${query}&${mode.query}`);
			const result = await pageResult<FrameResolutionResult>(page, 45_000);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(tier);
			expect(result.failures).toEqual([]);
			expect(result.scales).toEqual(FRAME_RESOLUTION_SCALES);
			for (const [index, scale] of result.scales.entries()) {
				const across = result.across[index] ?? 1;
				const down = result.down[index] ?? 1;
				expect(
					Math.abs(across - 0.5),
					`the change across at render scale ${scale} sits at ${across.toFixed(3)}`,
				).toBeLessThanOrEqual(PLACE_TOLERANCE);
				expect(
					Math.abs(down - 0.5),
					`the change down at render scale ${scale} sits at ${down.toFixed(3)}`,
				).toBeLessThanOrEqual(PLACE_TOLERANCE);
			}
		});
