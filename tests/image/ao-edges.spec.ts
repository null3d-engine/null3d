// Ambient occlusion at the image's last row and column, on every tier. The horizon step rebuilds
// each surface's normal from the depths beside it. At the corner's right and bottom edges, the
// neighbor outside the corner once read the edge texel's own depth and position, which left no
// direction to build a normal from, and the image showed dark dots along its bottom row and right
// column. The references held the dots, so the image comparison could not catch them. This spec
// compares the occlusion's images with the scene without it: occlusion must darken the edge
// pixels about as much as the pixels one in from the edge.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/**
 * How much more occlusion may darken an edge pixel than the pixel one in from the edge, as the
 * mean of its channels out of 255. A dot darkened by 40 to 120 more; a soft edge of occlusion
 * moves by a few.
 */
const JUMP = 24;

/** The occlusion images that cover the whole canvas, and the scene without occlusion. */
const OCCLUDED = ['ao-default', 'ao-wide', 'ao-custom'];
const PLAIN = 'ao-off';

interface Frame {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

interface Image {
	width: number;
	height: number;
	pixels: Uint8Array;
}

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return {
		width: frame.width,
		height: frame.height,
		pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')),
	};
}

/**
 * The edge pixels that occlusion darkens by more than `JUMP` beyond the pixel one in from the
 * edge, as `x,y`: along the bottom row, then down the right column.
 */
function edgeDots(plain: Image, occluded: Image): string[] {
	const { width, height } = occluded;
	const light = (image: Image, x: number, y: number) => {
		const i = 4 * (y * width + x);
		return ((image.pixels[i] ?? 0) + (image.pixels[i + 1] ?? 0) + (image.pixels[i + 2] ?? 0)) / 3;
	};
	const darkening = (x: number, y: number) => light(plain, x, y) - light(occluded, x, y);
	const dots: string[] = [];
	for (let x = 0; x < width; x++)
		if (darkening(x, height - 1) - darkening(x, height - 2) > JUMP) dots.push(`${x},${height - 1}`);
	for (let y = 0; y < height; y++)
		if (darkening(width - 1, y) - darkening(width - 2, y) > JUMP) dots.push(`${width - 1},${y}`);
	return dots;
}

for (const tier of ['webgpu', 'compat', 'webgl2'])
	test(`ambient occlusion draws no dark dots along the bottom row and right column on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runOf = (name: string) => {
			const run = IMAGE_RUNS.find((r) => r.test === name && r.tier === tier);
			if (!run) throw new Error(`the manifest has no ${name} run on ${tier}`);
			return run;
		};
		const plain = await imageOf(page, runOf(PLAIN).path);
		for (const name of OCCLUDED) {
			const dots = edgeDots(plain, await imageOf(page, runOf(name).path));
			expect.soft(dots, `${name} on ${tier}: dark dots at the edges`).toEqual([]);
		}
	});
