import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import type {
	Connect,
	DevEnvironment,
	EnvironmentModuleNode,
	HtmlTagDescriptor,
	Logger,
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
import { compressAnswers, compressedFiles, fromLoopback } from './compress.ts';
import { writeWgslDeclaration } from './declarations.ts';
import {
	ENGINE_SHADERS_ENV,
	engineShaderFolder,
	engineShadersRoot,
	ensureEngineShaders,
} from './engine-shaders.ts';
import { buildEngineShadersLocally } from './engine-shaders-local.ts';
import { HashPool } from './hash-pool.ts';
import {
	changedLiterals,
	GPU_PATH_EVENT,
	HOT_CLIENT,
	HOT_CLIENT_ADDRESS,
	HOT_CLIENT_ID,
	HotState,
	hotClientCode,
	hotKey,
	PERMUTATION_WORD_EVENT,
	UNLISTED_WORD_EVENT,
	UNSHIPPED_PATH_EVENT,
	unshippedPathWarning,
	WGSL_UPDATE_EVENT,
	type WgslUpdate,
} from './hot.ts';
import { MATERIAL_BUILDS_ADDRESS, MaterialBuilds, ModuleBuilds } from './material-builds.ts';
import {
	engineModule,
	FILES_LIST,
	featuresOf,
	listedFiles,
	missingWorkerAssets,
	offlineFiles,
	type WorkerFile,
	workerFilesPlugin,
} from './offline.ts';
import { narrowShaderPack, ShaderPack, UNPACK } from './pack.ts';
import { null3dPackages } from './package-files.ts';
import { emitParagraphTables, shaderParagraphsPlugin, tableImportsOfFile } from './paragraphs.ts';
import { ShaderCache, shaderCacheOff } from './shader-cache.ts';
import {
	builtWords,
	holdWord,
	moduleWords,
	narrowParagraphTable,
	narrowShaderModule,
	ShaderList,
	type ShaderOptions,
	shaderMarkersModule,
	shippedTargets,
	targetOfModule,
	UNLISTED_MODULE,
	UnlistedWords,
	wordText,
} from './shader-list.ts';
import {
	compileLiteral,
	compileTaggedWgsl,
	compileWgslFile,
	WGSL_TAG,
	type WgslError,
} from './wgsl.ts';
import { directImports, workerPreloadPlugin } from './worker-preload.ts';

export type { AssetOptions } from './assets.ts';
export { FILES_LIST, type OfflineFiles } from './offline.ts';
export type { GpuPath, ShaderOptions } from './shader-list.ts';
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
	/**
	 * Serve the `https` server over HTTP/2, which sends every request at once on one connection,
	 * where HTTP/1.1 sends six at a time. The dev server sends each module as its own file, and every
	 * engine thread loads its own copies, so a page asks for hundreds. The default is false, because
	 * Safari on an iPad sometimes stops while a worker loads its modules over HTTP/2.
	 */
	http2?: boolean;
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
	 * production builds too. Without the option, development builds read them and production builds
	 * do not, so a link cannot change how a shipped game runs. An explicit false turns them off in
	 * every build, the dev server's and the `null3d` command's included. Turn it on for builds of
	 * test and benchmark pages.
	 */
	urlSwitches?: boolean;
	/**
	 * Options for the engine's shader set. `list` names the file of the permutation words that the
	 * project's pages draw with, as `bunx @null3d/cli shaders record` writes it, relative to Vite's
	 * root. A production build then copies only the shader builds of those words. The dev server
	 * warns about each word that a page draws with and the list lacks.
	 */
	shaders?: ShaderOptions;
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
 * Takes `Origin` out of the Vary header of an answer to a request from the page's own origin, with
 * the CORS header that the origin chose. Vite's CORS step marks every answer as varying by the
 * request's Origin. The engine's page downloads the sketch module early with `fetch`, which sends no
 * Origin, and the worker's import of it sends one. Without this, the browser cannot use the early
 * copy and asks the server again, one round trip per such file. A request from the same origin needs
 * no CORS header, and the browser names such a request in its Sec-Fetch-Site header.
 */
export const sameOriginMiddleware: Connect.NextHandleFunction = (req, res, next) => {
	if (req.headers['sec-fetch-site'] !== 'same-origin') return next();
	const vary = String(res.getHeader('Vary') ?? '')
		.split(',')
		.map((field) => field.trim())
		.filter((field) => field !== '' && field.toLowerCase() !== 'origin');
	if (vary.length > 0) res.setHeader('Vary', vary.join(', '));
	else res.removeHeader('Vary');
	res.removeHeader('Access-Control-Allow-Origin');
	next();
};

/**
 * The HTTPS server's settings: the certificate, and HTTP/1.1 only unless `http2` asks for HTTP/2.
 * Vite serves HTTPS over HTTP/2, where Safari on iPad sometimes stalls while a worker loads its
 * modules: a development server sends each module as its own file, and every engine thread loads
 * its own copies.
 */
function httpsOptions(certificate: { cert: Buffer; key: Buffer }, http2: boolean) {
	return http2 ? certificate : { ...certificate, ALPNCallback: () => 'http/1.1' };
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

/**
 * Marks a copied shader file's address in a transformed module until the build knows where the
 * module that names it lands. The mark is not a path, so no bundler resolves it; `generateBundle`
 * replaces it with the address from that module's own place in the output.
 */
const SHADER_URL_MARK = '__null3d_shader__';

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

/**
 * The engine's import of one of its generated shader modules, as its own files write it: from a
 * file at any depth inside the engine, so the path climbs one or more folders to `generated/`.
 */
const ENGINE_GENERATED = /^(?:\.\.?\/)+generated\/([A-Za-z0-9_.-]+)$/;

/** The `lib` folder of an engine package, when the importer sits inside it. */
function engineLibFolder(importer: string): string | undefined {
	const marker = '/lib/';
	const at = importer.lastIndexOf(marker);
	return at < 0 ? undefined : importer.slice(0, at + marker.length);
}

/** Tells the developer where the engine's shaders come from, and why a first build waits. */
function reportShaderSource(message: string): void {
	console.log(message);
}

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

/** The null3D packages that run as tools on the developer's computer and put no code in a page. */
const TOOL_PACKAGES = new Set(['@null3d/cli', '@null3d/vite-plugin']);

/**
 * The third-party notices of the null3D packages that the project depends on: the engine's first,
 * then each add-on's, by name. The tools' notices stay out, since a page ships none of their code.
 * Null when none has notices, as in a project without the engine.
 */
export function thirdPartyNotices(root: string): string | null {
	const manifest = resolve(root, 'package.json');
	if (!existsSync(manifest)) return null;
	const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
	const require = createRequire(manifest);
	const names = Object.keys({ ...dependencies, ...devDependencies })
		.filter((name) => name.startsWith('@null3d/') && !TOOL_PACKAGES.has(name))
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

/**
 * True for a module that a page passes by address for a worker to import, such as a sketch or an
 * add-on's task: a script file whose imports the build must resolve. The address of a script reaches
 * a worker as it is, so a build that copied a TypeScript file with its types would hand the worker a
 * file it cannot parse. Built output under `dist/` ships as it is, as the engine's core does.
 */
function isImportedModule(path: string): boolean {
	const file = path.split('?')[0] ?? path;
	if (file.includes('/dist/')) return false;
	return SCRIPT_FILE.test(file) && existsSync(file);
}

/**
 * Empties the preload lists of the chunks that a worker imports. Vite's preload helper adds a link
 * to the page's head for each file that a dynamic import needs, and it reads `document`, which a
 * worker has not. A sketch module and a task module run in workers, with every chunk they import,
 * so their lists go: an import still fetches its own file, as any worker's import does.
 */
export function emptyWorkerPreloads(bundle: Rollup.OutputBundle, seeds: readonly string[]): void {
	const seen = new Set<string>();
	const stack = [...seeds];
	while (stack.length > 0) {
		const file = stack.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		const chunk = bundle[file];
		if (chunk?.type !== 'chunk') continue;
		stack.push(...chunk.imports, ...chunk.dynamicImports);
	}
	for (const file of seen) {
		const chunk = bundle[file];
		if (chunk?.type !== 'chunk' || !chunk.code.includes('__vite__mapDeps(')) continue;
		chunk.code = chunk.code.replace(/__vite__mapDeps\(\s*\[[^\]]*\]\s*\)/g, '[]');
	}
}

/**
 * True when `address`, named by a module at `importer`, is one of the engine's generated shader
 * device modules. The shader build writes those beside `shaders.ts` and its combination modules, and
 * they hold shader text rather than a sketch. A build that read each one to look for `defineSketch`
 * spent a pass over the whole set. Both files may sit in the installed package or in the cache that
 * a project shares, so the names decide and the folder does not.
 */
function isGeneratedShaderFile(importer: string, address: string): boolean {
	const name = importer.slice(importer.lastIndexOf('/') + 1);
	return GENERATED_MODULE.test(name) && /^\.\/shaders-[a-z0-9-]+\.js$/.test(address);
}

/** The name of one of the engine's generated shader modules: the main module, or one it names. */
const GENERATED_MODULE = /^shaders(?:-[a-z0-9-]+)?\.[cm]?[jt]s$/;

/** The name of the generated module that names the words a narrowed shader set holds. */
const LISTED_MODULE = /^shader-permutations\.[cm]?[jt]s$/;

/** The start of the name of the module that stands for every device file a list leaves out. */
const UNLISTED_STEM = 'shaders-unlisted';

/**
 * The module id that stands for a generated module of a GPU path that a build does not ship. The
 * names that the module exports follow it, so one stub serves every table that exports the same
 * names, such as the tables of builds that need several features.
 */
const NO_SHADER_MARK = 'null3d:no-shader/';
const NO_SHADER_ID = `\0${NO_SHADER_MARK}`;

/** The start of the id of a stub module, with or without Vite's null byte. */
const NO_SHADER_PATTERN = /^\0?null3d:no-shader\//;

/** The code of a stub module, which exports each name that it stands for as an empty object. */
function stubModule(names: readonly string[]): string {
	return `${names.map((name) => `export const ${name} = {};`).join('\n')}\n`;
}

/**
 * True for the folder of a generated shader set, which holds the marker module that every set has.
 * Only a module of such a folder takes a stub, so a project's own file that happens to share a name
 * never does.
 */
function inShaderSet(folder: string): boolean {
	return ['shader-permutations.ts', 'shader-permutations.js'].some((name) =>
		existsSync(join(folder, name)),
	);
}

/**
 * The names that a generated shader module exports, in the order the shader build writes them. The
 * stub of a module that a build drops exports the same names, so every import of it resolves.
 */
function exportNamesOf(text: string, file: string): string[] {
	const names = [...text.matchAll(/^export (?:const|function|class) ([A-Za-z_$][\w$]*)/gm)].map(
		(match) => match[1] as string,
	);
	if (names.length === 0)
		throw new Error(
			`null3D cannot read the exports of the engine's shader module ${file}, so it cannot stand an empty one in its place. Install the same version of @null3d/vite-plugin as of @null3d/engine, or run bun run shaders in a checkout.`,
		);
	return names;
}

/** The docs on a project's list of permutation words, which the build's report names. */
const SHADER_LIST_DOCS =
	'https://github.com/null3d-engine/null3d/blob/generated/docs/guides/assets-pipeline.md#build-only-the-shader-permutations-you-draw-with';

/** One generated shader file that the build copies into its output. */
interface ShaderCopy {
	/** Its name in the output, which carries a hash of its bytes. */
	readonly name: string;
	/** The file that holds its bytes: the set's own file, or a narrowed copy of it. */
	readonly bytes: string;
	/** The set's file that it comes from, beside which its tables of paragraphs sit. */
	readonly source: string;
}

/** A number of bytes in megabytes, as the build's report gives it. */
function megabytes(bytes: number): string {
	return `${Math.round(bytes / 1e6).toLocaleString('en-US')} MB`;
}

/** A WGSL file that a module imports, without a query such as `?raw`. */
const WGSL_FILE = /\.wgsl$/;

/** A script module, whose code the plugin parses for tagged WGSL. */
const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

/** The parameter that keeps a dotted query from naming a module's extension. */
export const QUERY_EXTENSION_PARAM = 'null3d-query';

/**
 * Keeps a module's query from deciding its type. Vite reads a dotted word at the end of a module's
 * address as the extension, so a sketch at `sketch.ts?render-scale=0.5` parses as JavaScript and
 * fails on its types. The middleware adds a parameter after such a query, which the sketch sees in
 * `import.meta.url` and ignores, and Vite then reads the file's own extension.
 */
export function queryExtensionMiddleware(): Connect.NextHandleFunction {
	return (req, _res, next) => {
		const url = req.url ?? '';
		const at = url.indexOf('?');
		if (at < 0) return next();
		const path = url.slice(0, at);
		const query = url.slice(at + 1);
		if (!SCRIPT_FILE.test(path) || !/\.\w+$/.test(query)) return next();
		req.url = `${url}&${QUERY_EXTENSION_PARAM}=1`;
		next();
	};
}

/** Modules of installed packages, which the plugin leaves as they are. */
const PACKAGE_MODULE = /\/node_modules\//;

/** A file's path from the project's root, as messages name it. */
function projectPath(root: string, file: string): string {
	return relative(root, file).split(sep).join('/');
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
export default function null3d(options: Null3dPluginOptions = {}): Plugin[] {
	let building = false;
	/** True for a production build of pages, which gets the early script. */
	let buildingPages = false;
	/**
	 * The GPU paths whose shaders a build ships. The dev server keeps both, so a developer can test
	 * the other path, and a build narrows the set and the project's own shaders to this.
	 */
	const shipped = shippedTargets(options.shaders);
	/** The early script's module, once a build of pages that imports the engine has added it. */
	let earlyCoreId: string | undefined;
	/** True once the build has looked for the early script. */
	let earlyCoreSought = false;
	let root = process.cwd();
	let base = '/';
	let assetsDir = 'assets';
	/** True when the shader cache is ignored, by the environment or by Vite's `--force`. */
	let noShaderCache = shaderCacheOff();
	/** The third-party notices that a client build writes beside the page; null in other builds. */
	let notices: string | null = null;
	/** What each worker build's files hold, by file name, for the list of files for offline play. */
	const workerFiles = new Map<string, WorkerFile>();
	const packageOf = null3dPackages();
	/** The optimized files that this build has written, so each texture goes in once. */
	const emitted = new Map<string, string>();
	/** The chunks emitted for the scripts that a worker imports, by their rollup reference. */
	const workerChunks = new Set<string>();
	/** The modules of the scripts that a worker imports, which those chunks are built from. */
	const workerModules = new Set<string>();
	/** Hashes the generated shader files on worker threads, so the build goes on meanwhile. */
	const hasher = new HashPool();
	/**
	 * The generated shader files that the build copies instead of bundling, by their output name:
	 * each is named by a hash of its bytes and copied on its own, so the build never holds the
	 * whole set in memory.
	 */
	const copiedShaders = new Map<string, ShaderCopy>();
	/**
	 * The copy of each generated shader file by its path, which the pool works out. A page build and
	 * its workers reach the same files, so each file is read once for the whole build, and a second
	 * name for it waits for the same copy.
	 */
	const shaderCopies = new Map<string, Promise<ShaderCopy>>();
	/** The tables of shared paragraphs that the copies import, which the build emits beside them. */
	const copiedTables = { files: 0, bytes: 0 };
	/** The project's list of permutation words, in a build whose options name one. */
	let shaderList: ShaderList | undefined;
	/** Each word that a build of the engine's shader set answers, as this build has read them. */
	const heldWords = new Set<number>();
	/** The folder of this build's narrowed copies, made when the first one is written. */
	let narrowedFolder: string | undefined;
	/** Writes the text of a narrowed copy, named by its hash, into this build's folder of them. */
	const narrowedCopy = (stem: string, text: string, source?: string): ShaderCopy => {
		narrowedFolder ??= mkdtempSync(join(tmpdir(), 'null3d-shaders-'));
		const name = `${stem}-${createHash('sha256').update(text).digest('hex').slice(0, 8)}.js`;
		const bytes = join(narrowedFolder, name);
		if (!existsSync(bytes)) writeFileSync(bytes, text);
		return { name, bytes, source: source ?? bytes };
	};
	/**
	 * The copy of a generated shader file. A file of a GPU path that this build does not ship gives
	 * way to one module without builds, and the build copies it for every such file. With a list, a
	 * file whose builds the list all names stays whole, a file of which it names some keeps only
	 * those, and a file of which it names none gives way to one module without builds.
	 */
	const copyOf = async (file: string): Promise<ShaderCopy> => {
		const stem = file.slice(file.lastIndexOf('/') + 1).replace(/\.js$/, '');
		const target = targetOfModule(file);
		if (target !== null && !shipped[target]) {
			// The words of a dropped file still answer the project's list, which may hold a word that
			// only the other GPU path builds, such as a morph target's.
			if (shaderList !== undefined)
				for (const word of (await hasher.scan(file)).words) holdWord(heldWords, word);
			return narrowedCopy(UNLISTED_STEM, UNLISTED_MODULE);
		}
		const list = shaderList;
		if (list === undefined)
			return { name: `${stem}-${await hasher.hash(file)}.js`, bytes: file, source: file };
		const { hash, words } = await hasher.scan(file);
		for (const word of words) holdWord(heldWords, word);
		const kept = words.filter((word) => list.holds(word)).length;
		if (kept === words.length) return { name: `${stem}-${hash}.js`, bytes: file, source: file };
		if (kept === 0) return narrowedCopy(UNLISTED_STEM, UNLISTED_MODULE);
		const narrowed = narrowShaderModule(
			readFileSync(file, 'utf8'),
			(word) => list.holds(word),
			file,
		);
		return narrowedCopy(stem, narrowed.text, file);
	};
	/** The copy of a generated shader file, worked out on the pool when a module first names it. */
	const shaderCopy = (file: string): Promise<ShaderCopy> => {
		let copy = shaderCopies.get(file);
		if (copy === undefined) {
			copy = copyOf(file);
			shaderCopies.set(file, copy);
		}
		return copy;
	};
	/** Vite's logger, for the build's report of the shader files it copied. */
	let logger: Logger | undefined;
	/** A copied shader file's path in the output, whatever the assets folder is called. */
	const assetPath = (name: string) => (assetsDir === '' ? name : posix.join(assetsDir, name));
	/** Compiles WGSL on worker threads, so the dev server answers other requests meanwhile. */
	const compiler = new CompilerPool();
	/** Keeps each compiled shader in the project's cache, so a later build skips the compile. */
	const shaders = new ShaderCache(() => root, compiler, { disabled: () => noShaderCache });
	/** Custom materials' builds, which load on first use from modules of their own by device. */
	const materialBuilds = new MaterialBuilds(() => !building || shipped.glsl);
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
	/**
	 * Resolves the engine's import of one of its generated shader modules into the set on this
	 * machine: the release asset's, or the one built here. The engine's built files name the
	 * modules as the build names them, while the set holds a TypeScript module with its source
	 * extension, and a module that the package carries itself stays with it.
	 */
	const resolveGenerated = async (source: string, importer?: string): Promise<string | null> => {
		const name = ENGINE_GENERATED.exec(source)?.[1];
		if (!name || !importer) return null;
		const lib = engineLibFolder(importer);
		if (!lib) return null;
		const folder = await engineShaderFolder(lib, {
			fetch: (artifact) => ensureEngineShaders(artifact, reportShaderSource),
			build: () => buildEngineShadersLocally(lib, reportShaderSource),
		});
		if (!folder) return null;
		const built = join(folder, name);
		if (existsSync(built)) return built;
		const asSource = join(folder, name.replace(/\.js$/, '.ts'));
		return existsSync(asSource) ? asSource : null;
	};
	/**
	 * Reports the shader files that the build copied. Without a list, the build copied the whole
	 * set, which a host stores although a page downloads a few files of it, so the report warns and
	 * names the way to copy less.
	 */
	const reportShaderCopies = (files: number, bytes: number) => {
		const copied = `null3D: copied ${files.toLocaleString('en-US')} shader files, ${megabytes(bytes)}`;
		const paths = shipped.glsl ? '' : ' for the WebGPU path alone';
		if (shaderList !== undefined)
			logger?.info(
				`${copied}${paths}: the builds of the ${shaderList.words.size} permutation words of ${shaderList.file}.`,
			);
		else if (!shipped.glsl)
			logger?.info(
				`${copied}: every build of every permutation word of the WebGPU path. A page downloads only the few that its device needs. Record the words that your pages draw with in a list, and name it in the plugin's shaders.list option, to copy only their builds: ${SHADER_LIST_DOCS}`,
			);
		else
			logger?.warn(
				`${copied}: every build of every permutation word in the engine's shader set. A page downloads only the few that its device needs, but the host stores them all. Record the words that your pages draw with in a list, and name it in the plugin's shaders.list option, to copy only their builds: ${SHADER_LIST_DOCS}`,
			);
	};
	const plugin: Plugin = {
		name: 'null3d',
		// Runs before Vite's own asset handling, which would copy a sketch file as raw text, and
		// before TypeScript becomes JavaScript, so tagged WGSL sits where the source file has it.
		enforce: 'pre',
		config(config, { mode }) {
			const root = config.root ?? process.cwd();
			const https = options.https
				? httpsOptions(readCertificate(root, options.certDir ?? DEV_CERT_DIR), !!options.http2)
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
				worker: {
					format: 'es',
					plugins: () => [
						// A worker build keeps only these plugins, so the generated shader files are
						// named here as they are on the page; otherwise every one of them is read
						// into memory to reach the page's bundle through the worker's own.
						streamedShaderAssets,
						workerFilesPlugin(workerFiles),
						workerPreloadPlugin(),
						shaderParagraphsPlugin(),
						{
							// A worker build keeps these plugins alone, so the engine's generated
							// modules resolve here as they do on the page.
							name: 'null3d:engine-generated',
							enforce: 'pre',
							resolveId: {
								filter: { id: ENGINE_GENERATED },
								handler: (source: string, importer?: string) => resolveGenerated(source, importer),
							},
						},
					],
				},
				build: {
					assetsInlineLimit: inlineLimit(config.build?.assetsInlineLimit),
				},
				// A prebundled copy of the engine would lose the addresses of its workers and core files,
				// and one of the sound add-on's page half the address of the mixer it loads into the
				// browser's audio thread.
				optimizeDeps: { exclude: ['@null3d/engine', '@null3d/sound'] },
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
			logger = config.logger;
			// Vite's `--force` ignores its own caches; it ignores the shader cache too.
			noShaderCache ||= config.optimizeDeps?.force === true;
		},
		buildStart() {
			emitted.clear();
			workerChunks.clear();
			workerModules.clear();
			// The copies follow the generated set: a watch rebuild reads the files again, so a hash
			// from the last build would name old bytes, and a file that went away would be copied.
			copiedShaders.clear();
			shaderCopies.clear();
			copiedTables.files = 0;
			copiedTables.bytes = 0;
			heldWords.clear();
			if (narrowedFolder !== undefined) rmSync(narrowedFolder, { recursive: true, force: true });
			narrowedFolder = undefined;
			shaderList = undefined;
			earlyCoreId = undefined;
			earlyCoreSought = false;
			if (!building) return;
			const list = options.shaders?.list;
			if (list !== undefined) {
				try {
					shaderList = ShaderList.read(resolve(root, list), list);
				} catch (error) {
					this.error(`null3D: ${(error as Error).message}`);
				}
			}
			const missing = missingCoreFiles(root);
			if (missing && missing.length > 0) {
				this.error(
					`null3D: the installed @null3d/engine lacks its WebAssembly core (${missing.join(', ')}). Reinstall the package; in a copy of the engine's source, run bun run build first.`,
				);
			}
		},
		async buildEnd() {
			await Promise.all([compiler.close(), hasher.close()]);
		},
		closeBundle() {
			if (narrowedFolder !== undefined) rmSync(narrowedFolder, { recursive: true, force: true });
			narrowedFolder = undefined;
		},
		// The dev server's pages import the client module of hot updates. A build of pages that
		// imports the engine ships the early script, found from the module that imports the engine,
		// as the engine itself is. The page's own scripts run only once all of them have arrived. The
		// early script imports nothing, so it runs as soon as it arrives, and the core's download
		// starts sooner by the time the others take to arrive and run.
		resolveId: {
			filter: {
				id: [HOT_CLIENT_ADDRESS, MATERIAL_BUILDS_ADDRESS, /^@null3d\/engine$/, ENGINE_GENERATED],
			},
			async handler(source, importer) {
				if (HOT_CLIENT_ADDRESS.test(source)) return HOT_CLIENT_ID;
				if (MATERIAL_BUILDS_ADDRESS.test(source))
					return source.startsWith('\0') ? source : `\0${source}`;
				// The engine package carries no built shader modules. Its files import them by a name
				// that the installed package's release asset holds, so each import resolves into the
				// cache folder that every project on this machine shares.
				const generated = await resolveGenerated(source, importer);
				if (generated) return generated;
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
			filter: {
				id: {
					include: [WGSL_FILE, OPTIMIZED_MODEL, HOT_CLIENT_ADDRESS, MATERIAL_BUILDS_ADDRESS],
				},
			},
			async handler(id) {
				if (id === HOT_CLIENT_ID)
					return hotClientCode(options.shaders?.list !== undefined, !shipped.glsl);
				if (MATERIAL_BUILDS_ADDRESS.test(id))
					return (
						materialBuilds.module(id) ??
						this.error(
							`null3D has no custom material builds named ${id.slice(1)}. Reload the page so the dev server compiles its WGSL again.`,
						)
					);
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
				const compiled = await compileWgslFile(
					path,
					id,
					readFileSync(id, 'utf8'),
					shaders,
					!building || shipped.glsl,
				);
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
				const pack = new ShaderPack();
				const builds = new ModuleBuilds(!building || shipped.glsl);
				const value = builds.value(pack, compiled.shader, key);
				return {
					code: `export default ${value};\n${pack.unpacker()}${materialBuilds.finish(id, builds)}`,
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
					const tagged = await compileTaggedWgsl(
						code,
						file,
						path,
						shaders,
						!building || shipped.glsl,
					);
					if ('error' in tagged) return this.error(tagged.error);
					for (const warning of tagged.warnings) this.warn(warning);
					const pack = new ShaderPack();
					const builds = new ModuleBuilds(!building || shipped.glsl);
					for (const [literal, { start, end, shader }] of tagged.shaders.entries()) {
						const key = keyOf(file, path, literal);
						if (key !== undefined) hot.remember(key, shader);
						out ??= new MagicString(code);
						out.overwrite(start, end, builds.value(pack, shader, key));
					}
					if (out && !pack.empty)
						out.append(`${pack.unpacker()}${materialBuilds.finish(file, builds)}`);
					if (keyOf(file, path) !== undefined && tagged.shaders.length > 0)
						hot.scripts.set(file, code);
				}
				if (building && code.includes('import.meta.url')) {
					for (const match of code.matchAll(SCRIPT_URL)) {
						const start = match.index;
						if (WORKER_BEFORE.test(code.slice(Math.max(0, start - 40), start))) continue;
						const address = match[2] ?? '';
						if (isGeneratedShaderFile(file, address)) continue;
						const script = await this.resolve(address, id);
						if (!script || !isImportedModule(script.id)) continue;
						// The worker imports the compiled module by this address, as a sketch or a task.
						const ref = this.emitFile({
							type: 'chunk',
							id: script.id,
							preserveSignature: 'strict',
						});
						workerChunks.add(ref);
						workerModules.add(script.id);
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
				const compiled = await compileWgslFile(
					path,
					file,
					await read(),
					shaders,
					!building || shipped.glsl,
				);
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
				changed.map(({ literal }) =>
					compileLiteral(literal, code, file, path, shaders, !building || shipped.glsl),
				),
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
		// A worker that imports a script by its address asks for the script's imports only once the
		// script has arrived, so the script names them all. This runs before the build names the
		// files, so each file's name follows its code.
		renderChunk(code, chunk, _options, meta) {
			const module = chunk.facadeModuleId;
			if (!chunk.isEntry || module === null || !workerModules.has(module)) return null;
			const chunks = (meta as { chunks?: Record<string, Rollup.RenderedChunk> }).chunks;
			if (!chunks) return null;
			const edited = new MagicString(code);
			if (!directImports(edited, chunk.fileName, chunks)) return null;
			return { code: edited.toString(), map: edited.generateMap({ hires: true }) };
		},
		// After Vite's own plugins, which add the worker builds' files and the pages to the bundle.
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				// The scripts that a worker imports run there, where the page's preload helper has no
				// document to read.
				if (workerChunks.size > 0)
					emptyWorkerPreloads(
						bundle,
						[...workerChunks].map((ref) => this.getFileName(ref)),
					);
				/** True for a build with a list that reached the engine's shader set. */
				const listing = shaderList !== undefined && copiedShaders.size > 0;
				// Each file that names a copy now knows where it sits, so the mark becomes the
				// address from there to the copy's own place in the output. A worker's files reach
				// this bundle as the worker built them, so they take the same pass.
				for (const file of Object.values(bundle)) {
					const text =
						file.type === 'chunk'
							? file.code
							: typeof file.source === 'string'
								? file.source
								: new TextDecoder().decode(file.source);
					// The builds that the bundle holds answer their words: the set's own main module,
					// and the project's custom materials and add-on shaders, in the worker builds' files
					// too.
					if (listing) for (const word of builtWords(text)) holdWord(heldWords, word);
					if (!text.includes(SHADER_URL_MARK)) continue;
					const from = posix.dirname(file.fileName);
					const rewritten = text.replaceAll(
						/__null3d_shader__([^"'`\s)]+)/g,
						(_match, name: string) => {
							const address = posix.relative(from, assetPath(name));
							return address.startsWith('.') ? address : `./${address}`;
						},
					);
					if (file.type === 'chunk') file.code = rewritten;
					else file.source = rewritten;
				}
				// A listed word that no build answers, a copied one or one that the bundle holds,
				// would fail its pipeline on a device, so the build fails first and names it.
				const missing = listing ? (shaderList?.missing(heldWords) ?? []) : [];
				if (missing.length > 0)
					this.error(
						`null3D: the shader list ${shaderList?.file} names ${missing.map(wordText).join(', ')}, which no shader build of this project holds: none of the engine's shader set and none of its own shaders. Record the list again against this version of the engine with bunx @null3d/cli shaders record, or remove the word. A set that ${ENGINE_SHADERS_ENV} names must hold every listed word.`,
					);
				const tables = emitParagraphTables.call(this, bundle, root);
				// The copied device modules are not in the bundle, so the tables of shared
				// paragraphs that they import are emitted from here, once each, and each copy's
				// module names them as its loads. Every build that copies the files needs them,
				// whatever it is for.
				const emittedTables = new Set([...tables.values()].flat());
				const loads = new Map<string, string[]>();
				/** The file of each table that the copies import, by its place in the output. */
				const tableFiles = new Map<string, string>();
				/** The names that the copies import from each of those tables. */
				const tableNames = new Map<string, Set<string>>();
				for (const [name, copy] of copiedShaders) {
					const own: string[] = [];
					for (const { stem, names } of tableImportsOfFile(copy.bytes)) {
						const table = assetPath(`${stem}.js`);
						own.push(table);
						if (emittedTables.has(table)) continue;
						if (!tableFiles.has(table)) {
							const file = join(dirname(copy.source), `${stem}.js`);
							if (!existsSync(file))
								this.error(
									`null3D: ${assetPath(name)} imports ${stem}.js, which the engine's shader modules do not hold. Run \`bun run shaders\` again, and reinstall @null3d/engine if the build still fails.`,
								);
							tableFiles.set(table, file);
							tableNames.set(table, new Set());
						}
						for (const imported of names) tableNames.get(table)?.add(imported);
					}
					loads.set(name, own);
				}
				// With a list, a table keeps only the paragraphs that the narrowed copies import.
				for (const [table, file] of tableFiles) {
					const whole = readFileSync(file);
					const source =
						shaderList === undefined
							? whole
							: Buffer.from(
									narrowParagraphTable(
										whole.toString('utf8'),
										tableNames.get(table) ?? new Set(),
										file,
									),
								);
					copiedTables.files++;
					copiedTables.bytes += source.length;
					this.emitFile({ type: 'asset', fileName: table, source });
				}
				if (buildingPages) {
					const listed = listedFiles(bundle, workerFiles, packageOf, root, tables);
					// The copied shader files are not in the bundle, so the list of files for offline
					// play takes them here, by the module each one holds.
					for (const [name, copy] of copiedShaders) {
						const module = engineModule(copy.source, packageOf);
						listed.push({
							fileName: assetPath(name),
							entry: false,
							modules: module === undefined ? [] : [module],
							imports: [],
							loads: loads.get(name) ?? [],
						});
					}
					const files = offlineFiles(listed);
					this.emitFile({
						type: 'asset',
						fileName: FILES_LIST,
						source: `${JSON.stringify(files, null, '\t')}\n`,
					});
				}
				if (notices) this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source: notices });
			},
		},
		// A worker's file that another file names must reach the build, whatever Vite decided about
		// the worker. The bundle is whole here, so a missing file is certain, and the build's files
		// and its list of files for offline play take it as they take the others.
		writeBundle: {
			order: 'post',
			handler(options, bundle) {
				const outDir = options.dir;
				if (!outDir) return;
				// The generated shader files are copied one at a time, so the build never holds the
				// whole set of builds in memory as a bundle of assets.
				if (copiedShaders.size > 0) {
					const folder = join(outDir, assetsDir);
					mkdirSync(folder, { recursive: true });
					let bytes = copiedTables.bytes;
					for (const [name, copy] of copiedShaders) {
						copyFileSync(copy.bytes, join(folder, name));
						bytes += statSync(copy.bytes).size;
					}
					reportShaderCopies(copiedShaders.size + copiedTables.files, bytes);
				}
				const recovered = missingWorkerAssets(bundle, workerFiles).filter(
					({ fileName, source }) => !existsSync(join(outDir, fileName)) && existsSync(source),
				);
				if (recovered.length === 0) return;
				for (const { fileName, source } of recovered) {
					const path = join(outDir, fileName);
					mkdirSync(dirname(path), { recursive: true });
					writeFileSync(path, readFileSync(source));
				}
				const listPath = join(outDir, FILES_LIST);
				if (!existsSync(listPath)) return;
				const list = JSON.parse(readFileSync(listPath, 'utf8')) as {
					start: string[];
					features: Record<string, string[]>;
				};
				for (const { fileName } of recovered) {
					const modules = workerFiles.get(fileName)?.moduleIds ?? [];
					const feature = modules.flatMap((id) => {
						const module = engineModule(id, packageOf);
						return module === undefined ? [] : featuresOf(module);
					})[0];
					if (feature === undefined) {
						if (!list.start.includes(fileName)) list.start.push(fileName);
						continue;
					}
					list.features[feature] ??= [];
					const files = list.features[feature];
					if (!files.includes(fileName)) files.push(fileName);
					files.sort();
				}
				list.start.sort();
				const version = createHash('sha256')
					.update(JSON.stringify({ start: list.start, features: list.features }))
					.digest('hex')
					.slice(0, 16);
				writeFileSync(
					listPath,
					`${JSON.stringify({ version, start: list.start, features: list.features }, null, '\t')}\n`,
				);
			},
		},
		configureServer(server) {
			// Ahead of every other step, so it sees each answer of the server and its plugins.
			server.middlewares.use(compressAnswers((req) => !fromLoopback(req)));
			server.middlewares.use(queryExtensionMiddleware());
			// The engine's shader modules sit outside the project, in the machine's cache or in the
			// folder that names a set, and the page and its workers reach them from there.
			const allowed = server.config.server.fs.allow;
			for (const shaders of [engineShadersRoot(), process.env[ENGINE_SHADERS_ENV]])
				if (shaders && !allowed.includes(shaders)) allowed.push(shaders);
			server.middlewares.use(isolationMiddleware);
			// The dev server draws with the whole shader set. It warns about each word that a page
			// draws with and the project's list lacks, because a production build stops that page.
			const list = options.shaders?.list;
			if (list !== undefined) {
				const unlisted = new UnlistedWords(resolve(server.config.root, list), list);
				server.environments.client.hot.on(PERMUTATION_WORD_EVENT, (data, client) => {
					const { word, page } = (data ?? {}) as { word?: unknown; page?: unknown };
					if (typeof word !== 'number' || typeof page !== 'string') return;
					const warning = unlisted.check(word, page);
					if (warning === undefined) return;
					if (warning.first)
						server.config.logger.warn(`null3D: ${warning.message}`, { timestamp: true });
					client.send(UNLISTED_WORD_EVENT, { message: warning.message });
				});
			}
			// The dev server draws with both GPU paths. It warns when a page draws with a path that a
			// production build with these options does not ship, because that build stops the page.
			if (!shipped.glsl) {
				const warned = new Set<string>();
				server.environments.client.hot.on(GPU_PATH_EVENT, (data, client) => {
					const { path, page } = (data ?? {}) as { path?: unknown; page?: unknown };
					if (typeof path !== 'string' || typeof page !== 'string') return;
					if (warned.has(page)) return;
					const message = unshippedPathWarning(path, page, shipped.glsl);
					if (message === undefined) return;
					warned.add(page);
					server.config.logger.warn(`null3D: ${message}`, { timestamp: true });
					client.send(UNSHIPPED_PATH_EVENT, { message });
				});
			}
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
			const { config } = server;
			// Every visitor gets compressed answers, as from a host: the build's own files from the
			// step below, and the answers of other plugins' routes, such as model files, from this one.
			server.middlewares.use(compressAnswers(() => true));
			server.middlewares.use(queryExtensionMiddleware());
			server.middlewares.use(isolationMiddleware);
			server.middlewares.use(immutableAssetsMiddleware);
			server.middlewares.use(sameOriginMiddleware);
			server.middlewares.use(
				compressedFiles(
					resolve(config.root, config.build.outDir),
					config.base,
					config.preview.headers,
				),
			);
		},
	};

	/** The device files whose words this build has read for the project's shader list. */
	const scannedWords = new Set<string>();
	/**
	 * Adds to `heldWords` the words of every device file that a generated module names. A build
	 * that drops the module must still answer the project's list with its words, which the module's
	 * own text does not hold: a table of combined builds names them through the addresses below.
	 */
	const holdNamedWords = (text: string, file: string): void => {
		if (shaderList === undefined) return;
		for (const match of text.matchAll(SCRIPT_URL)) {
			const address = match[2] ?? '';
			if (!isGeneratedShaderFile(file, address)) continue;
			const named = resolve(dirname(file), address);
			if (scannedWords.has(named) || !existsSync(named)) continue;
			scannedWords.add(named);
			for (const word of moduleWords(readFileSync(named, 'utf8'))) holdWord(heldWords, word);
		}
	};

	/**
	 * Names the generated shader files' copies before Vite's own asset step sees them, which runs
	 * after the plugins that declare no order. A generated module loads each of its builds by
	 * `new URL('./shaders-<name>.js', import.meta.url)`, and a bundler reads every one of them into
	 * memory to emit it as an asset; here a pool of worker threads hashes each file and the build
	 * copies it on its own, and the module names the copy, so the build never holds the whole set
	 * at once. With a list of words, each copy holds only the listed builds, and the set's module of
	 * listed words names the project's list. With a GPU path set, a file of the other path gives way
	 * to one module without builds, so the build copies none of that path's text.
	 *
	 * The argument is a mark rather than an address: where a copy lands is fixed, but the file that
	 * names it can sit anywhere in the output, and only `generateBundle` knows where.
	 */
	const streamedShaderAssets: Plugin = {
		name: 'null3d:streamed-shader-assets',
		enforce: 'pre',
		apply: 'build',

		async transform(code, id) {
			const file = id.split('?')[0] ?? id;
			// The engine names a missing word as one that the list lacks, and the list to record.
			const name = file.slice(file.lastIndexOf('/') + 1);
			if (
				(shaderList !== undefined || !shipped.glsl) &&
				LISTED_MODULE.test(name) &&
				inShaderSet(dirname(file)) &&
				code.includes('LISTED_PERMUTATIONS')
			) {
				// The engine reads the shipped paths from the same module. A set that predates the
				// constant would keep both paths, so the build refuses rather than ship one silently.
				if (!code.includes('SHIPPED_GPU_PATHS'))
					this.error(
						"null3D: the engine's shader set is older than the plugin: its shader-permutations module has no SHIPPED_GPU_PATHS. Install the same version of @null3d/engine as of @null3d/vite-plugin, or run bun run shaders in a checkout.",
					);
				return {
					code: shaderMarkersModule(shaderList?.words ?? null, shipped.glsl ? null : ['webgpu']),
					map: null,
				};
			}
			let text = code;
			let changed = false;
			// An add-on package's compiled shaders keep both GPU paths, which a build that ships one
			// path drops here, including the modules of the other path's build sets.
			if (!shipped.glsl && text.includes(UNPACK)) {
				text = narrowShaderPack(text, file);
				changed = true;
			}
			if (!text.includes('import.meta.url')) return changed ? { code: text, map: null } : undefined;
			// The files this module names.
			const named: { match: RegExpExecArray; target: string }[] = [];
			for (const match of text.matchAll(SCRIPT_URL)) {
				const address = match[2] ?? '';
				if (!isGeneratedShaderFile(file, address)) continue;
				const target = resolve(dirname(file), address);
				if (!existsSync(target)) continue;
				named.push({ match, target });
			}
			if (named.length === 0) return changed ? { code: text, map: null } : undefined;
			// The pool reads each file in chunks and hashes it, so the build's own thread reads none
			// of the files and holds none of their bytes; only a file that a list narrows is read
			// here, to write the copy of its listed builds.
			const copies = await Promise.all(
				named.map(async ({ match, target }) => ({ match, copy: await shaderCopy(target) })),
			);
			let out: MagicString | undefined;
			for (const { match, copy } of copies) {
				copiedShaders.set(copy.name, copy);
				out ??= new MagicString(text);
				out.overwrite(
					match.index,
					match.index + match[0].length,
					`((u) => new URL(u, import.meta.url))(${JSON.stringify(SHADER_URL_MARK + copy.name)})`,
				);
			}
			if (out === undefined) return changed ? { code: text, map: null } : undefined;
			return { code: out.toString(), map: out.generateMap({ hires: 'boundary' }) };
		},
		// A generated module of a GPU path that this build does not ship, named by a module of the
		// set itself, such as a table of builds that need several features, takes the place of one
		// stub module. The stub exports the names of the module it stands for, so every import of it
		// resolves, and the lookups find no build rather than failing to load the module.
		resolveId: {
			filter: { id: /^\.\/shaders(?:-[a-z0-9-]+)+$/ },
			handler(source, importer) {
				if (shipped.glsl || importer === undefined) return;
				const importerFile = importer.split('?')[0] ?? importer;
				const importerName = importerFile.slice(importerFile.lastIndexOf('/') + 1);
				if (!GENERATED_MODULE.test(importerName)) return;
				if (!inShaderSet(dirname(importerFile))) return;
				if (targetOfModule(source) !== 'glsl') return;
				const named = resolve(dirname(importerFile), source);
				const file = [named, `${named}.ts`, `${named}.js`].find((path) => existsSync(path));
				if (file === undefined) return;
				const text = readFileSync(file, 'utf8');
				holdNamedWords(text, file);
				return `${NO_SHADER_ID}${exportNamesOf(text, file).join(',')}`;
			},
		},
		// A dropped generated module that a module imports by name, such as a whole shader that loads
		// on first use, gives way to a stub of the same exports. Its words still answer a project's
		// shader list, which may hold a word that only the other GPU path builds.
		load: {
			filter: {
				id: { include: [/shaders(?:-[a-z0-9-]+)?\.[cm]?[jt]s$/, NO_SHADER_PATTERN] },
			},
			handler(id) {
				const bare = id.startsWith('\0') ? id.slice(1) : id;
				if (bare.startsWith(NO_SHADER_MARK))
					return stubModule(
						bare
							.slice(NO_SHADER_MARK.length)
							.split(',')
							.filter((name) => name !== ''),
					);
				if (shipped.glsl) return;
				const file = id.split('?')[0] ?? id;
				const name = file.slice(file.lastIndexOf('/') + 1);
				if (!GENERATED_MODULE.test(name)) return;
				if (!inShaderSet(dirname(file))) return;
				if (targetOfModule(name) !== 'glsl') return;
				const text = readFileSync(file, 'utf8');
				if (shaderList !== undefined)
					for (const word of moduleWords(text)) holdWord(heldWords, word);
				holdNamedWords(text, file);
				return stubModule(exportNamesOf(text, file));
			},
		},
	};

	return [streamedShaderAssets, plugin];
}
