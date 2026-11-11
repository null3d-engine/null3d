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

for (const name of [
	'reflection-mirror',
	'reflection-water',
	'reflection-quarter',
	'reflection-scale-50',
	'reflection-batches',
])
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

/**
 * A panel in the sky reads the reflection's texture, as the floor does. The reflection view must
 * leave that panel out: a view that drew it would sample the texture that it is drawing in the same
 * frame, which is a feedback loop, and WebGPU refuses it as a validation error. The test draws the
 * frame with the panel and without it, and requires the panel to show in the sky, no page or
 * console error, and no strong mark in the floor. A panel's presence moves a few pixels of the
 * sphere's shading by up to 14 levels, even when the panel is off screen, so the floor check counts
 * only a strong change, such as the panel's own color reflected in the plane.
 */
const SELF_SKETCH = '/tests/pages/sketches/reflection-sketch.ts';
/** The share of the image's height that holds only sky, above the plane's horizon. */
const SKY_SHARE = 0.2;
/** The share below which the plane shows, and holds every reflection. */
const FLOOR_SHARE = 0.4;
/** The least change in a channel that counts as a different pixel. */
const STEP = 2;
/** The change in a channel that a surface's own picture makes, such as feedback's color. */
const FEEDBACK_STEP = 40;
/** The least count of changed sky pixels that shows the panel drew at all. */
const PANEL_PIXELS = 50;

/** The image page's address for the reflection sketch with the panel, or without it. */
function selfPath(tier: string, panel: boolean): string {
	const sketch = encodeURIComponent(`${SELF_SKETCH}?self${panel ? '' : '&panel=0'}`).replaceAll(
		'%2F',
		'/',
	);
	// FXAA keeps compatibility mode on HDR color, which is where a reflection view draws into its
	// own target. The default anti-aliasing there multisamples an 8-bit target and keeps the copy.
	return `/tests/pages/image.html?gpu=${tier}&hold=0&preset=high&antialias=fxaa&size=320x180&sketch=${sketch}`;
}

async function selfFrame(page: Page, tier: string, panel: boolean): Promise<Image> {
	await page.goto(selfPath(tier, panel));
	const frame = await pageResult<Frame>(page, 90_000);
	expect.soft(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	return { width: frame.width, height: pixels.length / 4 / frame.width, pixels };
}

for (const tier of ['webgpu', 'compat', 'webgl2'] as const)
	test(`${tier}: the reflection view leaves out a surface that reads its texture`, async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		page.on('console', (message) => {
			if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
				errors.push(message.text());
		});
		const drawn = await selfFrame(page, tier, true);
		const plain = await selfFrame(page, tier, false);
		expect(drawn.height).toBe(plain.height);
		const sky = Math.floor(drawn.height * SKY_SHARE);
		const floor = Math.floor(drawn.height * FLOOR_SHARE);
		let panel = 0;
		let feedback = 0;
		for (let row = 0; row < drawn.height; row++)
			for (let column = 0; column < drawn.width; column++) {
				const at = 4 * (row * drawn.width + column);
				const step = Math.max(
					Math.abs((drawn.pixels[at] ?? 0) - (plain.pixels[at] ?? 0)),
					Math.abs((drawn.pixels[at + 1] ?? 0) - (plain.pixels[at + 1] ?? 0)),
					Math.abs((drawn.pixels[at + 2] ?? 0) - (plain.pixels[at + 2] ?? 0)),
				);
				if (step <= STEP) continue;
				if (row < sky) panel++;
				else if (row >= floor && step > FEEDBACK_STEP) feedback++;
			}
		expect(panel, 'the panel drew in the sky').toBeGreaterThan(PANEL_PIXELS);
		expect(feedback, 'the panel left a strong mark in the floor, so the mirror drew it').toBe(0);
		expect(errors).toEqual([]);
	});
