import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import type {
	Connect,
	DevEnvironment,
	EnvironmentModuleNode,
	HtmlTagDescriptor,
	Plugin,
	Rollup,
} from 'vite';
import {
	ASSET_FOLDER,
	type AssetOptions,
	assetType,
	cachedFile,
	cacheFolder,
	OPTIMIZED_MODEL,
	optimizedModel,
} from './assets.ts';
import { CompilerPool } from './compile-pool.ts';
import { writeWgslDeclaration } from './declarations.ts';
import {
	changedLiterals,
	HOT_CLIENT,
	HOT_CLIENT_ADDRESS,
	HOT_CLIENT_CODE,
	HOT_CLIENT_ID,
	HotState,
	hotKey,
	WGSL_UPDATE_EVENT,
	type WgslUpdate,
} from './hot.ts';
import {
	FILES_LIST,
	listedFiles,
	offlineFiles,
	type WorkerFile,
	workerFilesPlugin,
} from './offline.ts';
import { null3dPackages } from './package-files.ts';
import type { CompiledWgsl } from './shader-types.ts';
import {
	compileLiteral,
	compileTaggedWgsl,
	compileWgslFile,
	WGSL_TAG,
	type WgslError,
} from './wgsl.ts';

export type { AssetOptions } from './assets.ts';
export { FILES_LIST, type OfflineFiles } from './offline.ts';
export type * from './shader-types.ts';

/** Headers that make a page cross-origin isolated, which shared memory and worker threads need. */
export const ISOLATION_HEADERS: Readonly<Record<string, string>> = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Where `bun run dev-cert` writes the local HTTPS certificate. */
export const DEV_CERT_DIR = 'target/dev-cert';

export interface Null3dPluginOptions {
	/**
	 * Serve HTTPS on the local network with the certificate in `certDir`, such as one made with
	 * mkcert. Phones and tablets reached over the network need HTTPS for shared memory and WebGPU.
	 */
	https?: boolean;
	/** Directory that holds `cert.pem` and `key.pem`; the default is `target/dev-cert` under the project root. */
	certDir?: string;
	/**
	 * Write a TypeScript declaration beside each `.wgsl` file that a module imports, such as
	 * `glow.wgsl.d.ts` beside `glow.wgsl`, with the types of the file's uniforms. The default is
	 * true. Set it to false in a project without TypeScript.
	 */
	wgslDeclarations?: boolean;
	/**
	 * Options of the asset tool for the models that modules import with `?optimized`, such as
	 * `import city from './city.glb?optimized'`. The import gives the optimized model's address,
	 * which `assets.loadGltf` takes. The tool comes from `@null3d/cli`, which the project installs.
	 */
	assets?: AssetOptions;
	/**
	 * Let the page's address set the engine's test switches, such as `?gpu=` and `?hold=`, in
	 * production builds too. Development builds always read them. The default is false, so a link
	 * cannot change how a shipped game runs. Turn it on for builds of test and benchmark pages.
	 */
	urlSwitches?: boolean;
}

/** Sets the isolation headers on every response, including `.wasm` files and worker scripts. */
export const isolationMiddleware: Connect.NextHandleFunction = (_req, res, next) => {
	for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
	next();
};

/** Build files whose names carry a content hash, which never change under that name. */
const HASHED_ASSET = /^\/assets\/[^/?]+-[\w-]{8}\.\w+(\?|$)/;

/**
 * Lets the browser keep hashed build files, as a host should. Each engine thread loads its own copy
 * of its script and the core's loader; without this, the browser checks each copy with the server
 * in turn, one round trip per thread.
 */
export const immutableAssetsMiddleware: Connect.NextHandleFunction = (req, res, next) => {
	if (HASHED_ASSET.test(req.url ?? ''))
		res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
	next();
};

/**
 * The HTTPS server's settings: the certificate, and HTTP/1.1 only. Vite serves HTTPS over HTTP/2,
 * where Safari on iPad sometimes stalls while a worker loads its modules: a development server
 * sends each module as its own file, and every engine thread loads its own copies.
 */
function httpsOptions(certificate: { cert: Buffer; key: Buffer }) {
	return { ...certificate, ALPNCallback: () => 'http/1.1' };
}

