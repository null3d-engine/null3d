import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig, Rollup, UserConfig } from 'vite';
import { build, createLogger, createServer } from 'vite';
import { DRACO_RELEASE } from '../../../tools/lib/draco-vendor';
import { fixture } from '../../../tools/lib/fixture';
import { HOT_CLIENT_ID, PERMUTATION_WORD_EVENT, UNLISTED_WORD_EVENT } from './hot';
import null3d, {
	CORE_FILES,
	earlyCoreTag,
	FILES_LIST,
	inlineLimit,
	missingCoreFiles,
	NOTICES_FILE,
	QUERY_EXTENSION_PARAM,
	queryExtensionMiddleware,
	sameOriginMiddleware,
	thirdPartyNotices,
} from './index';

/** The main null3D plugin, which the streamed shader plugin accompanies. */
function enginePlugin(options: Parameters<typeof null3d>[0] = {}): Plugin {
	const plugin = null3d(options).find((entry) => entry.name === 'null3d');
	if (plugin === undefined) throw new Error('the null3D plugin is missing');
	return plugin;
}

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
		const plugin = enginePlugin({ https: true, certDir: 'cert' });
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

	it('lets the server offer HTTP/2 when the http2 option asks for it', () => {
		const root = fixture({ 'cert/cert.pem': 'CERT', 'cert/key.pem': 'KEY' });
		const plugin = enginePlugin({ https: true, http2: true, certDir: 'cert' });
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root },
			{ mode: 'development', command: 'serve' },
		);
		for (const server of [config.server, config.preview]) {
			const https = server?.https as { cert: Buffer; ALPNCallback?: () => string };
			expect(String(https.cert)).toBe('CERT');
			expect(https.ALPNCallback).toBeUndefined();
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
	plugin = enginePlugin(),
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
	it("joins the notices of each null3D package that a page ships, the engine's first", () => {
		const root = noticesProject({
			'@null3d/physics': 'physics notices',
			'@null3d/engine': 'engine notices',
			'@null3d/controls': null,
			'@null3d/cli': 'command-line tool notices',
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
		const plugin = enginePlugin();
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root },
			{ mode: 'production', command: 'build' },
		);
		const workerFiles = (config.worker as { plugins: () => Plugin[] })
			.plugins()
			.find((plugin) => plugin.name === 'null3d:worker-files') as Plugin;
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
		(enginePlugin(options).config as (c: object, e: object) => UserConfig)(
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

describe('the shader list on the dev server', () => {
	/** A listener of Vite's channel, with the page that sent the event. */
	type Listener = (data: unknown, client: { send: (event: string, data: unknown) => void }) => void;

	/**
	 * Starts a dev server for a project with a list that holds only the word without bits, and
	 * gives the listeners on Vite's channel, the server's warnings and the server itself.
	 */
	async function devServer(options: Parameters<typeof null3d>[0]) {
		const root = fixture({
			'package.json': '{"name":"demo","private":true}',
			'list.txt': '0x00000000\n',
		});
		const listeners = new Map<string, Listener>();
		// Runs before the null3D plugin's own step, and keeps each listener that it adds.
		const capture: Plugin = {
			name: 'capture',
			enforce: 'pre',
			configureServer(server) {
				const hot = server.environments.client.hot;
				hot.on = ((event: string, listener: Listener) => {
					listeners.set(event, listener);
				}) as typeof hot.on;
			},
		};
		const warnings: string[] = [];
		const logger = createLogger('silent');
		logger.warn = (message) => {
			warnings.push(message);
		};
		const server = await createServer({
			root,
			configFile: false,
			customLogger: logger,
			plugins: [capture, null3d(options)],
			server: { middlewareMode: true, watch: null },
		});
		return { listeners, warnings, server };
	}

	it("warns about a word that the list lacks, in the terminal once and in each page's console", async () => {
		const { listeners, warnings, server } = await devServer({ shaders: { list: 'list.txt' } });
		try {
			const hear = listeners.get(PERMUTATION_WORD_EVENT);
			const sent: [string, unknown][] = [];
			const client = { send: (event: string, data: unknown) => sent.push([event, data]) };
			hear?.({ word: 0, page: '/' }, client);
			expect(sent).toEqual([]);
			hear?.({ word: 0x1000, page: '/' }, client);
			hear?.({ word: 0x1000, page: '/level.html' }, client);
			expect(sent.map(([event]) => event)).toEqual([UNLISTED_WORD_EVENT, UNLISTED_WORD_EVENT]);
			expect(sent[0]?.[1]).toEqual({
				message: expect.stringContaining('/ draws with the permutation word 0x00001000'),
			});
			expect(warnings).toEqual([
				expect.stringContaining(
					'null3D: / draws with the permutation word 0x00001000, which the shader list list.txt lacks.',
				),
			]);
			// A message that is not a page's word changes nothing.
			hear?.({ word: 'x' }, client);
			expect(sent).toHaveLength(2);
			// The pages' client module sends the words.
			const code = await server.environments.client.pluginContainer.load(HOT_CLIENT_ID);
			expect(String(code)).toContain(PERMUTATION_WORD_EVENT);
		} finally {
			await server.close();
		}
	});

	it('hears no words in a project without a list', async () => {
		const { listeners, server } = await devServer({});
		try {
			expect(listeners.has(PERMUTATION_WORD_EVENT)).toBe(false);
			const code = await server.environments.client.pluginContainer.load(HOT_CLIENT_ID);
			expect(String(code)).not.toContain(PERMUTATION_WORD_EVENT);
		} finally {
			await server.close();
		}
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

describe('the streamed shader files', () => {
	/**
	 * A project whose page and worker each load a generated shader file, which imports a table of
	 * shared paragraphs. The file names and the address are the shapes the shader build writes.
	 */
	function streamedProject(): string {
		return fixture({
			'package.json': '{"name":"demo","private":true}',
			'index.html': '<script type="module" src="/main.js"></script>',
			'shaders.ts': "export const glsl = () => new URL('./shaders-glsl.js', import.meta.url);\n",
			'shaders-glsl.js':
				"import { TABLE } from './shader-paragraphs-glsl.js';\nexport const value = TABLE;\n",
			'shader-paragraphs-glsl.js': 'export const TABLE = 1;\n',
			'worker.ts': "import { glsl } from './shaders.ts';\nconsole.log(glsl());\n",
			'main.js':
				"import { glsl } from './shaders.ts';\nnew Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });\nconsole.log(glsl());\n",
		});
	}

	/** Every file under a folder, by its path. */
	function filesIn(folder: string): string[] {
		return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
			const path = join(folder, entry.name);
			return entry.isDirectory() ? filesIn(path) : [path];
		});
	}

	it('keeps every shader address pointing at its copy, whatever folder the chunks land in', async () => {
		const root = streamedProject();
		await build({
			root,
			logLevel: 'silent',
			configFile: false,
			build: {
				rollupOptions: {
					output: {
						entryFileNames: 'js/[name]-[hash].js',
						chunkFileNames: 'js/[name]-[hash].js',
					},
				},
			},
			plugins: [null3d()],
		});
		const out = join(root, 'dist');
		const copy = readdirSync(join(out, 'assets')).find((name) =>
			/^shaders-glsl-[0-9a-f]{8}\.js$/.test(name),
		);
		expect(copy).toBeDefined();
		expect(readdirSync(join(out, 'assets'))).toContain('shader-paragraphs-glsl.js');
		const scripts = filesIn(out).filter((path) => path.endsWith('.js'));
		const naming = scripts
			.filter((path) => readFileSync(path, 'utf8').includes(copy as string))
			.flatMap((path) =>
				[...readFileSync(path, 'utf8').matchAll(/['"`](\.[^'"`]+\.js)['"`]/g)].map(
					(match) => [path, match[1] as string] as const,
				),
			);
		expect(naming.length).toBeGreaterThanOrEqual(2);
		for (const [path, address] of naming) {
			expect([relative(root, path), address, existsSync(resolve(dirname(path), address))]).toEqual([
				relative(root, path),
				address,
				true,
			]);
		}
		const list = JSON.parse(readFileSync(join(out, FILES_LIST), 'utf8')) as {
			start: string[];
			features: Record<string, string[]>;
		};
		const listed = [...list.start, ...Object.values(list.features).flat()];
		expect(listed).toContain(`assets/${copy as string}`);
		expect(listed).toContain('assets/shader-paragraphs-glsl.js');
	});

	it('writes the copies and their tables in a library build, at an address that resolves', async () => {
		const root = streamedProject();
		await build({
			root,
			logLevel: 'silent',
			configFile: false,
			build: { lib: { entry: 'shaders.ts', formats: ['es'], fileName: 'lib' } },
			plugins: [null3d()],
		});
		const out = join(root, 'dist');
		const assets = readdirSync(join(out, 'assets'));
		const copy = assets.find((name) => /^shaders-glsl-[0-9a-f]{8}\.js$/.test(name)) as string;
		expect(copy).toBeDefined();
		expect(assets).toContain('shader-paragraphs-glsl.js');
		const chunk = filesIn(out).find(
			(path) => /\.m?js$/.test(path) && !path.includes(`${sep}assets${sep}`),
		) as string;
		const text = readFileSync(chunk, 'utf8');
		expect(text).toContain(copy);
		for (const match of text.matchAll(/['"`](\.[^'"`]+\.js)['"`]/g))
			expect([match[1], existsSync(resolve(dirname(chunk), match[1] as string))]).toEqual([
				match[1],
				true,
			]);
	});

	describe('with a list of permutation words', () => {
		/** A device module in the shader build's form, with one build of each word. */
		const deviceModule = (
			words: readonly number[],
		) => `import { SHARED_${words.join(', SHARED_')} } from './shader-paragraphs-glsl.js';

// Paragraphs that several sources below share, each written once.
const PART_0 = \`void main() {}\`;

export const SHADERS = {
\tlit: {
${words.map((word) => `\t\tbuild_${word}: {\n\t\t\tpermutation: ${word},\n\t\t\twgsl: null,\n\t\t\tglsl: { main: \`\${SHARED_${word}}\${PART_0}\` },\n\t\t},`).join('\n')}
\t},
};
`;

		/**
		 * A project whose shader set holds the builds of words 0, 4, 16 and 18 in its start module,
		 * and of 64 in a feature's module, which a list without 64 leaves out. Its main module holds
		 * a build of 32 of its own, as the main module of the set bundles a few.
		 */
		function listedProject(list: string): string {
			return fixture({
				'package.json': '{"name":"demo","private":true}',
				'index.html': '<script type="module" src="/main.js"></script>',
				'list.txt': list,
				'shaders.ts': `export const SHADERS = { test: { a: {\n\t\tpermutation: 32,\n\t} } };
export const start = () => new URL('./shaders-glsl.js', import.meta.url);
export const skin = () => new URL('./shaders-skinning-glsl.js', import.meta.url);
`,
				'shaders-glsl.js': deviceModule([0, 4, 16, 18]),
				'shaders-skinning-glsl.js': deviceModule([64]),
				'shader-paragraphs-glsl.js': [0, 4, 16, 18, 64]
					.map((word) => `export const SHARED_${word} = \`// paragraph ${word}\`;\n`)
					.join(''),
				'shader-permutations.ts':
					"export const LISTED_PERMUTATIONS: readonly number[] | null = null;\nexport const SHIPPED_GPU_PATHS: readonly ('webgpu' | 'webgl2')[] | null = null;\n",
				'main.js':
					"import { SHADERS, start, skin } from './shaders.ts';\nimport { LISTED_PERMUTATIONS } from './shader-permutations.ts';\nconsole.log(start(), skin(), SHADERS, LISTED_PERMUTATIONS);\n",
			});
		}

		/**
		 * Builds the project with the list that `list` names, or with none for null, and gives its
		 * output folder and the messages it logged.
		 */
		async function buildListed(root: string, list: string | null = 'list.txt') {
			const messages: string[] = [];
			const logger = createLogger('info');
			logger.info = (message) => {
				messages.push(message);
			};
			logger.warn = (message) => {
				messages.push(message);
			};
			await build({
				root,
				customLogger: logger,
				configFile: false,
				plugins: [null3d(list === null ? {} : { shaders: { list } })],
			});
			return { out: join(root, 'dist'), messages };
		}

		/** The text of each file in the output's assets folder, by its name. */
		function assetsOf(out: string): Map<string, string> {
			const folder = join(out, 'assets');
			return new Map(
				readdirSync(folder).map((name) => [name, readFileSync(join(folder, name), 'utf8')]),
			);
		}

		it('copies only the listed builds, for every value of the bits a device fixes', async () => {
			const { out, messages } = await buildListed(listedProject('0x00000000\n0x00000010\n'));
			const assets = assetsOf(out);
			const start = [...assets].find(([name]) => /^shaders-glsl-[0-9a-f]{8}\.js$/.test(name));
			expect(start?.[1]).toContain('permutation: 0,');
			expect(start?.[1]).toContain('permutation: 16,');
			expect(start?.[1]).toContain('permutation: 18,');
			expect(start?.[1]).not.toContain('permutation: 4,');
			// The table keeps the paragraphs that the kept builds import.
			const table = assets.get('shader-paragraphs-glsl.js') ?? '';
			expect(table).toContain('SHARED_16');
			expect(table).toContain('SHARED_18');
			expect(table).not.toContain('SHARED_4 ');
			expect(table).not.toContain('SHARED_64');
			expect(messages.join('\n')).toMatch(/copied 3 shader files.*permutation words of list\.txt/);
		});

		it('names a module without builds in place of a file whose builds the list leaves out', async () => {
			const { out } = await buildListed(listedProject('0x00000000\n'));
			const assets = assetsOf(out);
			const names = [...assets.keys()];
			expect(names.some((name) => name.startsWith('shaders-skinning-glsl'))).toBe(false);
			const unlisted = names.find((name) => /^shaders-unlisted-[0-9a-f]{8}\.js$/.test(name));
			expect(assets.get(unlisted ?? '')).toContain('export const SHADERS = {};');
			const scripts = readdirSync(join(out, 'assets')).filter((name) => name.startsWith('index-'));
			const page = scripts.map((name) => assets.get(name)).join('\n');
			expect(page).toContain(unlisted as string);
		});

		it('names the listed words in the module that the engine reads them from', async () => {
			const { out } = await buildListed(listedProject('0x00000010\n0x00000000\n0x00000004\n'));
			const page = [...assetsOf(out)]
				.filter(([name]) => name.startsWith('index-'))
				.map(([, text]) => text)
				.join('\n');
			expect(page).toMatch(/\[\s*0\s*,\s*4\s*,\s*16\s*\]/);
		});

		it('answers a word that a build of the main module holds', async () => {
			const { out } = await buildListed(listedProject('0x00000000\n0x00000020\n'));
			expect(existsSync(out)).toBe(true);
		});

		it('fails the build for a listed word that no build of the set holds', async () => {
			const root = listedProject('0x00000000\n0x00000400\n');
			await expect(buildListed(root)).rejects.toThrow(
				/list\.txt names 0x00000400, which no shader build of this project holds/,
			);
		});

		it('fails the build for a list it cannot read, and says how to make one', async () => {
			await expect(buildListed(listedProject('0x00000000\n'), 'none.txt')).rejects.toThrow(
				/cannot read the shader list none\.txt.*shaders record/,
			);
		});

		it('copies the whole set without a list, and warns with its size and the docs', async () => {
			const { out, messages } = await buildListed(listedProject('0x00000000\n'), null);
			const names = [...assetsOf(out).keys()];
			expect(names.some((name) => name.startsWith('shaders-skinning-glsl-'))).toBe(true);
			expect(names.some((name) => name.startsWith('shaders-unlisted'))).toBe(false);
			expect(messages.join('\n')).toMatch(
				/copied 3 shader files, 0 MB: every build.*shaders\.list.*assets-pipeline\.md#build-only-the-shader-permutations-you-draw-with/,
			);
		});
	});

	it('runs in the worker builds, which name the copies they load', () => {
		const plugin = enginePlugin();
		const config = (plugin.config as (c: object, e: object) => UserConfig)(
			{ root: fixture({ 'package.json': '{}' }) },
			{ mode: 'production', command: 'build' },
		);
		const names = (config.worker as { plugins: () => Plugin[] })
			.plugins()
			.map((plugin) => plugin.name);
		expect(names).toContain('null3d:streamed-shader-assets');
	});
});

describe('the query-extension middleware', () => {
	/** The URL that the middleware leaves for `url`, as Vite's transform would receive it. */
	const rewritten = (url: string): string => {
		const req = { url } as { url?: string };
		queryExtensionMiddleware()(req as never, {} as never, () => {});
		return req.url ?? '';
	};

	it('keeps a dotted query from naming the module type', () => {
		for (const query of ['render-scale=0.5', 'render-scale=0.333', 'x=1.25'])
			expect(rewritten(`/examples/a.ts?${query}`)).toBe(
				`/examples/a.ts?${query}&${QUERY_EXTENSION_PARAM}=1`,
			);
	});

	it('leaves an address whose query cannot be an extension as it is', () => {
		for (const url of [
			'/examples/a.ts',
			'/examples/a.ts?seconds=60',
			'/examples/a.ts?render-scale=0.5&still',
			`/examples/a.ts?render-scale=0.5&${QUERY_EXTENSION_PARAM}=1`,
			'/examples/a.json?x=1.5',
			'/examples/a.wgsl?x=1.5',
		])
			expect(rewritten(url)).toBe(url);
	});
});

describe('the same-origin middleware', () => {
	/** The headers that the middleware leaves on an answer that Vite's CORS step marked. */
	const left = (site: string | undefined, vary: string): Record<string, string> => {
		const headers = new Map<string, string>([
			['vary', vary],
			['access-control-allow-origin', 'https://localhost:5173'],
		]);
		const res = {
			getHeader: (name: string) => headers.get(name.toLowerCase()),
			setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
			removeHeader: (name: string) => headers.delete(name.toLowerCase()),
		};
		const req = { headers: site === undefined ? {} : { 'sec-fetch-site': site } };
		sameOriginMiddleware(req as never, res as never, () => {});
		return Object.fromEntries(headers);
	};

	it("drops Origin from Vary, and the CORS header, on a same-origin request's answer", () => {
		expect(left('same-origin', 'Origin')).toEqual({});
		expect(left('same-origin', 'Origin, Accept-Encoding')).toEqual({ vary: 'Accept-Encoding' });
	});

	it('leaves the answers to other sites and to requests that do not name their site', () => {
		const marked = { vary: 'Origin', 'access-control-allow-origin': 'https://localhost:5173' };
		expect(left('cross-site', 'Origin')).toEqual(marked);
		expect(left('same-site', 'Origin')).toEqual(marked);
		expect(left(undefined, 'Origin')).toEqual(marked);
	});
});
