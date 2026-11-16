// The model files of the desert, the scene that compares null3D with three.js's meshlet renderer.
// The scene module builds every mesh from fixed seeds. This module writes them as two GLB files of
// float vertices with no compression, the `raw` form, which three.js loads as it is. The asset tool
// of this checkout then optimizes each file into the `null3d` form, through the Vite plugin's cache
// of optimized models, which keys each model by the tool's own code, its options and the file. So
// the scene always draws what the current tool writes, and a change to the tool builds new files.
//
// The raw files go under target/desert, in a folder named by a hash of the scene module and this
// module, so a change to either builds them again. `target/desert/files.json` names the files of
// the latest build, with the SHA-256 of each, and the benchmark's server serves them from there.
// The first build takes a few minutes; later ones take the files from the caches.
import { createHash } from 'node:crypto';
import {
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import type { AssetOptions } from '../../packages/vite-plugin/src/assets.ts';
import {
	DESERT_FILES,
	DESERT_FORMS,
	DESERT_MATERIALS,
	DESERT_URL,
	type DesertFile,
	type DesertForm,
	type DesertMaterial,
	type DesertMeshData,
	desertModelPath,
	meshesOf,
} from '../scenes/desert.ts';

/**
 * The asset tool's options for each file. The ground, which the scene draws once, gets levels and a
 * tree of cluster patches. The props, which the scene copies many times, get levels, whose large
 * lists the tool also splits into pieces: a mesh with many copies draws whole levels. Neither gets
 * blockers, which only WebGL2's software culling reads, or raycast trees, which nothing here casts.
 */
export const DESERT_ASSET_OPTIONS: Readonly<Record<DesertFile, AssetOptions>> = {
	ground: { lod: true, clusters: true, blockers: false, bvh: 0 },
	props: { lod: true, blockers: false, bvh: 0 },
};

/** The folder of the desert's files in a checkout. */
export const desertDir = (root: string) => join(root, 'target/desert');

/** The file that names the latest build's files. */
export const desertManifestPath = (root: string) => join(desertDir(root), 'files.json');

/** One built file: where it is and its SHA-256. */
export interface DesertBuiltFile {
	path: string;
	sha256: string;
}

/** The latest build: the raw folder's key, and each form of each file by its address. */
export interface DesertManifest {
	key: string;
	files: Record<string, DesertBuiltFile>;
}

// GLB files.

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** The length of a chunk padded to a multiple of 4 bytes, as the GLB format needs. */
const padded = (length: number) => Math.ceil(length / 4) * 4;

/**
 * A GLB file from its JSON and its one buffer. The JSON chunk pads with spaces and the binary chunk
 * with zeros, and the JSON gets the buffer's length.
 */
export function writeGlb(json: Record<string, unknown>, bin: Uint8Array): Uint8Array {
	const text = new TextEncoder().encode(
		JSON.stringify({ ...json, buffers: [{ byteLength: bin.byteLength }] }),
	);
	const jsonLength = padded(text.length);
	const binLength = padded(bin.byteLength);
	const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
	const view = new DataView(out.buffer);
	view.setUint32(0, GLB_MAGIC, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, JSON_CHUNK, true);
	out.set(text, 20);
	out.fill(0x20, 20 + text.length, 20 + jsonLength);
	const binAt = 20 + jsonLength;
	view.setUint32(binAt, binLength, true);
	view.setUint32(binAt + 4, BIN_CHUNK, true);
	out.set(bin, binAt + 8);
	return out;
}

/** The smallest and largest value of each of the three columns of a list of points. */
function bounds(positions: Float32Array): { min: number[]; max: number[] } {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i++) {
		const v = positions[i] as number;
		const axis = i % 3;
		if (v < (min[axis] as number)) min[axis] = v;
		if (v > (max[axis] as number)) max[axis] = v;
	}
	return { min, max };
}

