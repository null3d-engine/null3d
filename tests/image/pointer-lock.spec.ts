// The pointer lock in a live engine. A click on the canvas asks for the lock with
// engine.requestPointerLock(), and Playwright's mouse moves then reach the sketch's first-person
// controls through the engine's input, and three.js's PointerLockControls on the same canvas
// through their DOM listeners. Both cameras must reach the same rotation, and both must see the
// lock begin and end. The deterministic simulation demo locks the pointer with its page's own code,
// and a click under that lock raises no error. With input off and the sketch on the page's thread,
// the sketch's module loads while the core downloads, and a development build still names the
// controls that the module imports.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

// Playwright's headless shell, the default Chromium of the SwiftShader runs, gets the lock wrong. On
// Linux, as in CI, each move under the lock reports the pointer's position as its movement, and then
// the same movement back, so the moves add up to nothing. On a Mac it refuses the lock. Playwright's
// full Chromium build, in Chrome's own headless mode, locks and reports the movement as Google Chrome
// does. So these tests run in it, where the environment names no browser of its own, by channel or
// by executable.
test.use({
	channel: [
		async ({ launchOptions }, use) =>
			use(launchOptions.channel ?? (launchOptions.executablePath ? undefined : 'chromium')),
		{ scope: 'worker' },
	],
});

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

async function open(page: Page, query = ''): Promise<void> {
	await page.goto(`pointer-lock.html${query}`);
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

/** Whether the canvas holds the pointer lock now. */
const lockedToCanvas = (page: Page) =>
	page.evaluate(() => (globalThis as { lockedToCanvas?: () => boolean }).lockedToCanvas?.());

/** Stops the page's engine. */
const destroyEngine = (page: Page) =>
	page.evaluate(() => (globalThis as { destroyEngine?: () => Promise<void> }).destroyEngine?.());

test('destroying the engine ends the lock that it took', async ({ page }) => {
	await open(page);
	await lock(page);
	await destroyEngine(page);
	await expect.poll(() => lockedToCanvas(page)).toBe(false);
});

test('with input off, the engine refuses the lock with E1426, and leaves the page its own', async ({
	page,
}) => {
	const notes: string[] = [];
	page.on('console', (message) => {
		if (message.text().startsWith('null3D: ')) notes.push(message.text());
	});
	await open(page, '?noInput');
	// The click asks the engine for the lock, which it refuses, and locks the canvas with the page's
	// own call.
	await page.mouse.click(160, 90);
	await expect
		.poll(() => page.evaluate(() => (globalThis as { lockRequests?: string[] }).lockRequests))
		.toHaveLength(1);
	const [refusal] = await page.evaluate(
		() => (globalThis as { lockRequests?: string[] }).lockRequests ?? [],
	);
	expect(refusal).toMatch(
		/^E1426: engine\.requestPointerLock\(\) was called on an engine started with input: false, /,
	);
	await expect.poll(() => lockedToCanvas(page)).toBe(true);
	// The sketch hears nothing of the page's lock.
	expect((await page.evaluate(readPoses)).null3d.locked).toBe(false);
	// Its first-person controls read ctx.input, which a development build names once for each.
	expect(notes.filter((note) => note.includes('@null3d/controls'))).toHaveLength(1);
	expect(notes.filter((note) => note.includes('ctx.input was read'))).toHaveLength(1);
	// Stopping the engine leaves the lock that the page took.
	await destroyEngine(page);
	expect(await lockedToCanvas(page)).toBe(true);
});

test("with input off and the sketch on the page's thread, the sketch loads beside the core, and its module's controls are named", async ({
	page,
}) => {
	const notes: string[] = [];
	page.on('console', (message) => {
		if (message.text().startsWith('null3D: ')) notes.push(message.text());
	});
	// The core's download waits, for up to fifteen seconds, until the sketch's module has loaded
	// and its import of the controls has checked their version. A page that loads the sketch only
	// once the core has started loads it after that.
	// The page hears each add-on that checks its version, through the record that a development
	// build keeps on the thread's global object under Symbol.for('null3d.addonsChecked'): a set of
	// handlers. The script runs before the page's own, so it hears the sketch's imports too.
	await page.addInitScript(() => {
		const heard: string[] = [];
		const scope = globalThis as unknown as Record<symbol, Set<(name: string) => void>> & {
			addonsHeard?: string[];
		};
		scope.addonsHeard = heard;
		const record = Symbol.for('null3d.addonsChecked');
		scope[record] ??= new Set();
		scope[record].add((name) => heard.push(name));
	});
	let coreWaited = 'no core download';
	await page.route(/\/null3d_bg(-[\w-]+)?\.wasm(\?|$)/, async (route) => {
		const until = Date.now() + 15_000;
		coreWaited = 'the sketch did not load while the core downloaded';
		while (Date.now() < until) {
			const loaded = await page
				.evaluate(() =>
					(globalThis as { addonsHeard?: string[] }).addonsHeard?.includes('@null3d/controls'),
				)
				.catch(() => false);
			if (loaded) {
				coreWaited = 'the sketch loaded first';
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		await route.continue();
	});
	await open(page, '?noInput&sketch-thread=main');
	expect(coreWaited).toBe('the sketch loaded first');
	// The sketch's module imports the controls, which a development build names once the runner
	// exists, from what the page heard while the module loaded.
	expect(notes.filter((note) => note.includes('@null3d/controls'))).toHaveLength(1);
});

test("a click while the deterministic simulation demo's page holds the lock raises no error", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('demo-probe.html?demo=replay&preset=low');
	const result = await pageResult<{ error?: string }>(page, 60_000);
	expect(result.error).toBeUndefined();
	// A click that drags nothing asks for the page's own lock.
	await page.mouse.click(320, 180);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(globalThis as unknown as { document: { pointerLockElement: unknown } }).document
						.pointerLockElement !== null,
			),
		)
		.toBe(true);
	// Under the lock a press goes to the canvas, which the page must not capture: the browser
	// refuses a capture while the pointer is locked.
	await page.mouse.click(320, 180);
	await page.mouse.click(320, 180);
	// A frame on, so an error that the presses raised has reached the page's handler.
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				(
					globalThis as unknown as { requestAnimationFrame(callback: () => void): void }
				).requestAnimationFrame(() => resolve(null)),
			),
	);
	expect(errors).toEqual([]);
});
