// A scene in real units on every tier: a sun of 100,000 lux, a lamp of 1,000,000 lumens and a
// camera at EV100 15, with bloom (tests/pages/sketches/real-units-sketch.ts). The engine multiplies
// the exposure into each light, so the scene color holds values near 1. With the exposure at the end
// of the frame instead, the sun's highlight on the metal floor and the glowing sphere passed the
// largest 16-bit float: the color limit held them at 65,472, which the exposure then turned into a
// gray of about 1.7, with a faint glow. The image comparison catches a change of the picture. This
// spec checks the pixels that the fault changes, and the light that the units give a rough surface,
// so it fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

type Point = readonly [number, number];

/** Where the center of the sun's highlight on the floor draws, in pixels from the top-left corner. */
const HIGHLIGHT: Point = [160, 90];
/** Where the glowing sphere's center draws. */
const SPHERE: Point = [102, 47];
/** A pixel on the sunlit top of the rough white box. */
const BOX_TOP: Point = [230, 76];
/** The lowest value of each channel that counts as white, out of 255. */
const WHITE = 250;
/** How far from the highlight's center bloom's glow must reach, in pixels. */
const GLOW_RADIUS = 15;
/**
 * The darkest channel that a pixel within the glow's radius may have, out of 255. The black floor
 * around the highlight shows only the glow there. With the exposure at the end, the glow came from
 * the highlight held at 65,472 before the exposure, about 39,000 times too faint to show.
 */
const GLOW_FLOOR = 60;
/**
 * The box's top in linear color before the tone curve: white paper under 100,000 lux at 63.4° from
 * the vertical, 100,000 × cos(63.4°) / π nits, times the exposure of EV100 15, 1 / (1.2 × 2^15).
 */
const BOX_TOP_LINEAR = ((100_000 * Math.cos(Math.atan(2))) / Math.PI) * (1 / (1.2 * 2 ** 15));
/**
 * How far the box's top may stray from the value its units give, out of 255: the highlight's glow
 * adds about 5 there.
 */
const BOX_TOLERANCE = 7;

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

interface Image {
	width: number;
	pixels: Uint8Array;
}

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

/** The darkest channel of each pixel within `radius` of `center`, as `x,y: value` for the darkest. */
function darkest(image: Image, center: Point, radius: number): { value: number; at: string } {
	let value = 255;
	let at = '';
	for (let y = center[1] - radius; y <= center[1] + radius; y++)
		for (let x = center[0] - radius; x <= center[0] + radius; x++) {
			if ((x - center[0]) ** 2 + (y - center[1]) ** 2 > radius * radius) continue;
			const i = 4 * (y * image.width + x);
			const low = Math.min(
				image.pixels[i] ?? 0,
				image.pixels[i + 1] ?? 0,
				image.pixels[i + 2] ?? 0,
			);
			if (low < value) [value, at] = [low, `${x},${y}`];
		}
	return { value, at };
}

/** The green channel of a pixel, out of 255. */
function green(image: Image, [x, y]: Point): number {
	return image.pixels[4 * (y * image.width + x) + 1] ?? 0;
}

/** Linear color from 0 up after three.js's ACES curve, encoded as sRGB out of 255, for gray. */
function acesSrgb(linear: number): number {
	// three.js's ACESFilmicToneMapping for a gray input: its fit of RRT and ODT on each channel, after
	// the input and output matrices, whose rows each add up to 1 for gray, and its 1 / 0.6 scale.
	const v = linear / 0.6;
	const a = v * (v + 0.0245786) - 0.000090537;
	const b = v * (0.983729 * v + 0.432951) + 0.238081;
	const mapped = Math.min(Math.max(a / b, 0), 1);
	const srgb = mapped <= 0.0031308 ? mapped * 12.92 : 1.055 * mapped ** (1 / 2.4) - 0.055;
	return srgb * 255;
}

for (const name of ['real-units', 'real-units-exposure'])
	test(`${name}: a sun of 100,000 lux at EV100 15 keeps its highlight white and its glow`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runs = IMAGE_RUNS.filter((run) => run.test === name);
		expect(runs.length).toBe(3);
		for (const run of runs) {
			const image = await imageOf(page, run.path);
			const highlight = darkest(image, HIGHLIGHT, 1);
			expect
				.soft(highlight.value, `${run.id}: the highlight at ${highlight.at}`)
				.toBeGreaterThanOrEqual(WHITE);
			const sphere = darkest(image, SPHERE, 0);
			expect
				.soft(sphere.value, `${run.id}: the sphere at ${sphere.at}`)
				.toBeGreaterThanOrEqual(WHITE);
			const glow = darkest(image, HIGHLIGHT, GLOW_RADIUS);
			expect
				.soft(glow.value, `${run.id}: the glow at ${glow.at}`)
				.toBeGreaterThanOrEqual(GLOW_FLOOR);
			const top = green(image, BOX_TOP);
			const expected = acesSrgb(BOX_TOP_LINEAR);
			expect
				.soft(Math.abs(top - expected), `${run.id}: the box's sunlit top, ${top} for ${expected}`)
				.toBeLessThanOrEqual(BOX_TOLERANCE);
		}
	});
