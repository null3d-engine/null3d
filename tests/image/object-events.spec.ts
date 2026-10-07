// Pointer events on objects in a live engine. Playwright moves the mouse over the object events
// page's boxes, clicks them and drags across one, and the handlers must see the right objects: each
// event on the object under the pointer, then on its group, enter and leave in pairs, and no click
// after a drag. Before any object listens, and after the last handler goes, pointer events cast no
// ray. A tap on the touch screen enters, clicks and leaves. During a fast pan, a click must cast its
// ray from the frame on screen at the click. A click on a frame of the setup must reach what that
// frame showed, through pointer events and `camera.screenToRay`, though the setup turned its camera
// away after it. Each runs in every thread mode, and the moves and clicks on every GPU path.
import { expect, type Page, test } from '@playwright/test';
import { allocatingPlaces } from '../lib/allocations.ts';
import { ALONE } from '../lib/alone.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Reply {
	lines: string[];
	rays: number;
	step: number;
	panClicks: { frame: number; shown: number; turn: number; hit: string }[];
	/** The frames since the pan started. */
	panFrames: number;
	/** The pointer as the sketch last read it. */
	pointer: { x: number; y: number; buttons: number };
}

/** Places on the 320 x 180 canvas, in CSS pixels, from the sketch's camera and boxes. */
const EMPTY = { x: 40, y: 30 };
const LEFT = { x: 100, y: 90 };
const MIDDLE = { x: 160, y: 90 };
const RIGHT = { x: 220, y: 90 };
/** The panel behind the middle box, above it. */
const PANEL = { x: 160, y: 62 };
/** A place on the page below the canvas. */
const OUTSIDE = { x: 400, y: 300 };

/**
 * How long a test waits for the sketch to read the input and its handlers to run. CI's software
 * GPU on a busy runner can take more than a second for a frame, and a step can take several frames
 * and messages.
 */
const WAIT_MS = 30_000;
/** A test's time limit, which holds many waits on a slow runner. */
const TEST_MS = 120_000;

test.describe.configure({ timeout: TEST_MS });

/** Asks `read` again until its answer passes the expectation, for up to `WAIT_MS`. */
const poll = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: WAIT_MS });

const CLICKS = 8;
/** The frames whose cameras the engine keeps. */
const KEPT_FRAMES = 4;
/** How far a turn may stray: well under one frame's step, well over rounding. */
const TURN_TOLERANCE = 1e-4;

const switchesOf = (mode: EngineMode, tier?: string, extra = '') =>
	[tier ? `gpu=${tier}` : '', mode.query, extra].filter(Boolean).join('&');

/** Opens the page and returns a function that sends the sketch a message and gives its reply. */
async function open(page: Page, switches: string) {
	await page.goto(`object-events.html?${switches}`);
	return started(page);
}

/** Waits for the page's result, and returns the function that `open` returns. */
async function started(page: Page) {
	const result = await pageResult<{ ok: boolean; error?: string }>(page, WAIT_MS);
	expect(result.error).toBeUndefined();
	return (message = 'ask') =>
		page.evaluate(
			(message) =>
				(globalThis as { objectEvents?: (message: string) => Promise<Reply> }).objectEvents?.(
					message,
				) as Promise<Reply>,
			message,
		);
}

/**
 * Waits until the handlers have written exactly `expected`, and fails with the lines they wrote
 * when they never do. A line that comes later fails the next wait, or the test's last check.
 */
async function expectLines(send: (message?: string) => Promise<Reply>, expected: string[]) {
	await poll(async () => (await send()).lines).toEqual(expected);
}

