// The cloud tier's step count must move the picture. The references of clouds-volume and
// clouds-ultra differ by less than the comparison's threshold, so a comparison of the two pictures
// would pass even if the engine drew the High tier's 32 steps for both. This spec draws both counts
// on each GPU path and measures the change itself, so the Ultra tier fails before any reference
// exists if its march does not differ from the High tier's.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

/** The longest that one page may take to draw its image, for a slow software GPU. */
const PAGE_MS = 180_000;

/**
 * The least mean difference of color per channel, and the least share of channels that must move,
 * between the two step counts. Both floors are half of the smallest figures that a Mac and CI's
 * software GPU measured, as the car paint spec sets its floors, so a tier that drew the cheaper
 * march fails by the whole floor.
 */
const LEAST_MEAN = 0.002;
const LEAST_CHANGED = 0.02;

/** Each pixel's red, green and blue, from 0 to 1. */
async function imageOf(page: Page, path: string): Promise<Float32Array> {
	await page.goto(path);
	const frame = await pageResult<Frame>(page, PAGE_MS);
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return rgb;
}

/** The mean difference of color between two images, from 0 to 1 per channel. */
function difference(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let k = 0; k < a.length; k++) sum += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
	return sum / a.length;
}

/** The share of channels that differ by more than `step`. */
function changed(a: Float32Array, b: Float32Array, step: number): number {
	let count = 0;
	for (let k = 0; k < a.length; k++) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > step) count++;
	return count / a.length;
}

test('clouds-steps: the Ultra tier draws a finer march than the High tier', async ({ page }) => {
	const high = IMAGE_RUNS.filter((run) => run.test === 'clouds-volume');
	const ultra = IMAGE_RUNS.filter((run) => run.test === 'clouds-ultra');
	expect(high).toHaveLength(3);
	expect(ultra).toHaveLength(3);
	test.setTimeout(high.length * 2 * PAGE_MS);
	for (const run of high) {
		const finer = ultra.find((other) => other.tier === run.tier);
		expect(finer, `an Ultra page on ${run.tier}`).toBeDefined();
		const at32 = await imageOf(page, run.path);
		const at48 = await imageOf(page, (finer as (typeof ultra)[number]).path);
		expect(at48.length).toBe(at32.length);
		const mean = difference(at32, at48);
		// A step of one level of 255 is well under the comparison's threshold, so this counts a
		// change that the image tests' own tolerance would hide.
		const share = changed(at32, at48, 1 / 255);
		console.log(
			`CLOUDSTEPS ${run.tier}: mean ${mean.toFixed(5)}, changed by a step ${share.toFixed(5)}`,
		);
		expect(mean).toBeGreaterThan(LEAST_MEAN);
		expect(share).toBeGreaterThan(LEAST_CHANGED);
	}
});