/** A mesh to write: its name, material and arrays. */
export interface NamedMesh {
	name: string;
	material: DesertMaterial;
	data: DesertMeshData;
}

/**
 * A GLB file that holds each mesh as a node of its own, named as the mesh, with float positions and
 * normals, 32-bit indices and its material. The scene's name differs from every node's, because
 * three.js's loader renames a node that shares the scene's name.
 */
export function desertGlb(file: string, meshes: readonly NamedMesh[]): Uint8Array {
	const arrays = meshes.flatMap(({ data }) => [data.positions, data.normals, data.indices]);
	const bin = new Uint8Array(arrays.reduce((sum, array) => sum + array.byteLength, 0));
	const bufferViews: Record<string, number>[] = [];
	let at = 0;
	for (const [k, array] of arrays.entries()) {
		bin.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), at);
		// Every third array is a mesh's indices.
		const target = k % 3 === 2 ? ELEMENT_ARRAY_BUFFER : ARRAY_BUFFER;
		bufferViews.push({ buffer: 0, byteOffset: at, byteLength: array.byteLength, target });
		at += array.byteLength;
	}
	const materialNames = [...new Set(meshes.map((mesh) => mesh.material))];
	const json = {
		asset: { version: '2.0', generator: 'null3D desert benchmark' },
		scene: 0,
		scenes: [{ name: `desert-${file}`, nodes: meshes.map((_, k) => k) }],
		nodes: meshes.map(({ name }, k) => ({ name, mesh: k })),
		meshes: meshes.map(({ name, material }, k) => ({
			name,
			primitives: [
				{
					attributes: { POSITION: k * 3, NORMAL: k * 3 + 1 },
					indices: k * 3 + 2,
					material: materialNames.indexOf(material),
				},
			],
		})),
		materials: materialNames.map((name) => {
			const { color, roughness } = DESERT_MATERIALS[name];
			return {
				name,
				pbrMetallicRoughness: {
					baseColorFactor: [...color, 1],
					roughnessFactor: roughness,
					metallicFactor: 0,
				},
			};
		}),
		accessors: meshes.flatMap(({ data }, k) => [
			{
				bufferView: k * 3,
				componentType: FLOAT,
				count: data.positions.length / 3,
				type: 'VEC3',
				...bounds(data.positions),
			},
			{ bufferView: k * 3 + 1, componentType: FLOAT, count: data.normals.length / 3, type: 'VEC3' },
			{
				bufferView: k * 3 + 2,
				componentType: UNSIGNED_INT,
				count: data.indices.length,
				type: 'SCALAR',
			},
		]),
		bufferViews,
	};
	return writeGlb(json, bin);
}

// The build.

/** The sources whose bytes decide the raw files: the scene module and its imports, and this module. */
const RAW_SOURCES = ['../scenes/desert.ts', '../scenes/spec.ts', './desert-files.ts'].map((path) =>
	join(import.meta.dirname, path),
);

