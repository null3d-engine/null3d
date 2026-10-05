import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import type { Connect, DevEnvironment, EnvironmentModuleNode, Plugin } from 'vite';
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
import type { CompiledWgsl } from './shader-types.ts';
import {
	compileLiteral,
	compileTaggedWgsl,
	compileWgslFile,
	WGSL_TAG,
	type WgslError,
} from './wgsl.ts';

export type { AssetOptions } from './assets.ts';
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
	'threaded/null3d_memory.json',
	'single/null3d.js',
	'single/null3d_bg.wasm',
];

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
 * production build that compiles each sketch module and ships the engine core.
 */
export default function null3d(options: Null3dPluginOptions = {}): Plugin {
	let building = false;
	let root = process.cwd();
	let base = '/';
	let assetsDir = 'assets';
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
				define: { __NULL3D_DEV__: JSON.stringify(mode !== 'production') },
				server: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				preview: { headers: { ...ISOLATION_HEADERS }, ...(https ? { https, host: true } : {}) },
				worker: { format: 'es' },
				// A prebundled copy of the engine would lose the addresses of its workers and core files.
				// The meshopt decoder is a plain module that the glTF worker imports on first use; a
				// prebundle found that late would reload the page.
				optimizeDeps: { exclude: ['@null3d/engine', 'meshoptimizer'] },
			};
		},
		configResolved(config) {
			building = config.command === 'build';
			root = config.root;
			base = config.base;
			assetsDir = config.build.assetsDir;
		},
		buildStart() {
			emitted.clear();
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
		resolveId: {
			filter: { id: HOT_CLIENT_ADDRESS },
			handler: () => HOT_CLIENT_ID,
		},
		transformIndexHtml() {
			if (building) return;
			return [
				{
					tag: 'script',
					attrs: { type: 'module', src: `${base}@id/__x00__${HOT_CLIENT}` },
					injectTo: 'head',
				},
			];
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
