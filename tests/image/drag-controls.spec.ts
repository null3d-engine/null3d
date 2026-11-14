// Drag controls in a live engine. Playwright's mouse and Chrome's touches press the crate where the
// page says that it draws, and drag it: the main button moves it over the plane that faces the
// camera, and the right button turns it. The crate must move by the drag, and a drag that holds
// nothing must leave it alone. CI's software GPU draws a few frames a second, so every check waits
// on the sketch's own frames, never the page's clock.
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The sketch time that a check waits for, in seconds, before it gives up on a slow GPU. */
const PATIENCE = 60_000;

interface Pose {
	position: number[];
	rotation: number[];
	/** Where the crate shows on the canvas, in CSS pixels. */
	screen: [number, number];
	dragging: boolean;
	hovered: boolean;
	action: 'pan' | 'rotate' | null;
	time: number;
}

/** The page's own question, which its sketch answers. */
interface DragPage {
	dragPose?: () => Promise<Pose>;
}

/** Opens the drag-controls page and returns once the engine has drawn its first frame. */
async function open(page: Page): Promise<void> {
	await page.goto('drag-controls.html');
	const result = await pageResult<{ error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
}

const pose = (page: Page) =>
	page.evaluate(() => (globalThis as DragPage).dragPose?.()) as Promise<Pose>;

/** Waits until the sketch has read a frame after the one whose time is `after`. */
async function nextFrame(page: Page, after: number): Promise<void> {
	await expect
		.poll(async () => (await pose(page)).time, { timeout: PATIENCE })
		.toBeGreaterThan(after);
}

/** Waits until the sketch reports the state that `check` names. */
async function until(page: Page, check: (state: Pose) => boolean): Promise<Pose> {
	let state = await pose(page);
	await expect
		.poll(
			async () => {
				state = await pose(page);
				return check(state);
			},
			{ timeout: PATIENCE },
		)
		.toBe(true);
	return state;
}

/**
 * Presses the crate where it shows, moves the pointer by a share of the drag each frame, and lets
 * go. Each step waits for a frame that read the events before the next one goes out.
 */
async function drag(
	page: Page,
	from: [number, number],
	to: [number, number],
	button: 'left' | 'right' = 'left',
	steps = 4,
): Promise<Pose> {
	await page.mouse.move(from[0], from[1]);
	await nextFrame(page, (await pose(page)).time);
	await page.mouse.down({ button });
	const pressed = await until(page, (state) => state.dragging);
	expect(pressed.action).toBe(button === 'right' ? 'rotate' : 'pan');
	for (let step = 1; step <= steps; step++) {
		await page.mouse.move(
			from[0] + ((to[0] - from[0]) * step) / steps,
			from[1] + ((to[1] - from[1]) * step) / steps,
		);
		await nextFrame(page, (await pose(page)).time);
	}
	const after = await pose(page);
	await page.mouse.up({ button });
	await until(page, (state) => !state.dragging);
	return after;
}

test.describe.configure({ timeout: 180_000 });

test('the main button drags the crate over the plane that faces the camera', async ({ page }) => {
	await open(page);
	const before = await pose(page);
	const from = before.screen;
	const after = await drag(page, from, [from[0] + 80, from[1]]);
	expect(after.position[0] as number).toBeGreaterThan((before.position[0] as number) + 0.2);
	for (const k of [1, 2])
		expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
			0.05,
		);
});

test('the right button turns the crate where it stands', async ({ page }) => {
	await open(page);
	const before = await pose(page);
	const from = before.screen;
	const after = await drag(page, from, [from[0] + 60, from[1] + 40], 'right');
	const turned = Math.max(
		...after.rotation.map((value, k) => Math.abs(value - (before.rotation[k] as number))),
	);
	expect(turned).toBeGreaterThan(0.05);
	for (let k = 0; k < 3; k++)
		expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
			1e-4,
		);
});

test('a press on empty canvas holds no crate and moves nothing', async ({ page }) => {
	await open(page);
	const before = await pose(page);
	await page.mouse.move(10, 10);
	await nextFrame(page, (await pose(page)).time);
	await page.mouse.down();
	const pressed = await pose(page);
	expect(pressed.dragging).toBe(false);
	for (let step = 1; step <= 4; step++) {
		await page.mouse.move(10 + step * 20, 10 + step * 6);
		await nextFrame(page, (await pose(page)).time);
	}
	await page.mouse.up();
	const after = await pose(page);
	for (let k = 0; k < 3; k++)
		expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
			1e-5,
		);
});

test.describe('touch', () => {
	test.use({ hasTouch: true });

	/** Sends one touch event with these fingers down, through Chrome's input. */
	const touch = (
		cdp: CDPSession,
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		fingers: { x: number; y: number; id: number }[],
	) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers });

	test('a finger drags the crate as the mouse does', async ({ page }) => {
		await open(page);
		const before = await pose(page);
		const from = before.screen;
		const cdp = await page.context().newCDPSession(page);
		const finger = { x: from[0], y: from[1], id: 1 };
		await touch(cdp, 'touchStart', [finger]);
		expect((await until(page, (state) => state.dragging)).action).toBe('pan');
		for (let step = 1; step <= 4; step++) {
			finger.x += 15;
			await touch(cdp, 'touchMove', [finger]);
			await nextFrame(page, (await pose(page)).time);
		}
		const after = await pose(page);
		await touch(cdp, 'touchEnd', []);
		await until(page, (state) => !state.dragging);
		expect(after.position[0] as number).toBeGreaterThan((before.position[0] as number) + 0.2);
		for (const k of [1, 2])
			expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
				0.05,
			);
	});
});
