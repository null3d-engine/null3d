// Screen-space reflections on a steel floor that reflects no environment, on every tier: the ssr
// tests of the image test manifest. A trace that misses, a reprojection into the wrong place or a
// reflection read upside down still draws a plausible picture, which a new reference could take in.
// This spec checks that each box's reflection hangs below it on its own side, that the floor shows
// none without the reflections, and that a planar reflection on the floor's left half keeps the red
// box's reflection there. So it fails even before a test has references.
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
	red: ([r, g, b]: Rgb) => r > g + 50 && r > b + 50,
	green: ([r, g, b]: Rgb) => g > r + 35 && g > b + 35,
} as const;

/** The row of the image below which only the floor shows: the boxes' front edges end above it. */
const FEET = 182;

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

/** The runs of a test of the manifest, one per tier. */
function runsOf(name: string) {
	const runs = IMAGE_RUNS.filter((run) => run.test === name);
	expect(runs.length).toBe(3);
	return runs;
}

for (const name of [
	'ssr-floor',
	'ssr-quarter',
	'ssr-scale-50',
	'ssr-ao',
	'ssr-planar',
	'ssr-glass',
])
	test(`${name}: each box's reflection hangs below it on its own side`, async ({ page }) => {
		test.setTimeout(180_000);
		for (const run of runsOf(name)) {
			const image = await imageOf(page, run.path);
			const boxes = (['red', 'green'] as const).map((color) => ({
				color,
				box: centerOf(image, color, 0, FEET),
				reflection: centerOf(image, color, FEET, image.height),
			}));
			for (const { color, box, reflection } of boxes) {
				expect(box && reflection, `${run.id}: the ${color} box and its reflection`).toBeTruthy();
				if (!box || !reflection) continue;
				expect
					.soft(Math.abs(reflection.x - box.x), `${run.id}: the ${color} reflection on its side`)
					.toBeLessThan(16);
				expect
					.soft(reflection.count, `${run.id}: the ${color} reflection's size`)
					.toBeGreaterThan(box.count / 8);
			}
			const [red, green] = boxes;
			if (red?.reflection && green?.reflection)
				expect
					.soft(red.reflection.x < green.reflection.x, `${run.id}: red left of green`)
					.toBe(true);
		}
	});

test('ssr-off: without the reflections the floor shows no box', async ({ page }) => {
	test.setTimeout(120_000);
	for (const run of runsOf('ssr-off')) {
		const image = await imageOf(page, run.path);
		for (const color of ['red', 'green'] as const) {
			expect.soft(centerOf(image, color, 0, FEET), `${run.id}: the ${color} box`).toBeTruthy();
			const reflection = centerOf(image, color, FEET, image.height);
			expect.soft(reflection?.count ?? 0, `${run.id}: a ${color} reflection`).toBeLessThan(20);
		}
	}
});
