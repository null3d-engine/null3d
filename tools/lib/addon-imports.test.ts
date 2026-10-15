import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { addonImportProblems, importProblem } from './addon-imports.ts';
import { fixture } from './fixture.ts';

const ENGINE = '/repo/packages/engine';

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

describe('addonImportProblems', () => {
	test('reads add-on sources and the examples, and skips tests, tools and the engine', () => {
		const root = fixture({
			'packages/engine/src/internal.ts': "import '@null3d/engine/internal';",
			'packages/cli/src/run.ts': "import '@null3d/engine/internal';",
			'packages/terrain/src/index.ts': "import { defineSketch } from '@null3d/engine';",
			'packages/particles/src/index.ts':
				"export const load = () => import('@null3d/engine/internal');",
			'packages/particles/src/index.test.ts': "import '../../engine/src/internal.ts';",
			'examples/demo/sketch.ts': "import { x } from '../../packages/engine/src/internal.ts';",
			'examples/demo/node_modules/dep/index.js': "import '@null3d/engine/internal';",
		});
		try {
			const { problems, files } = addonImportProblems(root);
			expect(files).toBe(3);
			expect(problems).toEqual([
				'packages/particles/src/index.ts: imports @null3d/engine/internal, which is not a public entry point',
				"examples/demo/sketch.ts: imports the engine's source (../../packages/engine/src/internal.ts)",
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
