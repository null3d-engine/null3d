// glTF models that a project imports with `?optimized`: the plugin runs the asset tool of
// `@null3d/cli` on them, the steps of `bunx @null3d/cli assets optimize`, and the import gives the
// optimized model's address. Results stay in a cache, keyed by the model's files, the tool's
// version and the options, so each model encodes once until one of them changes. The dev server
// serves the cache, and a build writes the files into its assets folder.
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

/** Options of the asset tool, as `assets optimize` takes them. */
export interface AssetOptions {
	/** Add levels of detail to meshes of 64 triangles or more. The default is false. */
	lod?: boolean;
	/**
	 * Write each mesh's levels of detail as separate files beside the model, so the engine draws the
	 * coarsest level at once and takes each finer one as it arrives. It needs `lod`. The default is
	 * false.
	 */
	stages?: boolean;
	/**
	 * Add a tree of cluster patches to each large static mesh of 20,000 triangles or more. The
	 * default is false.
	 */
	clusters?: boolean;
	/**
	 * Keep this share of each mesh's triangles, above 0 and up to 1, as far as `simplifyError`
	 * allows. The default, 1, keeps them all.
	 */
	simplify?: number;
	/**
	 * The most that `simplify` may move a mesh's surface, as a share of the mesh's size. The
	 * default is 0.01.
	 */
	simplifyError?: number;
	/** The largest side of a texture: a power of two up to 2048, the default. */
	maxTextureSize?: number;
	/** `size` encodes color and data maps in ETC1S, the default; `high` in UASTC. */
	textureQuality?: 'size' | 'high';
	/**
	 * Add the detail of each material's normal map to the roughness levels of its metal-rough map,
	 * which then takes UASTC, so distant bumpy surfaces do not flicker. The default is true.
	 */
	roughnessBake?: boolean;
	/** Compress the model's buffers with meshopt, which the engine decodes on load. Default: true. */
	meshopt?: boolean;
	/**
	 * Give each mesh that encloses space a blocker for software occlusion culling
	 * (`NULL3D_occluder`). The default is true.
	 */
	blockers?: boolean;
	/**
	 * Store the tree that raycasts walk for each mesh part of at least this many triangles
	 * (`NULL3D_mesh_bvh`), or for none with 0. The default is 20,000.
	 */
	bvh?: number;
}

/** The query that asks for an optimized model. */
export const OPTIMIZED_QUERY = 'optimized';

/** An import of an optimized model: a `.glb` or `.gltf` file with the query. */
export const OPTIMIZED_MODEL = /\.(glb|gltf)\?optimized$/;

/** The address prefix and folder name of the optimized files, in the dev server and in a build. */
export const ASSET_FOLDER = 'null3d-assets';

/** The folder of the texture files, which every model shares. */
const TEXTURES = 'textures';

/** What the plugin uses of `@null3d/cli/assets`. */
interface AssetTool {
	VERSION: string;
	DEFAULT_OPTIONS: Required<AssetOptions>;
	namedFiles(path: string): string[];
	defaultJobs(): number;
	encoderPool(size: number): { encode(job: unknown): Promise<unknown>; close(): Promise<void> };
	encodeOnce(encode: (job: unknown) => Promise<unknown>): (job: unknown) => Promise<unknown>;
	optimizeModel(
		path: string,
		options: Required<AssetOptions> & { textureFolder: string },
		encode: (job: unknown) => Promise<unknown>,
	): Promise<{
		glb: Uint8Array;
		files: Map<string, Uint8Array>;
		stages: Map<string, Uint8Array>;
	}>;
}

/** The asset tool, loaded on the first optimized import. */
let tool: Promise<AssetTool> | undefined;

/** The CLI's asset module, which stays out of projects that import no optimized model. */
const TOOL_MODULE = '@null3d/cli/assets';

function loadTool(): Promise<AssetTool> {
	tool ??= (import(/* @vite-ignore */ TOOL_MODULE) as Promise<AssetTool>).catch(() => {
		tool = undefined;
		throw new Error(
			'null3D optimizes models with the asset tool of @null3d/cli, which the project does not install. Add it with bun add -d @null3d/cli.',
		);
	});
	return tool;
}

/** An optimized model in the cache: its folder's key and its file's name. */
export interface CachedModel {
	key: string;
	name: string;
	/** The model file, and the texture files it names, by their paths from the cache's folder. */
	files: string[];
}

/** The cache's folder in a project. */
export const cacheFolder = (root: string) => join(root, 'node_modules/.cache', ASSET_FOLDER);

/**
 * The cache key of a model: the hash of the tool's identity, the options, and each file of the
 * model, its own and those it names.
 */
export function modelKey(identity: string, options: object, files: readonly string[]): string {
	const hash = createHash('sha256').update(`${identity}\n${JSON.stringify(options)}\n`);
	for (const file of files) hash.update(readFileSync(file));
	return hash.digest('hex').slice(0, 16);
}

/**
 * What the asset tool is: the version it reports and a hash of every module and file that decides
 * its output. The version alone is not enough, because it stays `0.0.0` in the repository: a fix to
 * the tool can change what a model encodes to without changing the key, and the cache would keep
 * serving models that the tool wrote before the fix (code review H-17). A tool whose entry module
 * cannot be read falls back to the version it reports.
 */
