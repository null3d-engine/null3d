import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface FloatTargetTest {
	complete: boolean;
	readsBack: boolean;
	samples: number;
}

interface CapabilitiesResult {
	error?: string;
	report: {
		webgl2: {
			available: boolean;
			extensions: Record<string, boolean>;
			floatRenderTargets: {
				rgba16f: FloatTargetTest;
				rgba32f: FloatTargetTest;
				r11fG11fB10f: FloatTargetTest;
			} | null;
		};
	};
}

test('the capability report says which float textures WebGL2 renders into', async ({ page }) => {
	await page.goto('capabilities.html');
	const result = await pageResult<CapabilitiesResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	const { webgl2 } = result.report;
	expect(webgl2.available).toBe(true);
	// WebGL2 renders into the three formats with the full extension, into 16-bit floats with the
	// half one, and into none without them. The sample count of a format it renders into depends on
	// the device.
	const works = { complete: true, readsBack: true, samples: expect.any(Number) };
	const refused = { complete: false, readsBack: false, samples: 0 };
	const full = webgl2.extensions.EXT_color_buffer_float === true;
	const half = full || webgl2.extensions.EXT_color_buffer_half_float === true;
	expect(webgl2.floatRenderTargets).toEqual({
		rgba16f: half ? works : refused,
		rgba32f: full ? works : refused,
		r11fG11fB10f: full ? works : refused,
	});
});
