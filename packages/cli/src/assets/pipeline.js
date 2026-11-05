// The asset tool's steps for one model, which the assets optimize command and the Vite plugin
// share: read a glTF file, put its clips on the engine's frames, merge its equal parts, simplify,
// reorder and quantize its meshes, plan their levels of detail, encode its textures to KTX2,
// compress its buffers with meshopt unless told not to, and write a binary glTF file with its
// texture files beside it. The same input and options
// give the same bytes on every machine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, resolve } from 'node:path';
import { BufferUtils, Format, NodeIO } from '@gltf-transform/core';
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { MeshoptClusterizer, MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { VERSION } from '../version.js';
import { bakeClips, MeshoptWithRotationFilter } from './clips.js';
import { NULL3D_CLUSTERS, Null3dClusters } from './cluster-extension.js';
import { bandClusters, clusterSummary, planClusters, storeClusters } from './clusters.js';
import { dedup, dedupAccessors } from './dedup.js';
import { quantizeMeshes, reorderMeshes } from './geometry.js';
import { MAX_TEXTURE_SIDE } from './images.js';
import {
	orderLevels,
	planLevels,
	SIMPLIFY_MAX_ERROR,
	simplifyMeshes,
	storeLevels,
	storeStages,
} from './levels.js';
import { lodOf, MSFTLod } from './lod-extension.js';
import { NULL3D_PIECES, Null3dPieces, storePieces } from './pieces-extension.js';
import { modelReport, shownBytes } from './report.js';
import { shaderList, writeShaderList } from './shaders.js';
import { addSpatialData, BVH_MIN_TRIANGLES } from './spatial.js';
import {
	NULL3D_MESH_BVH,
	NULL3D_OCCLUDER,
	Null3dMeshBvh,
	Null3dOccluder,
} from './spatial-extensions.js';
import { encodeTextures, TEXTURE_FOLDER } from './textures.js';

/** @import { Document } from '@gltf-transform/core' */
/** @import { EncodedTexture, TextureJob } from './encoder.js' */
/** @import { ModelReport } from './report.js' */
/** @import { TextureQuality } from './textures.js' */

/**
 * @typedef {object} OptimizeOptions
 * @property {boolean} lod Make levels of detail.
 * @property {boolean} stages Write the levels of detail as separate downloads beside the model,
 *   so the engine draws the coarsest level first and refines it as the rest arrive. It needs
 *   `lod`.
 * @property {boolean} clusters Make trees of cluster patches, and give each mesh with a tree whole
 *   levels of detail too, for a viewer that draws no patches.
 * @property {number} simplify The share of each mesh's triangles to keep, from 0 to 1, as far
 *   as the error limit allows. 1 keeps them all.
 * @property {number} simplifyError The largest error of that simplification, as a share of each
 *   mesh's longest side.
 * @property {number} maxTextureSize The largest side of a texture, a power of two up to 2048.
 * @property {TextureQuality} textureQuality
 * @property {boolean} roughnessBake Add the detail of each material's normal map to the roughness
 *   levels of its metal-rough map, which then takes UASTC. The default is true.
 * @property {boolean} meshopt Compress the model's buffers with meshopt, which the engine decodes
 *   losslessly on load. The default is true.
 * @property {boolean} blockers Give each mesh that encloses space a blocker mesh for software
 *   occlusion culling. The default is true.
 * @property {number} bvh The fewest triangles of a mesh part whose tree for raycasts the file
 *   stores, or 0 for none.
 * @property {string} textureFolder The address of the texture files' folder from the model.
 */

/** The options that a command gives when it says nothing. */
export const DEFAULT_OPTIONS = /** @type {const} */ ({
	lod: false,
	stages: false,
	clusters: false,
	simplify: 1,
	simplifyError: SIMPLIFY_MAX_ERROR,
	maxTextureSize: MAX_TEXTURE_SIDE,
	textureQuality: 'size',
	roughnessBake: true,
	meshopt: true,
	blockers: true,
	bvh: BVH_MIN_TRIANGLES,
	textureFolder: TEXTURE_FOLDER,
});

/**
 * @typedef {object} OptimizedModel
 * @property {Uint8Array} glb The binary glTF file.
 * @property {Map<string, Uint8Array>} files The texture files, by their names in the texture
 *   folder.
 * @property {Map<string, Uint8Array>} stages The stage files of the levels, by their names beside
 *   the model.
 * @property {ModelReport} report
 */

/** The `generator` that optimized files name. */
export const GENERATOR = `null3D asset tool ${VERSION}`;

/**
 * A reader and writer of glTF files with every extension that glTF-Transform knows, MSFT_lod and
 * the engine's own.
 */
export async function glTFIO() {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptClusterizer.ready]);
	return new NodeIO()
		.registerExtensions([
			...ALL_EXTENSIONS,
			MSFTLod,
			Null3dOccluder,
			Null3dMeshBvh,
			Null3dClusters,
			Null3dPieces,
		])
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/**
 * The files that a `.gltf` file names by address: its buffers and images. A binary file names
 * none that it needs.
 *
 * @param {string} path
 * @returns {string[]}
 */