export function toolIdentity(version: string): string {
	try {
		const module = createRequire(import.meta.url).resolve(TOOL_MODULE);
		const code = toolCodeHash(module);
		return code === null ? version : `${version}+${code}`;
	} catch {
		// A project without the tool keeps the version alone; the import that runs the tool reports it.
		return version;
	}
}

/** The file types that name further files, so the walker reads their contents as module text. */
const MODULE_FILE = /\.(?:js|cjs|mjs|ts)$/;

/** The patterns of the specifiers that a module reads. */
const SPECIFIERS: readonly RegExp[] = [
	// `import ... from 'x'` and `export ... from 'x'`, including the multi-line forms.
	/\bfrom\s*['"]([^'"]+)['"]/g,
	// A side-effect import, `import 'x'`.
	/\bimport\s*['"]([^'"]+)['"]/g,
	// A module that loads on demand, `import('x')`.
	/\bimport\s*\(\s*['"]([^'"]+)['"]/g,
	// A file that sits beside the module, `new URL('./worker.js', import.meta.url)`.
	/\bnew URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
	// A package that a lazily made loader loads by name, `createRequire(...)('draco3d')`.
	/\bcreateRequire\s*\([^)]*\)\s*\(\s*['"]([^'"]+)['"]/g,
];

/**
 * The specifiers that a module's text reads, in order. A specifier is a path beside the module or a
 * package name; the walker decides which, and whether it can be read at all.
 */
export function moduleSpecifiers(text: string): string[] {
	const found = new Set<string>();
	for (const pattern of SPECIFIERS)
		for (const match of text.matchAll(pattern)) found.add(match[1] as string);
	return [...found].sort();
}

/** A package that holds a file, and the version that decides the file's contents. */
interface PackageManifest {
	dir: string;
	name: string;
	version: string;
}

/** The package that holds `file`: the nearest folder above it with a manifest that names one. */
function packageOf(file: string): PackageManifest | undefined {
	for (let folder = dirname(file); ; folder = dirname(folder)) {
		const manifest = join(folder, 'package.json');
		if (existsSync(manifest)) {
			try {
				const json = JSON.parse(readFileSync(manifest, 'utf8')) as {
					name?: unknown;
					version?: unknown;
				};
				if (typeof json.name === 'string')
					return {
						dir: folder,
						name: json.name,
						version: typeof json.version === 'string' ? json.version : '0',
					};
			} catch {
				// A manifest that does not parse names no package; try the folder above it.
			}
		}
		if (dirname(folder) === folder) return undefined;
	}
}

/** What one specifier names: a module to read, a package to name by version, or a file not yet built. */
type ToolInput =
	| { kind: 'module'; file: string }
	| { kind: 'package'; name: string; version: string }
	| { kind: 'missing'; file: string };

/**
 * What the specifier read by `from` names. A built-in library names nothing. A null3D package, such
 * as the engine's pieces planner, holds code that the output depends on, so the walker reads it just
 * as it reads the tool's own modules. Any other package is named by its version: its files are fixed
 * for a version, and reading them again for every model would cost far more than it decides. A file
 * that the specifier names but that is absent, such as a built WebAssembly module, keeps its absence
 * in the identity, so the entry changes when a build writes the file.
 */
function resolveToolInput(from: string, specifier: string): ToolInput | undefined {
	if (isBuiltin(specifier)) return undefined;
	let resolved: string;
	try {
		resolved = createRequire(from).resolve(specifier);
	} catch {
		if (!specifier.startsWith('.')) return undefined;
		return { kind: 'missing', file: resolve(dirname(from), specifier) };
	}
	const holder = packageOf(resolved);
	if (holder && !holder.name.startsWith('@null3d/'))
		return { kind: 'package', name: holder.name, version: holder.version };
	return { kind: 'module', file: resolved };
}

/**
 * A hash of the code that the asset tool runs, or null when its entry module cannot be read. The
 * walker starts at the module the plugin loads and reads every module it names, with the engine's
 * own planners among them, plus the files that the modules name by URL beside themselves. The paths
 * go into the hash as the tool's package holds them, and each package read from outside the tool is
 * named by its version, so changing any input gives a new hash and an unchanged tree gives the same
 * one.
 */
export function toolCodeHash(entry: string): string | null {
	let start: string;
	try {
		start = realpathSync(entry);
	} catch {
		return null;
	}
	const root = packageOf(start)?.dir ?? dirname(start);
	const hash = createHash('sha256');
	const seen = new Set<string>();
	const packages = new Set<string>();
	const queue = [start];
	while (queue.length > 0) {
		let file: string;
		let bytes: Buffer;
		try {
			file = realpathSync(queue.shift() as string);
			if (seen.has(file)) continue;
			seen.add(file);
			bytes = readFileSync(file);
		} catch {
			// A module that the entry names and cannot be read leaves the tool unable to run, so the
			// caller falls back to the version rather than keying every model by a partial hash.
			return null;
		}
		hash.update(`${relative(root, file)}\0`);
		hash.update(bytes);
		hash.update('\0');
		if (!MODULE_FILE.test(file)) continue;
		for (const specifier of moduleSpecifiers(bytes.toString('utf8'))) {
			const input = resolveToolInput(file, specifier);
			if (!input) continue;
			if (input.kind === 'module') queue.push(input.file);
			else if (input.kind === 'missing') hash.update(`missing:${relative(root, input.file)}\0`);
			else packages.add(`${input.name}@${input.version}`);
		}
	}
	for (const packageTag of [...packages].sort()) hash.update(`package:${packageTag}\0`);
	return hash.digest('hex').slice(0, 16);
}

/** A stage file's name: a plain file name beside the model, as the tool writes it. */
const STAGE_FILE = /^[\w.-]+\.bin$/;

/**
 * The stage files that a model names, by their file names beside it: the files of the levels and
 * the bands that download after it, from `NULL3D_stages` in each node's extras.
 */
function stagesOf(glb: Uint8Array): string[] {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const json = JSON.parse(
		new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))),
	) as {
		nodes?: {
			extras?: { NULL3D_stages?: { levels?: { url?: unknown }[]; bands?: { url?: unknown }[] } };
		}[];
	};
	const out: string[] = [];
	for (const node of json.nodes ?? []) {
		const staged = node.extras?.NULL3D_stages;
		for (const stage of [...(staged?.levels ?? []), ...(staged?.bands ?? [])])
			if (typeof stage.url === 'string' && STAGE_FILE.test(stage.url)) out.push(stage.url);
	}
	return out;
}

