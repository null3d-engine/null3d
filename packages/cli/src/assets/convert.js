// null3d assets convert: turns models from other formats into binary glTF files that the engine
// loads. A .gltf file with its buffers and images becomes one .glb file, as it is. A file whose
// meshes are Draco-compressed gets meshopt compression instead, which the engine decodes in its
// own worker. OBJ, FBX, STL and PLY files become glTF scenes. The same input gives the same bytes
// on every machine.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { readArguments, UsageError } from '../args.js';
import { counted, shownPath } from '../text.js';
import { mtlFiles, readUfbx, ufbxDocument } from './fbx.js';
import { quantizeMeshes, reorderMeshes } from './geometry.js';
import { DRACO, GENERATOR, glTFIO, namedFiles, readModel, tidyBuffers } from './pipeline.js';
import { plyDocument } from './ply.js';
import { shownBytes } from './report.js';
import { stlDocument } from './stl.js';

/** @import { Document } from '@gltf-transform/core' */

/** The input formats, by file extension. */
export const INPUTS = /** @type {const} */ (['.gltf', '.glb', '.obj', '.fbx', '.stl', '.ply']);

/** The meshopt extension, which a file of compressed buffers names. */
const MESHOPT = 'EXT_meshopt_compression';

const OPTIONS = /** @type {const} */ ({
	compression: { type: 'string' },
	help: { type: 'boolean', short: 'h', default: false },
});

export const HELP = `Usage: bunx @null3d/cli assets convert <input> <output.glb> [options]

Converts a model to a binary glTF file, which the engine loads:

  .gltf  The file, its buffers and its images become one .glb file, as they are.
  .glb   A file whose meshes are Draco-compressed gets meshopt compression instead, which the
         engine decodes in its own worker.
  .obj   With the materials of its MTL files and its textures, from beside the file.
  .fbx   Binary and text FBX from version 3000, with materials, textures, skins, blend shapes
         and clips. Clips are baked to keys at up to 30 a second.
  .stl   Binary and text STL, one mesh per solid, flat shaded.
  .ply   Text and binary PLY, with normals, colors and texture coordinates. A file without
         faces becomes points.

OBJ and FBX materials become glTF's metal-rough materials. Separate roughness, metalness and
occlusion maps join into one texture, as assets pack-orm packs them, and a bump map, or a gray
image in a normal map's place, becomes a normal map, as assets normal-from-bump makes one.
Textures go into the file as PNG and JPEG images; TGA images become PNG. Cameras and lights
are left out. Units become meters, and Y points up.

The output keeps the input's texture images. Run assets optimize on it to quantize its meshes
and encode its textures for the GPU.

Options:
  --compression <none|meshopt> meshopt stores vertices as integers and compresses the buffers
                               (EXT_meshopt_compression), as assets optimize does; none leaves
                               them as floats (meshopt for a Draco or meshopt input, else none)`;

/**
 * @typedef {object} ConvertArgs
 * @property {string} input
 * @property {string} output
 * @property {'none' | 'meshopt' | undefined} compression Undefined keeps the input's kind.
 * @property {boolean} help
 */

/**
 * The arguments that `args` gives the command.
 *
 * @param {readonly string[]} args
 * @returns {ConvertArgs}
 */
export function parseConvertArgs(args) {
	const { values, positionals } = readArguments(args, OPTIONS, true);
	if (values.help) return { input: '', output: '', compression: undefined, help: true };
	if (positionals.length !== 2)
		throw new UsageError(
			`it takes an input model and an output .glb file, not ${counted(positionals.length, 'argument')}`,
		);
	const compression = values.compression;
	if (compression !== undefined && compression !== 'none' && compression !== 'meshopt')
		throw new UsageError(`--compression takes none or meshopt, not "${compression}"`);
	const input = resolve(/** @type {string} */ (positionals[0]));
	const output = resolve(/** @type {string} */ (positionals[1]));
	if (!INPUTS.includes(/** @type {never} */ (extname(input).toLowerCase())))
		throw new UsageError(
			`its input must be a ${INPUTS.slice(0, -1).join(', ')} or ${INPUTS.at(-1)} file, not ${shownPath(input)}`,
		);
	if (!/\.glb$/i.test(output))
		throw new UsageError(`its output must be a .glb file, not ${shownPath(output)}`);
	return { input, output, compression, help: false };
}