function readCertificate(root: string, certDir: string): { cert: Buffer; key: Buffer } {
	const dir = resolve(root, certDir);
	const cert = resolve(dir, 'cert.pem');
	const key = resolve(dir, 'key.pem');
	if (!existsSync(cert) || !existsSync(key)) {
		throw new Error(
			`null3D: no HTTPS certificate in ${dir}. Put cert.pem and key.pem there, or set certDir to their folder. Docs: getting-started/hosting.`,
		);
	}
	return { cert: readFileSync(cert), key: readFileSync(key) };
}

/** A script that a page passes by address, such as `new URL('./sketch.ts', import.meta.url)`. */
const SCRIPT_URL =
	/new\s+URL\(\s*(['"])(\.{1,2}\/[^'"]+?\.[cm]?[jt]sx?)\1\s*,\s*import\.meta\.url\s*\)/g;

/** Text just before a script address that a worker constructor takes; Vite builds those itself. */
const WORKER_BEFORE = /new\s+(?:Shared)?Worker\(\s*$/;

/** The engine core's files, which every production build ships. */
export const CORE_FILES = [
	'threaded/null3d.js',
	'threaded/null3d_bg.wasm',
	'single/null3d.js',
	'single/null3d_bg.wasm',
];

/**
 * The engine's early script, which starts the core's download as soon as a page's HTML arrives.
 * A production build ships it as a file of its own, and each page whose scripts load the core gets
 * a script tag for it.
 */
export const EARLY_CORE_MODULE = '@null3d/engine/early-core';

/** The chunks that a page's entry chunk imports, directly or through others, with the entry. */
function staticChunks(
	entry: Rollup.OutputChunk,
	bundle: Rollup.OutputBundle,
): Rollup.OutputChunk[] {
	const seen = new Map<string, Rollup.OutputChunk>([[entry.fileName, entry]]);
	for (const chunk of seen.values())
		for (const name of chunk.imports) {
			const imported = bundle[name];
			if (imported?.type === 'chunk' && !seen.has(name)) seen.set(name, imported);
		}
	return [...seen.values()];
}

/**
 * The script tag of the early script for a built page, or undefined when the page's scripts do not
 * load the engine core. The core files are the WebAssembly files that the early script names, and a
 * page loads the core when one of its chunks names one of them too. `htmlFile` is the page's path in
 * the build, and `base` the build's public base.
 */
export function earlyCoreTag(
	early: Rollup.OutputChunk,
	entry: Rollup.OutputChunk,
	bundle: Rollup.OutputBundle,
	htmlFile: string,
	base: string,
): HtmlTagDescriptor | undefined {
	const cores = Object.values(bundle)
		.filter((file) => file.type === 'asset' && file.fileName.endsWith('.wasm'))
		.map((file) => posix.basename(file.fileName))
		.filter((name) => early.code.includes(name));
	if (!staticChunks(entry, bundle).some((chunk) => cores.some((name) => chunk.code.includes(name))))
		return undefined;
	const relativeBase = base === '' || base.startsWith('.');
	const path = posix.relative(posix.dirname(htmlFile), early.fileName);
	const src = relativeBase
		? path.startsWith('.')
			? path
			: `./${path}`
		: `${base}${early.fileName}`;
	return {
		tag: 'script',
		attrs: { type: 'module', async: true, src },
		injectTo: 'head-prepend',
	};
}

/** The file in which each null3D package lists the third-party code that it ships, with licences. */
const PACKAGE_NOTICES = 'THIRD-PARTY-NOTICES.txt';

/** The file that a production build writes beside the page, with every package's notices. */
export const NOTICES_FILE = 'null3d-third-party-notices.txt';

/**
 * The third-party notices of the null3D packages that the project depends on: the engine's first,
 * then each add-on's, by name. Null when none has notices, as in a project without the engine.
 */
export function thirdPartyNotices(root: string): string | null {
	const manifest = resolve(root, 'package.json');
	if (!existsSync(manifest)) return null;
	const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
	const require = createRequire(manifest);
	const names = Object.keys({ ...dependencies, ...devDependencies })
		.filter((name) => name.startsWith('@null3d/'))
		.sort(
			(a, b) => Number(b === '@null3d/engine') - Number(a === '@null3d/engine') || (a < b ? -1 : 1),
		);
	const texts = names.flatMap((name) => {
		try {
			const file = join(dirname(require.resolve(`${name}/package.json`)), PACKAGE_NOTICES);
			return existsSync(file) ? [readFileSync(file, 'utf8').trimEnd()] : [];
		} catch {
			return [];
		}
	});
	return texts.length > 0 ? `${texts.join('\n\n')}\n` : null;
}

/** Vite's setting that decides which assets become data: addresses. */
type InlineLimit = number | ((file: string, content: Buffer) => boolean | undefined);

/** A test for files of the published null3D packages, installed or in a copy of the repository. */
function null3dPackageFiles(): (file: string) => boolean {
	const packageOf = null3dPackages();
	return (file) => packageOf(file) !== undefined;
}

/**
 * Vite's inline limit with one change: no file of a null3D package becomes a data: address. The
 * engine loads its workers' scripts, its WebAssembly and its shader files by address, and a strict
 * Content-Security-Policy blocks a data: address, as does a worker's origin. `own` is the
 * project's setting, which every other file keeps.
 */
export function inlineLimit(
	own: InlineLimit | undefined,
	isPackageFile: (file: string) => boolean = null3dPackageFiles(),
): InlineLimit {
	return (file, content) => {
		if (isPackageFile(file)) return false;
		if (typeof own === 'function') return own(file, content);
		return own === undefined ? undefined : content.length < own;
	};
}

/** True for a sketch module: a script that calls `defineSketch`. */
function isSketchModule(path: string): boolean {
	return existsSync(path) && readFileSync(path, 'utf8').includes('defineSketch(');
}

/** A WGSL file that a module imports, without a query such as `?raw`. */
const WGSL_FILE = /\.wgsl$/;

/** A script module, whose code the plugin parses for tagged WGSL. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/** Modules of installed packages, which the plugin leaves as they are. */
const PACKAGE_MODULE = /\/node_modules\//;

/** A file's path from the project's root, as messages name it. */
function projectPath(root: string, file: string): string {
	return relative(root, file).split(sep).join('/');
}

/**
 * A compiled shader as the JavaScript value that takes its source's place, with the key of its hot
 * updates on the dev server.
 */
function shaderValue(shader: CompiledWgsl, key?: string): string {
	return `(${JSON.stringify(key === undefined ? shader : { ...shader, hot: key })})`;
}

/** Shows WGSL that did not compile in Vite's overlay on the dev server's pages, and in the terminal. */
function showError(environment: DevEnvironment, error: WgslError): void {
	environment.logger.error(`${error.message}\n${error.frame}`, { timestamp: true });
	environment.hot.send({
		type: 'error',
		err: { ...error, stack: '', plugin: 'null3d' },
	});
}

/** Prints the warnings of WGSL that a hot update compiled, in the dev server's log. */
function showWarnings(environment: DevEnvironment, warnings: readonly string[]): void {
	for (const warning of warnings) environment.logger.warn(warning, { timestamp: true });
}

/** The modules of a changed file that Vite still updates: all but the one the plugin compiled. */
function otherModules(modules: readonly EnvironmentModuleNode[], file: string) {
	return modules.filter((module) => module.id !== file);
}

/**
 * The core files missing from the installed engine package, or null when the project does not
 * install the engine.
 */
export function missingCoreFiles(root: string): string[] | null {
	const require = createRequire(resolve(root, 'package.json'));
	try {
		require.resolve('@null3d/engine/package.json');
	} catch {
		return null;
	}
	return CORE_FILES.filter((file) => {
		try {
			require.resolve(`@null3d/engine/wasm/${file}`);
			return false;
		} catch {
			return true;
		}
	});
}

/**
 * The null3D Vite plugin: isolation headers on the dev and preview servers, optional HTTPS, WGSL
 * compiled for WebGPU and WebGL2 in dev and in builds, hot updates of WGSL on the dev server, and a
 * production build that compiles each sketch module, ships the engine core and starts its download
 * from each page that loads it.
 */
export default function null3d(options: Null3dPluginOptions = {}): Plugin {
	let building = false;
	/** True for a production build of pages, which gets the early script. */
	let buildingPages = false;
	/** The early script's module, once a build of pages that imports the engine has added it. */
	let earlyCoreId: string | undefined;
	/** True once the build has looked for the early script. */
	let earlyCoreSought = false;
	let root = process.cwd();
	let base = '/';
	let assetsDir = 'assets';
	/** The third-party notices that a client build writes beside the page; null in other builds. */
	let notices: string | null = null;
	/** What each worker build's files hold, by file name, for the list of files for offline play. */
	const workerFiles = new Map<string, WorkerFile>();
	const packageOf = null3dPackages();
	/** The optimized files that this build has written, so each texture goes in once. */
	const emitted = new Map<string, string>();
	/** Compiles WGSL on worker threads, so the dev server answers other requests meanwhile. */
	const compiler = new CompilerPool();
	/** What the dev server's pages run, to judge each change of WGSL. */
	const hot = new HotState();
	/** The key of a project module's WGSL on the dev server, which builds and packages lack. */
	const keyOf = (id: string, path: string, literal?: number) =>
		building || PACKAGE_MODULE.test(id) ? undefined : hotKey(path, literal);
	/** Sends hot updates to the dev server's pages. */
	const sendUpdates = (environment: DevEnvironment, updates: WgslUpdate[]) => {
		environment.logger.info(`null3D hot update ${updates.map((u) => u.key).join(', ')}`, {
			timestamp: true,
		});
		environment.hot.send({ type: 'custom', event: WGSL_UPDATE_EVENT, data: { updates } });
	};
	return {
		name: 'null3d',
		// Runs before Vite's own asset handling, which would copy a sketch file as raw text, and
		// before TypeScript becomes JavaScript, so tagged WGSL sits where the source file has it.
		enforce: 'pre',
		config(config, { mode }) {
			const root = config.root ?? process.cwd();
			const https = options.https
				? httpsOptions(readCertificate(root, options.certDir ?? DEV_CERT_DIR))
				: undefined;
			return {
				// Development checks stay in dev builds; release builds drop them as dead code.
				define: {
					__NULL3D_DEV__: JSON.stringify(mode !== 'production'),
					// Without the option, a build that defines the constant itself keeps its value.
					...(options.urlSwitches === undefined
						? {}
						: { __NULL3D_URL_SWITCHES__: JSON.stringify(options.urlSwitches) }),
				},
				server: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				preview: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				worker: { format: 'es', plugins: () => [workerFilesPlugin(workerFiles)] },
				build: {
					assetsInlineLimit: inlineLimit(config.build?.assetsInlineLimit),
				},
				// A prebundled copy of the engine would lose the addresses of its workers and core files.
				optimizeDeps: { exclude: ['@null3d/engine'] },
			};
		},
		configResolved(config) {
			building = config.command === 'build';
			buildingPages = building && !config.build.lib && !config.build.ssr;
			root = config.root;
			base = config.base;
			assetsDir = config.build.assetsDir;
			if (config.worker.format !== 'es') {
				config.logger.warn(
					`null3D: workers build as ${config.worker.format}, not as ES modules, so each engine worker takes in every shader file and grows to tens of MB. Set worker.format to 'es', or leave it unset for the null3D plugin to set.`,
				);
			}
			notices = building && !config.build.ssr ? thirdPartyNotices(root) : null;
		},
		buildStart() {
			emitted.clear();
			earlyCoreId = undefined;
			earlyCoreSought = false;
			if (!building) return;
			const missing = missingCoreFiles(root);
			if (missing && missing.length > 0) {
				this.error(
					`null3D: the installed @null3d/engine lacks its WebAssembly core (${missing.join(', ')}). Reinstall the package; in a copy of the engine's source, run bun run build first.`,
				);
			}
		},
		buildEnd() {
			return compiler.close();
		},
		// The dev server's pages import the client module of hot updates. A build of pages that
		// imports the engine ships the early script, found from the module that imports the engine,
		// as the engine itself is. The page's own scripts run only once all of them have arrived. The
		// early script imports nothing, so it runs as soon as it arrives, and the core's download
		// starts sooner by the time the others take to arrive and run.
		resolveId: {
			filter: { id: [HOT_CLIENT_ADDRESS, /^@null3d\/engine$/] },
			async handler(source, importer) {
				if (HOT_CLIENT_ADDRESS.test(source)) return HOT_CLIENT_ID;
				if (!buildingPages || earlyCoreSought) return null;
				earlyCoreSought = true;
				const early = await this.resolve(EARLY_CORE_MODULE, importer, { skipSelf: true });
				if (early && !early.external) {
					earlyCoreId = early.id;
					this.emitFile({ type: 'chunk', id: early.id, name: 'early-core' });
				}
				return null;
			},
		},
		transformIndexHtml: {
			order: 'post',
			handler(html, { bundle, chunk, path }) {
				if (!building)
					return [
						{
							tag: 'script',
							attrs: { type: 'module', src: `${base}@id/__x00__${HOT_CLIENT}` },
							injectTo: 'head',
						},
					];
				if (!earlyCoreId || !bundle || !chunk) return;
				const early = Object.values(bundle).find(
					(file): file is Rollup.OutputChunk =>
						file.type === 'chunk' && file.facadeModuleId === earlyCoreId,
				);
				const tag = early && earlyCoreTag(early, chunk, bundle, path.replace(/^\//, ''), base);
				return tag ? { html, tags: [tag] } : html;
			},
		},
		load: {
			filter: { id: { include: [WGSL_FILE, OPTIMIZED_MODEL, HOT_CLIENT_ADDRESS] } },
			async handler(id) {
				if (id === HOT_CLIENT_ID) return HOT_CLIENT_CODE;
				// Another plugin's virtual module whose name ends like a WGSL file.
				if (id.startsWith('\0')) return;
				if (OPTIMIZED_MODEL.test(id)) {
					const file = id.slice(0, id.indexOf('?'));
					let model: Awaited<ReturnType<typeof optimizedModel>>;
					try {
						model = await optimizedModel(root, file, options.assets);
					} catch (e) {
						return this.error(
							`null3D could not optimize ${projectPath(root, file)}: ${(e as Error).message}`,
						);
					}
					this.addWatchFile(file);
					const address = `${model.key}/${model.name}`;
					if (!building)
						return `export default ${JSON.stringify(`${base}${ASSET_FOLDER}/${address}`)};\n`;
					let ref = '';
					for (const path of model.files) {
						if (!emitted.has(path))
							emitted.set(
								path,
								this.emitFile({
									type: 'asset',
									fileName: `${assetsDir}/${ASSET_FOLDER}/${path}`,
									source: readFileSync(join(cacheFolder(root), path)),
								}),
							);
						if (path === address) ref = emitted.get(path) ?? '';
					}
					return `export default new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url).href;\n`;
				}
				const path = projectPath(root, id);
				const compiled = await compileWgslFile(path, id, readFileSync(id, 'utf8'), compiler);
				if ('error' in compiled) return this.error(compiled.error);
				for (const warning of compiled.warnings) this.warn(warning);
				const key = keyOf(id, path);
				if (key !== undefined) hot.remember(key, compiled.shader);
				if (options.wgslDeclarations !== false && !PACKAGE_MODULE.test(id)) {
					try {
						writeWgslDeclaration(id, compiled.shader);
					} catch (e) {
						this.warn(
							`null3D could not write the types of ${projectPath(root, id)} beside it (${(e as Error).message}). TypeScript then takes any uniform name for the file.`,
						);
					}
				}
				return {
					code: `export default ${shaderValue(compiled.shader, key)};\n`,
					map: { mappings: '' },
					moduleType: 'js',
				};
			},
		},
		transform: {
			filter: {
				id: { exclude: PACKAGE_MODULE },
				code: { include: [WGSL_TAG, 'import.meta.url'] },
			},
			async handler(code, id) {
				const file = id.split('?')[0] ?? id;
				let out: MagicString | undefined;
				if (SCRIPT_FILE.test(file) && WGSL_TAG.test(code)) {
					const path = projectPath(root, file);
					const tagged = await compileTaggedWgsl(code, file, path, compiler);
					if ('error' in tagged) return this.error(tagged.error);
					for (const warning of tagged.warnings) this.warn(warning);
					for (const [literal, { start, end, shader }] of tagged.shaders.entries()) {
						const key = keyOf(file, path, literal);
						if (key !== undefined) hot.remember(key, shader);
						out ??= new MagicString(code);
						out.overwrite(start, end, shaderValue(shader, key));
					}
					if (keyOf(file, path) !== undefined && tagged.shaders.length > 0)
						hot.scripts.set(file, code);
				}
				if (building && code.includes('import.meta.url')) {
					for (const match of code.matchAll(SCRIPT_URL)) {
						const start = match.index;
						if (WORKER_BEFORE.test(code.slice(Math.max(0, start - 40), start))) continue;
						const script = await this.resolve(match[2] ?? '', id);
						if (!script || !isSketchModule(script.id)) continue;
						// The sketch worker imports the compiled module by this address.
						const ref = this.emitFile({
							type: 'chunk',
							id: script.id,
							preserveSignature: 'strict',
						});
						out ??= new MagicString(code);
						out.overwrite(
							start,
							start + match[0].length,
							`new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url)`,
						);
					}
				}
				return out
					? { code: out.toString(), map: out.generateMap({ hires: 'boundary' }) }
					: undefined;
			},
		},
		async hotUpdate({ type, file, modules, read }) {
			const environment = this.environment;
			if (environment.name !== 'client' || type !== 'update' || PACKAGE_MODULE.test(file)) return;
			if (!modules.some((module) => module.id === file)) return;
			const path = projectPath(root, file);
			if (WGSL_FILE.test(file)) {
				const compiled = await compileWgslFile(path, file, await read(), compiler);
				if ('error' in compiled) {
					showError(environment, compiled.error);
					return otherModules(modules, file);
				}
				showWarnings(environment, compiled.warnings);
				const key = hotKey(path);
				// Without a hot update, Vite reloads the page as it does for any module.
				if (!hot.swaps(key, compiled.shader)) return;
				hot.remember(key, compiled.shader);
				sendUpdates(environment, [{ key, shader: compiled.shader }]);
				return otherModules(modules, file);
			}
			const before = hot.scripts.get(file);
			if (before === undefined) return;
			const code = await read();
			const changed = changedLiterals(before, code, file);
			if (!changed) return;
			const results = await Promise.all(
				changed.map(({ literal }) => compileLiteral(literal, code, file, path, compiler)),
			);
			const updates: WgslUpdate[] = [];
			for (const [k, result] of results.entries()) {
				if ('error' in result) {
					showError(environment, result.error);
					return otherModules(modules, file);
				}
				showWarnings(environment, result.warnings);
				const key = hotKey(path, changed[k]?.index);
				if (!hot.swaps(key, result.shader)) return;
				updates.push({ key, shader: result.shader });
			}
			// The script's code that pages run changes only once its updates go out, so an edit
			// after an error sends every literal that changed since.
			hot.scripts.set(file, code);
			for (const { key, shader } of updates) hot.remember(key, shader);
			if (updates.length > 0) sendUpdates(environment, updates);
			return otherModules(modules, file);
		},
		// After Vite's own plugins, which add the worker builds' files and the pages to the bundle.
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				if (buildingPages) {
					const files = offlineFiles(listedFiles(bundle, workerFiles, packageOf, root));
					this.emitFile({
						type: 'asset',
						fileName: FILES_LIST,
						source: `${JSON.stringify(files, null, '\t')}\n`,
					});
				}
				if (notices) this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: notices });
			},
		},
		configureServer(server) {
			server.middlewares.use(isolationMiddleware);
			server.middlewares.use(`${server.config.base}${ASSET_FOLDER}/`, (req, res, next) => {
				const path = decodeURIComponent((req.url ?? '').split('?')[0]?.slice(1) ?? '');
				const bytes = cachedFile(root, path);
				if (!bytes) return next();
				res.setHeader('Content-Type', assetType(path));
				res.setHeader('Cache-Control', 'no-cache');
				res.end(bytes);
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use(isolationMiddleware);
			server.middlewares.use(immutableAssetsMiddleware);
		},
	};
}
