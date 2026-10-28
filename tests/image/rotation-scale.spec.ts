// A rotation quaternion that is not unit length turns a mesh and never stretches or shears it. The
// aurora's sixteenth snow cone carries one, `[0, 2.3, 0, 1]`, and a raw compose stretches the cone
// about ten times: its base reaches past the camera, so its draw covers the whole lower half of the
// picture and hides the ice plane. This spec reads the plane's own color there, which is the
// picture proof of M3-R33 and needs no stored reference.
import { expect, type Page, test } from '@playwright/test';
import { TIERS } from '../../packages/cli/src/page.js';
import { pageResult } from '../lib/page-result.ts';

const SKETCH = '/tests/pages/sketches/rotation-scale.ts';
/** The size of the reproduction's picture. */
const SIZE = [640, 360] as const;

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

async function imageOf(page: Page, tier: string): Promise<Image> {
	const sketch = encodeURIComponent(SKETCH).replaceAll('%2F', '/');
	const path = `/tests/pages/image.html?gpu=${tier}&hold=1.5&preset=high&size=${SIZE.join('x')}&sketch=${sketch}`;
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error, `${tier}: the page drew its frame`).toBeUndefined();
	return {
		width: frame.width,
		height: frame.height,
		pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')),
	};
}

/** True for the plane's unlit magenta, which no cone shares. */
function magenta(image: Image, column: number, row: number): boolean {
	const i = 4 * (row * image.width + column);
	const [r, g, b] = [image.pixels[i] ?? 0, image.pixels[i + 1] ?? 0, image.pixels[i + 2] ?? 0];
	return r > 128 && g < 80 && b > 128;
}

for (const tier of TIERS)
	test(`${tier}: a non-unit rotation turns the cone and leaves the plane's own color below it`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const image = await imageOf(page, tier);
		// The plane fills the lower part of the picture: below the far cones' ridge.
		let plane = 0;
		let total = 0;
		for (let row = Math.floor(image.height * 0.6); row < image.height * 0.95; row++)
			for (let column = 0; column < image.width; column++) {
				total++;
				if (magenta(image, column, row)) plane++;
			}
		expect(
			plane / total,
			`${tier}: the ice plane's color fills the lower part of the picture`,
		).toBeGreaterThan(0.5);
		expect(
			magenta(image, Math.floor(image.width / 2), Math.floor(image.height * 0.9)),
			`${tier}: the plane draws below the camera`,
		).toBe(true);
	});
