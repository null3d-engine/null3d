// The shader library test page runs each case's function by its number in the library test
// shader, and checks it against the reference of the same number. These tests keep the two lists
// in step, and make sure that every function of every public library module has a GPU test. The
// constants and structs are tested through the functions that use them.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLibrary } from '../../tools/lib/shader-library.ts';
import {
	allCases,
	FUNCTIONS,
	probeFault,
	TARGET_PROBE,
} from '../pages/lib/shader-library-cases.ts';
import { judge, NONE_MISSING } from './plans.ts';

const root = join(import.meta.dir, '../..');
const shader = readFileSync(join(root, 'crates/null3d-shaders/wgsl/test_library.wgsl'), 'utf8');

/** The library items that each numbered case of the test shader's `run` names, by case number. */
function shaderCases(): Map<number, string[]> {
	const start = shader.indexOf('\nfn run(');
	const run = shader.slice(start, shader.indexOf('\n        default:', start));
	const cases = new Map<number, string[]>();
	const pattern = /case (\d+)u: \{([\s\S]*?)(?=\n {8}case |$)/g;
	for (const [, number, body] of run.matchAll(pattern))
		cases.set(
			Number(number),
			[...(body ?? '').matchAll(/null3d::(\w+::\w+)/g)].map((m) => m[1] ?? ''),
		);
	return cases;
}

describe('the shader library test', () => {
	it('numbers the functions in the test shader as the reference table does', () => {
		const cases = shaderCases();
		expect(cases.size).toBe(FUNCTIONS.length);
		FUNCTIONS.forEach((fn, number) => {
			expect({ number, names: cases.get(number) }).toEqual({
				number,
				names: expect.arrayContaining([fn.name]),
			});
		});
	});

	it('puts each case in the variant of its module, which the page draws over its rows', () => {
		const run = shader.slice(shader.indexOf('\nfn run('), shader.indexOf('\n        default:'));
		let def = '';
		const defs = new Map<number, string>();
		for (const line of run.split('\n')) {
			def = line.match(/^#ifdef (\w+)/)?.[1] ?? (line === '#endif' ? '' : def);
			const number = line.match(/^ {8}case (\d+)u:/)?.[1];
			if (number) defs.set(Number(number), def);
		}
		const modules = FUNCTIONS.map((fn) => fn.name.split('::')[0] ?? '');
		expect([...defs.values()]).toEqual(modules.map((module) => module.toUpperCase()));

		const manifest = readFileSync(join(root, 'crates/null3d-shaders/shaders.toml'), 'utf8');
		const section = manifest.slice(manifest.indexOf('[shaders.test_library]'));
		const variants = [
			...section
				.slice(0, section.indexOf('\n[', 1))
				.matchAll(/^variants\.(\w+) = \{ defs = \["(\w+)"\]/gm),
		].map(([, name, variantDef]) => [name, variantDef]);
		const expected = [...new Set(modules)].sort().map((module) => [module, module.toUpperCase()]);
		expect(variants).toEqual(expected);
	});

	it('tests every function of every public library module on the GPU', () => {
		const { modules } = readLibrary(root);
		const tested = new Set([...shader.matchAll(/null3d::(\w+::\w+)/g)].map((m) => m[1]));
		const untested = modules.flatMap((module) =>
			module.items
				.filter((item) => item.kind === 'fn')
				.map((item) => `${module.name.slice('null3d::'.length)}::${item.name}`)
				.filter((name) => !tested.has(name)),
		);
		expect(untested).toEqual([]);
	});

	it('gives each function cases, and each case expected results in the shader layout', () => {
		const cases = allCases();
		for (let number = 0; number < FUNCTIONS.length; number++)
			expect(cases.some((c) => c.function === number)).toBe(true);
		for (const c of cases)
			expect(FUNCTIONS[c.function]?.expected(c.inputs).values).toHaveLength(16);
	});

	it('draws the same cases on every run', () => {
		const first = allCases().map((c) => [...c.inputs.bits]);
		const second = allCases().map((c) => [...c.inputs.bits]);
		expect(second).toEqual(first);
	});
});

describe("the WebGL2 page's probe of its 32-bit target", () => {
	it('finds no fault when every value comes back whole', () => {
		expect(probeFault('a clear', new Uint32Array(TARGET_PROBE))).toBeUndefined();
	});

	it('names how many low bits survived, as on the Galaxy Tab A9 Plus', () => {
		const low16 = TARGET_PROBE.map((value) => value & 0xffff);
		expect(probeFault('a clear of the texture target', low16)).toBe(
			'a clear of the texture target kept only the low 16 bits of each value: wrote 0x89abcdef, 0x12345678, 0xfedcba98, 0x76543210, read 0x0000cdef, 0x00005678, 0x0000ba98, 0x00003210',
		);
		expect(probeFault('a write', [0, 0, 0, 0])).toContain('changed the values');
	});

	it('records a device fault as a note, and still fails on modules that did not draw', () => {
		const check = { kind: 'shader-library', tier: 'webgl2' } as const;
		const notes: string[] = [];
		const context = { resultOf: () => undefined, imageDir: '', note: (t: string) => notes.push(t) };
		const fault = 'a clear of the texture target kept only the low 16 bits of each value';
		const result = { ok: true, cases: 428, failures: [], mismatches: [], deviceFault: fault };
		expect(judge(check, result, NONE_MISSING, context)).toEqual([]);
		expect(notes).toEqual([
			`device fault: ${fault}. The page could not read the library's results back on this device`,
		]);
		const broken = { ...result, failures: ['math: GLSL: 0:1: error'] };
		expect(judge(check, broken, NONE_MISSING, context)).toEqual(['math: GLSL: 0:1: error']);
	});

	it("fails when the library's own shader loses bits on a target that keeps them", () => {
		const check = { kind: 'shader-library', tier: 'webgl2' } as const;
		const context = { resultOf: () => undefined, imageDir: '', note: () => {} };
		const shaderFault = probeFault(
			"the library test shader's write (its math module) into the texture target",
			TARGET_PROBE.map((value) => value & 0xffff),
		);
		const result = { ok: true, cases: 428, failures: [], mismatches: [], shaderFault };
		expect(judge(check, result, NONE_MISSING, context)).toEqual([
			"the library test shader's write (its math module) into the texture target kept only the low 16 bits of each value: wrote 0x89abcdef, 0x12345678, 0xfedcba98, 0x76543210, read 0x0000cdef, 0x00005678, 0x0000ba98, 0x00003210. The target kept every bit, so the GLSL lost them, and engine shaders keep whole numbers the same way",
		]);
	});

	it('notes a driver that keeps only 16 bits of whole numbers declared without a precision, without a failure', () => {
		const check = { kind: 'shader-library', tier: 'webgl2' } as const;
		const notes: string[] = [];
		const context = { resultOf: () => undefined, imageDir: '', note: (t: string) => notes.push(t) };
		const precisionFault =
			"a shader's write of whole numbers declared without a precision kept only the low 16 bits of each value";
		const result = { ok: true, cases: 428, failures: [], mismatches: [], precisionFault };
		expect(judge(check, result, NONE_MISSING, context)).toEqual([]);
		expect(notes).toEqual([
			`driver fault: ${precisionFault}. The GLSL build declares each whole number highp, which avoids it`,
		]);
	});
});
