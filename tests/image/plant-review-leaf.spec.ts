// Two cutting pictures of one plant, drawn at two leaf lengths, must differ. A photograph measured
// in a young leaf's length frames its piece at the photograph's own scale, and a page that ignores
// the length draws the same picture for both: two references judged by one drawing, which no figure
// can explain. The sedge's blades are a metre long and its photographed leaf a tenth of that.
import { expect, test } from '@playwright/test';
import { differentPixels, imageOf } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';

/** Small enough to draw in a few seconds, large enough that a reframing moves pixels. */
const SIZE = [256, 256] as const;

/** The drawing page's path for one cutting picture framed in leaves of the given length. */
function leafWindow(leafLength: number): string {
	const sketch =
		`/tests/pages/sketches/plant-review-sketch.ts?species=sedge&view=cluster&seed=11` +
		`&variant=0&preset=high&leaves=7.4&leafLength=${leafLength}` +
		`&size=${SIZE[0]}x${SIZE[1]}&hold=1`;
	return `image.html?sketch=${encodeURIComponent(sketch)}&hold=1&size=${SIZE[0]}x${SIZE[1]}&preset=high`;
}

test('two leaf lengths draw two cutting pictures', async ({ page }) => {
	const draw = async (leafLength: number) => {
		const result = await loadResult(page, leafWindow(leafLength), 60_000);
		expect(result.ok, JSON.stringify(result)).toBe(true);
		const image = imageOf(result, SIZE);
		if (typeof image === 'string') throw new Error(image);
		return image.data;
	};
	const young = await draw(0.1);
	const mature = await draw(1);
	expect(differentPixels(young, mature)).toBeGreaterThan(0);
});
