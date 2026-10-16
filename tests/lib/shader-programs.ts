// How many GLSL programs the generated shader modules hold, for the tests that size their work by
// it. Playwright loads every test file before it starts a server or a test, and the shaders test
// learns from this number how many parts its page compiles, so loading the modules there costs the
// runner gigabytes for one number. They are read as text instead, which costs a second and no
// memory: the shader build writes one `vertex:` stage for each program, and no source of these
// modules holds that line, so the lines count the programs. A test checks the count against them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHADERS } from '../../packages/engine/src/generated/shaders.ts';
import { glslProgramsOf } from '../pages/lib/shader-list.ts';

/** The folder the shader build writes its modules into. */
const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');
/** The generated files that hold GLSL, by name: each names the targets it was built for. */
const GLSL_MODULE = /^shaders-.*glsl.*\.(js|ts)$/;
/** One GLSL program's vertex stage, as the shader build writes it: one line for each program. */
const VERTEX_STAGE = /^\t*vertex: \{$/gm;
/** The GLSL programs of the main module, which is small enough to read as its own build. */
const MAIN_MODULE_PROGRAMS = glslProgramsOf(SHADERS).length;

/** The GLSL programs of each generated module, by the module's file name. */
export function glslProgramsByModule(): Map<string, number> {
	const programs = new Map<string, number>();
	for (const name of readdirSync(MODULE_DIR))
		if (GLSL_MODULE.test(name))
			programs.set(
				name,
				(readFileSync(join(MODULE_DIR, name), 'utf8').match(VERTEX_STAGE) ?? []).length,
			);
	return programs;
}

/**
 * Every GLSL program of the generated modules, which is what the shaders page compiles in all. A
 * build held by several modules counts once for each of them, because each part's page compiles its
 * own share of the modules.
 */
export function glslProgramCount(): number {
	let programs = MAIN_MODULE_PROGRAMS;
	for (const count of glslProgramsByModule().values()) programs += count;
	return programs;
}
