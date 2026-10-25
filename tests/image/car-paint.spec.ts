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

/**
 * The fewest pixels that a clustered light's glints must brighten. The paint's flakes must sparkle
 * under a point and a spot light as they do under the main light, so a lobe that answers the main
 * light alone leaves the body smooth and this count at zero. The flakes brighten 182 pixels under
 * the point light and 171 under the spot light on WebGPU, compatibility mode and WebGL2, so the
 * floor is a third of the smaller figure.
 */
const GLINT_FLOOR = 56;

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
		// The flakes glint where a light's band crosses the body, the seams darken their grooves,
		// and the weave draws its twill with a highlight along the tows. Each changes a fair share
		// of the image, which a shader that skipped it would not. The flakes must also brighten
		// pixels. That count is the only guard against a lobe that darkens without sparkling: the
		// mean and share floors below pass such a paint.
		// Each set's picture pairs measure the flakes a mean channel difference of 0.00472 to
		// 0.00474 and 0.02615 to 0.02626 of the channels changing by more than 8 steps, with 260 to
		// 263 pixels brighter, the seams 0.00071 and 0.00345 to 0.00348, and the weave 0.01437 and
		// 0.12380 to 0.12410. The flakes' figures rose from a mean of 0.00262 on 15 October 2026,
		// because the point light glints now as well as the sun. The part test's own runs measure
		// the same to within a step. Each floor is half the smallest of those figures, and a skipped
		// part would draw the plain body, so it fails by the whole floor.
		const parts = [
			['flakes', plain.flakes, 0.0023, 0.013],
			['seams', plain.seams, 0.00035, 0.0016],
			['weave', plain.weave, 0.0074, 0.063],
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
			.toBeGreaterThan(130);
	}
});

test('car-paint: the flakes glint under each clustered light', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'car-paint');
	expect(runs.length).toBe(3);
	// Three positions, each with the flakes and without them, on every tier: a bulb to the side, a
	// cone onto the body, and a bulb at the camera. The lamp at the camera sends its light back
	// along the view, so the lobe reads a half vector equal to the view, which is the grazing end of
	// the range. A light on the far side of the body is the case the half-vector guard exists for,
	// and no picture can show it: the two directions cancel exactly only along one line, which meets
	// a convex body at one point, and the engine's own base specular would draw a NaN there too.
	const lamps = ['point', 'spot', 'eye'];
	test.setTimeout(runs.length * lamps.length * 2 * PAGE_MS);
	for (const run of runs) {
		for (const lamp of lamps) {
			// The main light is out, so the clustered light alone lights the body. A lobe that
			// answers only the main light draws the two images the same, and the floor fails.
			const lit = await imageOf(page, variant(run.path, `?sun=off&lamp=${lamp}`));
			const plain = await imageOf(page, variant(run.path, `?sun=off&lamp=${lamp}&flakes=off`));
			const glints = brightened(lit, plain, 8 / 255);
			console.log(`${run.id} ${lamp}: glints ${glints}`);
			expect
				.soft(glints, `${run.id}: the flakes glint under the ${lamp} light`)
				.toBeGreaterThan(GLINT_FLOOR);
		}
	}
});
