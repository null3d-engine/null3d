import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix, relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import type { Connect, HtmlTagDescriptor, Plugin, Rollup } from 'vite';
import {
	ASSET_FOLDER,
	type AssetOptions,
	assetType,
	cachedFile,
	cacheFolder,
	OPTIMIZED_MODEL,
	optimizedModel,
} from './assets.ts';
import { writeWgslDeclaration } from './declarations.ts';
import { compileTaggedWgsl, compileWgslFile, WGSL_TAG } from './wgsl.ts';

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

/** A compiled shader as the JavaScript value that takes its source's place. */
function shaderValue(shader: unknown): string {
	return `(${JSON.stringify(shader)})`;
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
 * compiled for WebGPU and WebGL2 in dev and in builds, and a production build that compiles each
 * sketch module, ships the engine core and starts its download from each page that loads it.
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
	/** The optimized files that this build has written, so each texture goes in once. */
	const emitted = new Map<string, string>();
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
			buildingPages = building && !config.build.lib && !config.build.ssr;
			root = config.root;
			base = config.base;
			assetsDir = config.build.assetsDir;
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
		// A build of pages that imports the engine ships the early script, found from the module that
		// imports the engine, as the engine itself is. The page's own scripts run only once all of
		// them have arrived. The early script imports nothing, so it runs as soon as it arrives, and
		// the core's download starts sooner by the time the others take to arrive and run.
		resolveId: {
			filter: { id: /^@null3d\/engine$/ },
			async handler(_source, importer) {
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
			filter: { id: { include: [WGSL_FILE, OPTIMIZED_MODEL], exclude: /^\0/ } },
			async handler(id) {
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
				const compiled = compileWgslFile(projectPath(root, id), id, readFileSync(id, 'utf8'));
				if ('error' in compiled) return this.error(compiled.error);
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
					code: `export default ${shaderValue(compiled.shader)};\n`,
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
					const tagged = compileTaggedWgsl(code, file, projectPath(root, file));
					if ('error' in tagged) return this.error(tagged.error);
					for (const { start, end, shader } of tagged.shaders) {
						out ??= new MagicString(code);
						out.overwrite(start, end, shaderValue(shader));
					}
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
