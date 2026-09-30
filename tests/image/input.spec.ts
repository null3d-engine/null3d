// Input in the sketch: Playwright drives the keyboard, the mouse, the wheel and touch, and a stand-in
// gamepad plays a connected pad. The sketch records what ctx.input reports each frame, and the tests
// read it back in every thread mode. Hold mode must keep all input out of the sketch.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface InputState {
	frames: number;
	pressed: Record<string, number>;
	released: Record<string, number>;
	together: string[];
	down: Record<string, boolean>;
	pointer: {
		x: number;
		y: number;
		ndcX: number;
		ndcY: number;
		buttons: number;
		isTouch: boolean;
		frame: number;
	};
	moved: { dx: number; dy: number; wheel: number; touchDx: number };
	touches: { id: number; x: number; y: number }[];
	mostTouches: number;
	stick: number;
	trigger: number;
}

/** The test canvas's size in CSS pixels, at the page's top-left corner. */
const CANVAS = { width: 320, height: 180 };

/** Runs in the page: what the sketch has recorded so far. */
const readState = () =>
	(globalThis as { inputState?: () => Promise<InputState> }).inputState?.() as Promise<InputState>;

/** Opens the input page in a thread mode, with more switches, and waits for the engine to run. */
async function open(
	page: Page,
	mode: EngineMode,
	switches = '',
): Promise<() => Promise<InputState>> {
	const query = [mode.query, switches].filter(Boolean).join('&');
	await page.goto(`input.html?${query}`);
	const result = await pageResult<{ ok: boolean; error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	return () => page.evaluate(readState);
}

/**
 * Runs in the page before its scripts: a stand-in for one gamepad in the standard layout, which the
 * test connects, presses and disconnects. It counts the page's reads of the gamepads.
 */
function standInGamepad(): void {
	const pad = {
		index: 0,
		id: 'stand-in pad',
		connected: true,
		mapping: 'standard',
		timestamp: 0,
		buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
		axes: [0, 0, 0, 0],
	};
	// The page's globals, which this file's types do not describe.
	const page = globalThis as unknown as {
		dispatchEvent(event: Event): boolean;
		navigator: { getGamepads(): unknown[] };
		standInPad?: unknown;
	};
	let connected = false;
	const stand = {
		reads: 0,
		pad,
		connect() {
			connected = true;
			page.dispatchEvent(new Event('gamepadconnected'));
		},
		disconnect() {
			connected = false;
			page.dispatchEvent(new Event('gamepaddisconnected'));
		},
	};
	page.standInPad = stand;
	page.navigator.getGamepads = () => {
		stand.reads++;
		return [connected ? pad : null, null, null, null];
	};
}

interface StandInPad {
	reads: number;
	pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] };
	connect(): void;
	disconnect(): void;
}

/** How often the page has read the gamepads. */
const padReads = (page: Page) =>
	page.evaluate(() => (globalThis as unknown as { standInPad: StandInPad }).standInPad.reads);

for (const mode of ENGINE_MODES)
	test(`the sketch reads keys, mouse buttons, the wheel and a gamepad, ${mode.name}`, async ({
		page,
	}) => {
		await page.addInitScript(standInGamepad);
		const state = await open(page, mode);

		await page.keyboard.down('KeyW');
		await expect.poll(state).toMatchObject({ down: { KeyW: true }, pressed: { KeyW: 1 } });
		await page.keyboard.up('KeyW');
		await expect.poll(state).toMatchObject({ down: { KeyW: false }, released: { KeyW: 1 } });
		// A quick press counts once as a press and once as a release, and so does its action.
		await page.keyboard.press('Space');
		await expect
			.poll(state)
			.toMatchObject({ pressed: { Space: 1, jump: 1 }, released: { Space: 1, jump: 1 } });
		// A press and a release that reach the ring in one task of the page reach the sketch in one
		// frame, which counts both. Each tap waits for the one before it, so each lands in a frame of
		// its own. A frame could start between the two writes of a tap, but hardly for all three.
		for (let tap = 1; tap <= 3; tap++) {
			await page.evaluate(() =>
				(globalThis as { tapKey?: (code: string) => void }).tapKey?.('KeyD'),
			);
			await expect.poll(state).toMatchObject({ pressed: { KeyD: tap }, released: { KeyD: tap } });
		}
		expect((await state()).together).toContain('KeyD');

		// The first move places the pointer; the four steps after it move it 60 right and 20 down.
		await page.mouse.move(40, 30);
		await page.mouse.move(100, 50, { steps: 4 });
		await expect.poll(state).toMatchObject({
			pointer: { x: 100, y: 50, isTouch: false },
			moved: { dx: 60, dy: 20 },
		});
		const placed = await state();
		expect(placed.pointer.ndcX).toBeCloseTo((100 / CANVAS.width) * 2 - 1, 5);
		expect(placed.pointer.ndcY).toBeCloseTo(1 - (50 / CANVAS.height) * 2, 5);
		// Each pointer event names the frame that was on screen when it came.
		expect(placed.pointer.frame).toBeGreaterThan(0);
		expect(placed.pointer.frame).toBeLessThanOrEqual(placed.frames);

		await page.mouse.down({ button: 'left' });
		await expect.poll(state).toMatchObject({ down: { Mouse0: true }, pointer: { buttons: 1 } });
		await page.mouse.up({ button: 'left' });
		await page.mouse.down({ button: 'right' });
		await page.mouse.up({ button: 'right' });
		await expect.poll(state).toMatchObject({
			pressed: { Mouse0: 1, Mouse2: 1 },
			released: { Mouse0: 1, Mouse2: 1 },
			down: { Mouse0: false, Mouse2: false },
		});
		await page.mouse.wheel(0, 120);
		await expect.poll(state).toMatchObject({ moved: { wheel: 120 } });

		// With no pad connected, the page reads the pads once, when it starts.
		expect(await padReads(page)).toBe(1);
		await page.evaluate(() => {
			const stand = (globalThis as unknown as { standInPad: StandInPad }).standInPad;
			stand.pad.buttons[0] = { pressed: true, value: 1 };
			stand.pad.axes[0] = 1;
			stand.connect();
		});
		await expect.poll(state).toMatchObject({
			pressed: { GamepadA: 1, GamepadLeftStickRight: 1, jump: 2 },
			down: { GamepadA: true, GamepadLeftStickRight: true, jump: true },
			stick: 1,
		});
		await page.evaluate(() => {
			const stand = (globalThis as unknown as { standInPad: StandInPad }).standInPad;
			stand.pad.buttons[7] = { pressed: false, value: 0.25 };
		});
		await expect.poll(state).toMatchObject({ trigger: 0.25 });
		await page.evaluate(() =>
			(globalThis as unknown as { standInPad: StandInPad }).standInPad.disconnect(),
		);
		await expect.poll(state).toMatchObject({
			released: { GamepadA: 1, GamepadLeftStickRight: 1, jump: 2 },
			stick: 0,
			trigger: 0,
		});
		// The reads stop with the last pad.
		const reads = await padReads(page);
		await page.waitForTimeout(200);
		expect(await padReads(page)).toBe(reads);
	});

