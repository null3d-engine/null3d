// The plant core's sway, measured rather than only looked at: a plant of the vegetation add-on held
// at two times under the wind add-on's field moves its own vertices, and the same plant under the
// same field, past a one millimetre sway distance, stays where it was. The plant's materials carry
// the vertex offset, which moves the wood, the shoot rows, the leaves and the cards of one plant;
// the offset fades to nothing at its sway distance. The short-distance twin gives the first its
// teeth: a material that ignored the field would fail the moving pair, and a scene that moved for
// another reason would fail the control.
//
// Both pages are held at the same times. Hold mode steps the sketch's updates up to that time and
// the field's pass runs with them, so a held page draws the same frames every time; two live pages
// on a busy machine would not. The control page makes the same field, but its materials fade the
// offset out at one millimetre, so the plant cannot move.
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
const PAGE_MS = 240_000;

/** The two sketch times, in seconds, that every page is held at. */
const EARLY = 1;
const LATE = 1.6;

/**
 * How far a channel must differ to count as moved: one step of 255, so a change of two steps
 * counts and the rounding of one step does not.
 */
const STEP = 2 / 255;

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

/** The run's page held at another sketch time. */
function at(run: ImageRun, hold: number): string {
	return run.path.replace(/hold=[0-9.]+/, `hold=${hold}`);
}

/** The run of `name` on the same tier and thread mode as `run`. */
function pair(name: string, run: ImageRun): ImageRun {
	const found = IMAGE_RUNS.find(
		(other) => other.test === name && other.tier === run.tier && other.mode === run.mode,
	);
	expect(found, `the manifest holds ${name} for ${run.tier}`).toBeDefined();
	return found as ImageRun;
}

test('plant-sway: a plant under the field moves between two held times, and its short-distance twin holds still', async ({
	page,
}) => {
	const runs = IMAGE_RUNS.filter((run) => run.test === 'plant-wind-sway');
	expect(runs.length).toBeGreaterThan(0);
	// Four drawings a run: the swaying plant at both times and the still plant at both times.
	test.setTimeout(runs.length * 4 * PAGE_MS);
	let measured = 0;
	for (const run of runs) {
		const still = pair('plant-wind-still', run);
		const early = await imageOf(page, at(run, EARLY));
		const late = await imageOf(page, at(run, LATE));
		const earlyStill = await imageOf(page, at(still, EARLY));
		const lateStill = await imageOf(page, at(still, LATE));
		const moved = changed(early, late, STEP);
		const control = changed(earlyStill, lateStill, STEP);
		// The field's own offset at the first time, against the plant past the one millimetre distance.
		const field = changed(early, earlyStill, STEP);
		measured++;
		console.log(
			`${run.id}: moved ${moved.toFixed(5)} control ${control.toFixed(5)} field ${field.toFixed(5)}`,
		);
		// A plant whose materials read the field moves a fair share of its own pixels between the
		// two times. A material that ignored the field would draw the control's picture.
		expect.soft(moved, `${run.id}: the plant sways between the two times`).toBeGreaterThan(0.002);
		// The short-distance page steps the same times and draws the same static plant, so it cannot move.
		expect.soft(control, `${run.id}: the plant past the distance holds still`).toBeLessThan(0.0005);
		// The field moves the plant at one time as well, so the pair above is not the only evidence.
		expect.soft(field, `${run.id}: the field moves the plant at one time`).toBeGreaterThan(0.002);
		// The moving pair must change far more than the control, so a sway that froze between the
		// two times fails here even if some pixels changed for another reason.
		expect
			.soft(moved, `${run.id}: the sway moves far more than the still page`)
			.toBeGreaterThan(control * 4 + 0.001);
	}
	expect(measured, `runs that measured the sway, of ${runs.length}`).toBe(runs.length);
});
