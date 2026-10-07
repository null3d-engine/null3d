import { expect, type Page, test } from '@playwright/test';
import { type CaptureResult, captureProblems } from '../lib/capture-checks.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

type CapturePage = CaptureResult & { error?: string; lost?: string };

async function checkCapture(page: Page, query: string, mode: EngineMode): Promise<CapturePage> {
	await page.goto(`capture.html?${query}&${mode.query}`);
	const result = await pageResult<CapturePage>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(captureProblems(result, mode)).toEqual([]);
	return result;
}

// The thread that draws encodes the image that capture() gives, from the same readback as
// captureFrame(). The boxes sketch is still, so on a live engine the next frame holds the same
// pixels as the frame before it, in every thread mode. Hold mode gives the held frame to both.
// Once the engine has stopped, capture() fails with E1414.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`capture() gives a PNG file of the frame, ${mode.name} on ${gpu}`, async ({ page }) => {
			await checkCapture(page, `gpu=${gpu}`, mode);
		});
	}
	const [pipelined] = ENGINE_MODES;
	test(`capture() gives a PNG file of the held frame on ${gpu}`, async ({ page }) => {
		await checkCapture(page, `gpu=${gpu}&hold=0`, pipelined);
	});
	// The page keeps the held frame's pixels and encodes them, so the GPU draws nothing more: the
	// image comes even after hold mode lost its only device.
	test(`capture() gives the held frame after the GPU is lost, on ${gpu}`, async ({ page }) => {
		const result = await checkCapture(page, `gpu=${gpu}&hold=0&lose`, pipelined);
		expect(result.lost).toBe('E1302');
	});
}

// captureFrame() gives the newest frame. Captures back to back each wait for the frame loop to take
// a frame after the one before, so on a slow GPU, whose readback blocks the thread that draws, the
// loop still gets its turn. The sketch's background changes shade every frame.
for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES) {
		test(`captureFrame() back to back gives newer frames, ${mode.name} on ${gpu}`, async ({
			page,
		}) => {
			await page.goto(`capture-frames.html?gpu=${gpu}&${mode.query}`);
			const result = await pageResult<{ error?: string; tier: string; shades: number[] }>(
				page,
				30_000,
			);
			expect(result.error).toBeUndefined();
			expect(result.tier).toBe(gpu);
			const repeats = result.shades.filter((shade, i) => i > 0 && shade === result.shades[i - 1]);
			expect(repeats, `shades ${result.shades.join(', ')}`).toEqual([]);
		});
	}
}
