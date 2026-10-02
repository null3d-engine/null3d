import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ShaderResult {
	ok: boolean;
	error?: string;
	glslPrograms: number;
	multiDraw: boolean;
	skipped: string[];
	renderer: string;
	webgpu: boolean;
	wgslModules: number;
	wgslSkipped: number;
	failures: { shader: string; stage: string; log: string }[];
}

/** Runs in the page: the result the test page published, once it exists. */
/** Real-GPU runs (every run outside CI) refuse a software GPU, which would hide driver bugs. */
const realGpu = !process.env.CI;

test('the generated GLSL compiles and links in WebGL2 and the WGSL compiles in WebGPU', async ({
	page,
}) => {
	await page.goto('shaders.html');
	const result = await pageResult<ShaderResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.glslPrograms).toBeGreaterThan(0);
	expect(result.webgpu).toBe(true);
	expect(result.wgslModules).toBeGreaterThan(0);
	// Only programs that read the draw index may be skipped, and only without WEBGL_multi_draw,
	// which Chrome on a real GPU always has.
	if (result.multiDraw) expect(result.skipped).toEqual([]);
	if (realGpu) {
		// Chrome on the Mac's GPU offers 16-bit floats, so it compiles the half precision modules too.
		expect(result.wgslSkipped).toBe(0);
		expect(result.multiDraw).toBe(true);
		expect(result.renderer.toLowerCase()).not.toContain('swiftshader');
	}
});