export function namedFiles(path) {
	if (extname(path).toLowerCase() !== '.gltf') return [];
	const json = JSON.parse(readFileSync(path, 'utf8'));
	return [...(json.buffers ?? []), ...(json.images ?? [])]
		.map((entry) => entry.uri)
		.filter((uri) => typeof uri === 'string' && !uri.startsWith('data:'))
		.map((uri) => resolve(dirname(path), decodeURIComponent(uri)));
}

/** The name of Draco's extension, which a file that holds Draco data names in its JSON. */
export const DRACO = 'KHR_draco_mesh_compression';

/** Draco's decoder, loaded for the first file that holds Draco data. */
let dracoDecoder;

/**
 * Reads a model, and turns a reader's failure into a message that names the file. A model with
 * Draco data loads Draco's decoder first, so the tool rewrites it without Draco.
 *
 * @param {NodeIO} io
 * @param {string} path
 */
export async function readModel(io, path) {
	const json = extname(path).toLowerCase() === '.gltf' ? readFileSync(path) : glbJson(path);
	if (json.includes(DRACO)) {
		dracoDecoder ??= createRequire(import.meta.url)('draco3d').createDecoderModule();
		io.registerDependencies({ 'draco3d.decoder': await dracoDecoder });
	}
	try {
		return await io.read(path);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`${basename(path)} is not a glTF file the tool can read: ${message}`);
	}
}

/**
 * The JSON chunk of a binary glTF file, or nothing for a file too short to have one.
 *
 * @param {string} path
 */
function glbJson(path) {
	const bytes = readFileSync(path);
	if (bytes.byteLength < 20) return Buffer.alloc(0);
	return bytes.subarray(20, 20 + bytes.readUInt32LE(12));
}

/**
 * Moves every accessor into the document's first buffer and drops the others, since a binary
 * glTF file holds one buffer. Drops accessors that nothing uses, such as those that a step
 * replaced.
 *
 * @param {Document} doc
 */
export function tidyBuffers(doc) {
	const root = doc.getRoot();
	const [first, ...rest] = root.listBuffers();
	const buffer = first ?? doc.createBuffer();
	for (const accessor of root.listAccessors()) {
		const used = doc
			.getGraph()
			.listParentEdges(accessor)
			.some((edge) => edge.getName() !== 'accessors');
		if (!used) accessor.dispose();
		else accessor.setBuffer(buffer);
	}
	for (const extra of rest) extra.dispose();
	buffer.setURI('');
}

/**
 * A binary glTF file from a document, with each encoded texture named by its file's address
 * instead of held in the file, and the file's JSON.
 *
 * @param {NodeIO} io
 * @param {Document} doc
 * @param {Map<import('@gltf-transform/core').Texture, string>} uris
 */
async function writeGlb(io, doc, uris) {
	const { json, resources } = await io.writeJSON(doc, { format: Format.GLB });
	doc
		.getRoot()
		.listTextures()
		.forEach((texture, i) => {
			const uri = uris.get(texture);
			const image = json.images?.[i];
			if (uri && image) {
				image.uri = uri;
				delete image.mimeType;
			}
		});
	const text = BufferUtils.pad(BufferUtils.encodeText(JSON.stringify(json)), 32);
	const bin = Object.values(resources)[0];
	const chunks = [chunk(text, 0x4e4f534a)];
	if (bin && bin.byteLength > 0) chunks.push(chunk(BufferUtils.pad(bin, 0), 0x004e4942));
	const length = 12 + chunks.reduce((sum, c) => sum + c.byteLength, 0);
	const header = new Uint8Array(12);
	const view = new DataView(header.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, length, true);
	return { glb: BufferUtils.concat([header, ...chunks]), json };
}

/** Bytes in a mebibyte. */
const MIB = 1024 * 1024;

