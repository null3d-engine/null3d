// The demos take the user's input at any moment. Playwright drives the mouse over two live demos,
// and the probe sketch reports where each demo's camera and moving objects are, with the sketch time
// of the frame that answered. A hover leads the math demo's lamp and leaves its camera alone. In
// the instances demo, a drag hands the scripted camera over to the user with no jump, the script
// then stops moving it, and the wheel zooms.
// CI's software GPU draws only a few frames a second, and a frame's step is at most 0.25 s, so
// sketch time can run slower than the page's. Every check therefore waits on sketch time or on a
// condition, never on the page's clock alone.
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
	// The interaction does not depend on the look. The Low preset draws the light version of each
	// demo, as on a phone, which CI's software GPU draws several times faster than the full look.
	await page.goto(`demo-probe.html?demo=${demo}&preset=low`);
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

/** How long a wait on sketch time or on a condition may take, in milliseconds of page time. */
const PATIENCE = 60_000;
// Each test waits several times, so it may take longer than the default limit on a slow GPU.
test.describe.configure({ timeout: 180_000 });

/** The probe of the first frame at or after the sketch time `time`. */
async function probeAt(page: Page, time: number): Promise<DemoProbe> {
	let report = await probe(page);
	await expect
		.poll(
			async () => {
				report = await probe(page);
				return report.time;
			},
			{ timeout: PATIENCE },
		)
		.toBeGreaterThanOrEqual(time);
	return report;
}

/** The math demo's lamp: the first dynamic mesh it makes, the lamp's bulb. */
const lightX = (report: DemoProbe) => (report.objects[0] as number[])[0] as number;

test('a hover leads the math demo lamp, and leaves its camera alone', async ({ page }) => {
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
			.poll(async () => side * lightX(await probe(page)), { timeout: PATIENCE })
			.toBeGreaterThan(3);
		// The scripted light stays more than 3 m to one side for at most 2.4 s at a time. The led light
		// stays there for 3 s of sketch time. A small move before each probe keeps the pointer from
		// going idle, however slowly the frames come.
		const led = await probe(page);
		let report = led;
		for (let nudge = 0; report.time < led.time + 3; nudge++) {
			await page.mouse.move(x + (nudge % 2), 182);
			await page.waitForTimeout(100);
			report = await probe(page);
			expect(side * lightX(report)).toBeGreaterThan(3);
		}
	}
	expect(apart((await probe(page)).camera, start.camera)).toBeLessThan(1e-6);
	expect(errors).toEqual([]);
});

test('a drag takes the instances demo camera from its script with no jump, and the wheel zooms', async ({
	page,
}) => {
	const errors = await open(page, 'instances');
	// The script circles the camera 40 m from the middle and 11 m up, at 0.1 radians a second.
	const radius = Math.hypot(40, 11);
	const scriptSpeed = 0.1 * 40;
	// Half a second of sketch time moves the scripted camera about 2 m.
	const first = await probe(page);
	const before = await probeAt(page, first.time + 0.5);
	expect(apart(first.camera, before.camera)).toBeGreaterThan(1);

	// A short drag across: past the click limit, it turns the camera a little around the middle. A
	// press alone hands nothing over, so the script moves the camera until the drag reaches the
	// sketch, at the latest in the frame that answers the probe after the release.
	await page.mouse.move(320, 180);
	await page.mouse.down();
	const pressed = await probe(page);
	await page.mouse.move(326, 180, { steps: 3 });
	await page.mouse.up();
	const released = await probe(page);
	// The controls' damping lets the camera coast after the drag. Wait until it rests: two probes at
	// least a fifth of a second of sketch time apart move it less than 2 cm.
	let last = released;
	await expect
		.poll(
			async () => {
				const next = await probeAt(page, last.time + 0.2);
				const moved = apart(next.camera, last.camera);
				last = next;
				return moved;
			},
			{ timeout: PATIENCE },
		)
		.toBeLessThan(0.02);
	const taken = last;
	// The camera stays on the script's circle: a jump to another pose would leave it.
	expect(Math.hypot(...taken.camera)).toBeCloseTo(radius, 1);
	expect(taken.camera[1]).toBeCloseTo(11, 1);
	// From the script's place at the press: the script's motion until the release, the drag's turn
	// of 6 pixels (a turn of 2π for the canvas's 360 pixels of height), and one frame to spare.
	const dragTurn = ((2 * Math.PI * 6) / 360) * 40;
	const allowed = scriptSpeed * (released.time - pressed.time + 0.25) + dragTurn;
	expect(apart(taken.camera, pressed.camera)).toBeLessThan(allowed);
	// The script, which would move the camera 4 m in a second, no longer moves it.
	const later = await probeAt(page, taken.time + 1);
	expect(apart(later.camera, taken.camera)).toBeLessThan(0.05);

	await page.mouse.wheel(0, -400);
	await expect
		.poll(async () => Math.hypot(...(await probe(page)).camera), { timeout: PATIENCE })
		.toBeLessThan(radius * 0.9);
	expect(errors).toEqual([]);
});
