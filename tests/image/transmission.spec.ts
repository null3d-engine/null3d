// Surfaces that let light through bend, blur and tint what lies behind them, on every tier: the
// transmission tests of the image test manifest. Glass that shows its background unbent, or with
// no blur, still draws a plausible picture, which a new reference could take in. This spec measures
// each effect against the same scene drawn another way, so it fails even before a test has
// references.
import { expect, test } from '@playwright/test';
import {
	BALL_RADIUS,
	TRANSMISSION_BALLS,
	TRANSMISSION_CAMERA,
} from '../../bench/scenes/transmission.ts';
import type { EngineModeName } from '../lib/engine-checks.ts';
import {
	difference,
	type Image,
	imageOf,
	luma,
	meanOf,
	project,
	type Vec3,
	variant,
} from '../lib/frame-pixels.ts';
import { IMAGE_RUNS, manifestRun } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** The pixels of the disc in the middle of a ball, two thirds of its radius on the screen across. */
function discOf(image: Image, ball: number): number[] {
	const { position } = TRANSMISSION_BALLS[ball] as (typeof TRANSMISSION_BALLS)[number];
	const center = project(TRANSMISSION_CAMERA, position, image.width, image.height);
	const edge = project(
		TRANSMISSION_CAMERA,
		[position[0] + BALL_RADIUS, position[1], position[2]],
		image.width,
		image.height,
	);
	const radius = ((edge.x - center.x) * 2) / 3;
	const pixels: number[] = [];
	for (let y = Math.floor(center.y - radius); y <= center.y + radius; y++)
		for (let x = Math.floor(center.x - radius); x <= center.x + radius; x++)
			if (Math.hypot(x - center.x, y - center.y) <= radius) pixels.push(y * image.width + x);
	return pixels;
}

/**
 * The mean squared change of brightness from each pixel of `pixels` to the one at its right: high
 * for sharp edges, and low where a blur spreads the same change over many pixels.
 */
function sharpness(image: Image, pixels: readonly number[]): number {
	let sum = 0;
	for (const p of pixels) sum += (luma(image, p + 1) - luma(image, p)) ** 2;
	return sum / pixels.length;
}

const GLASS_SKETCH = 'transmission-sketch.ts';
const [SMOOTH, ROUGH, TINTED] = [0, 1, 2];

test('transmission: glass bends, blurs and tints the wall behind it', async ({ page }) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'transmission');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const glass = await imageOf(page, run.path);
		const thin = await imageOf(page, variant(run.path, GLASS_SKETCH, '?thin'));
		const empty = await imageOf(page, variant(run.path, GLASS_SKETCH, '?empty'));
		const smooth = discOf(glass, SMOOTH);
		// A ball with no thickness shows the wall straight behind it, less what its surface
		// reflects. A thick one bends the light, so it shows other stripes.
		const unbent = difference(thin, empty, smooth);
		const bent = difference(glass, empty, smooth);
		expect.soft(unbent, `${run.id}: a thin ball shows the wall unbent`).toBeLessThan(0.04);
		expect.soft(bent, `${run.id}: a thick ball bends the wall`).toBeGreaterThan(0.05);
		expect.soft(bent, `${run.id}: bent against unbent`).toBeGreaterThan(3 * unbent);
		// The rough ball blurs the stripes that the smooth one shows sharp.
		const sharp = sharpness(glass, smooth);
		const blurred = sharpness(glass, discOf(glass, ROUGH));
		expect.soft(sharp, `${run.id}: the smooth ball's stripes are sharp`).toBeGreaterThan(1.5e-4);
		expect.soft(blurred, `${run.id}: the rough ball blurs them`).toBeLessThan(sharp / 3);
		// The tinted ball's volume turns the light blue over its path, which a thin ball has none of.
		const tinted = meanOf(glass, discOf(glass, TINTED));
		const clear = meanOf(thin, discOf(thin, TINTED));
		const blueness = ([r, g, b]: Vec3) => b - (r + g) / 2;
		expect
			.soft(blueness(tinted) - blueness(clear), `${run.id}: the volume tints the light`)
			.toBeGreaterThan(0.15);
		expect.soft(tinted[0], `${run.id}: the volume absorbs red`).toBeLessThan(clear[0] / 2);
	}
});