for (const mode of ENGINE_MODES)
	test(`a pause releases every key, and input during the pause never reaches the sketch, ${mode.name}`, async ({
		page,
	}) => {
		const state = await open(page, mode);
		await page.keyboard.down('KeyW');
		await expect.poll(state).toMatchObject({ down: { KeyW: true } });
		await page.evaluate(() =>
			(globalThis as { pauseEngine?: (p: boolean) => void }).pauseEngine?.(true),
		);
		await page.keyboard.down('KeyD');
		await page.mouse.move(30, 30);
		await page.mouse.down();
		await page.evaluate(() =>
			(globalThis as { pauseEngine?: (p: boolean) => void }).pauseEngine?.(false),
		);
		await expect.poll(state).toMatchObject({ down: { KeyW: false }, released: { KeyW: 1 } });
		const after = await state();
		expect(after.pressed).toMatchObject({ KeyD: 0, Mouse0: 0 });
		expect(after.down).toMatchObject({ KeyD: false, Mouse0: false });
	});

test.describe('touch', () => {
	test.use({ hasTouch: true });
	for (const mode of ENGINE_MODES)
		test(`the sketch reads a tap as the main button, and two fingers as touches, ${mode.name}`, async ({
			page,
		}) => {
			const state = await open(page, mode);
			await page.touchscreen.tap(60, 40);
			await expect.poll(state).toMatchObject({
				pressed: { Mouse0: 1 },
				released: { Mouse0: 1 },
				pointer: { x: 60, y: 40, isTouch: true },
			});

			const cdp = await page.context().newCDPSession(page);
			const fingers = (dx: number) => [
				{ x: 50 + dx, y: 90, id: 1 },
				{ x: 150 + dx, y: 90, id: 2 },
			];
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(0) });
			await expect.poll(state).toMatchObject({
				touches: [
					{ x: 50, y: 90 },
					{ x: 150, y: 90 },
				],
			});
			for (const dx of [10, 20])
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(dx) });
			await expect.poll(state).toMatchObject({
				touches: [
					{ x: 70, y: 90 },
					{ x: 170, y: 90 },
				],
				moved: { touchDx: 40 },
			});
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect.poll(state).toMatchObject({ touches: [], mostTouches: 2 });
		});
});

for (const mode of ENGINE_MODES)
	test(`hold mode keeps input out of the sketch, ${mode.name}`, async ({ page }) => {
		// The page presses W, the main button and the wheel during the sketch's setup. A live sketch
		// sees them in its first frame.
		const live = await (await open(page, mode, 'setupInput'))();
		expect([live.pressed.KeyW, live.pressed.Mouse0, live.moved.wheel]).toEqual([1, 1, 50]);
		// A held sketch, stepped through its 31 frames, sees none of them.
		const held = await (await open(page, mode, 'setupInput&hold=0.5'))();
		expect(held.frames).toBe(31);
		expect(held.pressed).toMatchObject({ KeyW: 0, Mouse0: 0 });
		expect(held.down).toMatchObject({ KeyW: false, Mouse0: false });
		expect(held.moved).toEqual({ dx: 0, dy: 0, wheel: 0, touchDx: 0 });
	});
