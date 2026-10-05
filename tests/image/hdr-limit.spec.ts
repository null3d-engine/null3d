// Light past the largest 16-bit float, 65,504, on every tier: the HDR limit tests of the image test
// manifest. The scene shaders limit the color that they write into the 16-bit float scene color,
// and the final pass and bloom limit what they read. Without that, CI's software GPU stores such
// light as infinity, and the tone mapping draws it black: the emissive sphere vanishes, the sun's
// highlight on the metal floor gets a black hole at its center, and bloom draws no glow at all.
// The image comparison catches a change of the picture. This spec checks the pixels that the fault
// turns black, so it fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** Where the emissive sphere's center draws, in pixels from the image's top-left corner. */
const SPHERE: Point = [102, 46];
/** Where the center of the sun's highlight on the floor draws. */
const HIGHLIGHT: Point = [160, 90];
/** The lowest value of each channel that counts as white, out of 255. */
const WHITE = 250;
/** How far from the sphere's center bloom's glow must reach, in pixels. */
const GLOW_RADIUS = 40;
/**
 * The darkest channel that a pixel within the glow's radius may have, out of 255. CI's software
 * GPU draws at least 150 there, and a frame without bloom draws 0 to 5.
 */
const GLOW_FLOOR = 80;

type Point = readonly [number, number];

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

for (const name of ['hdr-limit', 'hdr-limit-bloom'])
	test(`${name}: light past the largest 16-bit float draws white on every tier`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runs = IMAGE_RUNS.filter((run) => run.test === name);
		expect(runs.length).toBe(3);
		for (const run of runs) {
			const image = await imageOf(page, run.path);
			const sphere = darkest(image, SPHERE, 1);
			expect
				.soft(sphere.value, `${run.id}: the sphere at ${sphere.at}`)
				.toBeGreaterThanOrEqual(WHITE);
			if (name === 'hdr-limit') {
				const highlight = darkest(image, HIGHLIGHT, 2);
				expect
					.soft(highlight.value, `${run.id}: the highlight at ${highlight.at}`)
					.toBeGreaterThanOrEqual(WHITE);
			} else {
				const glow = darkest(image, SPHERE, GLOW_RADIUS);
				expect
					.soft(glow.value, `${run.id}: the glow at ${glow.at}`)
					.toBeGreaterThanOrEqual(GLOW_FLOOR);
			}
		}
	});
