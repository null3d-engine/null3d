// Checks the count that the shaders test sizes its parts by against the generated modules. The
// count is read from their text, so a change to the shader build that writes them another way has
// to fail here, rather than size the test's parts wrongly.
import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SHADERS, type ShaderVariants } from '../../packages/engine/src/generated/shaders.ts';
import { glslProgramsOf } from '../pages/lib/shader-list.ts';
import { glslProgramCount, glslProgramsByModule } from './shader-programs.ts';

const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');
/** The modules the count reads, and what it read from each of them. */
const COUNTED = glslProgramsByModule();
/** Loading every module takes seconds on a busy machine, which the tests may have. */
const LOADING_MS = 120_000;

/** The GLSL programs one generated module holds, read from the module itself. */
async function programsLoadedFrom(name: string): Promise<number> {
	const module = (await import(join(MODULE_DIR, name))) as {
		SHADERS?: Readonly<Record<string, ShaderVariants>>;
	};
	return glslProgramsOf(module.SHADERS ?? {}).length;
}

test(
	'counts every GLSL program of the generated modules',
	async () => {
		for (const [name, programs] of COUNTED) expect(await programsLoadedFrom(name)).toBe(programs);
		let total = glslProgramsOf(SHADERS).length;
		for (const programs of COUNTED.values()) total += programs;
		expect(glslProgramCount()).toBe(total);
	},
	LOADING_MS,
);

test(
	'leaves out the generated modules that hold no GLSL',
	async () => {
		const others = readdirSync(MODULE_DIR).filter(
			(name) => /^shaders-.*\.(js|ts)$/.test(name) && name !== 'shaders.ts' && !COUNTED.has(name),
		);
		const holding: (readonly [string, number])[] = [];
		for (const name of others) holding.push([name, await programsLoadedFrom(name)]);
		// The main module is read as its own build, so its own file name is not in the list.
		expect(holding.filter(([, programs]) => programs !== 0)).toEqual([]);
	},
	LOADING_MS,
);