/**
 * A model as a glTF document, read by its format.
 *
 * @param {string} path
 * @param {string[]} notes Gets a line for each part that the document leaves out.
 * @returns {Promise<{ doc: Document, compressed: boolean }>}
 */
export async function readSource(path, notes) {
	const kind = extname(path).toLowerCase();
	const name = basename(path, extname(path));
	if (kind === '.gltf' || kind === '.glb') {
		const doc = await readModel(await glTFIO(), path);
		const used = doc.getRoot().listExtensionsUsed();
		const compressed = used.some((e) => [DRACO, MESHOPT].includes(e.extensionName));
		for (const extension of used)
			if ([DRACO, MESHOPT].includes(extension.extensionName)) extension.dispose();
		return { doc, compressed };
	}
	const bytes = new Uint8Array(readFileSync(path));
	if (kind === '.stl') return { doc: stlDocument(bytes, name), compressed: false };
	if (kind === '.ply') return { doc: plyDocument(bytes, name), compressed: false };
	const obj = kind === '.obj';
	const mtl = obj ? mtlFiles(bytes, dirname(path), notes) : undefined;
	const { scene, bin } = await readUfbx(bytes, { obj, ...(mtl && { mtl }) });
	return { doc: ufbxDocument(scene, bin, dirname(path), notes), compressed: false };
}

/**
 * Converts a model, and returns the binary glTF file with the notes of what it left out.
 *
 * @param {string} path
 * @param {{ compression?: 'none' | 'meshopt' }} [options] Without a compression, the output
 *   takes meshopt when the input was compressed.
 */
export async function convertModel(path, options = {}) {
	/** @type {string[]} */
	const notes = [];
	const { doc, compressed } = await readSource(path, notes);
	doc.getRoot().getAsset().generator = GENERATOR;
	const meshopt = (options.compression ?? (compressed ? 'meshopt' : 'none')) === 'meshopt';
	if (meshopt) {
		await reorderMeshes(doc);
		quantizeMeshes(doc);
	}
	tidyBuffers(doc);
	if (meshopt)
		doc
			.createExtension(EXTMeshoptCompression)
			.setRequired(true)
			.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
	const glb = await (await glTFIO()).writeBinary(doc);
	return { glb, doc, notes, meshopt };
}

/**
 * Runs the command, and returns its exit code.
 *
 * @param {readonly string[]} args
 * @returns {Promise<number>}
 */
export async function run(args) {
	const { input, output, compression, help } = parseConvertArgs(args);
	if (help) {
		console.log(HELP);
		return 0;
	}
	try {
		statSync(input);
	} catch {
		throw new UsageError(`its input ${shownPath(input)} does not exist`);
	}
	const start = performance.now();
	let result;
	try {
		result = await convertModel(input, compression ? { compression } : {});
	} catch (error) {
		console.error(`${shownPath(input)}: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
	const { glb, doc, notes, meshopt } = result;
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, glb);
	const root = doc.getRoot();
	const inputBytes = [input, ...namedFiles(input)].reduce(
		(sum, file) => sum + statSync(file).size,
		0,
	);
	const triangles = root
		.listMeshes()
		.flatMap((mesh) => mesh.listPrimitives())
		.reduce((sum, prim) => {
			if (prim.getMode() !== 4) return sum;
			const corners = (prim.getIndices() ?? prim.getAttribute('POSITION'))?.getCount() ?? 0;
			return sum + corners / 3;
		}, 0);
	console.log(
		[
			`${shownPath(input)} to ${shownPath(output)}: ${shownBytes(inputBytes)} to ${shownBytes(glb.byteLength)}${meshopt ? ', meshopt' : ''}, in ${((performance.now() - start) / 1000).toFixed(1)} s`,
			`  ${[
				`${root.listMeshes().length} mesh${root.listMeshes().length === 1 ? '' : 'es'}`,
				counted(triangles, 'triangle'),
				counted(root.listMaterials().length, 'material'),
				counted(root.listTextures().length, 'texture'),
				counted(root.listSkins().length, 'skin'),
				counted(root.listAnimations().length, 'clip'),
			].join(', ')}`,
			...notes.map((note) => `  note: ${note}`),
		].join('\n'),
	);
	return 0;
}
