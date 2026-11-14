// The motion of a masked custom material's leaves (M3-V2): the surface function cuts each leaf from
// its card, and the material's motion build tests the same alpha at the cutoff, so the motion of a
// leaf stops at its own edge. The spec draws the batch twice, once masked and once opaque, and
// decodes both motion views: pixels that move in the opaque picture and stand still in the masked
// one are the holes that the alpha cuts.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { decodeMotion } from '../pages/lib/motion-vectors.ts';

const SKETCH = 'tests/pages/sketches/custom-cutout-sketch.ts';
const HOLD = 0.4;
const SIZE = [480, 270] as const;

/** A motion the size of a pixel's last bit, which a still surface shows as no motion. */
const MOVING = 0.25;

/** Draws one picture of the sketch and returns the motion that each pixel shows. */
async function drawMotion(page: Page, tier: Tier, query: string, name: string) {
	const [run] = imageRuns([
		{ name, sketch: `${SKETCH}?${query}`, hold: HOLD, tiers: [tier], size: SIZE },
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const pixels = new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
	return (index: number) =>
		decodeMotion(pixels[index * 4] ?? 0, pixels[index * 4 + 1] ?? 0, pixels[index * 4 + 2] ?? 0);
}

for (const tier of TIERS) {
	test(`a masked custom material's motion keeps its holes on ${tier}`, async ({ page }) => {
		const masked = await drawMotion(page, tier, 'motion', 'custom-cutout-motion');
		const solid = await drawMotion(page, tier, 'motion&solid', 'custom-cutout-motion-solid');
		let leaves = 0;
		let holes = 0;
		for (let index = 0; index < SIZE[0] * SIZE[1]; index++) {
			const [x, y] = masked(index);
			const still = Math.hypot(x, y) <= MOVING;
			if (!still) leaves++;
			if (!still) continue;
			const [solidX, solidY] = solid(index);
			if (Math.hypot(solidX, solidY) > MOVING) holes++;
		}
		// The leaves sway, so a share of the picture moves, and the holes that their alpha cuts keep
		// the still scene: those pixels move in the opaque picture and not in the masked one.
		expect(leaves).toBeGreaterThan(400);
		expect(holes).toBeGreaterThan(400);
	});
}
