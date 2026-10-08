import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite';
import { DRACO_RELEASE } from '../../../tools/lib/draco-vendor';
import { fixture } from '../../../tools/lib/fixture';
import null3d, {
	CORE_FILES,
	earlyCoreTag,
	FILES_LIST,
	inlineLimit,
	missingCoreFiles,
	NOTICES_FILE,
	thirdPartyNotices,
} from './index';

/** A project with the engine package installed, holding the given core files. */
function project(files: readonly string[]): string {
	const engine = 'node_modules/@null3d/engine';
	return fixture({
		'package.json': '{"name":"demo","private":true}',
		[`${engine}/package.json`]: JSON.stringify({
			name: '@null3d/engine',
			exports: {
				'.': './lib/index.js',
				'./wasm/*': './dist/wasm/*',
				'./package.json': './package.json',
			},
		}),
		[`${engine}/lib/index.js`]: '',
		...Object.fromEntries(files.map((file) => [`${engine}/dist/wasm/${file}`, 'x'])),
	});
}

describe('missingCoreFiles', () => {
	it('is null when the project does not install the engine', () => {
		expect(missingCoreFiles(fixture({ 'package.json': '{}' }))).toBeNull();
	});

	it('lists each core file the engine package lacks', () => {
		expect(missingCoreFiles(project([]))).toEqual([...CORE_FILES]);
		expect(missingCoreFiles(project(CORE_FILES.slice(1)))).toEqual(CORE_FILES.slice(0, 1));
		expect(missingCoreFiles(project(CORE_FILES))).toEqual([]);
	});
});

describe('the HTTPS server', () => {
	it('serves HTTP/1.1 only, with the certificate from the certificate folder', () => {
		const root = fixture({ 'cert/cert.pem': 'CERT', 'cert/key.pem': 'KEY' });
		const plugin = null3d({ https: true, certDir: 'cert' });
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root },
			{ mode: 'development', command: 'serve' },
		);
		for (const server of [config.server, config.preview]) {
			const https = server?.https as { cert: Buffer; ALPNCallback: () => string };
			expect(String(https.cert)).toBe('CERT');
			expect(https.ALPNCallback()).toBe('http/1.1');
		}
	});
});

describe('earlyCoreTag', () => {
	const chunk = (fileName: string, code: string, imports: string[] = []) =>
		({ type: 'chunk', fileName, code, imports }) as unknown as Rollup.OutputChunk;
	const asset = (fileName: string) =>
		({ type: 'asset', fileName }) as unknown as Rollup.OutputAsset;
	const early = chunk(
		'assets/early-core-AbCd1234.js',
		'new URL("null3d_bg-Thr00000.wasm",import.meta.url);new URL("null3d_bg-Sgl00000.wasm",import.meta.url)',
	);
	const page = chunk('assets/page-AbCd1234.js', 'import "./engine-AbCd1234.js"', [
		'assets/engine-AbCd1234.js',
	]);
	const bundle = (engineCode: string): Rollup.OutputBundle =>
		Object.fromEntries(
			[
				early,
				page,
				chunk('assets/engine-AbCd1234.js', engineCode),
				asset('assets/null3d_bg-Thr00000.wasm'),
				asset('assets/null3d_bg-Sgl00000.wasm'),
				asset('assets/other-Xy000000.wasm'),
			].map((file) => [file.fileName, file]),
		);
	const loadsCore = bundle('fetch(new URL("null3d_bg-Thr00000.wasm",import.meta.url))');

	it('adds the early script to a page whose chunks load the core, first in its head', () => {
		expect(earlyCoreTag(early, page, loadsCore, 'tests/pages/engine.html', './')).toEqual({
			tag: 'script',
			attrs: { type: 'module', async: true, src: '../../assets/early-core-AbCd1234.js' },
			injectTo: 'head-prepend',
		});
	});

	it("gives the address from the page with a relative base, and from the base's root otherwise", () => {
		const src = (htmlFile: string, base: string) =>
			earlyCoreTag(early, page, loadsCore, htmlFile, base)?.attrs?.src;
		expect(src('index.html', './')).toBe('./assets/early-core-AbCd1234.js');
		expect(src('index.html', '')).toBe('./assets/early-core-AbCd1234.js');
		expect(src('play/index.html', '/')).toBe('/assets/early-core-AbCd1234.js');
		expect(src('index.html', 'https://cdn.example.com/game/')).toBe(
			'https://cdn.example.com/game/assets/early-core-AbCd1234.js',
		);
	});

	it('leaves out a page whose chunks load no core, or another WebAssembly file', () => {
		expect(earlyCoreTag(early, page, bundle('let x = 1'), 'index.html', '/')).toBeUndefined();
		expect(
			earlyCoreTag(
				early,
				page,
				bundle('new URL("other-Xy000000.wasm",import.meta.url)'),
				'index.html',
				'/',
			),
		).toBeUndefined();
	});
});

