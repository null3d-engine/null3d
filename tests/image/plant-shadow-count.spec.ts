// The shadow redraw count: a still camera over a row of swaying plants. With a sway distance that
// reaches the row's far cascade, the plants' vertex offset marks that cascade moving and it redraws
// in every frame. With a distance shorter than the row, the cascade keeps its layer and takes only
// its scheduled turns. The two pages differ in the sway distance alone, so the difference in the
// measured draw calls is the far cascade's extra redraws.
//
// The count must be able to fail: the reaching page must draw more than the past-distance page, and
// both must draw something. A rule that never marked a cascade moving would draw both alike; a rule
// that marked every cascade moving would draw both alike as well.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

test.describe.configure({ mode: 'parallel' });

interface Percentiles {
	count: number;
	mean: number;
	median: number;
}

interface Result {
	error?: string;
	tier: string;
	preset: string;
	frames: number;
	drawCalls: Percentiles;
	triangles: Percentiles;
	built: { sway: number; wind: number; plants: number; distance: number } | null;
}

/** The longest that one page may take to draw and measure. */
const PAGE_MS = 300_000;

/** The row and the wind, which both pages share. */
const PLANTS = 12;
const WIND = 2;

/**
 * Frames that the measurement must hold. The far cascade draws its row every second frame at High,
 * so four frames sample two of its turns without depending on which frame the window starts on. A
 * software GPU drew three frames in its first twenty-four seconds, so the page grows its window to
 * sixty, and the wait covers the start plus every window the page tries before that.
 */
const REQUIRED_FRAMES = 4;

/** Opens the page at one sway distance and reads what it measured and built. */
async function measured(page: Page, gpu: string, sway: number): Promise<Result> {
	const query = new URLSearchParams({
		gpu,
		sway: String(sway),
		wind: String(WIND),
		plants: String(PLANTS),
		seconds: '3',
		frames: String(REQUIRED_FRAMES),
	});
	await page.goto(`plant-shadow.html?${query}`);
	const result = await pageResult<Result>(page, PAGE_MS);
	expect(result.error).toBeUndefined();
	expect(result.built, 'the sketch reports what it built').not.toBeNull();
	expect(result.built?.sway, 'the sketch used the distance it was given').toBe(sway);
	expect(result.built?.plants, 'the sketch placed the row it was given').toBe(PLANTS);
	expect(
		result.frames,
		'the measurement drew enough frames for the far cascade turns',
	).toBeGreaterThanOrEqual(REQUIRED_FRAMES);
	return result;
}

for (const gpu of ['webgpu', 'webgl2'] as const)
	test(`a plant past its sway distance leaves a far cascade cached on ${gpu}`, async ({ page }) => {
		test.setTimeout(2 * PAGE_MS);
		const reaching = await measured(page, gpu, 200);
		const past = await measured(page, gpu, 1);
		// The far cascade draws its row every second frame at High. A mover in it forces every
		// frame, so the reaching page owes about half the row's draw calls more than the past one.
		const extra = reaching.drawCalls.mean - past.drawCalls.mean;
		console.log(
			`${gpu}: reaching ${reaching.drawCalls.mean.toFixed(2)} draw calls a frame, past ${past.drawCalls.mean.toFixed(2)}, extra ${extra.toFixed(2)}`,
		);
		expect(past.drawCalls.mean, `${gpu}: the cached page draws`).toBeGreaterThan(0);
		expect(reaching.drawCalls.mean, `${gpu}: the reaching page draws`).toBeGreaterThan(0);
		expect(
			extra,
			`${gpu}: the far cascade redraws for a plant within its sway distance`,
		).toBeGreaterThan(2);
	});
