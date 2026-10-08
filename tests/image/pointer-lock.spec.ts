// The pointer lock in a live engine. A click on the canvas asks for the lock with
// engine.requestPointerLock(), and Playwright's mouse moves then reach the sketch's first-person
// controls through the engine's input, and three.js's PointerLockControls on the same canvas
// through their DOM listeners. Both cameras must reach the same rotation, and both must see the
// lock begin and end.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface Pose {
	rotation: number[];
	locked: boolean;
}

interface Poses {
	null3d: Pose;
	three: Pose;
}

/** Runs in the page: both cameras' rotations, and whether each side sees the lock. */
const readPoses = () =>
	(globalThis as { lockPoses?: () => Promise<Poses> }).lockPoses?.() as Promise<Poses>;

/** How far apart the two rotations are: 0 for the same rotation. */
function apart({ null3d, three }: Poses): number {
	const dot = null3d.rotation.reduce(
		(sum, value, k) => sum + value * (three.rotation[k] as number),
		0,
	);
	return 1 - Math.abs(dot);
}

async function open(page: Page): Promise<void> {
	await page.goto('pointer-lock.html');
	const result = await pageResult<Record<string, unknown>>(page, 30_000);
	expect(result.error).toBeUndefined();
}

/** Clicks the canvas, which asks for the lock, and waits until both sides see it. */
async function lock(page: Page): Promise<void> {
	await page.mouse.click(160, 90);
	await expect
		.poll(() => page.evaluate(() => (globalThis as { lockRequests?: string[] }).lockRequests))
		.toEqual(['locked']);
	await expect
		.poll(async () => {
			const { null3d, three } = await page.evaluate(readPoses);
			return [null3d.locked, three.locked];
		})
		.toEqual([true, true]);
}

test("first-person controls turn as three.js's PointerLockControls while the pointer is locked", async ({
	page,
}) => {
	await open(page);
	const before = await page.evaluate(readPoses);
	await lock(page);
	// The pointer stays still while locked, so each move gives the movement from the last one.
	await page.mouse.move(220, 70, { steps: 6 });
	await page.mouse.move(120, 130, { steps: 8 });
	await expect.poll(async () => apart(await page.evaluate(readPoses))).toBeLessThan(1e-6);
	const after = await page.evaluate(readPoses);
	// The moves turned both cameras.
	expect(apart({ null3d: after.null3d, three: before.three })).toBeGreaterThan(1e-3);

	await page.evaluate(() =>
		(globalThis as unknown as { document: { exitPointerLock(): void } }).document.exitPointerLock(),
	);
	await expect
		.poll(async () => {
			const { null3d, three } = await page.evaluate(readPoses);
			return [null3d.locked, three.locked];
		})
		.toEqual([false, false]);
	// Without the lock, a move turns neither camera.
	await page.mouse.move(40, 40, { steps: 4 });
	await expect.poll(async () => apart(await page.evaluate(readPoses))).toBeLessThan(1e-6);
});

test('a request that the browser refuses fails with E1425', async ({ page }) => {
	await open(page);
	// The browser locks the pointer only to an element on the page.
	const message = await page.evaluate(() =>
		(globalThis as { lockDetached?: () => Promise<string> }).lockDetached?.(),
	);
	expect(message).toMatch(/^E1425: the browser refused the pointer lock: /);
});
