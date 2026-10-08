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
			.poll(async () => side * (await lightX(page)), { timeout: 15_000 })
			.toBeGreaterThan(3);
		// The scripted path would cross the middle within 2 seconds; the led light stays on its side.
		// A small move before each sample keeps the pointer from going idle at any frame rate.
		for (let sample = 0; sample < 4; sample++) {
			await page.mouse.move(x + (sample % 2), 182);
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

	// A short drag across: past the click limit, it turns the camera a little around the middle. A
	// press alone hands nothing over, so the script still moves the camera until the drag.
	await page.mouse.move(320, 180);
	await page.mouse.down();
	const pressed = await probe(page);
	await page.mouse.move(326, 180, { steps: 3 });
	await page.mouse.up();
	// The controls' damping lets the camera coast after the drag. Wait until it rests: two probes at
	// least a fifth of a second of sketch time apart. A slow software GPU can answer two probes from
	// one frame, so the probes count the sketch's time, not the page's.
	let last = await probe(page);
	await expect
		.poll(
			async () => {
				await page.waitForTimeout(250);
				const next = await probe(page);
				if (next.time - last.time < 0.2) return Number.POSITIVE_INFINITY;
				const moved = apart(next.camera, last.camera);
				last = next;
				return moved;
			},
			{ timeout: 30_000 },
		)
		.toBeLessThan(0.02);
	const taken = last;
	// The camera stays on the script's circle: a jump to another pose would leave it.
	expect(Math.hypot(...taken.camera)).toBeCloseTo(radius, 1);
	expect(taken.camera[1]).toBeCloseTo(20, 1);
	// From the script's place at the press, by the drag's small turn and the script's last frames.
	expect(apart(taken.camera, pressed.camera)).toBeLessThan(8);
	// The script, which would move the camera 7 m in a second, no longer moves it.
	let later = taken;
	await expect
		.poll(async () => {
			later = await probe(page);
			return later.time - taken.time;
		})
		.toBeGreaterThan(1);
	expect(apart(later.camera, taken.camera)).toBeLessThan(0.05);

	await page.mouse.wheel(0, -400);
	await expect
		.poll(async () => Math.hypot(...(await probe(page)).camera), { timeout: 15_000 })
		.toBeLessThan(radius * 0.9);
	expect(errors).toEqual([]);
});
