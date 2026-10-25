// The port of three.js's CSS3D periodic table example (examples/css3d_periodictable.html, r186)
// against three.js's own draw: both stages show the same 118 cells, camera and markup, and the
// picture of one must match the picture of the other. This is a DOM comparison, so a screenshot is
// the reading: the engine draws none of these pixels.
import { expect, test } from '@playwright/test';
import { compareImages, percent } from '../../packages/cli/src/compare.js';
import { decodePngRgba } from '../../packages/cli/src/png.js';
import { pageResult } from '../lib/page-result.ts';
import { STAGE } from '../pages/lib/css3d-shared.ts';

/**
 * The most of the picture that may differ: a thousandth, the limit of the reference images. The two
 * stages drew with no differing pixel on the Mac's GPU, so the allowance is for the rasterisation of
 * another machine, not for the placement, which comes from the same matrices.
 */
const MAX_DIFFERENCE = 0.001;

interface Result {
	ok: boolean;
	error?: string;
	stage: { width: number; height: number };
	cells: number;
	theirCells: number;
}

/** The number of pixels of an image that a dark stage still shows as a cell or its text. */
function litPixels(data: Uint8Array): number {
	let lit = 0;
	for (let i = 0; i < data.length; i += 4)
		if ((data[i] as number) + (data[i + 1] as number) + (data[i + 2] as number) > 40) lit++;
	return lit;
}

test('the ported CSS3D periodic table draws the picture that three.js draws', async ({ page }) => {
	await page.goto('css3d-periodictable.html');
	const result = await pageResult<Result>(page, 45_000);
	expect(result.error).toBeUndefined();
	expect([result.cells, result.theirCells]).toEqual([118, 118]);
	expect([result.stage.width, result.stage.height]).toEqual([STAGE.width, STAGE.height]);

	const mine = decodePngRgba(Buffer.from(await page.locator('#mine').screenshot()), 'null3D');
	const theirs = decodePngRgba(Buffer.from(await page.locator('#theirs').screenshot()), 'three.js');
	expect([mine.width, mine.height]).toEqual([STAGE.width, STAGE.height]);
	expect([theirs.width, theirs.height]).toEqual([STAGE.width, STAGE.height]);
	// Each stage shows the table: a blank stage would otherwise compare equal to another blank one.
	expect(litPixels(mine.data)).toBeGreaterThan(5_000);
	expect(litPixels(theirs.data)).toBeGreaterThan(5_000);

	const { share } = compareImages(theirs, mine, 0.1);
	expect(share, `${percent(share)} of the pixels differ from three.js's draw`).toBeLessThanOrEqual(
		MAX_DIFFERENCE,
	);
});