/** A project that depends on the given null3D packages, each installed with the given notices. */
function noticesProject(packages: Record<string, string | null>): string {
	const files: Record<string, string> = {
		'package.json': JSON.stringify({
			name: 'demo',
			private: true,
			dependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, '*'])),
		}),
	};
	for (const [name, notices] of Object.entries(packages)) {
		files[`node_modules/${name}/package.json`] = JSON.stringify({
			name,
			exports: { './package.json': './package.json' },
		});
		if (notices !== null) files[`node_modules/${name}/THIRD-PARTY-NOTICES.txt`] = `${notices}\n`;
	}
	return fixture(files);
}

type GenerateBundle = { handler: (this: object, o: object, b: Rollup.OutputBundle) => void };

/**
 * The plugin's hooks after Vite resolves a config for the given command and worker format, and the
 * files that it adds to `bundle`, as a build's last step.
 */
function resolvedPlugin(
	root: string,
	command: 'build' | 'serve',
	format: 'es' | 'iife' = 'es',
	bundle: Rollup.OutputBundle = {},
	plugin = null3d(),
) {
	const warnings: string[] = [];
	const config = {
		command,
		root,
		base: '/',
		build: { assetsDir: 'assets', ssr: false, lib: false },
		worker: { format },
		logger: { warn: (message: string) => warnings.push(message) },
	} as unknown as ResolvedConfig;
	(plugin.configResolved as (c: ResolvedConfig) => void)(config);
	const emitted: object[] = [];
	(plugin.generateBundle as GenerateBundle).handler.call(
		{ emitFile: (file: object) => emitted.push(file) },
		{},
		bundle,
	);
	return { warnings, emitted };
}

describe('the third-party notices', () => {
	it("joins the notices of each null3D package that the project depends on, the engine's first", () => {
		const root = noticesProject({
			'@null3d/physics': 'physics notices',
			'@null3d/engine': 'engine notices',
			'@null3d/controls': null,
		});
		expect(thirdPartyNotices(root)).toBe('engine notices\n\nphysics notices\n');
		expect(thirdPartyNotices(fixture({ 'package.json': '{}' }))).toBeNull();
	});

	it('writes the notices beside the page in a production build only', () => {
		const root = noticesProject({ '@null3d/engine': 'engine notices' });
		expect(resolvedPlugin(root, 'build').emitted).toContainEqual({
			type: 'asset',
			fileName: NOTICES_FILE,
			source: 'engine notices\n',
		});
		expect(resolvedPlugin(root, 'serve').emitted).toEqual([]);
	});

	it("holds each licence and notice of the engine's third-party code word for word", () => {
		const engine = join(import.meta.dir, '../../engine');
		const notices = readFileSync(join(engine, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
		const meshopt = dirname(
			createRequire(join(engine, 'package.json')).resolve('meshoptimizer/package.json'),
		);
		for (const file of [
			join(engine, 'vendor/basis/LICENSE'),
			join(engine, 'vendor/basis/NOTICE'),
			join(engine, 'vendor/basis/LICENSE-zstd'),
			join(meshopt, 'LICENSE.md'),
		])
			expect(notices).toContain(readFileSync(file, 'utf8').trim());
		const { version } = JSON.parse(readFileSync(join(meshopt, 'package.json'), 'utf8'));
		expect(notices).toContain(`meshoptimizer ${version}`);
		// Draco's licence is the Apache License 2.0, whose text Basis Universal's section holds, and
		// whose appendix only differs in the copyright line.
		const apache = readFileSync(join(engine, 'vendor/draco/LICENSE'), 'utf8')
			.split('APPENDIX:')[0]
			?.trim() as string;
		expect(notices).toContain(apache);
		expect(notices).toContain(`Draco ${DRACO_RELEASE.version}`);
		expect(notices).toContain('Copyright 2016 The Draco Authors.');
	});
});

describe('the list of files for offline play', () => {
	it("writes the build's files beside the page, with what the worker builds hold", () => {
		const root = fixture({
			'package.json': '{}',
			'node_modules/@null3d/engine/package.json': '{"name":"@null3d/engine"}',
		});
		const plugin = null3d();
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root },
			{ mode: 'production', command: 'build' },
		);
		const [workerFiles] = (config.worker as { plugins: () => Plugin[] }).plugins();
		const ktx2 = `${root}/node_modules/@null3d/engine/lib/scene/ktx2.js`;
		((workerFiles as Plugin).generateBundle as (o: object, b: object) => void)(
			{},
			{
				'assets/ktx2-b.js': {
					type: 'chunk',
					fileName: 'assets/ktx2-b.js',
					moduleIds: [ktx2],
					imports: [],
					dynamicImports: [],
				},
			},
		);
		const bundle = {
			'index.html': {
				type: 'asset',
				fileName: 'index.html',
				source: '"/assets/main-a.js"',
				originalFileNames: ['index.html'],
			},
			'assets/main-a.js': {
				type: 'chunk',
				fileName: 'assets/main-a.js',
				isEntry: true,
				code: '',
				moduleIds: [],
				imports: [],
				dynamicImports: [],
			},
			'assets/ktx2-b.js': {
				type: 'asset',
				fileName: 'assets/ktx2-b.js',
				source: '',
				originalFileNames: [],
			},
		} as unknown as Rollup.OutputBundle;
		const [list] = resolvedPlugin(root, 'build', 'es', bundle, plugin).emitted as {
			fileName: string;
			source: string;
		}[];
		expect(list?.fileName).toBe(FILES_LIST);
		const { start, features } = JSON.parse(list?.source ?? '');
		expect({ start, features }).toEqual({
			start: ['assets/main-a.js', 'index.html'],
			features: { ktx2: ['assets/ktx2-b.js'] },
		});
		expect(resolvedPlugin(root, 'serve').emitted).toEqual([]);
	});
});

