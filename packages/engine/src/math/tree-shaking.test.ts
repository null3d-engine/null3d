// A sketch that imports one math helper gets that helper alone: the bundler keeps the helpers that
// a module calls and drops the rest. This builds small sketches for production, as the Vite plugin
// does, and reads which helpers each bundle holds.
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { build, type Rollup } from 'vite';

const ENGINE = join(import.meta.dirname, '../index.ts');
/** The first line of the bundle's region for a public math module, which names its source file. */
const MATH_REGION = /^\S*\/math\/(vec3|quat|mat4|math|color)\.ts\n/;

/** Builds a sketch module for production and returns its code, unminified so names stay. */
async function bundle(sketch: string): Promise<string> {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-math-'));
	const entry = join(folder, 'sketch.ts');
	writeFileSync(entry, sketch.replace('@null3d/engine', ENGINE));
	const output = (await build({
		configFile: false,
		logLevel: 'silent',
		mode: 'production',
		plugins: [null3d()],
		build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'sketch' } },
	})) as Rollup.RollupOutput[];
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
function helpersIn(code: string): string[] {
	const found: string[] = [];
	for (const region of code.split('//#region ')) {
		const module = MATH_REGION.exec(region)?.[1];
		if (!module) continue;
		found.push(module);
		for (const [, name] of region.matchAll(/^function (\w+)\(/gm)) found.push(`${module}.${name}`);
	}
	return found.sort();
}

describe('the math helpers', () => {
	it('reach a bundle only when a module calls them', async () => {
		const code = await bundle(`
			import { vec3 } from '@null3d/engine';
			export const sum = vec3.add(vec3.create(), [1, 2, 3], [4, 5, 6]);
		`);
		expect(helpersIn(code)).toEqual(['vec3', 'vec3.add', 'vec3.create']);
	}, 60_000);

	it('bring along only the helpers that the called ones use', async () => {
		const code = await bundle(`
			import { math, quat } from '@null3d/engine';
			export const turn = quat.lookAt(quat.create(), [0, 0, 0], [1, 2, 3]);
			export const r = math.randFloat(-1, 1);
		`);
		expect(helpersIn(code)).toEqual([
			'math',
			'math.randFloat',
			'math.random',
			'math.randomState',
			'quat',
			'quat.create',
			'quat.fromMat4',
			'quat.lookAt',
		]);
	}, 60_000);
});
