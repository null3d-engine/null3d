import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	addonImportProblems,
	exampleImportProblem,
	importProblem,
	packageFolders,
	packageImportProblem,
} from './addon-imports.ts';
import { fixture } from './fixture.ts';

const ENGINE = '/repo/packages/engine';
const EXAMPLES = '/repo/examples';

describe('importProblem', () => {
	test('allows the public entry points and other packages', () => {
		for (const specifier of [
			'@null3d/engine',
			'@null3d/engine/stats',
			'@null3d/controls',
			'three',
			'./local.ts',
		]) {
			expect(
				importProblem('/repo/packages/terrain/src/index.ts', specifier, ENGINE),
			).toBeUndefined();
		}
	});

	test('refuses every other engine entry point', () => {
		for (const specifier of [
			'@null3d/engine/internal',
			'@null3d/engine/early-core',
			'@null3d/engine/wasm/core.wasm',
		]) {
			expect(importProblem('/repo/examples/demo/sketch.ts', specifier, ENGINE)).toContain(
				'not a public entry point',
			);
		}
	});

	test("refuses a relative path into the engine's source, but not a sibling package with a longer name", () => {
		const file = '/repo/packages/particles/src/index.ts';
		expect(importProblem(file, '../../engine/src/scene/scene.ts', ENGINE)).toContain(
			"engine's source",
		);
		expect(importProblem(file, '../../engine-extras/src/x.ts', ENGINE)).toBeUndefined();
	});
});

describe('exampleImportProblem', () => {
	test('refuses an import from a package into the examples', () => {
		expect(
			exampleImportProblem(
				'/repo/packages/terrain/src/index.ts',
				'../../../examples/addons/traffic-lanes/index.ts',
				EXAMPLES,
			),
		).toContain('which no package may depend on');
	});

	test('allows another package and a file outside the examples', () => {
		for (const specifier of [
			'@null3d/engine',
			'@null3d/controls',
			'../../geometry/src/index.ts',
			'./local.ts',
		]) {
			expect(
				exampleImportProblem('/repo/packages/terrain/src/index.ts', specifier, EXAMPLES),
			).toBeUndefined();
		}
	});
});

describe('packageImportProblem', () => {
	/** A small repository: three add-ons, the engine and one add-on with a wildcard export. */
	function packages(): { at: (path: string) => string; map: ReturnType<typeof packageFolders> } {
		const root = fixture({
			'packages/engine/package.json': JSON.stringify({
				name: '@null3d/engine',
				exports: { '.': './src/index.ts', './stats': './src/stats.ts' },
			}),
			'packages/vegetation/package.json': JSON.stringify({
				name: '@null3d/vegetation',
				exports: { '.': './src/index.ts', './package.json': './package.json' },
			}),
			'packages/wind/package.json': JSON.stringify({
				name: '@null3d/wind',
				exports: { '.': './src/index.ts', './package.json': './package.json' },
			}),
			'packages/assets/package.json': JSON.stringify({
				name: '@null3d/assets',
				exports: { '.': './src/index.ts', './wasm/*': './wasm/*' },
			}),
		});
		return { at: (path: string) => join(root, path), map: packageFolders(root) };
	}

	test('refuses a relative path into another package folder', () => {
		const { at, map } = packages();
		const file = at('packages/wind/src/field.ts');
		for (const specifier of [
			'../../vegetation/src/wind.ts',
			'../../vegetation/src',
			'../../vegetation',
		]) {
			expect(packageImportProblem(file, specifier, map)).toContain(
				'a file of the @null3d/vegetation package',
			);
		}
	});

	test('allows a path inside the same package and a plain module name', () => {
		const { at, map } = packages();
		const file = at('packages/wind/src/field.ts');
		for (const specifier of ['./field', '../src/field.ts', 'three', '@null3d/vegetation']) {
			expect(packageImportProblem(file, specifier, map)).toBeUndefined();
		}
	});

	test('allows an exported sub-path and refuses one that the package does not export', () => {
		const { at, map } = packages();
		const file = at('packages/wind/src/field.ts');
		expect(packageImportProblem(file, '@null3d/vegetation/package.json', map)).toBeUndefined();
		expect(packageImportProblem(file, '@null3d/vegetation/src/wind.ts', map)).toContain(
			'a sub-path that @null3d/vegetation does not export',
		);
	});

	test('a wildcard export answers the paths that it covers', () => {
		const { at, map } = packages();
		const file = at('packages/wind/src/field.ts');
		expect(packageImportProblem(file, '@null3d/assets/wasm/core.wasm', map)).toBeUndefined();
		expect(packageImportProblem(file, '@null3d/assets/data/core.json', map)).toContain(
			'does not export',
		);
	});

	test("leaves the engine's entry points to the public-entry rule", () => {
		const { at, map } = packages();
		const file = at('packages/wind/src/field.ts');
		expect(packageImportProblem(file, '@null3d/engine/wasm/core.wasm', map)).toBeUndefined();
	});
});

describe('addonImportProblems', () => {
	test('reads every package and the examples, and skips tests, declarations and installed packages', () => {
		const root = fixture({
			'packages/engine/src/internal.ts': "import '@null3d/engine/internal';",
			'packages/cli/src/run.ts': "import '@null3d/engine/internal';",
			'packages/terrain/src/index.ts': "import { defineSketch } from '@null3d/engine';",
			'packages/particles/src/index.ts':
				"export const load = () => import('@null3d/engine/internal');",
			'packages/particles/src/index.test.ts': "import '../../engine/src/internal.ts';",
			'packages/particles/src/types.d.ts': "import '@null3d/engine/internal';",
			'packages/terrain/src/copy.ts':
				"import { lanes } from '../../../examples/addons/traffic-lanes/index.ts';",
			'packages/vegetation/package.json': JSON.stringify({
				name: '@null3d/vegetation',
				exports: { '.': './src/index.ts' },
			}),
			'packages/wind/package.json': JSON.stringify({
				name: '@null3d/wind',
				exports: { '.': './src/index.ts' },
			}),
			'packages/wind/src/field.ts':
				"import { grow } from '../../vegetation/src/generate.ts';\nimport { species } from '@null3d/vegetation/species';",
			'examples/demo/sketch.ts': "import { x } from '../../packages/engine/src/internal.ts';",
			'examples/demo/node_modules/dep/index.js': "import '@null3d/engine/internal';",
		});
		try {
			const { problems, files } = addonImportProblems(root);
			expect(files).toBe(7);
			expect(problems).toEqual([
				'packages/particles/src/index.ts: imports @null3d/engine/internal, which is not a public entry point',
				'packages/terrain/src/copy.ts: imports the examples (../../../examples/addons/traffic-lanes/index.ts), which no package may depend on',
				'packages/wind/src/field.ts: imports ../../vegetation/src/generate.ts, a file of the @null3d/vegetation package, which another add-on reaches by its package name',
				'packages/wind/src/field.ts: imports @null3d/vegetation/species, a sub-path that @null3d/vegetation does not export',
				"examples/demo/sketch.ts: imports the engine's source (../../packages/engine/src/internal.ts)",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('the repository', () => {
	test('every add-on and example reaches the engine only through its public entry points', () => {
		const { problems, files } = addonImportProblems(join(import.meta.dir, '../..'));
		expect(problems).toEqual([]);
		expect(files).toBeGreaterThan(0);
	});
});
