// A moving caster's shadow follows it in a far cascade that keeps its layer for several frames.
// The shadow contact sketch drives a dynamic box past still ones, live, in the last of three cascades.
// Each frame read back gives the offset between the box and its shadow. With far cascades that
// draw in every frame, the offset stays the same. With far cascades that draw once in 8 frames, it
// must match: a layer kept from an earlier frame would show the shadow where the box stood then,
// up to 7 frames of driving behind it. Hold mode cannot show this, as it draws one frame, in which
// every cascade draws. On both GPU paths.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	offsets: (number | null)[];
}

/**
 * How far, in pixels, a frame's offset may stray from the median of every-frame cascades. The
 * shadow's edges step across the far cascade's coarse texels as the box drives, so a shadow that
 * follows its box still strays by about a texel. A shadow a few frames behind strays by several.
 */
const MAX_STRAY = 5;

async function offsets(page: Page, gpu: string, far: number): Promise<number[]> {
	await page.goto(`moving-shadow.html?gpu=${gpu}&far=${far}`);
	const result = await pageResult<Result>(page, 60_000);
	expect(result.error).toBeUndefined();
	const found = result.offsets.filter((offset): offset is number => offset !== null);
	expect(found, 'every frame shows the box and its shadow').toHaveLength(result.offsets.length);
	return found;
}

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a moving caster's shadow follows it in a far cascade on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		const everyFrame = await offsets(page, gpu, 1);
		const expected = median(everyFrame);

		for (const offset of everyFrame) expect(Math.abs(offset - expected)).toBeLessThan(MAX_STRAY);
		for (const offset of await offsets(page, gpu, 8))
			expect(Math.abs(offset - expected), `offsets with every frame: ${everyFrame}`).toBeLessThan(
				MAX_STRAY,
			);
	});
