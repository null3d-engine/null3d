// The WGSL of a sketch reaches it compiled by the null3D Vite plugin: a `.wgsl` file that the
// sketch imports, and a template literal that a `wgsl` comment tags. Each holds WGSL for WebGPU
// and GLSL for WebGL2, with the library modules it imports, and each compiles in the browser. The
// test runs on the production build too, where the sketch is a chunk of its own.
import { expect, test } from '@playwright/test';
import { pageResult } from '../lib/page-result.ts';

interface ShaderSummary {
	wgslPipelines: string[];
	glslPrograms: string[];
	wgsl: string;
	glslFragments: string[];
}

interface SketchShadersResult {
	error?: string;
	kinds: Record<string, string>;
	shaders: Record<string, ShaderSummary>;
	glslPrograms: number;
	webgpu: boolean;
	wgslModules: number;
	failures: { shader: string; stage: string; log: string }[];
}

test("a sketch's WGSL arrives compiled, and compiles in WebGL2 and WebGPU", async ({ page }) => {
	await page.goto('sketch-shaders.html');
	const result = await pageResult<SketchShadersResult>(page, 30_000);
	expect(result.error).toBeUndefined();
	expect(result.kinds).toEqual({ tint: 'object', glow: 'object' });

	const { tint, glow } = result.shaders;
	expect(tint?.wgslPipelines).toEqual(['fs_main']);
	expect(tint?.glslPrograms).toEqual(['fs_main']);
	expect(tint?.wgsl).toContain('fn square(x: f32) -> f32');

	// The tagged literal imports another library module, and WebGL2 builds it with `WEBGL2` set.
	expect(glow?.glslPrograms).toEqual(['fs_glow']);
	expect(glow?.wgsl).toContain('fn linear_to_srgb(');
	expect(glow?.wgsl).toContain('vec3(0.5f)');
	expect(glow?.glslFragments[0]).toContain('vec3(0.25)');

	expect(result.failures).toEqual([]);
	expect(result.glslPrograms).toBe(2);
	expect(result.webgpu).toBe(true);
	expect(result.wgslModules).toBe(2);
});
