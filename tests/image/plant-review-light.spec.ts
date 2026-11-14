// What the review's daylight does to a leaf of known colour. One hosta leaf is drawn square to the
// camera by the review page three times: under the copy stand's two lamps, which show a diffuse face
// at its own reflectance; under the whole views' daylight; and under that daylight with a sky share of
// 0.357, as several species' whole views are lit. The leaf's mean linear green against the record's
// reflectance is the leaf material's own share; the daylight's against the copy stand's is the light's.
//
// Measured at 2cf33dc35, on the real GPU: the copy stand shows the leaf at 1.06 of its
// reflectance, its gloss and its edge pixels blended with the white ground; the daylight at 1.11 of the
// copy stand, a face turned to the camera taking half the sky and the ground, the ambient light and the
// high sun at about a third of its strength; and the sky share at 0.87, which moves light from the sky
// into that high sun. A face turned to the camera is not brought to about 0.7 of its colour by the
// light: that share, read on whole views, comes from what the crown does to its leaves.
import { expect, test } from '@playwright/test';
import { loadSpecies } from '../../packages/vegetation/src/core/registry.ts';
import { imageOf } from '../lib/images.ts';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';

/** A broad leaf, so few of its pixels are its edge. */
const SPECIES = 'hosta';
const SIZE = [512, 512] as const;

/** A colour byte as the linear share it encodes. */
function linear(byte: number): number {
	const s = byte / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** The review page's one-leaf view of the plant on white, under a light. */
function leafWindow(sun: string, extra: string): string {
	const sketch =
		`/tests/pages/sketches/plant-review-sketch.ts?species=${SPECIES}&view=leaf-upper` +
		`&seed=11&variant=0&preset=high&background=white&sun=${sun}${extra}` +
		`&size=${SIZE[0]}x${SIZE[1]}&hold=1`;
	return `image.html?sketch=${encodeURIComponent(sketch)}&hold=1&size=${SIZE[0]}x${SIZE[1]}&preset=high`;
}

/** The mean linear green of the leaf's pixels: green over red and blue, and well off the white ground. */
function leafGreen(data: Uint8Array): number {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] as number;
		const g = data[i + 1] as number;
		const b = data[i + 2] as number;
		if (Math.min(r, g, b) > 225 || g < r || g < b) continue;
		sum += linear(g);
		count++;
	}
	return sum / Math.max(1, count);
}

test("the review's daylight on a leaf of known colour", async ({ page }) => {
	test.setTimeout(180_000);
	const draw = async (sun: string, extra = '') => {
		const result = await loadResult(page, leafWindow(sun, extra), 90_000);
		expect(result.ok, failureText(result)).toBe(true);
		const image = imageOf(result, SIZE);
		if (typeof image === 'string') throw new Error(image);
		return leafGreen(image.data);
	};
	const copyStand = await draw('albedo');
	const daylight = await draw('default', '&daylight=1');
	const skyShare = await draw('default', '&daylight=1&skyShare=0.357');
	const module = await loadSpecies(SPECIES);
	const foliage = module.record.foliage;
	if (foliage.kind !== 'blade' && foliage.kind !== 'thick')
		throw new Error(`the ${SPECIES} grows no flat leaf`);
	const reflectance = foliage.leaf.optics?.reflectance[1] as number;
	const shares = {
		material: Number((copyStand / reflectance).toFixed(3)),
		daylight: Number((daylight / copyStand).toFixed(3)),
		skyShare: Number((skyShare / copyStand).toFixed(3)),
	};
	console.log(`the leaf's green: reflectance ${reflectance}, ${JSON.stringify(shares)}`);
	expect(shares.material, 'the copy stand shows the leaf at its reflectance').toBeGreaterThan(0.95);
	expect(shares.material).toBeLessThan(1.2);
	expect(shares.daylight, 'the daylight on a face turned to the camera').toBeGreaterThan(1);
	expect(shares.daylight).toBeLessThan(1.25);
	expect(shares.skyShare, 'a sky share of 0.357 moves light into the high sun').toBeGreaterThan(
		0.78,
	);
	expect(shares.skyShare).toBeLessThan(0.95);
});