describe('the worker format', () => {
	it('warns when workers do not build as ES modules', () => {
		const root = fixture({ 'package.json': '{}' });
		expect(resolvedPlugin(root, 'build').warnings).toEqual([]);
		expect(resolvedPlugin(root, 'build', 'iife').warnings).toEqual([
			expect.stringContaining('workers build as iife, not as ES modules'),
		]);
	});
});

describe('the test switches in the address', () => {
	const define = (options: Parameters<typeof null3d>[0], mode: string) =>
		(null3d(options).config as (c: object, e: object) => UserConfig)(
			{ root: fixture({ 'package.json': '{}' }) },
			{ mode, command: 'build' },
		).define;

	it('leaves the choice to the engine without the option: development builds read them', () => {
		expect(define({}, 'production')).toEqual({ __NULL3D_DEV__: 'false' });
		expect(define({}, 'development')).toEqual({ __NULL3D_DEV__: 'true' });
	});

	it('lets a production build read them when the option asks', () => {
		expect(define({ urlSwitches: true }, 'production')).toEqual({
			__NULL3D_DEV__: 'false',
			__NULL3D_URL_SWITCHES__: 'true',
		});
	});
});

describe('inlineLimit', () => {
	type Limit = (file: string, content: Buffer) => boolean | undefined;
	const small = Buffer.alloc(100);
	/**
	 * A project with the engine installed, and a copy of the repository with the engine's source and
	 * a private workspace of the scope.
	 */
	const root = fixture({
		'app/package.json': '{"name":"demo","private":true}',
		'app/node_modules/@null3d/engine/package.json': '{"name":"@null3d/engine"}',
		'repo/packages/engine/package.json': '{"name":"@null3d/engine"}',
		'repo/tests/package.json': '{"name":"@null3d/tests","private":true}',
	});

	it('never inlines a file of a null3D package, and keeps the project setting for the rest', () => {
		const limit = inlineLimit(4096) as Limit;
		const engine = join(root, 'app/node_modules/@null3d/engine');
		expect(limit(join(engine, 'lib/workers/job-worker.js'), small)).toBe(false);
		const source = join(root, 'repo/packages/engine');
		expect(limit(join(source, 'src/generated/shaders-background-glsl.js'), small)).toBe(false);
		expect(limit(join(source, 'vendor/meshopt/meshopt_decoder.wasm'), small)).toBe(false);
		expect(limit(join(root, 'repo/tests/pages/icon.png'), small)).toBe(true);
		expect(limit(join(root, 'app/src/icon.png'), small)).toBe(true);
		expect(limit(join(root, 'app/src/photo.png'), Buffer.alloc(5000))).toBe(false);
	});

	it("passes other files to the project's own function, or to Vite's default", () => {
		const own = inlineLimit((file) => file.endsWith('.svg')) as Limit;
		expect(own(join(root, 'app/src/logo.svg'), small)).toBe(true);
		expect(own(join(root, 'app/node_modules/@null3d/engine/lib/x.svg'), small)).toBe(false);
		expect(
			(inlineLimit(undefined) as Limit)(join(root, 'app/src/icon.png'), small),
		).toBeUndefined();
	});
});
