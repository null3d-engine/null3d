// The wind add-on's wake, measured rather than only looked at: air that a moving body pushed keeps
// a trail, so the cards behind it lean where the body passed. The same page with the pushes turned
// off is the control: it draws the same body in the same place, and its cards lean only with the
// ambient air. The pair gives the first its teeth.
//
// A held frame cannot show this. Hold mode draws one frame and never runs a sketch's update, so the
// body never moves and never pushes. The page therefore runs live to the capture time, and the
// engine reads its frame back through `captureFrame`.
import { expect, type Page, test } from '@playwright/test';
import type { ImageRun } from '../lib/images.ts';
import { pageResult } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** The longest that one page may take to reach its capture time and draw it. */
const PAGE_MS = 120_000;

/** The time that each page runs to before it captures, in seconds of sketch time. */
const CAPTURE_SECONDS = 1.2;

/** Each pixel's red, green and blue, from 0 to 1. */
async function imageOf(page: Page, address: string): Promise<Float32Array> {
	await page.goto(address);
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

/** The add-on's own page at the run's tier and thread mode, live until it captures its frame. */
function address(run: ImageRun, push: boolean): string {
	const query = new URLSearchParams();
	query.set('gpu', run.tier);
	query.set('preset', 'high');
	query.set('capture', String(CAPTURE_SECONDS));
	query.set('still', '1');
	query.set('camera', 'still');
	if (!push) query.set('push', '0');
	const modes = new URLSearchParams((run.mode?.query ?? '').replace(/^&/, ''));
	for (const [name, value] of modes) query.set(name, value);
	return `/packages/wind/page/index.html?${query}`;
}

test('wind-wake: the air behind the body keeps the trail its pushes made', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'wind-cards');
	expect(runs.length).toBeGreaterThan(0);
	test.setTimeout(runs.length * 4 * PAGE_MS);
	for (const run of runs) {
		const pushed = await imageOf(page, address(run, true));
		const control = await imageOf(page, address(run, false));
		const moved = changed(pushed, control, 8 / 255);
		console.log(`${run.id}: pushed ${moved.toFixed(5)}`);
		// The pushes change a share of the picture where the body passed and the air carried the
		// trail. A page that never pushed, or a flight that never rolled the pushes in, draws the
		// control's picture.
		expect
			.soft(moved, `${run.id}: the pushes leave air that reaches the cards`)
			.toBeGreaterThan(0.005);
	}
});
