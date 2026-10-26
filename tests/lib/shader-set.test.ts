// The checks that need the whole generated shader set in memory: they hold each module beside the
// text that the other tests read their counts and names from, so a shader build that writes its
// modules another way fails here rather than sizing the plans from numbers that no longer hold. The
// unit run shares one process, where the 1,343 modules cost about 3.6 GB that every test after them
// still pays for, so the unit script ignores this file and `bun run test:heavy` runs it in a
// process of its own ([Test memory](../../.dev/tests.md)).

import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { everyShader, type ShaderVariants } from '../../packages/engine/src/generated/shaders.ts';
import {
	glslProgramsOf,
	inShaderSet,
	type ShaderSet,
	shaderOf,
	variantOf,
} from '../pages/lib/shader-list.ts';
import { PLANNED_SHADER_SETS, SHADER_PROGRAMS_PER_PART } from './plans.ts';
import { scaledBudget } from './run-budget.ts';
import {
	glslProgramCount,
	glslProgramCountOf,
	glslProgramsByName,
	glslProgramsByVariant,
	glslVariantsByModule,
} from './shader-programs.ts';

/** The folder the shader build writes its modules into. */
const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');
/** The generated files that hold a module: the main one, and the ones of each target. */
const MODULE = /^shaders-.*\.(js|ts)$/;
/** The main module, which the tests read as the engine's own build rather than as a file. */
const MAIN_MODULE = 'shaders.ts';
/** The most GLSL programs that one page compiles: more than a part's share holds, with room. */
const MOST_PROGRAMS_PER_PART = 600;
/** Loading every module takes seconds on a busy machine, which the tests may have. */
const LOADING_MS = scaledBudget(120_000);

/** The GLSL programs of one generated module, by build name, loaded from the module itself. */
async function programsLoadedFrom(name: string): Promise<Map<string, number>> {
	const { SHADERS } = (await import(join(MODULE_DIR, name))) as {
		SHADERS?: Readonly<Record<string, ShaderVariants>>;
	};
	const programs = new Map<string, number>();
	for (const [shader, variants] of Object.entries(SHADERS ?? {}))
		for (const [variant, built] of Object.entries(variants))
			programs.set(
				`${shader}.${variant}`,
				(programs.get(`${shader}.${variant}`) ?? 0) + Object.keys(built.glsl ?? {}).length,
			);
	return programs;
}

/** The generated files that hold a module, apart from the main one. */
const moduleFiles = () =>
	readdirSync(MODULE_DIR)
		.filter((name) => MODULE.test(name) && name !== MAIN_MODULE)
		.sort();

/** The builds of one set that the modules' text holds, each with at least one program. */
const buildsOfSet = (set: ShaderSet) =>
	[...glslProgramsByName()]
		.filter(([build, programs]) => programs > 0 && inShaderSet(build, set))
		.map(([build]) => build)
		.sort();

/**
 * The builds a set's parts load, one part at a time: the page's own share of them, which the plan
 * gives it the number of, and the most programs that one part holds. Each part is dropped before
 * the next loads, so no more than one part is held beside the modules.
 */
async function partsOfSet(set: ShaderSet) {
	const parts = Math.ceil(glslProgramCountOf(set) / SHADER_PROGRAMS_PER_PART);
	const loaded = new Set<string>();
	let most = 0;
	for (let part = 1; part <= parts; part++) {
		const share = glslProgramsOf(await everyShader(part, parts)).filter(([name]) =>
			inShaderSet(name, set),
		);
		for (const [name] of share) loaded.add(`${shaderOf(name)}.${variantOf(name)}`);
		if (share.length > most) most = share.length;
	}
	return { loaded, most };
}

describe('the generated shader set', () => {
	it(
		'holds the programs that the tests read from its modules',
		async () => {
			for (const [name, programs] of glslVariantsByModule())
				expect([name, await programsLoadedFrom(name)]).toEqual([name, programs]);
		},
		LOADING_MS,
	);

	it(
		'leaves out the generated modules that hold no GLSL',
		async () => {
			const counted = glslVariantsByModule();
			for (const name of moduleFiles().filter((name) => !counted.has(name))) {
				const loaded = await programsLoadedFrom(name);
				expect([name, [...loaded.values()].some((programs) => programs !== 0)]).toEqual([
					name,
					false,
				]);
			}
		},
		LOADING_MS,
	);

	it(
		'loads every build of a set in its parts, none of them over the page limit',
		async () => {
			for (const set of PLANNED_SHADER_SETS) {
				const { loaded, most } = await partsOfSet(set);
				expect([set, most <= MOST_PROGRAMS_PER_PART]).toEqual([set, true]);
				// The parts together load every build that the modules hold: a module that no part
				// loads is a set of pages that the browser test never compiles.
				expect([set, [...loaded].sort()]).toEqual([set, buildsOfSet(set)]);
			}
		},
		LOADING_MS,
	);

	it('counts every program of the set, those of the main module among them', () => {
		expect(glslProgramCount()).toBe(glslProgramCountOf('all'));
	});
});
