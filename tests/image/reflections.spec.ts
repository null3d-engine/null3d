// A reflection pass mirrors the camera's view across a plane and clips what lies below it, on every
// tier: the reflection tests of the image test manifest. A mirror that the pass draws upside down,
// unmirrored or with the wrong side clipped still draws a plausible picture, which a new reference
// could take in. This spec checks where the boxes' reflections land, and that the magenta box
// below the plane never shows, so it fails even before a test has references.
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

/**
 * The colors that the spec looks for, by the channels that lead in each. The reflections take the
 * floor's tint and the tone curve, so the tests ask for a lead, not a pure color.
 */
const COLORS = {
	red: ([r, g, b]: Rgb) => r > g + 60 && r > b + 60,
	green: ([r, g, b]: Rgb) => g > r + 40 && g > b + 40,
	magenta: ([r, g, b]: Rgb) => r > g + 60 && b > g + 60,
} as const;

/** The row of the image under which the floor shows the boxes' reflections, at the boxes' feet. */
const FEET = 104;

async function imageOf(page: Page, path: string): Promise<Image> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, 60_000);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	return { width: frame.width, height: pixels.length / 4 / frame.width, pixels };
}

/**
 * The middle of the pixels of a color between rows `top` and `bottom`, with their count, or
 * undefined for none.
 */
function centerOf(
	image: Image,
	color: keyof typeof COLORS,
	top: number,
	bottom: number,
): { x: number; y: number; count: number } | undefined {
	let [x, y, count] = [0, 0, 0];
	for (let row = top; row < bottom; row++)
		for (let column = 0; column < image.width; column++) {
			const i = 4 * (row * image.width + column);
			const pixel: Rgb = [image.pixels[i] ?? 0, image.pixels[i + 1] ?? 0, image.pixels[i + 2] ?? 0];
			if (!COLORS[color](pixel)) continue;
			x += column;
			y += row;
			count++;
		}
	return count > 0 ? { x: x / count, y: y / count, count } : undefined;
}

for (const name of ['reflection-mirror', 'reflection-water', 'reflection-quarter'])
	test(`${name}: the reflection hangs below each box on its own side, and nothing below the plane shows`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const runs = IMAGE_RUNS.filter((run) => run.test === name);
		expect(runs.length).toBe(3);
		for (const run of runs) {
			const image = await imageOf(page, run.path);
			const below = image.height;
			const magenta = centerOf(image, 'magenta', 0, below);
			expect.soft(magenta, `${run.id}: the box below the plane shows`).toBeUndefined();
			const boxes = (['red', 'green'] as const).map((color) => ({
				color,
				box: centerOf(image, color, 0, FEET),
				reflection: centerOf(image, color, FEET, below),
			}));
			for (const { color, box, reflection } of boxes) {
				expect(box && reflection, `${run.id}: the ${color} box and its reflection`).toBeTruthy();
				if (!box || !reflection) continue;
				expect
					.soft(Math.abs(reflection.x - box.x), `${run.id}: the ${color} reflection on its side`)
					.toBeLessThan(12);
				// Water reflects a few percent of the light at these angles, so fewer of its pixels take
				// the box's color than a mirror's do.
				const share = name === 'reflection-water' ? 1 / 4 / 4 : 1 / 4;
				expect
					.soft(reflection.count, `${run.id}: the ${color} reflection's size`)
					.toBeGreaterThan(box.count * share);
			}
			const [red, green] = boxes;
			if (red?.reflection && green?.reflection)
				expect
					.soft(red.reflection.x < green.reflection.x, `${run.id}: red left of green`)
					.toBe(true);
		}
	});
