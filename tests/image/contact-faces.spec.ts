// Contact shadows leave alone a face that the camera sees from the side away from the sun, on every
// tier. The march starts from the face that the camera sees, so on such a face it runs through the
// surface itself and always finds it in the way. Grass whose material lights both faces as an upper
// face once took dark, grainy blocks wherever the camera looked toward the sun. The spec draws upright
// cards lit from behind, with contact shadows on and off (tests/pages/sketches/contact-faces-sketch.ts):
// the cards must look the same, and the ground in front of them must keep its contact shadows.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'tests/pages/sketches/contact-faces-sketch.ts';

/** The share of the cards' pixels that may differ by more than `STEP`, from the output's dither. */
const CARD_SHARE = 0.01;
/** A change of a pixel's mean channel, out of 255, that counts as a difference. */
const STEP = 8;
/**
 * The fewest pixels of the ground away from the cards that contact shadows must darken, so the
 * check is not empty: about 100 at the test's size on every tier, where a frame without them
 * darkens none.
 */
const GROUND_PIXELS = 40;

interface Frame {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

async function imageOf(page: Page, path: string): Promise<{ width: number; pixels: Uint8Array }> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

const pathOf = (query: string, tier: string) => {
	const runs = imageRuns([{ name: `contact-faces${query}`, sketch: `${SKETCH}${query}`, hold: 0 }]);
	const run = runs.find((candidate) => candidate.tier === tier);
	if (!run) throw new Error(`no run of the contact faces sketch on ${tier}`);
	return run.path;
};

for (const tier of ['webgpu', 'compat', 'webgl2'])
	test(`contact shadows leave faces seen from away from the sun alone on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const { width, pixels: off } = await imageOf(page, pathOf('?off', tier));
		const { pixels: on } = await imageOf(page, pathOf('', tier));
		const at = (x: number, y: number) => 4 * (y * width + x);
		// The cards are green; the ground and the sky are not.
		const green = (i: number) =>
			(off[i + 1] ?? 0) > 1.2 * (off[i] ?? 0) && (off[i + 1] ?? 0) > 1.2 * (off[i + 2] ?? 0);
		const light = (pixels: Uint8Array, i: number) =>
			((pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0)) / 3;
		const height = off.length / 4 / width;
		let cards = 0;
		let changedCards = 0;
		let darkerGround = 0;
		// Pixels at a card's edge blend the card with the ground behind it, whose contact shadows
		// change, so only pixels whose neighbours share their kind count.
		for (let y = 1; y < height - 1; y++)
			for (let x = 1; x < width - 1; x++) {
				const i = at(x, y);
				const kinds = [i, at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].map(green);
				const change = light(on, i) - light(off, i);
				if (kinds.every(Boolean)) {
					cards++;
					if (Math.abs(change) > STEP) changedCards++;
				} else if (!kinds.some(Boolean) && change < -STEP) darkerGround++;
			}
		expect(cards).toBeGreaterThan(1000);
		expect(changedCards / cards).toBeLessThan(CARD_SHARE);
		expect(darkerGround).toBeGreaterThan(GROUND_PIXELS);
	});
