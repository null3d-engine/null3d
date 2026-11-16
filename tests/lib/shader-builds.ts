// The WGSL builds that the shader compiler wrote, for a check that reads the WebGPU pipeline
// metadata alone. `everyShader()` loads the builds of both GPU paths, and the WebGL2 modules hold
// about twelve times the bytes of the WGSL ones: 3.0 GB of module text against 258 MB. The shader
// build names each module for its one target (`generated/shaders-<features>-<target>-<bits>.js`),
// so a check reads the WGSL modules alone and holds a fraction of the whole set.
// `shader-builds.test.ts` checks that each module of builds names its target ([Test
// memory](../../.dev/tests.md)).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	SHADERS,
	type ShaderVariant,
	type ShaderVariants,
} from '../../packages/engine/src/generated/shaders.ts';

/** The folder that the shader build writes its modules into. */
const MODULE_DIR = join(import.meta.dirname, '../../packages/engine/src/generated');

/**
 * The name of a module of the WGSL target's builds. The target names every module of builds, so a
 * module of the other target holds none of these. A table of shared paragraphs, or of the loaders
 * of the builds that need several features, names its features in place of a shader set and is no
 * module of builds: the first is not a `shaders-` name, and the second is TypeScript.
 * `shader-builds.test.ts` checks that every module of builds names a target.
 */
export const isWgslModule = (name: string) => /^shaders-[^/]*wgsl[^/]*\.js$/.test(name);

/** The builds of `variants` that have a WGSL shader, by variant name. */
const wgslBuilds = (variants: ShaderVariants): [string, ShaderVariant][] =>
	Object.entries(variants).filter(([, build]) => build.wgsl !== null);

/**
 * Every WGSL build that the shader compiler wrote, by shader name and variant name: those of the
 * main module and those of every module of the WGSL target, the builds of the features that load
 * on first use among them.
 */
export async function everyWgslShader(): Promise<Record<string, ShaderVariants>> {
	const names = readdirSync(MODULE_DIR).filter(isWgslModule).sort();
	const modules = await Promise.all([
		Promise.resolve({ SHADERS } as { SHADERS?: Readonly<Record<string, ShaderVariants>> }),
		...names.map(
			(name) =>
				import(join(MODULE_DIR, name)) as Promise<{
					SHADERS?: Readonly<Record<string, ShaderVariants>>;
				}>,
		),
	]);
	const every: Record<string, ShaderVariants> = {};
	for (const module of modules)
		for (const [name, variants] of Object.entries(module.SHADERS ?? {})) {
			const builds = wgslBuilds(variants);
			if (builds.length > 0) every[name] = { ...every[name], ...Object.fromEntries(builds) };
		}
	return every;
}
