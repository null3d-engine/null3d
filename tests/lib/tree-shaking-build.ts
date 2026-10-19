// The helpers that the tree-shaking checks share. Each check builds one small sketch in a process
// of its own, because a build holds the whole engine and its shader text until the process ends.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { build, type Rollup } from 'vite';

const ENGINE = join(import.meta.dirname, '../../packages/engine/src/index.ts');
/** The first line of the bundle's region for a public math module, which names its source file. */
const MATH_REGION = /^\S*\/math\/(vec3|quat|mat4|math|color)\.ts\n/;

/**
 * Builds a sketch module for production and returns its code, unminified so names stay. A sketch
 * is a module of a page, so the build is the page's: a library build inlines every asset as a
 * data URL instead of copying it, and the shaders alone are about a gigabyte of them, which no
 * machine running this suite should hold at once.
 */
export async function bundle(sketch: string): Promise<string> {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-math-'));
	const entry = join(folder, 'sketch.ts');
	writeFileSync(entry, sketch.replace('@null3d/engine', ENGINE));
	const built = await build({
		configFile: false,
		logLevel: 'silent',
		mode: 'production',
		plugins: [null3d()],
		build: { write: false, minify: false, rollupOptions: { input: entry } },
	});
	const output = (Array.isArray(built) ? built : [built]) as Rollup.RollupOutput[];
	return output
		.flatMap((o) => o.output)
		.map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
		.join('\n');
}

/**
 * The public math modules that a bundle holds code from, and their functions, as `module` and
 * `module.name`. The bundler marks the code of each source module with a region comment, so a
 * module whose values the bundle keeps without any of its functions still shows.
 */
export function helpersIn(code: string): string[] {
	const found: string[] = [];
	for (const region of code.split('//#region ')) {
		const module = MATH_REGION.exec(region)?.[1];
		if (!module) continue;
		found.push(module);
		for (const [, name] of region.matchAll(/^function (\w+)\(/gm)) found.push(`${module}.${name}`);
	}
	return found.sort();
}
