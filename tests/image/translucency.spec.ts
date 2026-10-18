// Thin surfaces let the light behind them through to their front, on every tier: the translucency
// tests of the image test manifest. A panel that shows nothing of the sun behind it still draws a
// plausible picture, which a new reference could take in. This spec measures each effect, so it
// fails even before a test has references.
import { expect, test } from '@playwright/test';
import {
	type Image,
	imageOf,
	luma,
	meanOf,
	project,
	type Vec3,
	variant,
} from '../lib/frame-pixels.ts';
import {
	BOX,
	CAMERA,
	LAMP,
	PANEL_SHARES,
	PANEL_X,
	SUN,
} from '../pages/sketches/translucency-scene.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'translucency-sketch.ts';

/** The pixels of the panel at `x`, between heights `bottom` and `top` and half `width` across. */
function patchOf(image: Image, x: number, bottom: number, top: number, width = 0.35): number[] {
	const low = project(CAMERA, [x - width, bottom, 0], image.width, image.height);
	const high = project(CAMERA, [x + width, top, 0], image.width, image.height);
	const pixels: number[] = [];
	for (let y = Math.ceil(high.y); y < low.y; y++)
		for (let px = Math.ceil(low.x); px < high.x; px++) pixels.push(y * image.width + px);
	return pixels;
}

/** The mean brightness over `pixels`. */
const brightness = (image: Image, pixels: readonly number[]) =>
	pixels.reduce((sum, p) => sum + luma(image, p), 0) / pixels.length;

/** How much redder than green a color is. */
const redness = ([r, g]: Vec3) => r - g;

/** The upper part of panel `k`, which only the sun and the ambient light reach. */
const upper = (image: Image, k: number) => patchOf(image, PANEL_X[k] as number, 0.45, 0.8);

/** Where the box's shadow falls on the plane of the panels, along the sun's light. */
const shadow = (() => {
	const along = -BOX[2] / SUN[2];
	return [BOX[0] + SUN[0] * along, BOX[1] + SUN[1] * along] as const;
})();

test('translucency: light behind thin panels shows through, with its shadows and lamps', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'translucency');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const image = await imageOf(page, run.path);
		// Each panel lets more of the sun behind it through than the one before.
		const lit = PANEL_SHARES.map((_, k) => brightness(image, upper(image, k)));
		for (let k = 1; k < lit.length; k++)
			expect
				.soft(lit[k] as number, `${run.id}: panel ${k} shows more light than panel ${k - 1}`)
				.toBeGreaterThan((lit[k - 1] as number) + 0.03);
		const [none, all] = [lit[0] as number, lit[lit.length - 1] as number];
		expect.soft(all - none, `${run.id}: the sun shows through the last panel`).toBeGreaterThan(0.2);
		// The box's shadow on the last panel's back shows through it.
		const shaded = brightness(
			image,
			patchOf(image, shadow[0], shadow[1] - 0.06, shadow[1] + 0.06, 0.06),
		);
		expect.soft(shaded, `${run.id}: the box's shadow shows through`).toBeLessThan(all * 0.6);
		// The lamp behind the second panel's lower half tints it orange.
		const lamp = meanOf(image, patchOf(image, LAMP[0], LAMP[1] - 0.1, LAMP[1] + 0.1, 0.15));
		const above = meanOf(image, upper(image, 1));
		expect
			.soft(redness(lamp) - redness(above), `${run.id}: the lamp shows through`)
			.toBeGreaterThan(0.1);
	}
});

test('translucency-volume and translucency-maps: a volume and maps change the light through', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'translucency');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const plain = await imageOf(page, run.path);
		const thick = await imageOf(page, variant(run.path, SKETCH, '?volume'));
		const mapped = await imageOf(page, variant(run.path, SKETCH, '?maps'));
		// The red volume tints the light through the last panel.
		const last = upper(plain, 3);
		expect
			.soft(
				redness(meanOf(thick, last)) - redness(meanOf(plain, last)),
				`${run.id}: the volume tints the light`,
			)
			.toBeGreaterThan(0.1);
		// The map's stripes let less light through every other band across the last panel.
		const bands = (image: Image) => {
			const pixels = patchOf(image, PANEL_X[3], 0.45, 0.8, 0.5);
			const values = pixels.map((p) => luma(image, p));
			const mean = values.reduce((a, b) => a + b, 0) / values.length;
			return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
		};
		expect
			.soft(bands(mapped), `${run.id}: the maps' stripes show`)
			.toBeGreaterThan(4 * bands(plain) + 1e-3);
	}
});
