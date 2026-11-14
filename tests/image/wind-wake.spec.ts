// The wind add-on's wake, measured rather than only looked at: air that a moving body pushed keeps
// a trail, so the cards behind it lean where the body passed. The same page with the pushes turned
// off is the control: it draws the same body in the same place, and its cards lean only with the
// ambient air. The pair gives the first its teeth.
//
// Both pages are held at the same sketch time. Hold mode steps the sketch's updates up to that
// time, and the field's pass runs with them, so the pushed page carries the trail its body made.
// A held picture keeps the test deterministic: two live pages draw a different number of frames on
// a busy machine, and a held page draws the same frames every time. Drawn twice with the pushes off
// on both pages, the three paths differ by 0.00000 of their channels, so the 0.05505 to 0.07955
// that the pushing pair measures is the trail and nothing else.
import { expect, type Page, test } from '@playwright/test';
import type { ImageRun } from '../lib/images.ts';
import { pageResult, watchPageProblems } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	width: number;
	height: number;
	pixels: string;
}

/** The longest that one page may take to draw its held frame. */
const PAGE_MS = 120_000;

/** The time that each page holds at, in seconds of sketch time. */
const HOLD_SECONDS = 1.2;

/** The page's size, as the manifest's wind pictures draw it. */
const SIZE = '480x270';

/** Each pixel's red, green and blue, from 0 to 1. */
async function imageOf(page: Page, address: string): Promise<Float32Array> {
	const problems = watchPageProblems(page);
	await page.goto(address);
	const frame = await pageResult<Frame>(page, PAGE_MS).catch((error: unknown) => {
		throw new Error(`${address}: ${String(error)}\n${problems.join('\n')}`);
	});
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

/**
 * The add-on's sketch held at the wake's time, with its body stopped a second in. `push` false asks
 * for the page that never shoves the air. The sketch reads its own switches from the query that the
 * page gives it, so they travel inside the page's `sketch` switch.
 */
function address(run: ImageRun, push: boolean): string {
	const query = new URLSearchParams();
	query.set('gpu', run.tier);
	query.set('hold', String(HOLD_SECONDS));
	query.set('preset', 'high');
	query.set('size', SIZE);
	for (const [name, value] of new URLSearchParams((run.mode?.query ?? '').replace(/^&/, '')))
		query.set(name, value);
	query.set('sketch', `/packages/wind/page/sketch.ts?camera=still&still=1${push ? '' : '&push=0'}`);
	return `/tests/pages/image.html?${query}`;
}

test('wind-wake: the air behind the body keeps the trail its pushes made', async ({ page }) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'wind-cards');
	expect(runs.length).toBeGreaterThan(0);
	test.setTimeout(runs.length * 2 * PAGE_MS);
	// Every run measures: no run is skipped, so a page that drew nothing cannot leave the test
	// green with no reading. The count says so if a later change adds a skip.
	let measured = 0;
	for (const run of runs) {
		const pushed = await imageOf(page, address(run, true));
		const control = await imageOf(page, address(run, false));
		// A one-step bar counts a card that leans one pixel further, which is what the trail does
		// to the cards that the body passed.
		const moved = changed(pushed, control, 1 / 255);
		measured++;
		console.log(`${run.id}: pushed ${moved.toFixed(5)}`);
		// The pushes change a share of the picture where the body passed and the air carried the
		// trail. A page that never pushed, or a flight that never rolled the pushes in, draws the
		// control's picture. With the pushes off on both pages the three paths measure 0.00000, and
		// with them on they measure 0.07940, 0.05505 and 0.07452 on this Mac's card and 0.07955,
		// 0.05506 and 0.07448 on its software GPU, so the floor sits under half of the smallest.
		expect
			.soft(moved, `${run.id}: the pushes leave air that reaches the cards`)
			.toBeGreaterThan(0.01);
	}
	expect(measured, `runs that measured the wake, of ${runs.length}`).toBe(runs.length);
});
