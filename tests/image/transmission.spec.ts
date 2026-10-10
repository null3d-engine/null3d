// Surfaces that let light through bend, blur and tint what lies behind them, on every tier: the
// transmission tests of the image test manifest. Glass that shows its background unbent, or with
// no blur, still draws a plausible picture, which a new reference could take in. This spec measures
// each effect against the same scene drawn another way, so it fails even before a test has
// references.
import { expect, type Page, test } from '@playwright/test';
import {
	BALL_RADIUS,
	TRANSMISSION_BALLS,
	TRANSMISSION_CAMERA,
} from '../../bench/scenes/transmission.ts';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

interface Image {
	width: number;
	height: number;
	/** Each pixel's red, green and blue, from 0 to 1. */
	rgb: Float32Array;
}

type Vec3 = readonly [number, number, number];

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return { width: frame.width, height: pixels.length / 4 / frame.width, rgb };
}

/** The page of a run with `query` added to its sketch's address. */
function variant(path: string, sketch: string, query: string): string {
	expect(path).toContain(sketch);
	return path.replace(sketch, `${sketch}${encodeURIComponent(query)}`);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
	const length = Math.hypot(...a);
	return [a[0] / length, a[1] / length, a[2] / length];
};

/** Where a point of the glass scene lands in an image of its size, in pixels from the top left. */
function project(point: Vec3, width: number, height: number): { x: number; y: number } {
	const { fov, position, target } = TRANSMISSION_CAMERA;
	const forward = unit(sub(target, position));
	const right = unit(cross(forward, [0, 1, 0]));
	const up = cross(right, forward);
	const relative = sub(point, position);
	const depth = dot(relative, forward);
	const scale = 1 / Math.tan((fov * Math.PI) / 360);
	const ndcX = (dot(relative, right) * scale) / (depth * (width / height));
	const ndcY = (dot(relative, up) * scale) / depth;
	return { x: (ndcX * 0.5 + 0.5) * width, y: (0.5 - ndcY * 0.5) * height };
}

/** The pixels of the disc in the middle of a ball, two thirds of its radius on the screen across. */
function discOf(image: Image, ball: number): number[] {
	const { position } = TRANSMISSION_BALLS[ball] as (typeof TRANSMISSION_BALLS)[number];
	const center = project(position, image.width, image.height);
	const edge = project(
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

/** The mean difference of color between two images over `pixels`, from 0 to 1 per channel. */
function difference(a: Image, b: Image, pixels: readonly number[]): number {
	let sum = 0;
	for (const p of pixels)
		for (let c = 0; c < 3; c++) sum += Math.abs((a.rgb[3 * p + c] ?? 0) - (b.rgb[3 * p + c] ?? 0));
	return sum / (3 * pixels.length);
}

/** The mean color over `pixels`. */
function meanOf(image: Image, pixels: readonly number[]): Vec3 {
	let [r, g, b] = [0, 0, 0];
	for (const p of pixels) {
		r += image.rgb[3 * p] ?? 0;
		g += image.rgb[3 * p + 1] ?? 0;
		b += image.rgb[3 * p + 2] ?? 0;
	}
	return [r / pixels.length, g / pixels.length, b / pixels.length];
}

const luma = (image: Image, p: number) =>
	0.2126 * (image.rgb[3 * p] ?? 0) +
	0.7152 * (image.rgb[3 * p + 1] ?? 0) +
	0.0722 * (image.rgb[3 * p + 2] ?? 0);

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
