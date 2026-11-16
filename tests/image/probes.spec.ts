// Reflection probes on every tier: the probe tests of the image test manifest. A probe whose faces
// land on the wrong sides, or whose map never fills, still draws a plausible room, which a new
// reference could take in. This spec checks that the chrome ball in the middle of the room
// reflects the green wall on its left and the red wall on its right, as the walls stand, and that
// the mirror floor in front of the ball reflects the lit room, not the black of a scene without an
// environment. It also checks the floor beyond the near probe's box, which only a further probe
// can light: a held picture whose second probe never captures draws that half black, and a
// reference drawn from such a picture records the fault, so this check is the one that sees it. So
// the spec fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
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
	pixels: Uint8Array;
}

type Rgb = readonly [number, number, number];

/** The colors that the spec looks for, by the channels that lead in each. */
const COLORS = {
	red: ([r, g, b]: Rgb) => r > g + 60 && r > b + 60,
	green: ([r, g, b]: Rgb) => g > r + 60 && g > b + 60,
} as const;

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	return { width: frame.width, height: pixels.length / 4 / frame.width, pixels };
}

function pixelOf(image: Image, column: number, row: number): Rgb {
	const i = 4 * (row * image.width + column);
	return [image.pixels[i] ?? 0, image.pixels[i + 1] ?? 0, image.pixels[i + 2] ?? 0];
}

/**
 * The middle of the pixels of a color in the box from `left` to `right` and `top` to `bottom`, as
 * shares of the image, with their count, or undefined for none.
 */
function centerOf(
	image: Image,
	color: keyof typeof COLORS,
	[left, right, top, bottom]: readonly [number, number, number, number],
): { x: number; count: number } | undefined {
	let [x, count] = [0, 0];
	for (let row = Math.floor(top * image.height); row < bottom * image.height; row++)
		for (let column = Math.floor(left * image.width); column < right * image.width; column++) {
			if (!COLORS[color](pixelOf(image, column, row))) continue;
			x += column;
			count++;
		}
	return count > 0 ? { x: x / count / image.width, count } : undefined;
}

/** The mean brightness of the pixels in a box, as shares of the image, from 0 to 255. */
function brightness(image: Image, [left, right, top, bottom]: readonly number[]): number {
	let [sum, count] = [0, 0];
	for (
		let row = Math.floor((top as number) * image.height);
		row < (bottom as number) * image.height;
		row++
	)
		for (
			let column = Math.floor((left as number) * image.width);
			column < (right as number) * image.width;
			column++
		) {
			const [r, g, b] = pixelOf(image, column, row);
			sum += (r + g + b) / 3;
			count++;
		}
	return count > 0 ? sum / count : 0;
}

/** The middle third of the image across, a band about the ball's height, which the walls stay out of. */
const BALL = [0.3, 0.7, 0.25, 0.65] as const;
/** The floor between the ball and the camera. */
const FLOOR = [0.4, 0.6, 0.85, 1] as const;
/**
 * The floor beyond the near probe's box, across the room, which only a further probe lights. Its
 * box lies past the west probe's blend, so a picture in which the second probe never captured shows
 * it as the black of a surface that no probe lights.
 */
const EAST_FLOOR = [0.65, 0.85, 0.9, 1] as const;

for (const name of ['probe-room', 'probe-rough', 'probe-flat', 'probe-blend'])
	test(`${name}: the ball reflects each wall on its own side, and the floor reflects the room`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runs = IMAGE_RUNS.filter((run) => run.test === name);
		expect(runs.length).toBe(3);
		for (const run of runs) {
			const image = await imageOf(page, run.path);
			const green = centerOf(image, 'green', BALL);
			const red = centerOf(image, 'red', BALL);
			expect(green && red, `${run.id}: the ball reflects the green and the red walls`).toBeTruthy();
			if (green && red)
				expect.soft(green.x < red.x, `${run.id}: green on the left, red on the right`).toBe(true);
			expect
				.soft(brightness(image, FLOOR), `${run.id}: the floor reflects the lit room`)
				.toBeGreaterThan(40);
			expect
				.soft(brightness(image, EAST_FLOOR), `${run.id}: the east floor reflects the lit room`)
				.toBeGreaterThan(40);
		}
	});