/** The textures that a model file names, by their file names. */
function texturesOf(glb: Uint8Array): string[] {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const json = JSON.parse(
		new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))),
	);
	return ((json.images ?? []) as { uri?: string }[])
		.map((image) => image.uri)
		.filter((uri): uri is string => typeof uri === 'string' && uri.startsWith(`../${TEXTURES}/`))
		.map((uri) => uri.slice(`../${TEXTURES}/`.length));
}

/** Models that are optimizing now, by key, so two imports of one model optimize it once. */
const running = new Map<string, Promise<CachedModel>>();

/**
 * Optimizes a model into the cache unless the cache has it, and returns where it is. The model's
 * folder appears whole or not at all, so a stopped run leaves nothing half written.
 */
export async function optimizedModel(
	root: string,
	path: string,
	options: AssetOptions = {},
): Promise<CachedModel> {
	const asset = await loadTool();
	const settings = { ...asset.DEFAULT_OPTIONS, ...options };
	const sources = [path, ...asset.namedFiles(path)];
	const key = modelKey(toolIdentity(asset.VERSION), settings, sources);
	const name = `${basename(path, extname(path))}.glb`;
	const cache = cacheFolder(root);
	const folder = join(cache, key);
	const listed = (glb: Uint8Array): CachedModel => ({
		key,
		name,
		files: [
			`${key}/${name}`,
			...stagesOf(glb).map((file) => `${key}/${file}`),
			...texturesOf(glb).map((file) => `${TEXTURES}/${file}`),
		],
	});
	if (existsSync(join(folder, name))) return listed(readFileSync(join(folder, name)));
	const pending = running.get(key);
	if (pending) return pending;
	const work = (async () => {
		const pool = asset.encoderPool(asset.defaultJobs());
		try {
			const model = await asset.optimizeModel(
				path,
				{ ...settings, textureFolder: `../${TEXTURES}` },
				asset.encodeOnce((job) => pool.encode(job)),
			);
			mkdirSync(join(cache, TEXTURES), { recursive: true });
			for (const [file, bytes] of model.files) writeFileSync(join(cache, TEXTURES, file), bytes);
			const staging = join(cache, `.${key}-${process.pid}`);
			rmSync(staging, { recursive: true, force: true });
			mkdirSync(staging, { recursive: true });
			writeFileSync(join(staging, name), model.glb);
			// A tool older than this plugin writes no stage, and its answer holds no such list.
			for (const [file, bytes] of model.stages ?? []) writeFileSync(join(staging, file), bytes);
			rmSync(folder, { recursive: true, force: true });
			renameSync(staging, folder);
			return listed(model.glb);
		} finally {
			await pool.close();
			running.delete(key);
		}
	})();
	running.set(key, work);
	return work;
}

/** The media type of an optimized file. */
export function assetType(file: string): string {
	if (file.endsWith('.ktx2')) return 'image/ktx2';
	return file.endsWith('.bin') ? 'application/octet-stream' : 'model/gltf-binary';
}

/**
 * A cached file of a project by its path from the cache, such as `textures/<name>.ktx2`, for the
 * dev server. A path of any other shape, which could reach outside the cache, gives nothing.
 */
export function cachedFile(root: string, path: string): Uint8Array | undefined {
	const parts = path.split('/');
	if (parts.length !== 2 || parts.some((part) => !/^[\w-][\w.-]*$/.test(part))) return undefined;
	const file = join(cacheFolder(root), ...parts);
	return existsSync(file) ? readFileSync(file) : undefined;
}