/**
 * The engine's limits on what one model file may decode to: the most bytes of one array, and the
 * floor, ratio and cap of the whole file's total. They are `FILE_LIMITS` in the engine's
 * `scene/file-limits.ts`, and a test keeps the two equal.
 */
export const ENGINE_FILE_LIMITS = Object.freeze({
	itemBytes: 256 * MIB,
	modelFloorBytes: 64 * MIB,
	modelRatio: 32,
	modelCapBytes: 1024 * MIB,
});

/** The bytes of each glTF component type. */
const COMPONENT_BYTES = new Map([
	[5120, 1],
	[5121, 1],
	[5122, 2],
	[5123, 2],
	[5125, 4],
	[5126, 4],
]);

/** The values of each glTF accessor type. */
const TYPE_VALUES = new Map([
	['SCALAR', 1],
	['VEC2', 2],
	['VEC3', 3],
	['VEC4', 4],
	['MAT2', 4],
	['MAT3', 9],
	['MAT4', 16],
]);

/**
 * What the engine's loader decodes a file to, from the file's JSON, as it takes the bytes from the
 * file's budget: a copy of each accessor, each block of meshopt data, each image that the file
 * holds, 8-bit index lists widened to 16 bits, and the indices of each blocker widened to 32 bits.
 * It leaves out the small costs of skins and clips.
 *
 * @param {import('@gltf-transform/core').GLTF.IGLTF} json
 * @returns {{ total: number, largest: { accessor: number, bytes: number } }}
 */
export function decodedBytes(json) {
	const accessors = json.accessors ?? [];
	const views = json.bufferViews ?? [];
	/** @param {number | undefined} k */
	const bytesOf = (k) => {
		const accessor = k === undefined ? undefined : accessors[k];
		if (!accessor) return 0;
		return (
			accessor.count *
			(TYPE_VALUES.get(accessor.type) ?? 0) *
			(COMPONENT_BYTES.get(accessor.componentType) ?? 0)
		);
	};
	let total = 0;
	const largest = { accessor: -1, bytes: 0 };
	accessors.forEach((_, k) => {
		const bytes = bytesOf(k);
		total += bytes;
		if (bytes > largest.bytes) Object.assign(largest, { accessor: k, bytes });
	});
	for (const view of views) {
		const meshopt = /** @type {{ count: number, byteStride: number } | undefined} */ (
			view.extensions?.EXT_meshopt_compression ?? view.extensions?.KHR_meshopt_compression
		);
		if (meshopt) total += meshopt.count * meshopt.byteStride;
	}
	for (const image of json.images ?? [])
		if (image.bufferView !== undefined) total += views[image.bufferView]?.byteLength ?? 0;
	for (const mesh of json.meshes ?? [])
		for (const primitive of mesh.primitives) {
			const indices = primitive.indices === undefined ? undefined : accessors[primitive.indices];
			if (indices?.componentType === 5121) total += indices.count * 2;
			const blocker = /** @type {{ indices?: number } | undefined} */ (
				primitive.extensions?.[NULL3D_OCCLUDER]
			);
			if (blocker?.indices !== undefined) total += (accessors[blocker.indices]?.count ?? 0) * 4;
		}
	return { total, largest };
}

/**
 * Throws when the engine would refuse to load the file whose JSON is `json` and whose length is
 * `fileBytes`: an accessor larger than one array may be, or a file that decodes to more than a
 * file of its size may. A scene that large loads as several files.
 *
 * @param {import('@gltf-transform/core').GLTF.IGLTF} json
 * @param {number} fileBytes
 */
export function refuseWhatTheEngineRefuses(json, fileBytes) {
	const limits = ENGINE_FILE_LIMITS;
	const { total, largest } = decodedBytes(json);
	const advice =
		'Split the scene into several files, each with a part of its meshes, and load each one with assets.loadGltf()';
	if (largest.bytes > limits.itemBytes)
		throw new Error(
			`the engine would refuse the output: accessor ${largest.accessor} holds ${shownBytes(largest.bytes)}, more than the ${shownBytes(limits.itemBytes)} that one array may hold. ${advice}, or simplify the mesh that holds it with --simplify.`,
		);
	const allowance = Math.min(
		limits.modelCapBytes,
		limits.modelFloorBytes + limits.modelRatio * fileBytes,
	);
	if (total > allowance)
		throw new Error(
			`the engine would refuse the output: it decodes to ${shownBytes(total)}, more than the ${shownBytes(allowance)} that one model file may decode to. ${advice}.`,
		);
}

/**
 * A chunk of a binary glTF file: its length, its type and its data.
 *
 * @param {Uint8Array} data
 * @param {number} type
 */
