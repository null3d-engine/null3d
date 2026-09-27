import { expect, test } from '@playwright/test';

interface ShaderResult {
	ok: boolean;
	error?: string;
	glslPrograms: number;
	multiDraw: boolean;
	skipped: string[];
	renderer: string;
	webgpu: boolean;
	wgslModules: number;
	failures: { shader: string; stage: string; log: string }[];
}

/** Runs in the page: the result the test page published, once it exists. */
const readResult = () => (globalThis as { __sokko3dResult?: unknown }).__sokko3dResult;

/** Real-GPU runs (every run outside CI) refuse a software GPU, which would hide driver bugs. */
const realGpu = !process.env.CI;

test('the generated GLSL compiles and links in WebGL2 and the WGSL compiles in WebGPU', async ({
	page,
}) => {
	await page.goto('shaders.html');
	const handle = await page.waitForFunction(readResult, undefined, { timeout: 30_000 });
	const result = (await handle.jsonValue()) as ShaderResult;
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.glslPrograms).toBeGreaterThan(0);
	expect(result.webgpu).toBe(true);
	expect(result.wgslModules).toBeGreaterThan(0);
	// Only programs that read the draw index may be skipped, and only without WEBGL_multi_draw,
	// which Chrome on a real GPU always has.
	if (result.multiDraw) expect(result.skipped).toEqual([]);
	if (realGpu) {
		expect(result.multiDraw).toBe(true);
		expect(result.renderer.toLowerCase()).not.toContain('swiftshader');
	}
});
