import { describe, expect, it } from 'bun:test';
import {
	builtAddress,
	exportTargets,
	type Manifest,
	packageProblems,
	rewriteAddresses,
} from './packages';

/** The built files of a small package, by path in `lib/`. */
const BUILT = new Set([
	'index.js',
	'index.d.ts',
	'math/color.js',
	'page/engine.js',
	'render/draw.js',
	'scene/ktx2.js',
	'workers/sketch-worker.js',
	'workers/transcoder-worker.js',
	'shared/index.js',
]);
const exists = (path: string) => BUILT.has(path);

describe('builtAddress', () => {
	it('gives the built file of an address with .ts, without an extension, or of a folder', () => {
		expect(builtAddress('page/engine.js', '../workers/sketch-worker.ts', exists)).toBe(
			'../workers/sketch-worker.js',
		);
		expect(builtAddress('index.js', './math/color', exists)).toBe('./math/color.js');
		expect(builtAddress('index.js', './shared', exists)).toBe('./shared/index.js');
		expect(builtAddress('scene/ktx2.js', '../workers/transcoder-worker.js', exists)).toBe(
			'../workers/transcoder-worker.js',
		);
	});

	it('is null when no built file answers', () => {
		expect(builtAddress('index.js', './missing', exists)).toBeNull();
		expect(builtAddress('index.js', './missing.ts', exists)).toBeNull();
		expect(builtAddress('scene/ktx2.js', '../../vendor/basis/basis.wasm', exists)).toBeNull();
	});
});

describe('rewriteAddresses', () => {
	it('rewrites imports, exports, import() calls and import types to the built files', () => {
		const code = [
			"import { a } from './math/color';",
			"export * as color from './math/color';",
			"export { b } from './shared';",
			"const draw = () => import('./render/draw');",
			"type Draw = typeof import('./render/draw');",
			"import 'node:fs';",
		].join('\n');
		const { text, unresolved } = rewriteAddresses('index.js', code, exists);
		expect(text).toBe(
			[
				"import { a } from './math/color.js';",
				"export * as color from './math/color.js';",
				"export { b } from './shared/index.js';",
				"const draw = () => import('./render/draw.js');",
				"type Draw = typeof import('./render/draw.js');",
				"import 'node:fs';",
			].join('\n'),
		);
		expect(unresolved).toEqual([]);
	});

	it('rewrites the scripts a module passes by address, and keeps their queries', () => {
		const code = [
			"new Worker(new URL('../workers/sketch-worker.ts', import.meta.url));",
			"const glue = new URL('../../dist/wasm/single/null3d.js', import.meta.url);",
			"const wasm = new URL('../../vendor/basis/basis.wasm?no-inline', import.meta.url);",
			"const worker = new URL('../workers/transcoder-worker.js?no-inline', import.meta.url);",
		].join('\n');
		const { text } = rewriteAddresses('page/engine.js', code, exists);
		expect(text).toBe(code.replace('sketch-worker.ts', 'sketch-worker.js'));
	});

	it('keeps addresses in strings and comments, and reports imports that answer no file', () => {
		const code = [
			'const fix = "Pass new URL(\'./sketch.ts\', import.meta.url) as the sketch";',
			"// import { x } from './math/color';",
			"import { y } from './gone';",
		].join('\n');
		const { text, unresolved } = rewriteAddresses('index.js', code, exists);
		expect(text).toBe(code);
		expect(unresolved).toEqual(['./gone']);
	});
});

describe('exportTargets', () => {
	it('lists every target but the source condition', () => {
		expect(
			exportTargets({
				'.': {
					'null3d-source': './src/index.ts',
					types: './lib/index.d.ts',
					default: './lib/index.js',
				},
				'./internal': { 'null3d-source': './src/internal.ts' },
				'./wasm/*': './dist/wasm/*',
			}),
		).toEqual(['./lib/index.d.ts', './lib/index.js', './dist/wasm/*']);
		expect(exportTargets('./lib/index.js')).toEqual(['./lib/index.js']);
		expect(exportTargets(undefined)).toEqual([]);
	});
});

describe('packageProblems', () => {
	const manifest: Manifest = {
		name: '@null3d/demo',
		version: '0.1.0',
		exports: {
			'.': { types: './lib/index.d.ts', default: './lib/index.js' },
			'./wasm/*': './dist/wasm/*',
		},
		bin: { demo: 'bin/demo.js' },
		publishConfig: { access: 'public', provenance: true },
		peerDependencies: { '@null3d/engine': '0.1.0' },
	};
	const files = new Set([
		'lib/index.js',
		'lib/index.d.ts',
		'dist/wasm/single/null3d.js',
		'bin/demo.js',
		'docs/index.md',
	]);

	it('accepts a complete public package', () => {
		expect(packageProblems(manifest, files, ['docs/index.md'])).toEqual([]);
	});

	it('names each missing file, workspace version and publish setting', () => {
		const broken: Manifest = {
			...manifest,
			publishConfig: { access: 'public' },
			peerDependencies: { '@null3d/engine': 'workspace:*' },
		};
		const without = new Set(
			[...files].filter((file) => !file.startsWith('dist/') && file !== 'bin/demo.js'),
		);
		expect(packageProblems(broken, without, ['docs/index.md', 'docs/api.md'])).toEqual([
			'publishConfig must set "access": "public" and "provenance": true',
			'peerDependencies gives @null3d/engine the version workspace:*, which npm cannot install',
			'it lacks ./dist/wasm/*, which its manifest names',
			'it lacks bin/demo.js, which its manifest names',
			'it lacks docs/api.md',
		]);
	});
});
