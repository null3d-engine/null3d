// The asset tool's steps for one model, which the assets optimize command and the Vite plugin
// share: read a glTF file, reorder, simplify and quantize its meshes, encode its textures to KTX2,
// compress its buffers with meshopt unless told not to, and write a binary glTF file with its
// texture files beside it. The same input and options give the same bytes on every machine.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, resolve } from 'node:path';
import { BufferUtils, Format, NodeIO } from '@gltf-transform/core';
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	KHRTextureBasisu,
} from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { VERSION } from '../version.js';
import { planLevels, quantizeMeshes, reorderMeshes, storeLevels } from './geometry.js';
import { MAX_TEXTURE_SIDE } from './images.js';
import { MSFTLod } from './lod-extension.js';
import { modelReport } from './report.js';
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
 * @property {number} maxTextureSize The largest side of a texture, a power of two up to 2048.
 * @property {TextureQuality} textureQuality
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
	maxTextureSize: MAX_TEXTURE_SIDE,
	textureQuality: 'size',
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
 * @property {ModelReport} report
 */

/** The `generator` that optimized files name. */
export const GENERATOR = `null3D asset tool ${VERSION}`;

/**
 * A reader and writer of glTF files with every extension that glTF-Transform knows, MSFT_lod and
 * the engine's own.
 */
async function glTFIO() {
	await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
	return new NodeIO()
		.registerExtensions([...ALL_EXTENSIONS, MSFTLod, Null3dOccluder, Null3dMeshBvh])
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
const DRACO = 'KHR_draco_mesh_compression';

/** Draco's decoder, loaded for the first file that holds Draco data. */
let dracoDecoder;

/**
 * Reads a model, and turns a reader's failure into a message that names the file. A model with
 * Draco data loads Draco's decoder first, so the tool rewrites it without Draco.
 *
 * @param {NodeIO} io
 * @param {string} path
 */
async function readModel(io, path) {
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
function tidyBuffers(doc) {
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
 * instead of held in the file.
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
	return BufferUtils.concat([header, ...chunks]);
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
			['EXT_meshopt_compression', DRACO, NULL3D_OCCLUDER, NULL3D_MESH_BVH].includes(
				extension.extensionName,
			)
		)
			extension.dispose();
	await reorderMeshes(doc);
	const levels = options.lod ? await planLevels(doc) : new Map();
	quantizeMeshes(doc);
	storeLevels(doc, levels);
	const spatial = addSpatialData(doc, {
		blockers: options.blockers,
		bvhMinTriangles: options.bvh > 0 ? options.bvh : Number.POSITIVE_INFINITY,
	});
	const { files, records, uris } = await encodeTextures(doc, {
		encode,
		maxSide: options.maxTextureSize,
		quality: options.textureQuality,
		folder: options.textureFolder,
	});
	// glTF names a KTX2 image only through KHR_texture_basisu. Readers that follow the rules, such
	// as three.js's GLTFLoader, refuse a KTX2 image that a texture names directly.
	if (uris.size > 0) doc.createExtension(KHRTextureBasisu).setRequired(true);
	tidyBuffers(doc);
	if (options.meshopt)
		doc
			.createExtension(EXTMeshoptCompression)
			.setRequired(true)
			.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
	const glb = await writeGlb(io, doc, uris);
	const report = modelReport(doc, {
		name: basename(path),
		inputBytes,
		modelBytes: glb.byteLength,
		textures: records,
		files,
		lodMeshes: levels.size,
		spatial,
		ms: performance.now() - start,
	});
	return { glb, files, report };
}