/** The key of the raw files: a hash of the sources that write them. */
export function rawKey(sources: readonly string[] = RAW_SOURCES): string {
	const hash = createHash('sha256');
	for (const path of sources) hash.update(readFileSync(path));
	return hash.digest('hex').slice(0, 16);
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Writes the raw files into `folder`, which appears whole or not at all. */
function writeRawFiles(folder: string): void {
	const staging = `${folder}.${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	for (const file of DESERT_FILES) {
		const meshes = meshesOf(file).map(({ name, material, build }) => ({
			name,
			material,
			data: build(),
		}));
		writeFileSync(join(staging, `${file}.glb`), desertGlb(file, meshes));
	}
	try {
		renameSync(staging, folder);
	} catch (error) {
		// Another build finished first: keep its folder.
		rmSync(staging, { recursive: true, force: true });
		if (!existsSync(folder)) throw error;
	}
}

/**
 * Builds the desert's files unless the caches hold them, writes the manifest, and returns it. The
 * raw files come from the scene module, and the null3D files from this checkout's asset tool.
 */
export async function ensureDesertFiles(root: string): Promise<DesertManifest> {
	const { cacheFolder, optimizedModel } = await import('../../packages/vite-plugin/src/assets.ts');
	const key = rawKey();
	const rawFolder = join(desertDir(root), `raw-${key}`);
	if (!existsSync(rawFolder)) writeRawFiles(rawFolder);
	const files: Record<string, DesertBuiltFile> = {};
	for (const file of DESERT_FILES) {
		const raw = join(rawFolder, `${file}.glb`);
		const model = await optimizedModel(root, raw, DESERT_ASSET_OPTIONS[file]);
		const optimized = join(cacheFolder(root), model.key, model.name);
		files[desertModelPath('raw', file)] = { path: raw, sha256: sha256(raw) };
		files[desertModelPath('null3d', file)] = { path: optimized, sha256: sha256(optimized) };
	}
	const manifest: DesertManifest = { key, files };
	const path = desertManifestPath(root);
	writeFileSync(`${path}.${process.pid}`, `${JSON.stringify(manifest, null, '\t')}\n`);
	renameSync(`${path}.${process.pid}`, path);
	return manifest;
}

/** The latest build's manifest, or null when no build wrote one. */
export function readDesertManifest(root: string): DesertManifest | null {
	const path = desertManifestPath(root);
	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as DesertManifest) : null;
}

/**
 * The file that serves an address under the desert's prefix, from a manifest, or a reason to refuse
 * it. A build that is missing, or a form or file that the scene does not name, is refused.
 */
export function desertFileFor(
	manifest: DesertManifest | null,
	url: string,
): { path: string; sha256: string } | { problem: string } {
	const address = url.split('?')[0] as string;
	const known = DESERT_FORMS.some((form: DesertForm) =>
		DESERT_FILES.some((file) => desertModelPath(form, file) === address),
	);
	if (!known) return { problem: `${address} is not a desert model file` };
	const built = manifest?.files[address];
	if (!built || !existsSync(built.path))
		return { problem: `${address} is not built: run bun bench/lib/desert-files.ts` };
	return built;
}

/**
 * Serves the desert's model files under their prefix, in the dev server and in `vite preview`. The
 * SHA-256 is the entity tag, so a browser keeps no file of an earlier build.
 */
export function desertServer(root: string): Plugin {
	const serve: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
		if (!req.url?.startsWith(DESERT_URL)) return next();
		const found = desertFileFor(readDesertManifest(root), req.url);
		if ('problem' in found) {
			res.statusCode = 404;
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.end(found.problem);
			return;
		}
		const tag = `"${found.sha256}"`;
		res.setHeader('ETag', tag);
		res.setHeader('Cache-Control', 'no-cache');
		if (req.headers['if-none-match'] === tag) {
			res.statusCode = 304;
			res.end();
			return;
		}
		res.setHeader('Content-Type', 'model/gltf-binary');
		res.setHeader('Content-Length', statSync(found.path).size);
		createReadStream(found.path).pipe(res);
	};
	return {
		name: 'null3d-desert-files',
		configureServer: (server) => void server.middlewares.use(serve),
		configurePreviewServer: (server) => void server.middlewares.use(serve),
	};
}

// `bun bench/lib/desert-files.ts` builds the desert's files, as the benchmark run does before it
// opens the scene's pages, and prints each file with its SHA-256.
if (import.meta.main) {
	const root = join(import.meta.dirname, '../..');
	const started = performance.now();
	const manifest = await ensureDesertFiles(root);
	for (const [address, { path, sha256: sum }] of Object.entries(manifest.files))
		console.log(`${address}: ${sum.slice(0, 16)} ${path}`);
	console.log(
		`The desert's files are built, in ${((performance.now() - started) / 1000).toFixed(1)} s`,
	);
}
