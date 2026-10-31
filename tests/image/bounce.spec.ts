// Screen-space bounce light in a room with a red wall at the left and a green wall at the right:
// the neutral floor takes red light at the left and green at the right. This spec draws the same
// room three ways in one run: with the bounce light, with the light probe grid that bakes the same
// one bounce, and with neither. It checks each thing the feature promises.
//
// - The bounce light moves the picture: a sketch that never sets the quality setting draws the
//   room's plain light, and the pictures would match.
// - The floor takes the red wall's light at the left and the green wall's at the right, which the
//   environment's uniform light cannot give it. The two boxes are the floor under each wall, clear
//   of the walls themselves.
// - The bounce lands the bleed that the probe-lit room bakes. A screen-space estimate cannot equal
//   a bake, so the bake's signs are the firm figure and the whole frame must stay within the image
//   tolerance. A missing bounce, a swapped side or a wrong color fails this.
import { expect, test } from '@playwright/test';
import type { Tier } from '../../bench/lib/parity.ts';
import { compareImages } from '../../packages/cli/src/compare.js';
import { loadResult } from '../lib/page-result.ts';
import { failureText } from '../lib/runs.ts';
import { manifestRun } from './manifest.ts';

/** The pictures' size, which the manifest's bounce tests draw. */
const WIDTH = 480;
const HEIGHT = 270;
/** The threshold that counts a moved pixel: a two-step change in a channel counts, and one does not. */
const MOVED = 1 / 255;
/** The share of the frame that the bounce light must move to count as drawn. */
const MOVES = 0.05;
/**
 * The share of the frame that may differ from the probe-lit room past the image tests' own
 * threshold, one tenth of full scale. A screen-space estimate differs at the soft edges of the
 * light and where the screen cannot see, so this is a guard that the two draw the same room with
 * the same light, not an equality.
 */
const MATCHES = 0.45;
/** The image tests' own threshold: a change smaller than about 13 steps counts as nothing. */
const MATCH_THRESHOLD = 0.1;
/** The most that the picture's own light may move one floor box's red-minus-green, in 8-bit levels. */
const BLEED = 1.0;
/** The floor under the red wall at the left, and under the green wall at the right. */
const LEFT = { left: 0.16, right: 0.33, top: 0.7, bottom: 0.92 };
const RIGHT = { left: 0.67, right: 0.84, top: 0.7, bottom: 0.92 };

type Picture = { width: number; height: number; data: Uint8Array };

/** One load of the room with `variant`, as its picture. */
async function draw(
	page: import('@playwright/test').Page,
	tier: Tier,
	variant: 'off' | 'bounce' | 'grid',
): Promise<Picture> {
	const run = manifestRun(`bounce-${variant}`, tier, 'pipelined');
	const result = await loadResult(page, run.path, 90_000);
	expect(result.ok ? [] : [failureText(result)]).toEqual([]);
	const data = new Uint8Array(Buffer.from(result.pixels as string, 'base64'));
	expect(data.length).toBe(WIDTH * HEIGHT * 4);
	return { width: WIDTH, height: HEIGHT, data };
}

/** The mean of red minus green over a box of columns `left` to `right`, rows `top` to `bottom`. */
function redness(
	picture: Picture,
	left: number,
	right: number,
	top: number,
	bottom: number,
): number {
	let sum = 0;
	let count = 0;
	for (let row = Math.floor(top * HEIGHT); row < Math.floor(bottom * HEIGHT); row++)
		for (let column = Math.floor(left * WIDTH); column < Math.floor(right * WIDTH); column++) {
			const at = 4 * (row * WIDTH + column);
			sum += (picture.data[at] ?? 0) - (picture.data[at + 1] ?? 0);
			count++;
		}
	return count > 0 ? sum / count : 0;
}

/** The share of two pictures that differs past a threshold. */
function share(a: Picture, b: Picture, threshold: number): number {
	const image = (picture: Picture) => ({
		width: picture.width,
		height: picture.height,
		data: picture.data,
	});
	return compareImages(image(a), image(b), threshold).share;
}

/** How much redder a picture's floor box is than the plain room's, in 8-bit levels. */
function redder(picture: Picture, off: Picture, box: typeof LEFT): number {
	return (
		redness(picture, box.left, box.right, box.top, box.bottom) -
		redness(off, box.left, box.right, box.top, box.bottom)
	);
}

// Compatibility mode draws the 8-bit path, whose copy holds the display's color, so it draws no
// bounce light. The test below checks that it draws none.
for (const tier of ['webgpu', 'webgl2'] as const)
	test(`the bounce light shows each wall's color on the floor, ${tier}`, async ({ page }) => {
		const off = await draw(page, tier, 'off');
		const bounce = await draw(page, tier, 'bounce');
		const grid = await draw(page, tier, 'grid');

		const bounceLeft = redder(bounce, off, LEFT);
		const bounceRight = redder(bounce, off, RIGHT);
		expect(bounceLeft).toBeGreaterThan(BLEED);
		// The green wall takes red away from the right floor, so its figure is negative.
		expect(bounceRight).toBeLessThan(-BLEED);
		expect(share(bounce, off, MOVED)).toBeGreaterThan(MOVES);

		// The probe-lit room bakes the same one bounce. Its light lands on the same side. The
		// bake's green bleed is weaker than its red one, because the green wall's surface is
		// darker, so the signs are the firm figure and the strength is the share below.
		const gridLeft = redder(grid, off, LEFT);
		const gridRight = redder(grid, off, RIGHT);
		expect(gridLeft).toBeGreaterThan(0.3);
		expect(gridRight).toBeLessThan(-0.3);
		expect(share(bounce, grid, MATCH_THRESHOLD)).toBeLessThan(MATCHES);
	});

test('the bounce light draws nothing on the 8-bit path, compat', async ({ page }) => {
	const off = await draw(page, 'compat', 'off');
	const bounce = await draw(page, 'compat', 'bounce');
	expect(share(bounce, off, MOVED)).toBeLessThan(0.01);
});
