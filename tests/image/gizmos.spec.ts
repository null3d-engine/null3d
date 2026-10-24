// The transform gizmos in a live engine. Playwright's mouse and Chrome's touches take hold of a
// handle where the page says that it draws, and drag it. The block must then move, turn or scale
// along that handle alone, and a drag that holds no handle must leave it alone. CI's software GPU
// draws a few frames a second, so every check waits on the sketch's own frames, never the page's
// clock.
import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

/** The sketch time that a check waits for, in seconds, before it gives up on a slow GPU. */
const PATIENCE = 60_000;

interface Pose {
	position: number[];
	rotation: number[];
	scale: number[];
	mode: string;
	axis: string | null;
	dragging: boolean;
	time: number;
}

/** The page's own questions, which its sketch answers. */
interface GizmoPage {
	gizmoPose?: () => Promise<Pose>;
	gizmoHandles?: () => Promise<{
		points: Record<string, number[]>;
		takes: Record<string, string>;
	}>;
	gizmoMode?: (mode: string) => Promise<string>;
	gizmoSpace?: (space: string) => Promise<string>;
}

/** Opens the gizmo page and returns once the engine has drawn its first frame. */
async function open(page: Page): Promise<void> {
	await page.goto('gizmos.html');
	const result = await pageResult<{ error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
}

const pose = (page: Page) =>
	page.evaluate(() => (globalThis as GizmoPage).gizmoPose?.()) as Promise<Pose>;

/** Where each handle shows, and what a press there takes hold of. */
const handles = (page: Page) =>
	page.evaluate(() => (globalThis as GizmoPage).gizmoHandles?.()) as Promise<{
		points: Record<string, number[]>;
		takes: Record<string, string>;
	}>;

/** Picks a mode, and waits until the sketch's handles are that mode's. */
async function setMode(page: Page, mode: string): Promise<void> {
	const answer = await page.evaluate((value) => (globalThis as GizmoPage).gizmoMode?.(value), mode);
	expect(answer).toBe(mode);
	await expect.poll(async () => (await pose(page)).mode, { timeout: PATIENCE }).toBe(mode);
	// The handles of the new mode show from the frame that applies the change, so the probe waits
	// for two frames before it takes their places.
	await nextFrame(page, (await pose(page)).time);
	await nextFrame(page, (await pose(page)).time);
}

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
 * Hovers a point, presses it, moves the pointer by a share of the drag each frame, and lets go.
 * Each step waits for a frame that read the events before the next one goes out. It returns the
 * pose at the last move, and the handle that the press took hold of.
 */
async function drag(
	page: Page,
	from: number[],
	to: number[],
	steps = 5,
): Promise<{ after: Pose; grabbed: string | null }> {
	await page.mouse.move(from[0] as number, from[1] as number);
	await nextFrame(page, (await pose(page)).time);
	await page.mouse.down();
	const pressed = await until(page, (state) => state.dragging);
	for (let step = 1; step <= steps; step++) {
		const x = (from[0] as number) + ((to[0] as number) - (from[0] as number)) * (step / steps);
		const y = (from[1] as number) + ((to[1] as number) - (from[1] as number)) * (step / steps);
		await page.mouse.move(x, y);
		await nextFrame(page, (await pose(page)).time);
	}
	const after = await pose(page);
	await page.mouse.up();
	await until(page, (state) => !state.dragging);
	return { after, grabbed: pressed.axis };
}

test.describe.configure({ timeout: 180_000 });

test('a move drags the block along the axis that it holds', async ({ page }) => {
	await open(page);
	await setMode(page, 'translate');
	const at = await handles(page);
	// A camera that looks along the Z axis takes that arm at the center handle's place.
	expect(at.takes).toEqual({
		X: 'translate X',
		Y: 'translate Y',
		Z: 'translate Z',
		XY: 'translate XY',
		YZ: 'translate YZ',
		XZ: 'translate XZ',
		XYZ: 'translate Z',
	});
	const before = await pose(page);
	const from = at.points.X as number[];
	const { after, grabbed } = await drag(page, from, [
		(from[0] as number) + 70,
		(from[1] as number) - 10,
	]);
	expect(grabbed).toBe('X');
	expect(after.position[0] as number).toBeGreaterThan((before.position[0] as number) + 0.2);
	expect(Math.abs((after.position[1] as number) - (before.position[1] as number))).toBeLessThan(
		0.05,
	);
	expect(Math.abs((after.position[2] as number) - (before.position[2] as number))).toBeLessThan(
		0.05,
	);
});

test('a drag that holds no handle leaves the block alone', async ({ page }) => {
	await open(page);
	await setMode(page, 'translate');
	const before = await pose(page);
	// A drag across an empty part of the canvas takes no handle, so the block keeps its place.
	await page.mouse.move(30, 30);
	await nextFrame(page, (await pose(page)).time);
	await page.mouse.down();
	const pressed = await pose(page);
	expect(pressed.dragging).toBe(false);
	for (let step = 1; step <= 4; step++) {
		await page.mouse.move(30 + step * 28, 30 + step * 8);
		await nextFrame(page, (await pose(page)).time);
	}
	await page.mouse.up();
	const after = await pose(page);
	for (let k = 0; k < 3; k++)
		expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
			1e-5,
		);
});

