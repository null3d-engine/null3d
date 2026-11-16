// Clear coats and sheens on every tier: the layers tests of the image test manifest. A material
// whose layers are turned off must draw as a material without them, and turned on they must
// change the image where they lie. This spec measures both against the same scene drawn another
// way, so it fails even before a test has references.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import { failureText, type ItemResult } from '../lib/runs.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

/** The longest that one page may take to draw its image, long for a software GPU's slow builds. */
const PAGE_MS = 60_000;

/** The pages that the test draws for each run: with the layers, turned off, and without them. */
const PAGES_PER_RUN = 3;

/** Each pixel's red, green and blue, from 0 to 1. */
async function imageOf(page: Page, path: string): Promise<Float32Array> {
	await page.goto(path);
	const frame = await pageResult<Frame & ItemResult>(page, PAGE_MS);
	expect(frame.error, failureText(frame)).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return rgb;
}

/** The page of a run with `query` added to its sketch's address. */
function variant(path: string, query: string): string {
	const sketch = 'coat-sheen-sketch.ts';
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

test('coat-sheen: turned off they draw as none, and turned on they change the image', async ({
	page,
}) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'coat-sheen');
	expect(runs.length).toBe(3);
	test.setTimeout(runs.length * PAGES_PER_RUN * PAGE_MS);
	for (const run of runs) {
		const layered = await imageOf(page, run.path);
		const off = await imageOf(page, variant(run.path, '?off'));
		const none = await imageOf(page, variant(run.path, '?none'));
		// A coat of 0 and a black sheen leave the base as it is, within a step of 8-bit color.
		expect
			.soft(changed(off, none, 1.5 / 255), `${run.id}: layers turned off draw as none`)
			.toBeLessThan(0.0005);
		// The coats' highlights and reflections, and the sheens' glow, change a fair share of the
		// image, which a shader that skipped them would not. The tone curve keeps that change in the
		// mid-tones: the layers measure a mean channel difference of 0.00905 to 0.00916, and 0.0505
		// to 0.0506 of the channels changing by more than 8 steps, on every GPU path of both sets.
		// Each floor is half the smallest of those figures, and a shader that skipped the layers
		// would draw two identical images, so it fails both by the whole floor.
		expect
			.soft(difference(layered, off), `${run.id}: the layers change the image`)
			.toBeGreaterThan(0.004);
		expect
			.soft(changed(layered, off, 8 / 255), `${run.id}: the layers change many pixels`)
			.toBeGreaterThan(0.025);
	}
});
