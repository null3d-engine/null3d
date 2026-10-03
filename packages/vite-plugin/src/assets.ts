// glTF models that a project imports with `?optimized`: the plugin runs the asset tool of
// `@null3d/cli` on them, the steps of `bunx @null3d/cli assets optimize`, and the import gives the
// optimized model's address. Results stay in a cache, keyed by the model's files, the tool's
// version and the options, so each model encodes once until one of them changes. The dev server
// serves the cache, and a build writes the files into its assets folder.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** Options of the asset tool, as `assets optimize` takes them. */
export interface AssetOptions {
	/** Add levels of detail to meshes of 256 triangles or more. The default is false. */
	lod?: boolean;
	/** The largest side of a texture: a power of two up to 2048, the default. */
	maxTextureSize?: number;
	/** `size` encodes color and data maps in ETC1S, the default; `high` in UASTC. */
	textureQuality?: 'size' | 'high';
	/**
	 * Compress the model's buffers with meshopt. The engine does not read meshopt yet, so the
	 * default is false.
	 */
	meshopt?: boolean;
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
	): Promise<{ glb: Uint8Array; files: Map<string, Uint8Array> }>;
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
 * The cache key of a model: the hash of the tool's version, the options, and each file of the
 * model, its own and those it names.
 */
export function modelKey(version: string, options: object, files: readonly string[]): string {
	const hash = createHash('sha256').update(`${version}\n${JSON.stringify(options)}\n`);
	for (const file of files) hash.update(readFileSync(file));
	return hash.digest('hex').slice(0, 16);
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
	const key = modelKey(asset.VERSION, settings, sources);
	const name = `${basename(path, extname(path))}.glb`;
	const cache = cacheFolder(root);
	const folder = join(cache, key);
	const listed = (glb: Uint8Array): CachedModel => ({
		key,
		name,
		files: [`${key}/${name}`, ...texturesOf(glb).map((file) => `${TEXTURES}/${file}`)],
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
	return file.endsWith('.ktx2') ? 'image/ktx2' : 'model/gltf-binary';
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
