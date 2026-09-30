import { expect, type Page, test } from '@playwright/test';
import { type CaptureResult, captureProblems } from '../lib/capture-checks.ts';
import { ENGINE_MODES, type EngineMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

async function checkCapture(page: Page, query: string, mode: EngineMode): Promise<void> {
	await page.goto(`capture.html?${query}&${mode.query}`);
	const result = await pageResult<CaptureResult & { error?: string }>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(captureProblems(result, mode)).toEqual([]);
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
}
