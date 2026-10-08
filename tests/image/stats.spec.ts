import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import { type OverlayBoxes, type StatsResult, statsProblems } from '../lib/stats-checks.ts';

/** The overlay's element, which the page adds to its body. */
const OVERLAY = '[data-null3d-stats]';
/** The overlay's header button, which shows and hides its card. */
const HEADER = `${OVERLAY} button[aria-controls]`;
/** The overlay's card of figures. */
const CARD = `${OVERLAY} .card`;
/** The button of the frame mode's symbol, and its tooltip. */
const MODE_BUTTON = `${OVERLAY} button[aria-describedby]`;
const TOOLTIP = `${OVERLAY} [role=tooltip]`;

const MODES = [
	...ENGINE_MODES.map((mode) => ({ ...mode, query: `gpu=webgpu&${mode.query}` })),
	{ ...ENGINE_MODES[0], name: 'pipelined, WebGL2', query: 'gpu=webgl2' },
	{
		...ENGINE_MODES[0],
		name: 'pipelined, WebGL2, from the ?stats switch',
		query: 'gpu=webgl2&stats',
	},
];

/** Runs in the page: asks the sketch to show or hide the overlay. */
const show = (on: boolean) =>
	(globalThis as { showStats?: (show: boolean) => void }).showStats?.(on);
/** Runs in the page: asks the page to show or hide the overlay, or to change its options. */
const showFromPage = (request: boolean | { collapsed?: boolean }) =>
	(globalThis as { showPageStats?: (show: unknown) => void }).showPageStats?.(request);
/** Opens the stats page and waits for its result. */
async function openStats(page: Page, query: string): Promise<StatsResult & { error?: string }> {
	await page.goto(`stats.html?${query}`);
	const result = await pageResult<StatsResult & { error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	return result;
}

/** Calls one of the page's helpers by its name, and returns what it returns. */
function call<T>(page: Page, name: string, ...args: unknown[]): Promise<T> {
	return page.evaluate(
		([helper, values]) =>
			(globalThis as unknown as Record<string, (...each: unknown[]) => unknown>)[
				helper as string
			]?.(...(values as unknown[])) as T,
		[name, args] as const,
	);
}

/** The boxes of the canvas, the overlay's element and its header button, in the page. */
const boxes = (page: Page) => call<OverlayBoxes>(page, 'overlayBoxes');

/** Checks that the overlay sits on the canvas's top-right corner. */
function expectTopRight(at: OverlayBoxes): void {
	expect(at.host.right).toBeCloseTo(at.canvas.right, 0);
	expect(at.host.top).toBeCloseTo(at.canvas.top, 0);
}

/** Checks that the header button has the same right and top edges in two sets of boxes. */
function expectButtonKept(before: OverlayBoxes, after: OverlayBoxes): void {
	expect(after.button.right).toBeCloseTo(before.button.right, 0);
	expect(after.button.top).toBeCloseTo(before.button.top, 0);
}

for (const mode of MODES)
	test(`the stats overlay and the sketch's frame figures, ${mode.name}`, async ({ page }) => {
		const result = await openStats(page, mode.query);
		expect(statsProblems(result)).toEqual([]);
		// Chrome's GPU paths time frames wherever they offer the timer.
		if (result.gpuTimer) expect(result.figures?.gpuMs).not.toBeNull();

		// The overlay keeps to the canvas's top-right corner, and its button stays put as the card
		// closes and opens again.
		const open = await boxes(page);
		expectTopRight(open);
		await page.evaluate(showFromPage, { collapsed: true });
		await expect(page.locator(CARD)).toBeHidden();
		const closed = await boxes(page);
		expectTopRight(closed);
		expectButtonKept(open, closed);
		await page.evaluate(showFromPage, { collapsed: false });
		await expect(page.locator(CARD)).toBeVisible();
		expectButtonKept(open, await boxes(page));

		// Hidden and shown again by the sketch and by the page, then gone with the engine.
		const overlay = page.locator(OVERLAY);
		await page.evaluate(show, false);
		await expect(overlay).toHaveCount(0);
		await page.evaluate(show, true);
		await expect(overlay).toHaveCount(1);
		await page.evaluate(showFromPage, false);
		await expect(overlay).toHaveCount(0);
		await page.evaluate(showFromPage, true);
		await expect(overlay).toHaveCount(1);
		await page.evaluate(() => (globalThis as { stopEngine?: () => Promise<void> }).stopEngine?.());
		await expect(overlay).toHaveCount(0);
	});

test('the stats overlay leaves out the figures that the browser does not give, and its memory adds up', async ({
	page,
}) => {
	const result = await openStats(page, 'gpu=webgl2&no-page-memory');
	expect(statsProblems(result)).toEqual([]);
	expect(Object.keys(result.overlay?.figures ?? {})).not.toContain('js-heap');
	expect(Object.keys(result.overlay?.figures ?? {})).not.toContain('page-memory');
});

test('the stats overlay opens and closes by pointer and keyboard, and keeps its button in place', async ({
	page,
}) => {
	await openStats(page, 'gpu=webgl2');
	await page.evaluate(showFromPage, { collapsed: true });
	const header = page.locator(HEADER);
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator(CARD)).toBeHidden();
	await expect(header).toHaveText(/^\d+ fps$/);
	let at = await boxes(page);
	expectTopRight(at);

	// A click opens the card and a second closes it, and the button stays where it was.
	const collapsed = at;
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator(CARD)).toBeVisible();
	expectButtonKept(collapsed, await boxes(page));
	await header.click();
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	expectButtonKept(collapsed, await boxes(page));

	// Enter and Space toggle it from the keyboard, with a focus ring, and the sketch's keyboard
	// input hears neither key.
	const keysBefore = (await call<{ keys: string[] }>(page, 'inputSeen')).keys.length;
	await header.focus();
	await page.keyboard.press('Enter');
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	expect(await call(page, 'focusRing')).toEqual({ focused: true, outline: 'solid' });
	await page.keyboard.press(' ');
	await expect(header).toHaveAttribute('aria-expanded', 'false');
	expect((await call<{ keys: string[] }>(page, 'inputSeen')).keys.slice(keysBefore)).toEqual([]);

	// Over the open card, the pointer reaches the canvas: a drag there starts on the canvas.
	await page.keyboard.press('Enter');
	at = await boxes(page);
	const card = await page.locator(CARD).boundingBox();
	if (!card) throw new Error('the card has no box');
	const x = Math.max(card.x, at.canvas.left) + 10;
	const y = Math.min(card.y + card.height, at.canvas.bottom) - 10;
	const target = await call(page, 'elementAt', x, y);
	const downs = (await call<{ canvasDowns: number }>(page, 'inputSeen')).canvasDowns;
	expect(target).toBe('CANVAS');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 20, y - 5);
	await page.mouse.up();
	expect((await call<{ canvasDowns: number }>(page, 'inputSeen')).canvasDowns).toBe(downs + 1);
});

