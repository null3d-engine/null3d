// The subsurface blur spreads skin's light under its surface, on every tier: the subsurface tests
// of the image test manifest. A panel that blurs nothing still draws a plausible picture, which a
// new reference could take in. This spec measures each effect against the plain panel beside it,
// so it fails even before a test has references.
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
	BLOCKER,
	BLOCKER_SIZE,
	CAMERA,
	PANEL_X,
	SHADOW_Y,
} from '../pages/sketches/subsurface-scene.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

const SKETCH = 'subsurface-sketch.ts';

/** The pixels of the plane z = `z` between `left` and `right` and between `bottom` and `top`. */
function patchOf(
	image: Image,
	[left, right]: readonly [number, number],
	[bottom, top]: readonly [number, number],
	z = 0,
): number[] {
	const low = project(CAMERA, [left, bottom, z], image.width, image.height);
	const high = project(CAMERA, [right, top, z], image.width, image.height);
	const pixels: number[] = [];
	for (let y = Math.ceil(high.y); y < low.y; y++)
		for (let x = Math.ceil(low.x); x < high.x; x++) pixels.push(y * image.width + x);
	return pixels;
}

/** The middle of panel `k` across, at the heights `bottom` to `top`. */
const panel = (image: Image, k: number, bottom: number, top: number) => {
	const x = PANEL_X[k] as number;
	return patchOf(image, [x - 0.3, x + 0.3], [bottom, top]);
};

/** The middle of the bar's shadow on panel `k`. */
const shaded = (image: Image, k: number) => panel(image, k, SHADOW_Y - 0.008, SHADOW_Y + 0.008);

/** A lit band of panel `k` above the shadow, far from any edge. */
const lit = (image: Image, k: number) => panel(image, k, SHADOW_Y + 0.25, SHADOW_Y + 0.4);

/** The front face of the box in front of the right panel, inside its edges. */
const blocker = (image: Image) => {
	const half = BLOCKER_SIZE / 2 - 0.04;
	const z = BLOCKER[2] + BLOCKER_SIZE / 2;
	return patchOf(
		image,
		[BLOCKER[0] - half, BLOCKER[0] + half],
		[BLOCKER[1] - half, BLOCKER[1] + half],
		z,
	);
};

/** The mean brightness over `pixels`. */
const brightness = (image: Image, pixels: readonly number[]) =>
	pixels.reduce((sum, p) => sum + luma(image, p), 0) / pixels.length;

/** How much redder than blue a color is. */
const redness = ([r, , b]: Vec3) => r - b;

/** The spread of brightness over `pixels`: how far the stripes of a map stand apart. */
const spread = (image: Image, pixels: readonly number[]) => {
	const values = pixels.map((p) => luma(image, p));
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
};

/** Checks that the right panel's light spreads into the bar's shadow and keeps its level away. */
function expectBlur(image: Image, id: string): void {
	const [plain, skin] = [shaded(image, 0), shaded(image, 1)];
	expect
		.soft(
			brightness(image, skin) - brightness(image, plain),
			`${id}: light spreads into the shadow`,
		)
		.toBeGreaterThan(0.03);
	expect
		.soft(
			redness(meanOf(image, skin)) - redness(meanOf(image, plain)),
			`${id}: red light spreads furthest`,
		)
		.toBeGreaterThan(0.02);
	const away = brightness(image, lit(image, 1)) - brightness(image, lit(image, 0));
	expect.soft(Math.abs(away), `${id}: the lit skin keeps its light`).toBeLessThan(0.03);
}

test('subsurface: skin light spreads into a shadow, redder, and only on the skin', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'subsurface');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const image = await imageOf(page, run.path);
		expectBlur(image, run.id);
		// Without taps, both panels draw alike, and the box in front of the skin keeps its color.
		const off = await imageOf(page, variant(run.path, SKETCH, '?off'));
		const left = (k: number) => brightness(off, shaded(off, k));
		expect.soft(Math.abs(left(1) - left(0)), `${run.id}: no taps, no blur`).toBeLessThan(0.01);
		const box = blocker(image);
		const [blurred, plain] = [meanOf(image, box), meanOf(off, box)];
		const change = Math.max(...blurred.map((c, k) => Math.abs(c - (plain[k] as number))));
		expect.soft(change, `${run.id}: the box in front of the skin takes no blur`).toBeLessThan(0.01);
	}
});

test('subsurface-maps and subsurface-scale-50: maps soften, and corners blur alike', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'subsurface');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const mapped = await imageOf(page, variant(run.path, SKETCH, '?maps'));
		// The stripes stand further apart on the plain panel than on the skin, whose blur softens
		// them.
		expect
			.soft(spread(mapped, lit(mapped, 1)), `${run.id}: the skin's map softens under the blur`)
			.toBeLessThan(0.8 * spread(mapped, lit(mapped, 0)));
		expectBlur(mapped, `${run.id} maps`);
		const half = await imageOf(page, variant(run.path, SKETCH, '?scale=0.5'));
		expectBlur(half, `${run.id} at half scale`);
	}
});
