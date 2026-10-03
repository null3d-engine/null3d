// Compiles every generated shader in Chrome, in parts that run in parallel. A software GPU compiles
// one GLSL program at a time, so each part holds a bounded number of programs, and more shader
// variants make more parts.
import { expect, test } from '@playwright/test';
import { everyShader } from '../../packages/engine/src/generated/shaders.ts';
import { pageResult } from '../lib/page-result.ts';
import { glslProgramsOf } from '../pages/lib/shader-list.ts';

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

/** Real-GPU runs (every run outside CI) refuse a software GPU, which would hide driver bugs. */
const realGpu = !process.env.CI;

/**
 * The most GLSL programs that one part compiles. CI's SwiftShader takes about 70 ms for each, so a
 * part needs about 10 s of its 30 s.
 */
const PROGRAMS_PER_PART = 150;

/** Enough parts that none holds more than that many programs. */
const PARTS = Math.ceil(glslProgramsOf(await everyShader()).length / PROGRAMS_PER_PART);

test.describe.configure({ mode: 'parallel' });

for (let part = 1; part <= PARTS; part++)
	test(`the generated GLSL compiles and links in WebGL2 and the WGSL compiles in WebGPU, part ${part} of ${PARTS}`, async ({
		page,
	}) => {
		await page.goto(`shaders.html?part=${part}&parts=${PARTS}`);
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