test('a turn rings the block about the axis that it holds', async ({ page }) => {
	await open(page);
	await setMode(page, 'rotate');
	const at = await handles(page);
	expect(at.takes).toEqual({ X: 'rotate X', Y: 'rotate Y', Z: 'rotate Z', E: 'rotate E' });
	const before = await pose(page);
	const from = at.points.Y as number[];
	const { after, grabbed } = await drag(page, from, [
		(from[0] as number) + 60,
		(from[1] as number) + 50,
	]);
	expect(grabbed).toBe('Y');
	const turned = Math.max(
		...after.rotation.map((value, k) => Math.abs(value - (before.rotation[k] as number))),
	);
	expect(turned).toBeGreaterThan(0.05);
	for (let k = 0; k < 3; k++)
		expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
			1e-4,
		);
});

test('a scale drag grows the block along the axis that it holds', async ({ page }) => {
	await open(page);
	await setMode(page, 'scale');
	const at = await handles(page);
	expect(at.takes).toEqual({ X: 'scale X', Y: 'scale Y', Z: 'scale Z', XYZ: 'scale Z' });
	const before = await pose(page);
	const from = at.points.X as number[];
	const { after, grabbed } = await drag(page, from, [
		(from[0] as number) + 70,
		(from[1] as number) - 10,
	]);
	expect(grabbed).toBe('X');
	expect(after.scale[0] as number).toBeGreaterThan((before.scale[0] as number) * 1.1);
	expect(Math.abs((after.scale[1] as number) - (before.scale[1] as number))).toBeLessThan(0.01);
	expect(Math.abs((after.scale[2] as number) - (before.scale[2] as number))).toBeLessThan(0.01);
});

test.describe('touch', () => {
	test.use({ hasTouch: true });

	/** Sends one touch event with these fingers down, through Chrome's input. */
	const touch = (
		cdp: CDPSession,
		type: 'touchStart' | 'touchMove' | 'touchEnd',
		fingers: { x: number; y: number; id: number }[],
	) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: fingers });

	test('a finger drags a handle as the mouse does', async ({ page }) => {
		await open(page);
		await setMode(page, 'translate');
		const at = await handles(page);
		expect(at.takes.Y).toBe('translate Y');
		const before = await pose(page);
		const from = at.points.Y as number[];
		const cdp = await page.context().newCDPSession(page);
		const finger = { x: from[0] as number, y: from[1] as number, id: 1 };
		await touch(cdp, 'touchStart', [finger]);
		expect((await until(page, (state) => state.dragging)).axis).toBe('Y');
		for (let step = 1; step <= 4; step++) {
			finger.y -= 14;
			await touch(cdp, 'touchMove', [finger]);
			await nextFrame(page, (await pose(page)).time);
		}
		const after = await pose(page);
		await touch(cdp, 'touchEnd', []);
		await until(page, (state) => !state.dragging);
		expect(after.position[1] as number).toBeGreaterThan((before.position[1] as number) + 0.15);
		expect(Math.abs((after.position[0] as number) - (before.position[0] as number))).toBeLessThan(
			0.05,
		);
	});

	test('a finger turns the block as the mouse does', async ({ page }) => {
		await open(page);
		await setMode(page, 'rotate');
		const at = await handles(page);
		expect(at.takes.Y).toBe('rotate Y');
		const before = await pose(page);
		const from = at.points.Y as number[];
		const cdp = await page.context().newCDPSession(page);
		const finger = { x: from[0] as number, y: from[1] as number, id: 1 };
		await touch(cdp, 'touchStart', [finger]);
		expect((await until(page, (state) => state.dragging)).axis).toBe('Y');
		for (let step = 1; step <= 4; step++) {
			finger.x += 15;
			finger.y += 12;
			await touch(cdp, 'touchMove', [finger]);
			await nextFrame(page, (await pose(page)).time);
		}
		const after = await pose(page);
		await touch(cdp, 'touchEnd', []);
		await until(page, (state) => !state.dragging);
		const turned = Math.max(
			...after.rotation.map((value, k) => Math.abs(value - (before.rotation[k] as number))),
		);
		expect(turned).toBeGreaterThan(0.05);
		for (let k = 0; k < 3; k++)
			expect(Math.abs((after.position[k] as number) - (before.position[k] as number))).toBeLessThan(
				1e-4,
			);
	});

	test('a finger scales the block as the mouse does', async ({ page }) => {
		await open(page);
		await setMode(page, 'scale');
		const at = await handles(page);
		expect(at.takes.X).toBe('scale X');
		const before = await pose(page);
		const from = at.points.X as number[];
		const cdp = await page.context().newCDPSession(page);
		const finger = { x: from[0] as number, y: from[1] as number, id: 1 };
		await touch(cdp, 'touchStart', [finger]);
		expect((await until(page, (state) => state.dragging)).axis).toBe('X');
		for (let step = 1; step <= 4; step++) {
			finger.x += 18;
			finger.y -= 3;
			await touch(cdp, 'touchMove', [finger]);
			await nextFrame(page, (await pose(page)).time);
		}
		const after = await pose(page);
		await touch(cdp, 'touchEnd', []);
		await until(page, (state) => !state.dragging);
		expect(after.scale[0] as number).toBeGreaterThan((before.scale[0] as number) * 1.1);
		expect(Math.abs((after.scale[1] as number) - (before.scale[1] as number))).toBeLessThan(0.01);
		expect(Math.abs((after.scale[2] as number) - (before.scale[2] as number))).toBeLessThan(0.01);
	});
});
