// A scene pass's texture stands upright and unmirrored on every tier: the minimap tests of the
// image test manifest. WebGPU draws an image's top row first, and materials sample v = 0 at the
// bottom row, so a copy turns the pass's image over on WebGPU; WebGL2 draws the rows in that order.
// Either fault, an image upside down or mirrored, still draws a plausible picture that a new
// reference could take in. This spec checks where the four boxes' colors land on the screen that
// shows the map, so it fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** The part of the image where the screen that shows the map draws: left, top, right, bottom. */
const SCREEN = [110, 0, 210, 72] as const;

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

interface Image {
	width: number;
	pixels: Uint8Array;
}

type Rgb = readonly [number, number, number];

/**
 * A box's color, by the channels that lead in it. The 8-bit path applies the tone curve twice to
 * the map's colors, so they come out a little lighter there: the tests ask for a lead, not a pure
 * color.
 */
const COLORS = {
	red: ([r, g, b]: Rgb) => r > g + 30 && r > b + 30,
	green: ([r, g, b]: Rgb) => g > r + 25 && g > b + 25,
	blue: ([r, g, b]: Rgb) => b > r + 25 && b > g + 15,
	yellow: ([r, g, b]: Rgb) => r > b + 30 && g > b + 30,
} as const;

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	return { width: frame.width, pixels: new Uint8Array(Buffer.from(frame.pixels, 'base64')) };
}

/** The middle of the pixels of the screen's part that take a color, or undefined for none. */
function centerOf(image: Image, color: keyof typeof COLORS): [number, number] | undefined {
	const [left, top, right, bottom] = SCREEN;
	let [x, y, count] = [0, 0, 0];
	for (let row = top; row < bottom; row++)
		for (let column = left; column < right; column++) {
			const i = 4 * (row * image.width + column);
			const pixel: Rgb = [image.pixels[i] ?? 0, image.pixels[i + 1] ?? 0, image.pixels[i + 2] ?? 0];
			if (Math.max(...pixel) < 40 || !COLORS[color](pixel)) continue;
			x += column;
			y += row;
			count++;
		}
	return count > 0 ? [x / count, y / count] : undefined;
}

// The map with its own clear color has a blue border, which the box test would count as blue.
for (const name of ['minimap', 'minimap-layers'])
	test(`${name}: the pass's texture stands upright and unmirrored on every tier`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runs = IMAGE_RUNS.filter((run) => run.test === name);
		expect(runs.length).toBe(3);
		for (const run of runs) {
			const image = await imageOf(page, run.path);
			const [red, green, blue, yellow] = (['red', 'green', 'blue', 'yellow'] as const).map(
				(color) => centerOf(image, color),
			);
			expect(
				red && green && blue && yellow,
				`${run.id}: the map shows the four boxes`,
			).toBeTruthy();
			if (!red || !green || !blue || !yellow) continue;
			expect.soft(red[0] < green[0], `${run.id}: red left of green`).toBe(true);
			expect.soft(blue[0] < yellow[0], `${run.id}: blue left of yellow`).toBe(true);
			expect.soft(red[1] < blue[1], `${run.id}: red above blue`).toBe(true);
			expect.soft(green[1] < yellow[1], `${run.id}: green above yellow`).toBe(true);
		}
	});