for (const { name, query, latency } of [
	{ name: 'pipelined', query: 'gpu=webgl2', latency: 'pipelined' },
	{ name: 'low latency', query: 'gpu=webgl2&latency=low', latency: 'low' },
])
	test(`the stats overlay names the ${name} mode with a symbol and a tooltip`, async ({ page }) => {
		const result = await openStats(page, query);
		const figures = result.overlay?.figures ?? {};
		expect(Object.keys(figures).filter((figure) => figure.startsWith('mode:'))).toEqual([
			`mode:${latency}`,
		]);
		expect('sketch-drawing' in figures).toBe(latency === 'low');
		expect('sketch' in figures).toBe(latency !== 'low');
		const button = page.locator(MODE_BUTTON);
		const tooltip = page.locator(TOOLTIP);
		await expect(button).toHaveAttribute(
			'aria-label',
			latency === 'low' ? 'Low-latency mode: what it means' : 'Pipelined mode: what it means',
		);
		await expect(tooltip).toBeHidden();
		// The keyboard's focus shows the tooltip, and moving it on hides it.
		await page.locator(HEADER).focus();
		await page.keyboard.press('Tab');
		await expect(button).toBeFocused();
		await expect(tooltip).toBeVisible();
		await page.keyboard.press('Shift+Tab');
		await expect(tooltip).toBeHidden();
		// A tap shows it with the pointer away, and a second tap hides it again.
		await button.click();
		await page.mouse.move(0, 0);
		await expect(tooltip).toBeVisible();
		await button.click();
		await page.mouse.move(0, 0);
		await expect(tooltip).toBeHidden();
	});

for (const gpu of ['webgpu', 'webgl2'])
	test(`the collapsed stats overlay makes the GPU time and read back nothing, on ${gpu}`, async ({
		page,
	}) => {
		// The page draws, so it sees the GPU calls, and the sketch reads no figures of its own.
		const result = await openStats(
			page,
			`gpu=${gpu}&render=main&quiet&stats=collapsed&preset=medium`,
		);
		expect(result.overlay?.expanded).toBe('false');
		const calls = () =>
			page.evaluate(() =>
				(
					globalThis as {
						gpuCalls?: () => { timerQueries: number; resolves: number; readbacks: number };
					}
				).gpuCalls?.(),
			);
		const counted = async () => {
			const before = await calls();
			await page.waitForTimeout(2000);
			const after = await calls();
			if (!before || !after) throw new Error('the page counts no GPU calls');
			return {
				timerQueries: after.timerQueries - before.timerQueries,
				resolves: after.resolves - before.resolves,
				readbacks: after.readbacks - before.readbacks,
			};
		};
		expect(await counted()).toEqual({ timerQueries: 0, resolves: 0, readbacks: 0 });
		// The open card samples, which shows that the page counts what the GPU path does.
		await page.evaluate(showFromPage, { collapsed: false });
		await page.waitForTimeout(500);
		const open = await counted();
		if (result.gpuTimer)
			expect(open.timerQueries + open.resolves + open.readbacks).toBeGreaterThan(0);
	});
