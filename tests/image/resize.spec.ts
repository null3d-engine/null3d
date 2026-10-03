// Resizing the window, on the high-density screen that the Playwright project gives the browser. The
// thread that draws sizes the canvas's drawing buffer to the canvas's CSS size times the device pixel
// ratio, so the image stays sharp, or times `maxPixelRatio` when that is lower. Each thread mode
// resizes another canvas: the page's own, or the one a worker took over. A sketch that changes the
// cap during play resizes the buffer too. A canvas that no CSS sizes keeps its size, and a canvas
// larger than the GPU's largest texture draws at a lower ratio.
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

/**
 * How long a new size may take to reach the drawing buffer. Each new size makes the frame's HDR
 * targets again, which SwiftShader on CI's machines takes a second or two to do.
 */
const RESIZE_TIMEOUT_MS = 15_000;

/** Sets each window size, and waits until the drawing buffer is the canvas's CSS size times `ratio`. */
async function expectBuffers(page: Page, ratio: number): Promise<void> {
	for (const size of WINDOW_SIZES) {
		await page.setViewportSize(size);
		const css = { width: size.width / 2, height: size.height / 2 };
		await expect
			.poll(() => page.evaluate(canvasSize), { timeout: RESIZE_TIMEOUT_MS })
			.toEqual({
				css,
				buffer: { width: Math.round(css.width * ratio), height: Math.round(css.height * ratio) },
			});
	}
}

/** The default size of a canvas's drawing buffer, which is its CSS size when no CSS sizes it. */
const DEFAULT_CANVAS = { width: 300, height: 150 };

/** Frames that the engine draws before a test reads a size that must not change. */
const SETTLE_FRAMES = 10;

/**
 * Runs in the page: the largest drawing buffer of a GPU path, as the browser gives it. On WebGPU it
 * is the texture size limit of a device requested as the engine requests it, and on WebGL2 the
 * smallest limit of a texture, a renderbuffer and the viewport.
 */
const browserMaxDrawingSize = (gpu: string) =>
	(globalThis as { maxDrawingSize?: (gpu: string) => Promise<number> }).maxDrawingSize?.(gpu);

/** Runs in the page: the largest drawing buffer that the engine reports for its GPU path. */
const maxCanvasSize = () => (globalThis as { maxCanvasSize?: number }).maxCanvasSize;

/** Runs in the page: the message of an engine failure after the start, if one came. */
const engineFailure = () => (globalThis as { engineFailure?: string }).engineFailure;

/** The thread modes where the page draws into its canvas, and where a worker draws into it. */
const CANVAS_MODES = ENGINE_MODES.filter(({ query }) => query === '' || query === 'render=main');

for (const gpu of ['webgpu', 'webgl2'] as const) {
	// The drawing buffer sets the CSS size of a canvas that no CSS sizes. Unless the engine fixes that
	// size, each resize grows the canvas by the pixel ratio, until the GPU cannot draw into it.
	for (const mode of CANVAS_MODES) {
		test(`a canvas that no CSS sizes keeps its size on ${gpu}, ${mode.name}`, async ({ page }) => {
			const ratio = await openPage(page, `gpu=${gpu}&css=none&${mode.query}`);
			for (let frame = 0; frame < SETTLE_FRAMES; frame++) await page.evaluate(canvasSize);
			expect(await page.evaluate(canvasSize)).toEqual({
				css: DEFAULT_CANVAS,
				buffer: {
					width: Math.round(DEFAULT_CANVAS.width * ratio),
					height: Math.round(DEFAULT_CANVAS.height * ratio),
				},
			});
		});
	}

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

// Compatibility mode allows smaller textures than core WebGPU, so a canvas that fits core WebGPU's
// limit can still be too large for it.
for (const gpu of ['webgpu', 'compat', 'webgl2'] as const) {
	test(`a canvas wider than the largest texture draws at a lower ratio on ${gpu}`, async ({
		page,
	}) => {
		// Wider than any GPU's largest texture at the screen's ratio, and thin, so its targets stay small.
		const css = { width: 20_000, height: 8 };
		const ratio = await openPage(page, `gpu=${gpu}&css=${css.width}x${css.height}`);
		const maxSize = Number(await page.evaluate(browserMaxDrawingSize, gpu));
		const fit = maxSize / (css.width * ratio);
		expect(fit).toBeLessThan(1);
		await expect
			.poll(() => page.evaluate(canvasSize), { timeout: RESIZE_TIMEOUT_MS })
			.toEqual({
				css,
				buffer: { width: maxSize, height: Math.round(css.height * ratio * fit) },
			});
		expect(await page.evaluate(maxCanvasSize)).toBe(maxSize);
		expect(await page.evaluate(engineFailure)).toBeUndefined();
	});
}
