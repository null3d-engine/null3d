// Car paint on every tier: the paint tests of the image test manifest. Each part of the paint must
// change the image where it lies: the flakes, the panel seams and the carbon weave. This spec
// measures each part against the same body drawn without it, so it fails even before a test has
// references.
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

/** The pages that the test draws for each run: the paint and the body without each part. */
const PAGES_PER_RUN = 4;

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
	const sketch = 'car-paint-sketch.ts';
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

/** The number of pixels with a channel that is brighter by more than `step`. */
function brightened(a: Float32Array, b: Float32Array, step: number): number {
	let count = 0;
	for (let i = 0; i < a.length; i += 3) {
		let most = 0;
		for (let c = 0; c < 3; c++) {
			const d = (a[i + c] ?? 0) - (b[i + c] ?? 0);
			if (d > most) most = d;
		}
		if (most > step) count++;
	}
	return count;
}

test('car-paint: each part changes the image', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'car-paint');
	expect(runs.length).toBe(3);
	test.setTimeout(runs.length * PAGES_PER_RUN * PAGE_MS);
	for (const run of runs) {
		const painted = await imageOf(page, run.path);
		const plain = {
			flakes: await imageOf(page, variant(run.path, '?flakes=off')),
			seams: await imageOf(page, variant(run.path, '?seams=off')),
			weave: await imageOf(page, variant(run.path, '?weave=on')),
		};
		// The flakes glint where the sun's band crosses the body, the seams darken their grooves,
		// and the weave draws its twill with a highlight along the tows. Each changes a fair share
		// of the image, which a shader that skipped it would not. The flakes must also brighten
		// pixels: a model that only takes the smooth highlight away leaves every one of them
		// darker, which is the fault the glints were drawn to fix. Every GPU path of both sets
		// measures the flakes a mean channel difference of 0.00262 to 0.00267 and 0.01630 to
		// 0.01653 of the channels changing by more than 8 steps, with 217 to 232 pixels brighter,
		// the seams 0.00070 and 0.00343 to 0.00345, and the weave 0.01491 to 0.01504 and 0.12928
		// to 0.13030. Each floor is half the smallest of those figures, and a skipped part would
		// draw the plain body, so it fails by the whole floor.
		const parts = [
			['flakes', plain.flakes, 0.0013, 0.0081],
			['seams', plain.seams, 0.00035, 0.0017],
			['weave', plain.weave, 0.0074, 0.064],
		] as const;
		console.log(
			[
				`${run.id}:`,
				...parts.map(
					([part, without]) =>
						`${part} mean ${difference(painted, without).toFixed(5)} ` +
						`changed ${changed(painted, without, 8 / 255).toFixed(5)}`,
				),
				`glints ${brightened(painted, plain.flakes, 8 / 255)}`,
			].join(' '),
		);
		for (const [part, without, meanFloor, shareFloor] of parts) {
			expect
				.soft(difference(painted, without), `${run.id}: the ${part} change the image`)
				.toBeGreaterThan(meanFloor);
			expect
				.soft(changed(painted, without, 8 / 255), `${run.id}: the ${part} change many pixels`)
				.toBeGreaterThan(shareFloor);
		}
		expect
			.soft(brightened(painted, plain.flakes, 8 / 255), `${run.id}: the flakes glint`)
			.toBeGreaterThan(108);
	}
});
