// The page's start data reaches the sketch's setup before the first frame. The test page reads its
// own address and passes a background color as `sketchData`, as a scroll-driven page passes the
// section that its address names. In hold mode, which no message can reach before the held frame,
// the held frame shows that color in every thread mode. A recording keeps the data, and its replay
// gives the sketch the recorded data even when the replaying page passes other data.
import { expect, type Page, test } from '@playwright/test';
import { type HoldReport, holdResult } from '../../packages/cli/src/page.js';
import { ENGINE_MODES } from '../lib/engine-checks.ts';

/** What the test page keeps. */
interface DataPage {
	sketchDataSeen?: unknown;
	sketchDataReady?: boolean;
	sketchDataError?: string;
	null3dEngine?: { saveRecording(): Promise<Uint8Array | undefined> };
}

/** The color of the held frame's middle pixel, as red, green and blue. */
function middleColor(held: HoldReport): number[] {
	if (!held.ok) throw new Error(`hold mode failed: ${held.error}`);
	const pixels = Buffer.from(held.pixels, 'base64');
	const at = (Math.floor(held.height / 2) * held.width + Math.floor(held.width / 2)) * 4;
	return [pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0];
}

/** What the sketch's setup read, once the page has heard it. */
function seenData(page: Page): Promise<unknown> {
	return page
		.waitForFunction(() => (globalThis as DataPage).sketchDataSeen !== undefined)
		.then(() => page.evaluate(() => (globalThis as DataPage).sketchDataSeen));
}

const GREEN = { color: '#00ff00', level: 3 };

for (const mode of ENGINE_MODES)
	test(`a held frame shows the page's start data, ${mode.name}`, async ({ page }) => {
		const query = mode.query ? `&${mode.query}` : '';
		await page.goto(`sketch-data.html?hold=0.5&color=%2300ff00&level=3${query}`);
		const held = await holdResult(page, 30_000);
		const [red = 0, green = 0, blue = 0] = middleColor(held);
		expect(green).toBeGreaterThan(150);
		expect(red).toBeLessThan(green / 2);
		expect(blue).toBeLessThan(green / 2);
		expect(await seenData(page)).toEqual(GREEN);
	});

test("a replay gives the sketch the recording's start data, not the replaying page's", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.goto('sketch-data.html?record&color=%2300ff00&level=3');
	await page.waitForFunction(
		() =>
			(globalThis as DataPage).sketchDataReady === true ||
			(globalThis as DataPage).sketchDataError !== undefined,
		undefined,
		{ timeout: 60_000 },
	);
	expect(await page.evaluate(() => (globalThis as DataPage).sketchDataError)).toBeUndefined();
	const bytes = await page.evaluate(async () => {
		const engine = (globalThis as DataPage).null3dEngine;
		if (engine === undefined) throw new Error('the page has no engine');
		return Array.from((await engine.saveRecording()) ?? []);
	});
	expect(bytes.length).toBeGreaterThan(0);

	await page.route(
		(url) => url.pathname === '/data.n3dr',
		(route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/octet-stream',
				body: Buffer.from(bytes),
			}),
	);
	await page.goto('sketch-data.html?replay=/data.n3dr&color=%23ff0000&level=9');
	const held = await holdResult(page, 30_000);
	const [red = 0, green = 0] = middleColor(held);
	expect(green).toBeGreaterThan(150);
	expect(red).toBeLessThan(green / 2);
	expect(await seenData(page)).toEqual(GREEN);
});
