// Hold mode: the engine steps a sketch to a set time in fixed steps with seeded random numbers,
// draws that one frame, reads it back, and publishes the frame or the error that stopped it. These
// tests read what the engine publishes on a page that handles no error itself. The image test
// manifest's held test checks the held frame's pixels in every thread mode and on every tier.
import { expect, type Page, test } from '@playwright/test';
import { HOLD_SEED, seededRandom } from '../../packages/engine/src/sketch/random.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { type HoldReport, holdResult, windowValue } from '../lib/page-result.ts';

/** The sketch time the tests hold at, and the frame it gives: one frame, then 90 steps of 1/60 s. */
const HOLD_SECONDS = 1.5;
const HELD_FRAME = 91;
/** A failure must reach the page long before a test driver would give up. */
const FAST_FAILURE_MS = 15_000;

interface SketchState {
	state: {
		now: number;
		frame: number;
		updates: number;
		smallestStep: number;
		largestStep: number;
		firstRandom: number[];
	};
	mode: { hold: number | null; latency: string; renderThread: string };
	tier: string;
	seededOnPage: boolean;
	ownAfterStop: boolean;
}

/** Opens the hold page with `switches` and returns what the engine publishes. */
async function hold(page: Page, switches: string): Promise<HoldReport> {
	await page.goto(`hold.html?${switches}`);
	return holdResult(page, 30_000);
}

/** Waits for the page to publish the sketch's state, which it asks for once the engine started. */
function sketchState(page: Page): Promise<SketchState> {
	return windowValue<SketchState>(page, '__null3dSketchState', 30_000);
}

/** The held frame from a result that must have one. */
function frameOf(result: HoldReport, where: string): Extract<HoldReport, { ok: true }> {
	if (!result.ok) throw new Error(`${where}: hold mode failed: ${result.error}`);
	return result;
}

const modeSwitches = (mode: EngineMode) => (mode.query ? `&${mode.query}` : '');

test('hold mode steps the sketch in fixed steps to the held time, with seeded random numbers', async ({
	page,
}) => {
	for (const mode of ENGINE_MODES) {
		const held = frameOf(await hold(page, `hold=${HOLD_SECONDS}${modeSwitches(mode)}`), mode.name);
		expect([mode.name, held.time, held.frame]).toEqual([mode.name, HOLD_SECONDS, HELD_FRAME]);
		const { state, mode: engineMode, seededOnPage, ownAfterStop } = await sketchState(page);
		expect([mode.name, engineMode.hold, engineMode.renderThread]).toEqual([
			mode.name,
			HOLD_SECONDS,
			mode.renderThread,
		]);
		expect([mode.name, state.now, state.frame, state.updates]).toEqual([
			mode.name,
			HOLD_SECONDS,
			HELD_FRAME,
			HELD_FRAME,
		]);
		expect(state.smallestStep).toBeCloseTo(1 / 60, 12);
		expect(state.largestStep).toBeCloseTo(1 / 60, 12);
		const seeded = seededRandom(HOLD_SEED);
		expect([mode.name, state.firstRandom]).toEqual([mode.name, [seeded(), seeded(), seeded()]]);
		// The single-threaded build runs the sketch on the page's thread, which gets its own
		// Math.random back when the engine stops. Elsewhere the page's Math.random never changes.
		expect([mode.name, seededOnPage, ownAfterStop]).toEqual([
			mode.name,
			mode.build === 'single',
			true,
		]);
	}
});

test('a bare ?hold holds the first frame, at time 0', async ({ page }) => {
	const held = frameOf(await hold(page, 'hold'), 'bare ?hold');
	expect([held.time, held.frame]).toEqual([0, 1]);
	const { state } = await sketchState(page);
	expect([state.now, state.frame, state.updates]).toEqual([0, 1, 1]);
});

test('a live engine publishes no hold result, and its random numbers are not seeded', async ({
	page,
}) => {
	await page.goto('hold.html');
	const { state, mode } = await sketchState(page);
	expect(mode.hold).toBeNull();
	const seeded = seededRandom(HOLD_SEED);
	expect(state.firstRandom).not.toEqual([seeded(), seeded(), seeded()]);
	expect(
		await page.evaluate(() => (globalThis as { __null3dHold?: unknown }).__null3dHold),
	).toBeUndefined();
});

for (const mode of ENGINE_MODES)
	test(`hold mode publishes the sketch's first error at once, ${mode.name}`, async ({ page }) => {
		const started = Date.now();
		const result = await hold(page, `hold=2&sketch=throwing${modeSwitches(mode)}`);
		expect(Date.now() - started).toBeLessThan(FAST_FAILURE_MS);
		if (result.ok) throw new Error('the hold passed, though the sketch threw');
		expect(result.code).toBe('E1408');
		expect(result.error).toContain('hold mode stopped at 0.5 seconds, in frame 31');
		expect(result.error).toContain('the throwing sketch threw on purpose');
	});

test('hold mode publishes a failed setup at once, with its code', async ({ page }) => {
	const started = Date.now();
	const result = await hold(page, 'hold=1&sketch=failing-setup');
	expect(Date.now() - started).toBeLessThan(FAST_FAILURE_MS);
	if (result.ok) throw new Error('the hold passed, though the setup threw');
	expect(result.code).toBe('E1204');
	expect(result.error).toContain('E1204: setBackground() got the color "blue-ish".');
});

test('hold mode refuses a time that is not a number of seconds', async ({ page }) => {
	const result = await hold(page, 'hold=1500ms');
	if (result.ok) throw new Error('the hold passed with a bad time');
	expect(result.code).toBe('E1407');
	expect(result.error).toContain('E1407: ?hold=1500ms is not a number of seconds from 0 to 600.');
});
