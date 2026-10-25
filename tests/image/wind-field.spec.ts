// The wind add-on's field, measured rather than only looked at: a gust that crosses a field of
// cards must move them between two held times, and the same page with the gust and the swirl taken
// out must leave them where they were. The second pair gives the first its teeth. A card material
// that ignored the field would fail the first pair, and a field frozen by a fault would fail it too.
import { expect, type Page, test } from '@playwright/test';
import type { ImageRun } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	pixels: string;
}

/** The longest that one page may take to draw its image, for the field's first shader builds. */
const PAGE_MS = 120_000;

/** The pages that the test draws for each run: two times, with the gust and without it. */
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

/** The share of channels that differ by more than `step`. */
function changed(a: Float32Array, b: Float32Array, step: number): number {
	let count = 0;
	for (let k = 0; k < a.length; k++) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > step) count++;
	return count / a.length;
}

/** The run of `name` on the same tier and thread mode as `run`. */
function pair(name: string, run: ImageRun): ImageRun {
	const found = IMAGE_RUNS.find(
		(other) => other.test === name && other.tier === run.tier && other.mode === run.mode,
	);
	expect(found, `the manifest holds ${name} for ${run.tier}`).toBeDefined();
	return found as ImageRun;
}

/**
 * The same page as `run`, held at another time and, when asked, with the field frozen. The sketch
 * reads its switches from its own address, so the page's sketch switch takes them after a query
 * mark that the switch value encodes. A sketch that already has one takes the mark for a second.
 */
function variant(run: ImageRun, hold: number, frozen: boolean): string {
	const timed = run.path.replace(/hold=[0-9.]+/, `hold=${hold}`);
	if (!frozen) return timed;
	return timed.replace(/sketch=([^&]+)/, (_match, sketch: string) =>
		sketch.includes('%3F') ? `sketch=${sketch}%26frozen%3D1` : `sketch=${sketch}%3Ffrozen%3D1`,
	);
}

test('wind-field: a gust moves the cards, and a frozen field does not', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'wind-cards');
	expect(runs.length).toBeGreaterThan(0);
	test.setTimeout(runs.length * PAGES_PER_RUN * PAGE_MS);
	for (const run of runs) {
		const moved = changed(
			await imageOf(page, run.path),
			await imageOf(page, pair('wind-cards-later', run).path),
			8 / 255,
		);
		const frozen = changed(
			await imageOf(page, variant(run, 1, true)),
			await imageOf(page, variant(run, 1.6, true)),
			8 / 255,
		);
		console.log(`${run.id}: moved ${moved.toFixed(5)} frozen ${frozen.toFixed(5)}`);
		// A gust that crosses the field moves a fair share of the cards, while the frozen page
		// holds its camera and its body still and cannot move one. The moving pair must change far
		// more than the frozen pair, so a field that stopped moving between the two times fails
		// here even if some pixels changed for another reason.
		// On 26 October 2026 the three tiers measured 0.11657, 0.11450 and 0.11235 of the channels
		// changed, against 0 on the frozen pair, so the floor is under half of the smallest.
		expect.soft(moved, `${run.id}: the gust moves the cards`).toBeGreaterThan(0.05);
		expect.soft(frozen, `${run.id}: a frozen field leaves the cards`).toBeLessThan(0.005);
		expect
			.soft(moved, `${run.id}: the gust moves far more than a frozen field`)
			.toBeGreaterThan(frozen * 4 + 0.01);
	}
});
