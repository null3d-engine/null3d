// Facades on every tier: the rooms behind the add-on's windows. Each part of a room must change
// the image where it lies: the furniture, the blinds and the power-on wave. This spec measures
// each part against the same wall drawn without it, so it fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

/** The longest that one page may take to draw its image, for a custom shader's slow builds. */
const PAGE_MS = 120_000;

/** The pages that the test draws for each run: the wall and the same wall without each part. */
const PAGES_PER_RUN = 3;

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

/** The page of a run with `query` added to its sketch's address. */
function variant(path: string, query: string): string {
	const sketch = 'facades-sketch.ts';
	expect(path).toContain(sketch);
	return path.replace(sketch, `${sketch}${encodeURIComponent(query)}`);
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

test('facades: the furniture, the blinds and the wave change the image', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'facades');
	expect(runs.length).toBe(3);
	test.setTimeout(runs.length * PAGES_PER_RUN * PAGE_MS);
	for (const run of runs) {
		const room = await imageOf(page, run.path);
		const plain = {
			furniture: await imageOf(page, variant(run.path, '?furniture=off')),
			blinds: await imageOf(page, variant(run.path, '?blinds=off')),
			wave: await imageOf(page, variant(run.path, '?wave')),
		};
		// The furniture darkens the back of each room, the blinds draw their slats over the top of
		// some windows, and the wave leaves the windows that it has not reached dark. Each changes a
		// fair share of the image, which a shader that skipped it would not. The WebGPU tier measures
		// the furniture at 0.00423 mean and 0.02367 of the channels changing by more than 8 steps,
		// the blinds at 0.00653 and 0.05196, and the wave at 0.01910 and 0.10037. Each floor is half
		// of that, and a skipped part would draw the plain wall, so it fails by the whole floor.
		const parts = [
			['furniture', plain.furniture, 0.002, 0.011],
			['blinds', plain.blinds, 0.003, 0.026],
			['wave', plain.wave, 0.009, 0.05],
		] as const;
		console.log(
			[
				`${run.tier}:`,
				...parts.map(
					([name, other, , floor]) =>
						`${name} ${difference(room, other).toFixed(5)} mean, ${changed(room, other, 8 / 255).toFixed(5)} changed (floor ${floor})`,
				),
			].join(' '),
		);
		for (const [name, other, floorMean, floorChanged] of parts) {
			expect(difference(room, other), `${name} mean`).toBeGreaterThan(floorMean);
			expect(changed(room, other, 8 / 255), `${name} changed`).toBeGreaterThan(floorChanged);
		}
	}
});