function chunk(data, type) {
	const head = new Uint8Array(8);
	const view = new DataView(head.buffer);
	view.setUint32(0, data.byteLength, true);
	view.setUint32(4, type, true);
	return BufferUtils.concat([head, data]);
}

/**
 * Optimizes one model.
 *
 * @param {string} path A `.glb` or `.gltf` file.
 * @param {OptimizeOptions} options
 * @param {(job: TextureJob) => Promise<EncodedTexture>} encode Encodes a texture, as a pool of
 *   encoder threads does.
 * @returns {Promise<OptimizedModel>}
 */
export async function optimizeModel(path, options, encode) {
	const start = performance.now();
	const io = await glTFIO();
	const doc = await readModel(io, path);
	const inputBytes = [path, ...namedFiles(path)].reduce(
		(sum, file) => sum + readFileSync(file).byteLength,
		0,
	);
	doc.getRoot().getAsset().generator = GENERATOR;
	// Compression, blockers and trees of the input stay out of the output: the steps below make
	// their own.
	for (const extension of doc.getRoot().listExtensionsUsed())
		if (
			[
				'EXT_meshopt_compression',
				DRACO,
				NULL3D_OCCLUDER,
				NULL3D_MESH_BVH,
				NULL3D_CLUSTERS,
				NULL3D_PIECES,
			].includes(extension.extensionName)
		)
			extension.dispose();
	bakeClips(doc);
	const merged = dedup(doc);
	if (options.simplify < 1) await simplifyMeshes(doc, options.simplify, options.simplifyError);
	await reorderMeshes(doc);
	quantizeMeshes(doc);
	// The trees are planned before the levels: a mesh with a tree gets whole levels for the viewers
	// that draw no patches, and the levels' new vertex order renames the trees' indices too.
	const clusters = options.clusters ? await planClusters(doc) : new Map();
	const levels =
		options.lod || clusters.size > 0 ? await planLevels(doc, clusters, options.lod) : new Map();
	if (levels.size > 0) orderLevels(doc, levels, clusters);
	/** What each tree holds, which the report reads before the bands cut it away. */
	const trees = clusterSummary([...clusters.values()]);
	/** @type {Map<string, Uint8Array>} */
	const stages = new Map();
	const prefix = basename(path, extname(path));
	if (options.stages) {
		// Each tree streams its bands after the one that the file holds, so the file draws that first
		// band at once. A mesh's whole levels stay in the file for the paths that draw it whole.
		if (clusters.size > 0) bandClusters(doc, clusters, stages, prefix);
		if (levels.size > 0) storeStages(doc, levels, stages, prefix, clusters);
		else storeLevels(doc, levels);
	} else storeLevels(doc, levels);
	// Each large list of a mesh with levels sorts its triangles into pieces, which a viewer that
	// draws many copies culls one by one. Raycast trees read triangles by their place, so they
	// come after.
	storePieces(doc);
	storeClusters(doc, clusters);
	merged.accessors = dedupAccessors(doc);
	const spatial = addSpatialData(doc, {
		blockers: options.blockers,
		bvhMinTriangles: options.bvh > 0 ? options.bvh : Number.POSITIVE_INFINITY,
	});
	const { files, records, uris, skipped } = await encodeTextures(doc, {
		encode,
		maxSide: options.maxTextureSize,
		quality: options.textureQuality,
		folder: options.textureFolder,
		roughnessBake: options.roughnessBake,
	});
	// glTF names a KTX2 image only through KHR_texture_basisu. Readers that follow the rules, such
	// as three.js's GLTFLoader, refuse a KTX2 image that a texture names directly.
	if (uris.size > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
	// The list of shader features and permutation bits that this model needs, recorded with the
	// file for the engine. Every step that changes what the model draws has run by now.
	const shaders = shaderList(doc, { lodOf });
	writeShaderList(doc, shaders);
	tidyBuffers(doc);
	if (options.meshopt)
		doc
			.createExtension(MeshoptWithRotationFilter)
			.setRequired(true)
			.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
	const { glb, json } = await writeGlb(io, doc, uris);
	refuseWhatTheEngineRefuses(json, glb.byteLength);
	const report = modelReport(doc, {
		name: basename(path),
		inputBytes,
		modelBytes: glb.byteLength,
		textures: records,
		unbaked: skipped,
		files,
		stages,
		levels: [...levels.values()],
		clusters: trees,
		merged,
		spatial,
		shaders,
		ms: performance.now() - start,
	});
	return { glb, files, stages, report };
}
