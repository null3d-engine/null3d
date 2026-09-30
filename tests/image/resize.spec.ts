// Resizing the window, on the high-density screen that the Playwright project gives the browser. The
// thread that draws sizes the canvas's drawing buffer to the canvas's CSS size times the device pixel
// ratio, so the image stays sharp, or times `maxPixelRatio` when that is lower. Each thread mode
// resizes another canvas: the page's own, or the one a worker took over. A sketch that changes the
// cap during play resizes the buffer too.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

/** A pixel ratio cap below the screen's. */
const CAPPED_RATIO = 1.5;
/**
 * Window sizes in CSS pixels, in the order the test sets them: two landscape shapes, then portrait,
 * as when a tablet turns. The canvas is half the window, so each halves to whole pixels.
 */
const WINDOW_SIZES = [
	{ width: 800, height: 600 },
	{ width: 1000, height: 500 },
	{ width: 480, height: 800 },
];

/** Runs in the page: the canvas's CSS size and the size of its drawing buffer. */
const canvasSize = () => (globalThis as { canvasSize?: () => Promise<unknown> }).canvasSize?.();

/** Runs in the page: the sketch changes its pixel ratio cap, and the page waits until it has. */
const setMaxPixelRatio = (ratio: number) =>
	(globalThis as { setMaxPixelRatio?: (ratio: number) => Promise<void> }).setMaxPixelRatio?.(ratio);

/**
 * Opens the resize page with these switches, and returns the screen's device pixel ratio. The page
 * fixes a preset whose pixel ratio cap is the screen's ratio, so the preset check of a busy machine
 * cannot lower the cap.
 */
async function openPage(page: Page, query: string): Promise<number> {
	await page.goto(`resize.html?preset=high&${query}`);
	expect((await pageResult<{ error?: string }>(page, 30_000)).error).toBeUndefined();
	const ratio = await page.evaluate(
		() => (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1,
	);
	// On a screen at the cap or below, the buffers would match whatever the engine did with the ratio.
	expect(ratio, 'the screen needs more device pixels per CSS pixel').toBeGreaterThan(CAPPED_RATIO);
	return ratio;
}

/** Sets each window size, and waits until the drawing buffer is the canvas's CSS size times `ratio`. */
async function expectBuffers(page: Page, ratio: number): Promise<void> {
	for (const size of WINDOW_SIZES) {
		await page.setViewportSize(size);
		const css = { width: size.width / 2, height: size.height / 2 };
		await expect
			.poll(() => page.evaluate(canvasSize))
			.toEqual({
				css,
				buffer: { width: Math.round(css.width * ratio), height: Math.round(css.height * ratio) },
			});
	}
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`a resized canvas stays sharp on ${gpu}, ${mode.name}`, async ({ page }) => {
			const ratio = await openPage(page, `gpu=${gpu}&${mode.query}`);
			await expectBuffers(page, ratio);
		});
	}

	test(`a resized canvas keeps to maxPixelRatio on ${gpu}`, async ({ page }) => {
		await openPage(page, `gpu=${gpu}&maxPixelRatio=${CAPPED_RATIO}`);
		await expectBuffers(page, CAPPED_RATIO);
	});

	for (const mode of ENGINE_MODES) {
		test(`a sketch changes the pixel ratio cap during play on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const ratio = await openPage(page, `gpu=${gpu}&${mode.query}`);
			await page.evaluate(setMaxPixelRatio, CAPPED_RATIO);
			await expectBuffers(page, CAPPED_RATIO);
			await page.evaluate(setMaxPixelRatio, Number.POSITIVE_INFINITY);
			await expectBuffers(page, ratio);
		});
	}
}
