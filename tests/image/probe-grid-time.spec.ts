// A probe grid baked once under an afternoon sky must follow the sky as night falls, with no new
// bake. The page bakes the grid in its setup, captures the floor's light, turns the day to night,
// and captures it again over the frames that the sky map takes to refresh. A grid that baked the
// sky into its probes would keep the afternoon's light, so the floor would hardly move; a grid
// whose sky term is the live sky's color follows it. The two skies lie far apart, so the test
// reads a settled night against a settled day rather than one frame against the next.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Frame {
	since: number;
	floor: number[];
}

/** The GPU tiers and the name that each reports. */
const TIERS = { webgpu: 'webgpu', compat: 'webgpu-compat', webgl2: 'webgl2' } as const;
/** How many levels of 255 the floor's red must fall by from day to night. */
const DARKER = 30;
/** How far a color may stray between frames of one settled side, in levels of 255. */
const NEAR = 6;
/** The last captures, which the sky has settled within. */
const SETTLED = 5;

/** The largest difference between two colors' channels. */
const distance = (a: number[], b: number[]) =>
	Math.max(...a.map((value, c) => Math.abs(value - (b[c] as number))));

for (const gpu of Object.keys(TIERS) as (keyof typeof TIERS)[])
	test(`a day cycle dims a grid's light with no new bake on ${gpu}`, async ({ page }) => {
		test.setTimeout(120_000);
		await page.goto(`probe-grid-time.html?gpu=${gpu}`);
		const result = await pageResult<{ error?: string; tier: string; frames: Frame[] }>(
			page,
			90_000,
		);
		expect(result.error).toBeUndefined();
		expect(result.tier).toBe(TIERS[gpu]);
		const frames = result.frames;
		const day = frames.filter((frame) => frame.since < 0);
		const night = frames.slice(-SETTLED);
		expect(day.length).toBeGreaterThan(0);
		// The day is lit, and it holds still while nothing moves.
		const lit = day[0]?.floor[0] as number;
		expect(lit).toBeGreaterThan(40);
		for (const frame of day)
			expect(distance(frame.floor, day[0]?.floor as number[])).toBeLessThanOrEqual(NEAR);
		// The night has settled, and it lies far below the day.
		for (const frame of night)
			expect(distance(frame.floor, night[0]?.floor as number[])).toBeLessThanOrEqual(NEAR);
		expect(lit - (night[SETTLED - 1]?.floor[0] as number)).toBeGreaterThan(DARKER);
	});
