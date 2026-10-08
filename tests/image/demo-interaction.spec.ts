// The demos take the user's input at any moment. Playwright drives the mouse over two live demos,
// and the probe sketch reports where each demo's camera and moving objects are. A hover leads the
// math demo's light and leaves its camera alone. In the instances demo, a drag hands the scripted
// camera over to the user with no jump, the script then stops moving it, and the wheel zooms.
import { expect, type Page, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';
import type { DemoProbe } from '../pages/lib/demo-probe.ts';

/** Opens a demo on the probe page, and collects the page's errors. */
async function open(page: Page, demo: string): Promise<string[]> {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		// The page has no icon, and the browser's request for one is no fault of the demo.
		if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico'))
			errors.push(message.text());
	});
	await page.goto(`demo-probe.html?demo=${demo}`);
	const result = await pageResult<{ error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	return errors;
}

const probe = (page: Page) =>
	page.evaluate(() =>
		(globalThis as { demoProbe?: () => Promise<DemoProbe> }).demoProbe?.(),
	) as Promise<DemoProbe>;

const apart = (a: number[], b: number[]) =>
	Math.hypot(...a.map((value, k) => value - (b[k] as number)));

/** The math demo's light: the first dynamic mesh it makes. */
const lightX = async (page: Page) => ((await probe(page)).objects[0] as number[])[0] as number;

test('a hover leads the math demo light, and leaves its camera alone', async ({ page }) => {
	const errors = await open(page, 'math');
	const start = await probe(page);
	// The left of the canvas points over the left of the floor, and the right over the right.
	for (const [x, side] of [
		[80, -1],
		[560, 1],
	] as const) {
		await page.mouse.move(x, 180);
		await page.mouse.move(x + 2, 182);
		await expect
			.poll(async () => side * (await lightX(page)), { timeout: 5_000 })
			.toBeGreaterThan(3);
		// The scripted path would cross the middle within 2 seconds; the led light stays on its side.
		for (let sample = 0; sample < 4; sample++) {
			await page.waitForTimeout(250);
			expect(side * (await lightX(page))).toBeGreaterThan(3);
		}
	}
	expect(apart((await probe(page)).camera, start.camera)).toBeLessThan(1e-6);
	expect(errors).toEqual([]);
});

test('a drag takes the instances demo camera from its script with no jump, and the wheel zooms', async ({
	page,
}) => {
	const errors = await open(page, 'instances');
	// The script circles the camera 34 m from the middle and 20 m up, at 0.2 radians a second.
	const radius = Math.hypot(34, 20);
	const first = await probe(page);
	await page.waitForTimeout(500);
	const before = await probe(page);
	expect(apart(first.camera, before.camera)).toBeGreaterThan(1);

	// A short drag across: past the click limit, it turns the camera a little around the middle.
	await page.mouse.move(320, 180);
	await page.mouse.down();
	await page.mouse.move(326, 180, { steps: 3 });
	await page.mouse.up();
	await page.waitForTimeout(1_000);
	const taken = await probe(page);
	expect(Math.hypot(...taken.camera)).toBeCloseTo(radius, 1);
	expect(taken.camera[1]).toBeCloseTo(20, 1);
	// From the script's place, by the drag's small turn and the script's motion until the drag.
	expect(apart(taken.camera, before.camera)).toBeLessThan(6);
	// The script, which would move the camera 7 m in a second, no longer moves it.
	await page.waitForTimeout(1_000);
	expect(apart((await probe(page)).camera, taken.camera)).toBeLessThan(0.2);

	await page.mouse.wheel(0, -400);
	await expect
		.poll(async () => Math.hypot(...(await probe(page)).camera), { timeout: 5_000 })
		.toBeLessThan(radius * 0.9);
	expect(errors).toEqual([]);
});
