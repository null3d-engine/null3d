// A gust that Creek's address sends, measured rather than only looked at: the page sends the gust
// at a fixed sketch time from the camera's place, and the readers of the wind field bend where its
// wave reaches them. The twin page is the same scene with no gust switch, held at the same time and
// with the same switches, so the only difference between the pair is the sent gust. The sketch
// reports the send in its result, so a page that never sent one fails before the pixels are read.
//
// The picture draws on WebGL2's 8-bit path, where the field keeps no grid. Every reader then works
// the air out from the steady field, which carries the sent gust's place, strength and birth, so the
// measured move proves that the steady field's gust reaches the readers. The camera route is a
// function of the sketch time and hold mode steps it at fixed steps, so the place is fixed too.
import { expect, type Page, test } from '@playwright/test';
import { type Environment, environmentNamed, type ImageRun, runIn } from '../lib/images.ts';
import { pageResult, watchPageProblems } from '../lib/page-result.ts';
import { IMAGE_RUNS } from './manifest.ts';

test.describe.configure({ mode: 'parallel' });

interface Frame {
	error?: string;
	sketch?: { gust?: { at: number; strength: number; place: readonly number[] } };
	width: number;
	height: number;
	pixels: string;
}

interface Drawing {
	frame: Frame;
	rgb: Float32Array;
}

/** The sketch time when the address sends the gust, in seconds, as its query names it. */
const GUST_AT = 8.4;
/** The strength that the address names. */
const GUST_STRENGTH = 10;
/** The hold after the send. It is a whole number of hold mode's steps. */
const AFTER = 9;

/**
 * How far a channel must differ to count as moved: two steps of 255, so the rounding of one step
 * does not count.
 */
const STEP = 2 / 255;

/**
 * The least share of channels that the sent gust must move. The run recorded beside the test reads
 * about 0.32 on the Mac's GPU and 0.35 on its software GPU, so the floor sits well below the
 * smaller of the two while a page that sends no gust still fails.
 */
const LEAST_MOVED = 0.05;

/** Each pixel's red, green and blue, from 0 to 1, and the frame's own result. */
async function imageOf(page: Page, address: string, timeoutMs: number): Promise<Drawing> {
	const problems = watchPageProblems(page);
	await page.goto(address);
	const frame = await pageResult<Frame>(page, timeoutMs).catch((error: unknown) => {
		throw new Error(`${address}: ${String(error)}\n${problems.join('\n')}`);
	});
	expect(frame.error).toBeUndefined();
	const pixels = new Uint8Array(Buffer.from(frame.pixels, 'base64'));
	const rgb = new Float32Array((pixels.length / 4) * 3);
	for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3)
		for (let c = 0; c < 3; c++) rgb[j + c] = (pixels[i + c] ?? 0) / 255;
	return { frame, rgb };
}

/** The share of channels that differ by more than `step`. */
function changed(a: Float32Array, b: Float32Array, step: number): number {
	let count = 0;
	for (let k = 0; k < a.length; k++) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > step) count++;
	return count / a.length;
}

/**
 * The image page's address for Creek at the held time, with the address's gust or without it. The
 * run's switches carry the tier, the preset and the software GPU's lighter load, so the pair
 * differs by the gust alone.
 */
function address(run: ImageRun, environment: Environment, gust: boolean): string {
	const url = new URL(runIn(run, environment).path, 'http://localhost');
	url.searchParams.set('hold', String(AFTER));
	url.searchParams.set(
		'sketch',
		`/examples/showcase/creek/sketch.ts${gust ? `?gust=${GUST_STRENGTH}&gust-at=${GUST_AT}` : ''}`,
	);
	return `${url.pathname}${url.search}`;
}

test('creek-gust: a gust that Creek sends bends the air its readers sample', async ({
	page,
}, testInfo) => {
	const environment = environmentNamed(testInfo.project.name);
	const runs = IMAGE_RUNS.filter((run) => run.test === 'creek-gust');
	expect(runs.length).toBeGreaterThan(0);
	// Two drawings a run: the page that sends the gust and its twin that never sends one.
	test.setTimeout(runs.length * 2 * 630_000);
	let measured = 0;
	for (const run of runs) {
		const pageMs = (run.timeoutSeconds + 30) * 1000;
		const gust = await imageOf(page, address(run, environment, true), pageMs);
		const control = await imageOf(page, address(run, environment, false), pageMs);
		// The sketch reports the send, at the fixed time and strength that the address names.
		const sent = gust.frame.sketch?.gust;
		expect(sent, `${run.id}: the page sent the gust after its time`).toBeDefined();
		expect(sent?.at, `${run.id}: the send lands at the fixed time`).toBeCloseTo(GUST_AT, 6);
		expect(sent?.strength, `${run.id}: the send takes the address's strength`).toBe(GUST_STRENGTH);
		expect(control.frame.sketch?.gust, `${run.id}: the control sends no gust`).toBeUndefined();
		const moved = changed(gust.rgb, control.rgb, STEP);
		measured++;
		console.log(`${run.id}: moved ${moved.toFixed(5)}`);
		// The readers sample the air that the gust turned, so a fair share of the frame moves. A
		// page that never sent the gust draws the control's picture, and the witness above fails.
		expect
			.soft(moved, `${run.id}: the sent gust moves the air the readers sample`)
			.toBeGreaterThan(LEAST_MOVED);
	}
	expect(measured, `runs that measured the gust, of ${runs.length}`).toBe(runs.length);
});
