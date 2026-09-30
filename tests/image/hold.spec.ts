// Hold mode: the engine steps a sketch to a set time in fixed steps with seeded random numbers,
// draws that one frame, reads it back, and publishes the frame or the error that stopped it. These
// tests read what the engine publishes on a page that handles no error itself. The image test
// manifest's held test checks the held frame's pixels in every thread mode and on every tier.
import { expect, type Page, test } from '@playwright/test';
import { randFloat, random, seed } from '../../packages/engine/src/math/math.ts';
import { HOLD_SEED } from '../../packages/engine/src/sketch/random.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { type HoldReport, holdResult, windowValue } from '../lib/page-result.ts';

/** The sketch time the tests hold at, and the frame it gives: one frame, then 90 steps of 1/60 s. */
const HOLD_SECONDS = 1.5;
const HELD_FRAME = 91;
/** A failure must reach the page long before a test driver would give up. */
const FAST_FAILURE_MS = 15_000;

/** What the animated sketch reports. */
interface AnimatedState {
	now: number;
	frame: number;
	updates: number;
	smallestStep: number;
	largestStep: number;
	firstRandom: number[];
}

/** What the hold page publishes: the sketch's own report, and what the page saw. */
interface SketchState<State = AnimatedState> {
	state: State;
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
function sketchState<State = AnimatedState>(page: Page): Promise<SketchState<State>> {
	return windowValue<SketchState<State>>(page, '__null3dSketchState', 30_000);
}

/** The first numbers that hold mode's seeded generator gives. */
function seededNumbers(count: number): number[] {
	seed(HOLD_SEED);
	return Array.from({ length: count }, random);
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
		expect([mode.name, state.firstRandom]).toEqual([mode.name, seededNumbers(3)]);
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
	expect(state.firstRandom).not.toEqual(seededNumbers(3));
	expect(
		await page.evaluate(() => (globalThis as { __null3dHold?: unknown }).__null3dHold),
	).toBeUndefined();
});

test('hold mode seeds math.random in every thread mode, and Math.random draws from it too', async ({
	page,
}) => {
	// The sketch draws from math.random and Math.random in turn, so both take from one sequence.
	seed(HOLD_SEED);
	const expected = [random(), random(), randFloat(2, 4), random()];
	for (const mode of ENGINE_MODES) {
		frameOf(await hold(page, `hold=0.5&sketch=random${modeSwitches(mode)}`), mode.name);
		const { state } = await sketchState<{ drawn: number[] }>(page);
		expect([mode.name, state.drawn]).toEqual([mode.name, expected]);
	}
	await page.goto('hold.html?sketch=random');
	const live = await sketchState<{ drawn: number[] }>(page);
	expect(live.mode.hold).toBeNull();
	expect(live.state.drawn).not.toEqual(expected);
});

/** What the follow sketch reports. */
interface FollowState {
	now: number;
	frame: number;
	fixedSteps: number;
	updates: number;
	lateUpdates: number;
	outOfOrder: number;
	staleReads: number;
	stepMismatches: number;
	x: number;
	viewport: [number, number, number];
	tier: string;
}

/** The follow sketch's fixed steps per second, and its box's speed in meters per second. */
const FOLLOW_RATE = 50;
const FOLLOW_SPEED = 30;

/** The first and last column and row that hold red pixels in RGBA8 rows, top row first. */
function redBounds(pixels: Uint8Array, width: number, height: number) {
	const bounds = { left: width, right: -1, top: height, bottom: -1 };
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (!((pixels[i] ?? 0) > 150 && (pixels[i + 1] ?? 0) < 80 && (pixels[i + 2] ?? 0) < 80))
				continue;
			bounds.left = Math.min(bounds.left, x);
			bounds.right = Math.max(bounds.right, x);
			bounds.top = Math.min(bounds.top, y);
			bounds.bottom = Math.max(bounds.bottom, y);
		}
	return bounds;
}

test('fixed steps, the update and the late update run in order, and a camera that follows in the late update keeps its object at the center', async ({
	page,
}) => {
	const steps = Math.floor(HOLD_SECONDS * FOLLOW_RATE);
	for (const mode of ENGINE_MODES) {
		const held = frameOf(
			await hold(page, `hold=${HOLD_SECONDS}&sketch=follow${modeSwitches(mode)}`),
			mode.name,
		);
		const { state } = await sketchState<FollowState>(page);
		// The first frame, at time 0, runs no fixed step; the late update runs in every frame.
		expect([mode.name, state.fixedSteps, state.updates, state.lateUpdates]).toEqual([
			mode.name,
			steps,
			HELD_FRAME,
			HELD_FRAME,
		]);
		expect([mode.name, state.outOfOrder, state.staleReads, state.stepMismatches]).toEqual([
			mode.name,
			0,
			0,
			0,
		]);
		expect(state.x).toBeCloseTo((steps * FOLLOW_SPEED) / FOLLOW_RATE, 9);
		expect([mode.name, state.viewport, state.tier]).toEqual([mode.name, [320, 180, 1], held.tier]);
		// The box moved 0.6 m in the held frame, about 18 pixels, so a camera a frame behind it
		// would show it that far from the center.
		const box = redBounds(Buffer.from(held.pixels, 'base64'), held.width, held.height);
		const middle = (box.left + box.right + 1) / 2;
		expect([mode.name, Math.abs(middle - held.width / 2) <= 1]).toEqual([mode.name, true]);
		expect([mode.name, box.top < held.height / 2, box.bottom >= held.height / 2]).toEqual([
			mode.name,
			true,
			true,
		]);
	}
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
