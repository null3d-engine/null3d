// The ocean's frame rate in three states on one GPU path: its transform and its surface drawn, its
// surface drawn with the transform off, and its transform run with no surface drawn. It runs only
// with NULL3D_OCEAN_COST set, in a quiet window on a computer with a GPU of its own:
// NULL3D_OCEAN_COST=1 bun run test:browser -- ocean-rate.spec.ts
import { expect, test } from '@playwright/test';
import { loadNow, waitForQuiet } from '../lib/effect-cost.ts';
import { pageResult } from '../lib/page-result.ts';

/** What the page reports once it measured every state. */
interface RateResult {
	tier: string;
	warmUp: number;
	window: number;
	states: { name: string; intervals: number[]; intervalMs: number; fps: number }[];
	error?: string;
}

/** The GPU path and preset that the run measures, from the environment. */
const GPU = process.env.NULL3D_OCEAN_COST_GPU ?? 'webgl2';
const PRESET = process.env.NULL3D_OCEAN_COST_PRESET ?? 'low';

test(`the ocean's frame rate in each state on ${GPU} at ${PRESET}`, async ({ page }) => {
	test.skip(!process.env.NULL3D_OCEAN_COST, 'set NULL3D_OCEAN_COST to time the ocean');
	test.setTimeout(900_000);
	const loadBefore = await waitForQuiet();
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto(
		`ocean-rate.html?gpu=${GPU}&preset=${PRESET}${process.env.NULL3D_OCEAN_COST_EVERY ? `&every=${process.env.NULL3D_OCEAN_COST_EVERY}` : ''}`,
	);
	const result = await pageResult<RateResult>(page, 840_000);
	expect(result.error).toBeUndefined();
	for (const state of result.states)
		console.log(
			`RATE ${result.tier} ${state.name}: ${state.fps.toFixed(2)} fps, ${state.intervalMs.toFixed(1)} ms per frame, windows ${state.intervals.map((value) => value.toFixed(1)).join(' and ')} ms, load ${loadBefore} before and ${loadNow()} after`,
		);
	expect(result.states.length).toBe(3);
});