/** Moves and clicks the mouse over the boxes, and checks each step's events. */
async function moveAndClick(page: Page, send: (message?: string) => Promise<Reply>) {
	const { mouse } = page;
	const lines: string[] = [];
	const step = async (action: () => Promise<void>, expected: string[]) => {
		await action();
		lines.push(...expected);
		await expectLines(send, lines);
	};
	await step(() => mouse.move(EMPTY.x, EMPTY.y), []);
	await step(
		() => mouse.move(LEFT.x, LEFT.y),
		['pointerenter pair left', 'pointerenter left left'],
	);
	await step(
		() => mouse.move(MIDDLE.x, MIDDLE.y),
		['pointerleave left middle', 'pointerenter middle middle'],
	);
	await step(
		() => mouse.move(RIGHT.x, RIGHT.y),
		['pointerleave middle right', 'pointerleave pair right', 'pointerenter right right'],
	);
	await step(
		() => mouse.click(RIGHT.x, RIGHT.y),
		['pointerdown right right', 'pointerup right right', 'click right right'],
	);
	await step(
		() => mouse.click(MIDDLE.x, MIDDLE.y),
		[
			'pointerleave right middle',
			'pointerenter pair middle',
			'pointerenter middle middle',
			'pointerdown middle middle',
			'pointerup middle middle',
			'click middle middle',
			'click pair middle',
		],
	);
	// The panel shows above the middle box, which hides the rest of it.
	await step(
		() => mouse.move(PANEL.x, PANEL.y),
		['pointerleave middle panel', 'pointerleave pair panel', 'pointerenter panel panel'],
	);
	await step(() => mouse.click(PANEL.x, PANEL.y), ['click panel panel']);
	// A drag of 10 pixels across the right box is no click.
	await step(async () => {
		await mouse.move(RIGHT.x - 5, RIGHT.y);
		await mouse.down();
		await mouse.move(RIGHT.x + 5, RIGHT.y + 2);
		await mouse.up();
	}, [
		'pointerleave panel right',
		'pointerenter right right',
		'pointerdown right right',
		'pointerup right right',
	]);
	await step(() => mouse.move(OUTSIDE.x, OUTSIDE.y), ['pointerleave right nothing']);
	return lines;
}

for (const mode of ENGINE_MODES)
	test(`pointer events reach the objects under the mouse, ${mode.name}`, async ({ page }) => {
		const send = await open(page, switchesOf(mode));
		// No object listens yet: moves and clicks cast no ray. The test waits until the sketch has
		// read the press, then the release, as it dispatches each event in the frame that reads it.
		// The move alone already shows the pointer there with no button down, and a press and
		// release that the sketch reads only after the handlers come would reach them.
		const pointer = async () => (await send()).pointer;
		await page.mouse.move(MIDDLE.x, MIDDLE.y);
		await page.mouse.move(RIGHT.x, RIGHT.y);
		await page.mouse.down();
		await poll(pointer).toEqual({ x: RIGHT.x, y: RIGHT.y, buttons: 1 });
		await page.mouse.up();
		await poll(pointer).toEqual({ x: RIGHT.x, y: RIGHT.y, buttons: 0 });
		expect((await send()).rays).toBe(0);
		await page.mouse.move(OUTSIDE.x, OUTSIDE.y);
		await send('listen');
		const lines = await moveAndClick(page, send);
		const { rays } = await send('unlisten');
		expect(rays).toBeGreaterThan(0);
		await page.mouse.click(MIDDLE.x, MIDDLE.y);
		await page.mouse.move(LEFT.x, LEFT.y);
		await page.mouse.move(OUTSIDE.x, OUTSIDE.y);
		const after = await send();
		expect(after.rays).toBe(rays);
		expect(after.lines).toEqual(lines);
	});

for (const tier of ['webgl2', 'compat'] as const)
	test(`pointer events reach the objects under the mouse on ${tier}`, async ({ page }) => {
		const send = await open(page, switchesOf(ENGINE_MODES[0], tier));
		await send('listen');
		await moveAndClick(page, send);
	});

test.describe('on a touch screen', () => {
	test.use({ hasTouch: true });

	test('a tap enters, presses, clicks and leaves', async ({ page }) => {
		const send = await open(page, '');
		await send('listen');
		await page.touchscreen.tap(RIGHT.x, RIGHT.y);
		const lines = [
			'pointerenter right right',
			'pointerdown right right',
			'pointerup right right',
			'click right right',
			'pointerleave right nothing',
		];
		await expectLines(send, lines);
		await page.touchscreen.tap(LEFT.x, LEFT.y);
		lines.push(
			'pointerenter pair left',
			'pointerenter left left',
			'pointerdown left left',
			'pointerup left left',
			'click left left',
			'click pair left',
			'pointerleave left nothing',
			'pointerleave pair nothing',
		);
		await expectLines(send, lines);
	});
});

