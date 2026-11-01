// The boats' reflections in the island's harbour hold still from frame to frame: a ripple finer than
// a pixel would bend each pixel's reflection its own way, and thin masts would break into dashes that
// change every frame. Each case draws the harbour at two moments one frame apart, in the route's low
// pass over it, and compares the water at the bottom of the frame.
import { expect, type Page, test } from '@playwright/test';
import { differentShare } from '../lib/images.ts';

/** The route's time over the harbour, in seconds, and one frame later. */
const HOLDS = [24, 24 + 1 / 60];
/** The picture's size, and the rows at its bottom that show only water and boats. */
const [WIDTH, HEIGHT] = [640, 360];
const WATER_ROWS = 50;
/** How far a color channel may move in a frame, out of 255, before the pixel counts as changed. */
const CHANNEL = 24;
/** The share of the water's pixels that may change: about 1 per cent do, and 2 did with the fine ripples. */
const MAX_CHANGED = 0.015;

/** The water's rows of the harbour's held frame at a time. */
async function water(page: Page, query: string, hold: number): Promise<Uint8Array> {
	await page.goto(
		`image.html?${query}&hold=${hold}&preset=high&size=${WIDTH}x${HEIGHT}&moments=on&sketch=/examples/showcase/island/sketch.ts`,
	);
	await page.waitForFunction('globalThis.__null3dHold !== undefined', undefined, {
		timeout: 120_000,
	});
	const rows = await page.evaluate(
		([width, height, count]) => {
			const held = (globalThis as Record<string, unknown>).__null3dHold as {
				ok: boolean;
				error?: string;
				pixels: Uint8Array;
			};
			if (!held.ok) throw new Error(held.error);
			return Array.from(held.pixels.subarray((height - count) * width * 4));
		},
		[WIDTH, HEIGHT, WATER_ROWS] as const,
	);
	return Uint8Array.from(rows);
}

for (const [path, query] of [
	['WebGPU', 'gpu=webgpu'],
	['WebGL2', 'gpu=webgl2'],
] as const)
	test(`the harbour's reflections hold still from frame to frame on ${path}`, async ({ page }) => {
		// Each of the two held frames may take its own wait on a software GPU.
		test.setTimeout(300_000);
		const [a, b] = [
			await water(page, query, HOLDS[0] as number),
			await water(page, query, HOLDS[1] as number),
		];
		const changed = differentShare(a, b, CHANNEL);
		console.log(`changed ${path}: ${changed.toFixed(4)}`);
		expect(changed).toBeLessThan(MAX_CHANGED);
	});
