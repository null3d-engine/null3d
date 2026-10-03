// A moving caster's shadow follows it in a far cascade that keeps its layer for several frames.
// The shadow contact sketch drives a dynamic box past still ones, live, in the last of three
// cascades. The box moves a fixed step in each frame, so a slow GPU reads it where a fast one does.
// Each frame read back gives the offset between the box and its shadow. With far cascades that
// draw in every frame, the offset stays nearly the same. With far cascades that draw once in 8
// frames, it must match: a layer kept from an earlier frame would show the shadow where the box
// stood then, up to 7 frames of driving behind it. Hold mode cannot show this, as it draws one
// frame, in which every cascade draws. On both GPU paths.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	offsets: (number | null)[];
}

/**
 * How far, in pixels, a frame's offset may stray from the median of every-frame cascades. The
 * offset depends on where the box is: the shadow's edges step across the far cascade's coarse
 * texels, and the box's top stands nearer the camera than the ground. So a shadow that follows its
 * box still strays by up to about a texel. A shadow two or more frames behind strays by more.
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
