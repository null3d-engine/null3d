// A WebGPU check reads the WGSL builds of the generated set alone, and `everyWgslShader` in
// `shader-builds.ts` finds their modules by name ([Test memory](../../.dev/tests.md)). Each module
// of builds must then name its target: a module of another shape escapes that loader, and a check
// reads none of its builds.
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isWgslModule } from './shader-builds.ts';

/** The folder that the shader build writes its modules into. */
const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');

/** A module of builds, apart from the main module and the tables of shared paragraphs. */
const MODULE = /^shaders-.*\.js$/;

describe('the modules of the generated shader set', () => {
	it('name the target of every module of builds', () => {
		const modules = readdirSync(MODULE_DIR).filter((name) => MODULE.test(name));
		expect(modules.length).toBeGreaterThan(0);
		// The engine has two GPU paths, so a module that names neither target holds builds that no
		// check reads.
		expect(modules.filter((name) => !isWgslModule(name) && !name.includes('-glsl'))).toEqual([]);
	});
});
