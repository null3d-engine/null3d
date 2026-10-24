// Screen-space bounce light's colour bleed, on both GPU paths. The bounce tests' scene has a
// neutral floor beside a red wall. With the bounce on, the floor takes the wall's red, so the
// image gains red where it changes. The references alone would hold a wrong picture, so this spec
// computes the change from the scene without the bounce and requires it to be red: more red than
// green in the pixels that the bounce changed, over a meaningful share of the image.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

/** The image with the bounce on, and the scene without it. */
const BOUNCED = 'bounce-default';
const PLAIN = 'bounce-off';

/** A pixel counts as changed when its red rises by more than this many levels of 255. */
const CHANGED = 4;

/** The least share of the image that the bounce must change. */
const SHARE = 0.005;

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

/** The mean rise of each channel over the pixels whose red rose by more than `CHANGED`. */
function bleed(
	plain: Image,
	bounced: Image,
): { share: number; red: number; green: number; blue: number } {
	const { width, height } = bounced;
	let count = 0;
	let [red, green, blue] = [0, 0, 0];
	for (let i = 0; i < width * height; i++) {
		const at = 4 * i;
		const rise = (bounced.pixels[at] ?? 0) - (plain.pixels[at] ?? 0);
		if (rise <= CHANGED) continue;
		count += 1;
		red += rise;
		green += (bounced.pixels[at + 1] ?? 0) - (plain.pixels[at + 1] ?? 0);
		blue += (bounced.pixels[at + 2] ?? 0) - (plain.pixels[at + 2] ?? 0);
	}
	return {
		share: count / (width * height),
		red: red / Math.max(1, count),
		green: green / Math.max(1, count),
		blue: blue / Math.max(1, count),
	};
}

for (const tier of ['webgpu', 'webgl2'])
	test(`the bounce tints the floor with the red wall on ${tier}`, async ({ page }) => {
		test.setTimeout(180_000);
		const runOf = (name: string) => {
			const run = IMAGE_RUNS.find((r) => r.test === name && r.tier === tier);
			if (!run) throw new Error(`the manifest has no ${name} run on ${tier}`);
			return run;
		};
		const plain = await imageOf(page, runOf(PLAIN).path);
		const bounced = await imageOf(page, runOf(BOUNCED).path);
		expect([bounced.width, bounced.height]).toEqual([plain.width, plain.height]);
		const change = bleed(plain, bounced);
		console.log(`bounce bleed on ${tier}: ${JSON.stringify(change)}`);
		expect(change.share).toBeGreaterThan(SHARE);
		expect(change.red).toBeGreaterThan(change.green + 2);
		expect(change.red).toBeGreaterThan(change.blue + 2);
	});
