// How many GLSL programs the generated shader modules hold, and which builds hold them, for the
// tests that size their work by it. Playwright loads every test file before it starts a server or a
// test, and the shaders test learns from this number how many parts its page compiles, so loading
// the modules there costs the runner gigabytes for one number. They are read as text instead, which
// costs a second and little memory: the shader build writes one key for each build, whose value
// opens with that build's permutation bits, and one `vertex:` stage for each program of it, and no
// source of these modules holds those lines, so the lines name the builds and count their programs.
// The check that holds the modules beside them needs the whole set, so it runs in a process of its
// own ([Test memory](../../.dev/tests.md)).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHADERS } from '../../packages/engine/src/generated/shaders.ts';
import {
	glslProgramsOf,
	inShaderSet,
	type ShaderSet,
	shaderOf,
	variantInShaderSet,
	variantOf,
} from '../pages/lib/shader-list.ts';

/** The folder the shader build writes its modules into. */
const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');
/** The generated files that hold GLSL, by name: each names the targets it was built for. */
const GLSL_MODULE = /^shaders-.*glsl.*\.(js|ts)$/;
/** A build's key, as a module writes it, and the permutation bits that its value opens with. */
const BUILD_KEY = /^\t+([a-z][a-z0-9_]*): \{$/;
/** A shader's key, one level above its builds, which names the shader that a build belongs to. */
const SHADER_KEY = /^\t([a-z][a-z0-9_]*): \{$/;
const PERMUTATION = /^\t+permutation: /;
/** One GLSL program's vertex stage, as the shader build writes it: one line for each program. */
const VERTEX_STAGE = /^\t+vertex: \{$/;
/** The GLSL programs of the main module, which is small enough to read as its own build. */
const MAIN_MODULE_PROGRAMS = glslProgramsOf(SHADERS);

/**
 * The GLSL programs of one module, by build name, read from the module's text. A module writes its
 * builds one way when it holds a device's builds and another way when it holds one shader's, so a
 * build is named by its key whose value opens with its permutation bits, whatever holds it.
 */
function programsOfModule(text: string): Map<string, number> {
	const lines = text.split('\n');
	const programs = new Map<string, number>();
	let shader = '';
	let build = '';
	for (let at = 0; at < lines.length; at++) {
		const line = lines[at] ?? '';
		const key = BUILD_KEY.exec(line);
		if (key && PERMUTATION.test(lines[at + 1] ?? '')) {
			build = `${shader}.${key[1] ?? ''}`;
			if (!programs.has(build)) programs.set(build, 0);
		} else if (SHADER_KEY.test(line)) shader = SHADER_KEY.exec(line)?.[1] ?? shader;
		else if (VERTEX_STAGE.test(line)) programs.set(build, (programs.get(build) ?? 0) + 1);
	}
	return programs;
}

/** The modules' text, read once: the generated modules do not change while a process runs. */
let read: Map<string, Map<string, number>> | undefined;

/** The GLSL programs of each module, by module name and build name, read from the modules' text. */
export function glslVariantsByModule(): Map<string, Map<string, number>> {
	read ??= new Map(
		readdirSync(MODULE_DIR)
			.filter((name) => GLSL_MODULE.test(name))
			.map((name) => [name, programsOfModule(readFileSync(join(MODULE_DIR, name), 'utf8'))]),
	);
	return read;
}

/** The builds of the engine, counted together, kept for the life of the process. */
let builds: ReadonlyMap<string, number> | undefined;

/** The GLSL programs of each build of the engine, by variant alone: the main module's, then each module's. */
export function glslProgramsByVariant(): ReadonlyMap<string, number> {
	if (builds) return builds;
	const programs = new Map<string, number>();
	const add = (build: string, count: number) =>
		programs.set(build, (programs.get(build) ?? 0) + count);
	for (const [name] of MAIN_MODULE_PROGRAMS) add(variantOf(name), 1);
	for (const variants of glslVariantsByModule().values())
		for (const [build, count] of variants) add(variantOf(build), count);
	builds = programs;
	return builds;
}

/** The build names of the engine, kept for the life of the process. */
let named: ReadonlyMap<string, number> | undefined;

/**
 * The GLSL programs of each build of the engine, by `shader.variant`: the main module's, then each
 * module's. A set that leaves out a feature's builds needs the shader's name, which the variant
 * alone does not give.
 */
export function glslProgramsByName(): ReadonlyMap<string, number> {
	if (named) return named;
	const programs = new Map<string, number>();
	const add = (build: string, count: number) =>
		programs.set(build, (programs.get(build) ?? 0) + count);
	for (const [name] of MAIN_MODULE_PROGRAMS) add(`${shaderOf(name)}.${variantOf(name)}`, 1);
	for (const variants of glslVariantsByModule().values())
		for (const [build, count] of variants) add(build, count);
	named = programs;
	return named;
}

/**
 * Every GLSL program of the engine. A build that several modules hold counts once for each of them,
 * because each part of the shaders page compiles its own share of the modules.
 */
export function glslProgramCount(): number {
	let programs = 0;
	for (const count of glslProgramsByVariant().values()) programs += count;
	return programs;
}

/** The programs of each set, counted once: a plan counts them for every device it plans for. */
const counts = new Map<ShaderSet, number>();

/** The GLSL programs of one set of builds, which the parts of the shaders page share. */
export function glslProgramCountOf(set: ShaderSet): number {
	const counted = counts.get(set);
	if (counted !== undefined) return counted;
	let programs = 0;
	for (const [build, count] of glslProgramsByName()) if (inShaderSet(build, set)) programs += count;
	counts.set(set, programs);
	return programs;
}
