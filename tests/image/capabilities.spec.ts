import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface FloatTargetTest {
	complete: boolean;
	readsBack: boolean;
}

interface CapabilitiesResult {
	error?: string;
	report: {
		webgl2: {
			available: boolean;
			extensions: Record<string, boolean>;
			floatRenderTargets: { rgba16f: FloatTargetTest; rgba32f: FloatTargetTest } | null;
		};
	};
}

test('the capability report says which float textures WebGL2 renders into', async ({ page }) => {
	await page.goto('capabilities.html');
	const result = await pageResult<CapabilitiesResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	const { webgl2 } = result.report;
	expect(webgl2.available).toBe(true);
	// WebGL2 renders into both formats with the full extension, into 16-bit floats with the half
	// one, and into neither without them.
	const works = { complete: true, readsBack: true };
	const refused = { complete: false, readsBack: false };
	const full = webgl2.extensions.EXT_color_buffer_float === true;
	const half = full || webgl2.extensions.EXT_color_buffer_half_float === true;
	expect(webgl2.floatRenderTargets).toEqual({
		rgba16f: half ? works : refused,
		rgba32f: full ? works : refused,
	});
});