/** The difference of two turns, in radians from -pi to pi. */
const turnDifference = (a: number, b: number) => {
	const d = (a - b) % (2 * Math.PI);
	return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
};

for (const mode of ENGINE_MODES)
	test(`a click during a fast pan casts its ray from the frame on screen, ${mode.name}`, async ({
		page,
	}) => {
		const send = await open(page, switchesOf(mode));
		await send('pan');
		// Until the frames on screen show the dome, a click picks what they show: the boxes.
		await poll(async () => (await send()).panFrames).toBeGreaterThan(KEPT_FRAMES * 2);
		for (let k = 1; k <= CLICKS; k++) {
			await page.mouse.click(MIDDLE.x, MIDDLE.y);
			await poll(async () => (await send()).panClicks.length).toBe(k);
		}
		const { step, panClicks } = await send();
		for (const click of panClicks) {
			expect(click.hit).toBe('dome');
			expect(click.shown).toBeGreaterThanOrEqual(click.frame - KEPT_FRAMES);
			expect(click.shown).toBeLessThan(click.frame);
			expect(turnDifference(click.turn, click.shown * step)).toBeLessThan(TURN_TOLERANCE);
		}
		// The sketch runs a frame ahead of the one on screen in pipelined modes, so the current
		// camera would have missed. The other modes draw each frame as they record it, but a release
		// that comes while a frame draws still names the frame before, so they get no such check.
		if (mode.latency === 'pipelined')
			expect(panClicks.filter((click) => click.shown < click.frame - 1).length).toBeGreaterThan(0);
	});

for (const mode of ENGINE_MODES)
	test(`a click on an earlier frame of the setup picks what that frame showed, ${mode.name}`, async ({
		page,
	}) => {
		await page.goto(`object-events.html?${switchesOf(mode, undefined, 'setup')}`);
		// The setup waits with its frame of the box on screen.
		await page.waitForFunction(
			() => (globalThis as { objectEventsSetup?: unknown }).objectEventsSetup,
		);
		await page.mouse.click(RIGHT.x, RIGHT.y);
		// The setup then turns its camera away and draws more frames before the sketch reads the click.
		await page.evaluate(() =>
			(globalThis as { objectEventsSetup?: { go: () => void } }).objectEventsSetup?.go(),
		);
		const send = await started(page);
		await expectLines(send, ['click right', 'ray right']);
	});

test('pointer events allocate nothing', ALONE, async ({ page }) => {
	const send = await open(page, 'threads=off');
	await send('loop');
	// Each frame of the loop with events enters the left box, presses, clicks, then moves to the
	// right box: its handlers count four events, and the group's two.
	const loop = (iterations: number, runs: number) =>
		page.evaluate(
			({ iterations, runs }) => {
				const run = (globalThis as { __null3dPointerLoop?: (iterations: number) => number })
					.__null3dPointerLoop;
				let handled = 0;
				for (let k = 0; k < runs; k++) handled += run?.(iterations) ?? 0;
				return handled;
			},
			{ iterations, runs },
		);
	const plan = {
		warmUpRuns: 40,
		warmUpIterations: 200,
		sampledIterations: 10_000,
		// The dispatch, the rays from the frame cameras, the raycasts and the core's glue.
		counted:
			/\/packages\/engine\/(src\/scene\/(pointer-events|frame-cameras|queries|scene|memory)\.ts|dist\/wasm\/)/,
		pauseEngine: true,
	};
	expect(await allocatingPlaces(page, plan, loop)).toEqual([]);
	// The paused engine's handlers still ran the loop's events.
	expect(await loop(2, 1)).toBeGreaterThan(0);
});