/**
 * The transmission map's red and the thickness map's green vary across the balls in bands, which
 * change what shows through them and how far the light bends. The plain scene is the same scene
 * without them, so the ball differs from it by far more than a drawing's own noise.
 */
test('transmission-maps: the transmission and thickness maps vary the glass', async ({ page }) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'transmission-maps');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const mapped = await imageOf(page, run.path);
		// The plain scene's run of the same tier and thread mode draws the same balls without maps.
		const plain = manifestRun(
			'transmission',
			run.tier,
			run.mode?.name as EngineModeName | undefined,
		);
		const without = await imageOf(page, plain.path);
		const smooth = discOf(mapped, SMOOTH);
		expect
			.soft(difference(mapped, without, smooth), `${run.id}: the maps vary the glass`)
			.toBeGreaterThan(0.01);
	}
});

/**
 * A clear coat's value leaves the specular maps' slots free, where the transmission and thickness
 * maps sit. A shader that dropped those maps in a coated material would draw the same glass with
 * and without them, so the plain coat's balls differ from the mapped ones by far more than a
 * drawing's own noise.
 */
test('transmission-maps: a clear coat keeps the transmission and thickness maps', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'transmission-maps');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		// The plain scene's run of the same tier and thread mode draws the balls without a map, so
		// each variant adds its own switches to that path rather than to the mapped one's.
		const plain = manifestRun(
			'transmission',
			run.tier,
			run.mode?.name as EngineModeName | undefined,
		);
		const mapped = await imageOf(page, variant(plain.path, GLASS_SKETCH, '?coat&maps'));
		const coated = await imageOf(page, variant(plain.path, GLASS_SKETCH, '?coat'));
		const smooth = discOf(mapped, SMOOTH);
		expect
			.soft(difference(mapped, coated, smooth), `${run.id}: the coat keeps the maps`)
			.toBeGreaterThan(0.01);
	}
});

/**
 * A specular intensity map and the transmission and thickness maps draw together: the specular map
 * keeps its own row slot and samples the specular intensity slot's texture array, where the
 * transmission map takes a layer of its own. A shader that dropped either family would draw the
 * glass as the scene with the other alone, so each pair below differs by far more than a drawing's
 * own noise.
 */
test('transmission-specular-maps: the specular map and the volume maps both draw', async ({
	page,
}) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'transmission');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		// Every variant adds its switches to the same tier's path, so the three scenes differ only
		// in the maps that they give the glass.
		const both = await imageOf(page, variant(run.path, GLASS_SKETCH, '?maps&specular&env'));
		const volumes = await imageOf(page, variant(run.path, GLASS_SKETCH, '?maps&env'));
		const specular = await imageOf(page, variant(run.path, GLASS_SKETCH, '?specular&env'));
		const smooth = discOf(both, SMOOTH);
		expect
			.soft(difference(both, volumes, smooth), `${run.id}: the specular map draws beside them`)
			.toBeGreaterThan(0.01);
		expect
			.soft(difference(both, specular, smooth), `${run.id}: the volume maps draw beside it`)
			.toBeGreaterThan(0.01);
	}
});

test('transmission-water: ripples bend the bed that shows through the water', async ({ page }) => {
	test.setTimeout(240_000);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'transmission-water');
	expect(runs.length).toBe(3);
	for (const run of runs) {
		const rippled = await imageOf(page, run.path);
		const flat = await imageOf(page, variant(run.path, 'transmission-water-sketch.ts', '?flat'));
		// The water between the banks, in the lower half of the image.
		const water: number[] = [];
		for (let y = Math.floor(rippled.height / 2); y < rippled.height; y++)
			for (let x = Math.floor(rippled.width * 0.4); x < rippled.width * 0.6; x++)
				water.push(y * rippled.width + x);
		// The stones show through flat water as sharp shapes, which the ripples move about.
		expect.soft(sharpness(flat, water), `${run.id}: the bed shows through`).toBeGreaterThan(1.5e-4);
		expect
			.soft(difference(rippled, flat, water), `${run.id}: the ripples bend the bed`)
			.toBeGreaterThan(0.01);
	}
});
