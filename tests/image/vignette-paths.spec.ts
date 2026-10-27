// The vignette on both color paths, in the color grading scene with the table and the vignette
// (the image test lut-vignette and its 8-bit copy). The HDR path darkens light by the vignette in
// the final pass, before the tone mapping. The 8-bit path darkens it in the scene shaders, before
// their own tone mapping, and draws a plain background color as a background so the vignette
// darkens it too. The 8-bit copy compares the whole frame within a tolerance; this spec checks the
// vignette itself. At points from the top's middle out to the corners, over the objects and over
// the background color, both paths must draw the same light within a few steps, and the corners
// must darken. An 8-bit vignette that is missing, applied after the tone mapping, or of another
// size fails it.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

type Point = readonly [number, number];

/**
 * Points of the 640 x 360 frame, away from the objects' edges: the sky band at the top's middle and
 * at each side, the left edge, the floor, and the four corners, two over the background color and
 * two over the ground.
 */
const POINTS: readonly Point[] = [
	[320, 20],
	[160, 40],
	[540, 60],
	[20, 180],
	[100, 300],
	[8, 8],
	[632, 8],
	[8, 352],
	[632, 352],
];
/** The middle of the top's sky band, which the vignette darkens least of the points. */
const TOP = 0;
/** The corners, the last four points. */
const CORNERS = POINTS.slice(-4);
/** Half the side of the square of pixels whose mean color stands for a point, which evens out the dither. */
const BLOCK = 2;
/**
 * The largest gap between the two paths in any channel of a point's mean color, in steps out of
 * 255. The paths differ by at most 0.6 steps at these points, on SwiftShader and on the Mac's GPU.
 * A vignette a tenth of its size too large or too small moves them by 9 to 31 steps, and no
 * vignette by 47 to 144.
 */
const MAX_GAP = 3;
/** How many steps darker than the top's middle each corner must be, in every channel. */
const CORNER_DARKENING = 50;

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

/** The mean color of the square of pixels around `point`. */
function meanAt(image: Image, [x, y]: Point): number[] {
	const sum = [0, 0, 0];
	for (let dy = -BLOCK; dy <= BLOCK; dy++)
		for (let dx = -BLOCK; dx <= BLOCK; dx++) {
			const i = 4 * ((y + dy) * image.width + x + dx);
			for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (image.pixels[i + c] ?? 0);
		}
	return sum.map((s) => s / (2 * BLOCK + 1) ** 2);
}

/** The pipelined run of a manifest test on a tier. */
function runOf(name: string, tier: string) {
	const run = IMAGE_RUNS.find(
		(candidate) =>
			candidate.test === name && candidate.tier === tier && candidate.mode?.name === 'pipelined',
	);
	if (!run) throw new Error(`the manifest has no pipelined run of ${name} on ${tier}`);
	return run;
}

for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the 8-bit path's vignette darkens light before the tone mapping, as the HDR path's does, on ${tier}`, async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const hdr = await imageOf(page, runOf('lut-vignette', tier).path);
		const eightBit = await imageOf(page, runOf('lut-vignette-8-bit', tier).path);
		for (const point of POINTS) {
			const [a, b] = [meanAt(hdr, point), meanAt(eightBit, point)];
			const gap = Math.max(...a.map((v, c) => Math.abs(v - (b[c] ?? 0))));
			expect
				.soft(gap, `at ${point}: HDR ${a.map(Math.round)}, 8-bit ${b.map(Math.round)}`)
				.toBeLessThanOrEqual(MAX_GAP);
		}
		for (const image of [hdr, eightBit]) {
			const top = meanAt(image, POINTS[TOP] as Point);
			for (const corner of CORNERS) {
				const at = meanAt(image, corner);
				expect
					.soft(Math.min(...top.map((v, c) => v - (at[c] ?? 0))), `the corner at ${corner}`)
					.toBeGreaterThanOrEqual(CORNER_DARKENING);
			}
		}
	});
