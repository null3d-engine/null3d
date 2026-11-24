// A held frame draws the levels that a mesh made in code plans, however long the plan takes. The
// test page's sketch keeps every job worker busy past the ten seconds that hold mode waits for
// other tasks, and draws a grid whose level plan waits for a worker behind them
// (tests/pages/sketches/levels-held-sketch.ts). The frame that hold mode keeps must hold the grid's
// levels: hold mode waits for level plans all the way, and fails naming the meshes rather than
// capture a frame without them. That frame is the settle frame after the held one, which runs none
// of the sketch's code, so the sketch reports the levels when the plan gives them, and the page
// records whether that came before the hold ended.
//
// Hold mode lets the plans that the setup started finish before the first step, so that the steps
// find the same scene on every run. A grid made in the setup therefore has its levels in every held
// frame, and the wait after the held frame is tested with a grid that the first held step makes.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Result {
	error?: string;
	tier: string;
	held: number[];
	planned?: { levels: number; beforeHold: boolean };
	seconds: number;
}

/** How long each busy task keeps its job worker, as the sketch sets it. */
const BUSY_SECONDS = 20;

test('a held frame waits for the level plans of meshes made in code', async ({ page }) => {
	test.setTimeout(180_000);
	// Two job workers, which the sketch's two busy tasks keep for 20 seconds. The first held step
	// makes the grid, so its plan waits behind them while the held frames run.
	await page.goto('levels-held.html?jobs=2&plan=steps');
	const result = await pageResult<Result>(page, 150_000);
	expect(result.error).toBeUndefined();
	// The hold waited past the busy tasks, for the plan behind them.
	expect(result.seconds).toBeGreaterThanOrEqual(BUSY_SECONDS);
	// The held frames ran before the plan was in, so the wait is what gives the kept frame its levels.
	expect(result.held.length).toBeGreaterThan(0);
	expect(result.held.at(-1)).toBe(0);
	// The plan gave the grid its levels before the hold ended, so the settle frame that hold mode
	// records after the wait, the frame it keeps, drew them.
	expect(result.planned?.levels).toBeGreaterThan(0);
	expect(result.planned?.beforeHold).toBe(true);
});

test('the held steps start once the level plans that the setup started are in', async ({
	page,
}) => {
	test.setTimeout(180_000);
	// The setup makes the grid, whose plan waits behind the two busy tasks.
	await page.goto('levels-held.html?jobs=2&plan=setup');
	const result = await pageResult<Result>(page, 150_000);
	expect(result.error).toBeUndefined();
	// The first step waited past the busy tasks, for the plan behind them.
	expect(result.seconds).toBeGreaterThanOrEqual(BUSY_SECONDS);
	// Every held frame found the grid's levels in.
	expect(result.held.length).toBeGreaterThan(0);
	expect(result.held.filter((levels) => levels === 0)).toEqual([]);
	expect(result.planned?.levels).toBeGreaterThan(0);
	expect(result.planned?.beforeHold).toBe(true);
});
