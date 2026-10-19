// Compiles every generated shader in Chrome, in parts that run in parallel. A software GPU compiles
// one GLSL program at a time, so each part holds a bounded number of programs, and more shader
// variants make more parts. A last test fakes Safari's Metal fault in one link, which the page
// links again.
import { expect, test } from '@playwright/test';
import { pageResultWhileProgressing } from '../lib/page-result.ts';
import { glslProgramCount } from '../lib/shader-programs.ts';

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
	wgslExpected: number;
	failures: { shader: string; stage: string; log: string }[];
	relinked: { shader: string; stage: string; log: string }[];
}

/** Real-GPU runs (every run outside CI) refuse a software GPU, which would hide driver bugs. */
const realGpu = !process.env.CI;

/**
 * The most GLSL programs that one part compiles. CI's SwiftShader takes about 70 ms for each, so a
 * part needs about 10 s when the machine is not busy.
 */
const PROGRAMS_PER_PART = 150;

/**
 * Enough parts that each holds about that many programs. A part checks every so many device
 * modules, and a build that several modules hold counts in each part that downloads one of them, so
 * a part may hold somewhat more.
 */
const PARTS = Math.ceil(glslProgramCount() / PROGRAMS_PER_PART);

/**
 * A part fails when its page notes no new step for this long. The page notes a step after each
 * batch of GLSL programs and after every few WGSL modules, so a busy machine slows a part without
 * failing it, while a stuck compile still fails.
 */
const STALL_MS = 30_000;
/** The most time a part may take in all, far more than it takes alone. */
const PART_LIMIT_MS = 5 * 60_000;

test.describe.configure({ mode: 'parallel' });

for (let part = 1; part <= PARTS; part++)
	test(`the generated GLSL compiles and links in WebGL2 and the WGSL compiles in WebGPU, part ${part} of ${PARTS}`, async ({
		page,
	}) => {
		test.setTimeout(PART_LIMIT_MS);
		await page.goto(`shaders.html?part=${part}&parts=${PARTS}`);
		const result = await pageResultWhileProgressing<ShaderResult>(page, STALL_MS);
		expect(result.error).toBeUndefined();
		expect(result.failures).toEqual([]);
		expect(result.glslPrograms).toBeGreaterThan(0);
		expect(result.webgpu).toBe(true);
		// A part's share may hold only modules that need 16-bit floats, which a GPU without them skips.
		// The check then holds what the share holds: every module compiled or was skipped for that.
		expect(result.wgslModules + result.wgslSkipped).toBeGreaterThan(0);
		expect(result.wgslModules + result.wgslSkipped).toBe(result.wgslExpected);
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

/** Safari's words for the fault in a link log. A page that does not know them fails the program. */
const METAL_FAULT = 'MSL compilation error';

/**
 * Runs in the page before its scripts: the first program's link reads as failed, with Safari's
 * fault in its log.
 */
function fakeMetalFault(fault: string): void {
	type Program = object | null;
	interface Gl {
		LINK_STATUS: number;
		createProgram(): Program;
		getProgramParameter(program: Program, name: number): unknown;
		getProgramInfoLog(program: Program): string | null;
	}
	// The page's globals, which this file's types do not describe.
	const proto = (globalThis as unknown as { WebGL2RenderingContext: { prototype: Gl } })
		.WebGL2RenderingContext.prototype;
	const { createProgram, getProgramParameter, getProgramInfoLog } = proto;
	let faulty: Program | undefined;
	proto.createProgram = function (this: Gl) {
		const program = createProgram.call(this);
		faulty ??= program;
		return program;
	};
	proto.getProgramParameter = function (this: Gl, program, name) {
		if (program === faulty && name === this.LINK_STATUS) return false;
		return getProgramParameter.call(this, program, name);
	};
	proto.getProgramInfoLog = function (this: Gl, program) {
		if (program === faulty) return `Internal error while linking shader. ${fault}: a test`;
		return getProgramInfoLog.call(this, program);
	};
}

test("the shaders page links a program again after Safari's Metal fault, and lists it", async ({
	page,
}) => {
	test.setTimeout(PART_LIMIT_MS);
	await page.addInitScript(fakeMetalFault, METAL_FAULT);
	await page.goto(`shaders.html?part=1&parts=${PARTS}`);
	const result = await pageResultWhileProgressing<ShaderResult>(page, STALL_MS);
	expect(result.error).toBeUndefined();
	expect(result.failures).toEqual([]);
	expect(result.relinked).toHaveLength(1);
	expect(result.relinked[0]?.log).toContain(METAL_FAULT);
});
