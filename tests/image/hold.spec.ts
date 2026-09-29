// Hold mode: the engine steps a sketch to a set time in fixed steps with seeded random numbers,
// draws that one frame, reads it back, and publishes the frame or the error that stopped it. These
// tests read what the engine publishes on a page that handles no error itself.
import { expect, type Page, test } from '@playwright/test';
import { HOLD_SEED, seededRandom } from '../../packages/engine/src/sketch/random.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { compareToReference } from '../lib/images.ts';
import { type HoldReport, holdResult, windowValue } from '../lib/page-result.ts';

/** The GPU tiers, each forced with ?gpu=, and the tier the engine reports for it. */
const TIERS = [
	{ tier: 'webgpu', reported: 'webgpu' },
	{ tier: 'compat', reported: 'webgpu-compat' },
	{ tier: 'webgl2', reported: 'webgl2' },
] as const;
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

for (const { tier, reported } of TIERS)
	test(`two holds of an animated scene draw the same pixels in every thread mode on ${tier}, and match its reference`, async ({
		page,
	}) => {
		const holds = [...ENGINE_MODES, ENGINE_MODES[0] as EngineMode];
		let first: Extract<HoldReport, { ok: true }> | undefined;
		for (const [index, mode] of holds.entries()) {
			const where = `${mode.name}${index === ENGINE_MODES.length ? ', again' : ''}`;
			const held = frameOf(
				await hold(page, `gpu=${tier}&hold=${HOLD_SECONDS}${modeSwitches(mode)}`),
				where,
			);
			expect([where, held.time, held.frame, held.tier]).toEqual([
				where,
				HOLD_SECONDS,
				HELD_FRAME,
				reported,
			]);
			first ??= held;
			expect([where, held.width, held.height]).toEqual([where, first.width, first.height]);
			// Byte for byte: the same steps and the same random numbers draw the same frame.
			expect([where, held.pixels === first.pixels]).toEqual([where, true]);
		}
		if (!first) throw new Error('no frame was held');
		compareToReference(
			'held',
			tier,
			Buffer.from(first.pixels, 'base64'),
			first.width,
			first.height,
		);
	});

test('hold mode steps the sketch in fixed steps to the held time, with seeded random numbers', async ({
	page,
}) => {
	for (const mode of ENGINE_MODES) {
		frameOf(await hold(page, `hold=${HOLD_SECONDS}${modeSwitches(mode)}`), mode.name);
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
