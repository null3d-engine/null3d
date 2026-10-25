import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHADER_COMPILER_URL } from '../../packages/vite-plugin/src/shader-compiler';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import {
	builtAddress,
	compileShaders,
	exportTargets,
	internalConstructorClasses,
	type Manifest,
	packageProblems,
	protectedConstructors,
	repositoryOnlyFiles,
	rewriteAddresses,
	shaderDeclarationFiles,
	shaderFiles,
	shaderModuleJsFiles,
} from './packages';
import { MODULE_DIR } from './shader-modules';

/** True when the shader compiler's build is present, which the pack tests need. */
const COMPILES = existsSync(fileURLToPath(SHADER_COMPILER_URL));

/** A custom material compiles every build of the standard material, which takes seconds. */
const COMPILE_MS = scaledBudget(60_000);

/** The built files of a small package, by path in `lib/`. */
const BUILT = new Set([
	'index.js',
	'index.d.ts',
	'math/color.js',
	'page/engine.js',
	'render/draw.js',
	'scene/ktx2.js',
	'shader.wgsl.js',
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

	it('gives the module that holds the compiled shader of a .wgsl file', () => {
		expect(builtAddress('material.js', './shader.wgsl', exists)).toBe('./shader.wgsl.js');
	});

	it('is null when no built file answers', () => {
		expect(builtAddress('index.js', './missing', exists)).toBeNull();
		expect(builtAddress('index.js', './missing.ts', exists)).toBeNull();
		expect(builtAddress('index.js', './missing.wgsl', exists)).toBeNull();
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

	it('names each repository-only file that the package holds', () => {
		const build = { compile: true, shaders: false, docs: false, needs: [], required: [] };
		const forbidden = repositoryOnlyFiles({ ...build, repositoryOnly: ['internal.ts'] });
		expect(forbidden).toEqual(['lib/internal.js', 'lib/internal.d.ts']);
		expect(packageProblems(manifest, files, [], forbidden)).toEqual([]);
		expect(
			packageProblems(manifest, new Set([...files, 'lib/internal.js']), [], forbidden),
		).toEqual(['it holds lib/internal.js, which only the repository uses']);
	});

	it('accepts a complete public package', () => {
		expect(packageProblems(manifest, files, ['docs/index.md'])).toEqual([]);
	});

	it('names a raw shader file that the tarball holds', () => {
		const holding = new Set([...files, 'lib/glow.wgsl']);
		expect(packageProblems(manifest, holding, [], [], ['lib/glow.wgsl'])).toEqual([
			'it holds lib/glow.wgsl, whose compiled module must take its place',
		]);
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

/** A package folder of a temporary repository, with the files that `files` gives it. */
const folders: string[] = [];
function packageFixture(files: Readonly<Record<string, string>>): { root: string; dir: string } {
	const root = mkdtempSync(join(tmpdir(), 'null3d-shaders-'));
	const dir = join(root, 'packages/demo');
	writeFileSync(join(root, 'package.json'), '{"type":"module"}');
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	folders.push(root);
	return { root, dir };
}
afterAll(() => {
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A custom material's WGSL, as a package's shader file holds it. */
const MATERIAL = `
struct Uniforms {
	tint: vec4f,
}

fn surface(input: SurfaceInput) -> Surface {
	var s = defaultSurface(input);
	s.baseColor *= material.tint.rgb;
	return s;
}`;

/** WGSL with a render pipeline whose fragment stage names something undefined. */
const BROKEN = `
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
	return vec4f(0.0, 0.0, 0.0, 1.0);
}

@fragment fn fragment() -> @location(0) vec4f {
	return vec4f(nope);
}`;

describe('shaderFiles', () => {
	it('requires the compiled module of each shader file, and forbids the raw file', () => {
		const { root } = packageFixture({
			'src/parts/glow.wgsl': MATERIAL,
			'src/index.ts': '',
		});
		expect(shaderFiles(root, 'demo')).toEqual({
			required: ['lib/parts/glow.wgsl.js'],
			forbidden: ['lib/parts/glow.wgsl'],
		});
	});
});

describe('compileShaders', () => {
	it('refuses WGSL that is no shader, and names the file', async () => {
		const { root, dir } = packageFixture({ 'src/empty.wgsl': '// nothing here\n' });
		await expect(compileShaders(root, dir)).rejects.toThrow(
			/packages\/demo\/src\/empty\.wgsl:1:1: the WGSL has no entry point/,
		);
	});

	describe.skipIf(!COMPILES)('with the shader compiler', () => {
		it(
			'writes the compiled module and its build sets, and no raw WGSL',
			async () => {
				const { root, dir } = packageFixture({ 'src/glow.wgsl': MATERIAL });
				await compileShaders(root, dir);
				const lib = join(dir, 'lib');
				expect(existsSync(join(lib, 'glow.wgsl'))).toBe(false);
				expect(existsSync(join(lib, 'glow.wgsl.js'))).toBe(true);
				expect(
					readdirSync(lib).filter((name) => name.startsWith('glow.wgsl-material-wgsl-')),
				).not.toEqual([]);
				const { default: shader } = await import(pathToFileURL(join(lib, 'glow.wgsl.js')).href);
				expect(shader.kind).toBe('material');
				expect(shader.functions).toEqual(['surface']);
				// The builds load on first use, from the set modules beside the shader's own module.
				expect(Object.keys(shader.variants)).toEqual([]);
				const builds = await shader.builds('wgsl', 0);
				expect(Object.keys(builds).length).toBeGreaterThan(0);
			},
			COMPILE_MS,
		);

		it(
			'fails on WGSL that does not compile, and names the file and the place',
			async () => {
				const { root, dir } = packageFixture({ 'src/broken.wgsl': BROKEN });
				await expect(compileShaders(root, dir)).rejects.toThrow(
					/packages\/demo\/src\/broken\.wgsl:\d+:\d+: no definition in scope for identifier: `nope`/,
				);
			},
			COMPILE_MS,
		);
	});
});

describe('the shader module checks', () => {
	const root = mkdtempSync(join(tmpdir(), 'null3d-packages-'));
	const folder = join(root, MODULE_DIR);
	mkdirSync(folder, { recursive: true });
	for (const name of [
		'shaders.ts',
		'shader-features.ts',
		'shaders-ao-wgsl.ts',
		'shaders-sky-glsl.js',
		'core.ts',
		'gpu.ts',
	])
		writeFileSync(join(folder, name), '');
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it('asks for a declaration for each generated TypeScript module, and none for JavaScript', () => {
		expect(shaderDeclarationFiles(root)).toEqual([
			'lib/generated/core.d.ts',
			'lib/generated/gpu.d.ts',
			'lib/generated/shader-features.d.ts',
			'lib/generated/shaders-ao-wgsl.d.ts',
			'lib/generated/shaders.d.ts',
		]);
	});

	it('names the built shader JavaScript, and leaves the generated constants alone', () => {
		expect(shaderModuleJsFiles(root)).toEqual([
			'lib/generated/shader-features.js',
			'lib/generated/shaders-ao-wgsl.js',
			'lib/generated/shaders-sky-glsl.js',
			'lib/generated/shaders.js',
		]);
	});
});

describe('internal constructors', () => {
	it('finds each class whose constructor is marked @internal', () => {
		const source = `
export class Made {
	/** @internal */
	constructor(readonly id: number) {}
}
export class Open {
	constructor(readonly id: number) {}
}`;
		expect(internalConstructorClasses(source)).toEqual(['Made']);
	});

	it('gives each such class a protected constructor in its declarations', () => {
		const declarations = `export declare class Made {
    readonly radius: number;
}
export declare class Open {
}
`;
		expect(protectedConstructors(declarations, new Set(['Made']))).toBe(`export declare class Made {
    protected constructor();
    readonly radius: number;
}
export declare class Open {
}
`);
	});
});
