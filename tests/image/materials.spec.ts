// A material's set call changes only the options it gets, and every object that uses the material
// draws the change, on both GPU paths and in every thread mode. The page changes the opacity alone,
// which the engine stores but does not draw yet, then the color alone, then both.
import { expect, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface MaterialsResult {
	error?: string;
	tier: string;
	failures: string[];
	/** The RGBA color at the middle of the frame after each step. */
	colors: number[][];
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const GREEN = [0, 255, 0, 255];
/** The color after each step. A change of the opacity alone keeps the red. */
const EXPECTED = [RED, RED, BLUE, GREEN];
/** How far a channel may stray from the unlit color, for GPUs that round differently. */
const TOLERANCE = 2;

for (const tier of ['webgpu', 'webgl2'] as const)
	for (const mode of ENGINE_MODES)
		test(`a material changes only the options that set gets, on ${tier}, ${mode.name}`, async ({
			page,
		}) => {
			await page.goto(`materials.html?gpu=${tier}&${mode.query}`);
			const result = await pageResult<MaterialsResult>(page, 30_000);
			expect(result.error).toBeUndefined();
			expect(result.failures).toEqual([]);
			expect(result.tier).toBe(tier);
			// A channel within the tolerance counts as its expected value; any other shows as drawn.
			const seen = result.colors.map((color, step) =>
				color.map((channel, i) => {
					const expected = EXPECTED[step]?.[i] ?? 0;
					return Math.abs(channel - expected) <= TOLERANCE ? expected : channel;
				}),
			);
			expect(seen).toEqual(EXPECTED);
		});
