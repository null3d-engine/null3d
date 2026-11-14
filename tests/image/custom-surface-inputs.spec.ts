// The inputs that a masked custom material's surface function reads in each pass (M3-V2): the card
// of `custom-surface-inputs-sketch.ts` sways over a ground that receives its shadow, and its alpha
// is its shape times values that hold across the card where it shades: the object's world matrix,
// the camera's pixel, target size, matrices and planes, the face that the triangle shows, the side
// its normal faces and the direction toward the camera.
//
// The spec draws the card twice, once gated and once plain, and requires the same picture: a caster
// or a motion build that reads another value in any of them cuts the card's shadow or its motion,
// and the two pictures then differ. A third run turns the shadows off, so the comparison cannot
// pass with no shadow drawn at all.
import { expect, type Page, test } from '@playwright/test';
import { imageRuns, TIERS, type Tier } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { decodeMotion } from '../pages/lib/motion-vectors.ts';

const SKETCH = 'tests/pages/sketches/custom-surface-inputs-sketch.ts';
const HOLD = 0.4;
/** The picture's size. The card stands beyond the shadow map's width, so the caster's pixel gate
 * can tell the camera's pixel from the map's. */
const SIZE = [640, 360] as const;

/** A motion the size of a pixel's last bit, which a still surface shows as no motion. */
const MOVING = 0.25;

/** The pixels that differ between two pictures of the sketch, or that move in one. */
type Pixels = Uint8Array;

/** Draws one picture of the sketch, as its pixels in order. */
async function draw(page: Page, tier: Tier, query: string, name: string): Promise<Pixels> {
	const [run] = imageRuns([
		{
			name,
			sketch: `${SKETCH}?${query}`,
			hold: HOLD,
			tiers: [tier],
			size: SIZE,
		},
	]);
	if (!run) throw new Error('a sketch test has a run on its tier');
	const result = await loadResult(page, run.path, run.timeoutSeconds * 1000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	return new Uint8Array(Buffer.from(String(result.pixels), 'base64'));
}

/** How many pixels of two pictures of one size differ in color. */
function differing(before: Pixels, after: Pixels): number {
	let count = 0;
	for (let at = 0; at < before.length; at += 4) {
		if (
			before[at] !== after[at] ||
			before[at + 1] !== after[at + 1] ||
			before[at + 2] !== after[at + 2]
		)
			count++;
	}
	return count;
}

/** The moving pixels of a plain motion picture, and how many differ between two of them. */
function motionOf(gated: Pixels, plain: Pixels): { moving: number; differing: number } {
	let moving = 0;
	let differ = 0;
	for (let index = 0; index < SIZE[0] * SIZE[1]; index++) {
		const at = index * 4;
		const [gx, gy] = decodeMotion(gated[at] ?? 0, gated[at + 1] ?? 0, gated[at + 2] ?? 0);
		const [px, py] = decodeMotion(plain[at] ?? 0, plain[at + 1] ?? 0, plain[at + 2] ?? 0);
		if (Math.hypot(px, py) > MOVING) moving++;
		if (gx !== px || gy !== py) differ++;
	}
	return { moving, differing: differ };
}

for (const tier of TIERS) {
	test(`a masked custom material's shadow sees the surface's inputs on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		const gated = await draw(page, tier, 'gated', 'custom-surface-inputs');
		const plain = await draw(page, tier, 'plain', 'custom-surface-inputs-plain');
		const unshadowed = await draw(
			page,
			tier,
			'plain&noshadows',
			'custom-surface-inputs-plain-unshadowed',
		);
		// The card's shadow draws, so a picture without it differs in many pixels.
		const shadow = differing(plain, unshadowed);
		expect(shadow, `${shadow} pixels change when the sun casts no shadow`).toBeGreaterThan(400);
		// The caster gives the surface the same inputs as the shading does, so the gated card casts
		// the plain card's shadow, down to the pixel.
		const caster = differing(gated, plain);
		expect(caster, `${caster} pixels differ between the gated and the plain shadow`).toBe(0);
	});

	test(`a masked custom material's motion sees the surface's inputs on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(240_000);
		const gated = await draw(page, tier, 'motion', 'custom-surface-inputs-motion');
		const plain = await draw(page, tier, 'motion&plain', 'custom-surface-inputs-motion-plain');
		const { moving, differing: differ } = motionOf(gated, plain);
		// The card sways, so its plain motion moves at many pixels: the motion pass draws it.
		expect(moving, `${moving} pixels of the plain card move`).toBeGreaterThan(400);
		// The motion build gives the surface the same inputs as the shading does, so the gated card
		// moves exactly where the plain one does.
		expect(differ, `${differ} pixels of motion differ between the gated and the plain card`).toBe(
			0,
		);
	});
}
