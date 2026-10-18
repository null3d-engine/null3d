// The shader list of an optimized model: the permutation bits and the first-use shader files that
// the model's draws need. The tool records the list with the file, so the engine downloads exactly
// those shader files while it loads and builds only those pipelines. The engine compares every
// name against its own tables, so a name that this file names wrongly shows there.
//
// The bits are the ones an asset itself turns on. Bits that a device fixes (DRAW_INDEX, TONE_MAP
// and HALF) and bits that the scene decides during play (RECEIVE_SHADOWS, PREPASS, FXAA, BLOOM
// and the rest) are not part of a file's list.
import {
	KHRMaterialsClearcoat,
	KHRMaterialsSheen,
	KHRMaterialsTransmission,
} from '@gltf-transform/extensions';

/** The asset field that holds the list, beside the engine's other fields in `asset.extras`. */
export const NULL3D_SHADERS = 'NULL3D_shaders';

/**
 * The permutation bits that an asset can turn on, in the engine's bit order, as
 * `permutation::NAMES` of `crates/null3d-gpu/src/drawlist.rs` gives them. A test keeps this list
 * a subset of the engine's names. A bit that no glTF file decides, such as ROW_VALUES, is not
 * here.
 */
export const ASSET_PERMUTATIONS = /** @type {const} */ ([
	'VERTEX_COLOR',
	'ALPHA_MASK',
	'VERTEX_TANGENT',
	'SKIN',
	'MORPH',
	'TRANSMISSION',
	'LOD_FADE',
	'COAT_SHEEN',
]);

/**
 * The first-use shader files that an asset can need, as the `[first_use.<feature>]` tables of
 * `crates/null3d-shaders/shaders.toml` name them. A test keeps this list a subset of the engine's
 * features. A feature that no glTF file decides, such as `bloom`, is not here.
 */
export const ASSET_SHADER_FILES = /** @type {const} */ ([
	'cutout',
	'coverage',
	'lod_fade',
	'morph',
	'skinning',
	'transmission',
	'coat_sheen',
]);

/**
 * The mesh templates an asset's draws use, as the shaders of `shaders.toml` name them. A test
 * keeps each name a template the engine builds.
 */
export const ASSET_TEMPLATES = /** @type {const} */ ([
	'lit',
	'standard_maps',
	'unlit',
	'unlit_map',
]);

/**
 * @typedef {object} DrawBucket One pipeline key that the model's draws need: the template, the
 *   mesh's vertex format and the permutation bits the material turns on. Every object that draws
 *   with the key shares one pipeline.
 * @property {string} template
 * @property {string} format The vertex format, such as `uv0+color`, or `position` with none.
 * @property {string[]} permutations
 * @property {string} key The three above as one name for the report.
 * @property {number} objects The objects, instances included, that draw with the key.
 */

/**
 * @typedef {object} ShaderList The list the tool records with a model.
 * @property {string[]} permutations The permutation bits, in the engine's bit order.
 * @property {string[]} features The first-use shader files, in name order.
 * @property {DrawBucket[]} buckets The pipeline keys, most objects first.
 */

/** The maps whose presence makes a lit material use the template with maps. */
const MAP_SLOTS = /** @type {const} */ ([
	'getBaseColorTexture',
	'getMetallicRoughnessTexture',
	'getNormalTexture',
	'getOcclusionTexture',
	'getEmissiveTexture',
]);

/**
 * The material's maps that the file holds, as glTF-Transform's material gives them.
 *
 * @param {import('@gltf-transform/core').Material | null} material
 */
function hasMap(material, /** @type {(typeof MAP_SLOTS)[number]} */ slot) {
	return material !== null && material[slot]() !== null;
}

/**
 * True when the material lets light through: KHR_materials_transmission's factor is above 0.
 *
 * @param {import('@gltf-transform/core').Material | null} material
 */
function transmits(material) {
	const extension = /** @type {{ getTransmissionFactor(): number } | null} */ (
		material?.getExtension(KHRMaterialsTransmission.EXTENSION_NAME) ?? null
	);
	return extension !== null && extension.getTransmissionFactor() > 0;
}

/**
 * True when the material has a clear coat or a sheen: it holds KHR_materials_clearcoat or
 * KHR_materials_sheen, as the engine's glTF reader gives the material the layers then.
 *
 * @param {import('@gltf-transform/core').Material | null} material
 */
function layered(material) {
	const coat = material?.getExtension(KHRMaterialsClearcoat.EXTENSION_NAME) ?? null;
	const sheen = material?.getExtension(KHRMaterialsSheen.EXTENSION_NAME) ?? null;
	return coat !== null || sheen !== null;
}

/**
 * The mesh's vertex format, as a name of the attributes that it holds, in the engine's order.
 *
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {boolean} morph
 */
function formatOf(prim, morph) {
	const names = /** @type {const} */ ([
		['TEXCOORD_0', 'uv0'],
		['TEXCOORD_1', 'uv1'],
		['TANGENT', 'tangent'],
		['COLOR_0', 'color'],
		['JOINTS_0', 'joints'],
		['WEIGHTS_0', 'weights'],
	]);
	/** @type {string[]} */
	const held = names
		.filter(([attribute]) => prim.getAttribute(attribute) !== null)
		.map(([, name]) => name);
	if (morph) held.push('morph');
	return held.join('+');
}

/**
 * The template that draws a primitive, as the engine picks it from the material and the mesh:
 * an unlit material with its base color map draws with `unlit_map`, any other lit material with a
 * map and texture coordinates with `standard_maps`, and the rest with `lit` or `unlit`.
 *
 * @param {import('@gltf-transform/core').Primitive} prim
 * @param {import('@gltf-transform/core').Material | null} material
 */
function templateOf(prim, material) {
	const unlit = material !== null && material.getExtension('KHR_materials_unlit') !== null;
	const uvs = prim.getAttribute('TEXCOORD_0') !== null;
	if (unlit) return uvs && hasMap(material, 'getBaseColorTexture') ? 'unlit_map' : 'unlit';
	if (!uvs) return 'lit';
	return MAP_SLOTS.some((slot) => hasMap(material, slot)) ? 'standard_maps' : 'lit';
}

/**
 * The permutation bits and shader files that one drawn primitive needs.
 *
 * @param {object} draw
 * @param {import('@gltf-transform/core').Primitive} draw.prim
 * @param {import('@gltf-transform/core').Material | null} draw.material
 * @param {boolean} draw.skinned
 * @param {boolean} draw.levels
 * @returns {{ bits: string[], files: string[] }}
 */
function needsOf({ prim, material, skinned, levels }) {
	const bits = [];
	const files = [];
	const morph = prim.listTargets().length > 0;
	const masked = material?.getAlphaMode() === 'MASK';
	if (prim.getAttribute('COLOR_0') !== null) bits.push('VERTEX_COLOR');
	if (masked) bits.push('ALPHA_MASK');
	if (hasMap(material, 'getNormalTexture') && prim.getAttribute('TANGENT') !== null)
		bits.push('VERTEX_TANGENT');
	if (skinned) bits.push('SKIN');
	if (morph) bits.push('MORPH');
	if (transmits(material)) bits.push('TRANSMISSION');
	if (levels) bits.push('LOD_FADE');
	if (layered(material)) bits.push('COAT_SHEEN');
	if (skinned) files.push('skinning');
	if (morph) files.push('morph');
	// A masked material's edges fade by alpha to coverage on a page that draws with MSAA, as the
	// engine's materials from glTF files do by default.
	if (masked) files.push('cutout', 'coverage');
	if (transmits(material)) files.push('transmission');
	if (levels) files.push('lod_fade');
	if (layered(material)) files.push('coat_sheen');
	return { bits, files };
}

/**
 * The shader list of a document, after every step that changes what it draws: the permutation
 * bits, the first-use shader files and the pipeline keys of its draws.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ lodOf: (node: import('@gltf-transform/core').Node) => unknown }} levels `lodOf` of
 *   `lod-extension.js`, which says whether a node holds levels of detail.
 * @returns {ShaderList}
 */
export function shaderList(doc, { lodOf }) {
	const bits = new Set();
	const files = new Set();
	/** @type {Map<string, DrawBucket>} */
	const buckets = new Map();
	/**
	 * Counts one node's draws, once per object, with each instance of an instancing node.
	 *
	 * @param {import('@gltf-transform/core').Node} node
	 */
	const visit = (node) => {
		const mesh = node.getMesh();
		if (mesh) {
			const skinned = node.getSkin() !== null;
			const levels = lodOf(node) !== null;
			const instancing = /** @type {any} */ (node.getExtension('EXT_mesh_gpu_instancing'));
			const objects = instancing ? (instancing.listAttributes()[0]?.getCount() ?? 0) : 1;
			for (const prim of mesh.listPrimitives()) {
				if (prim.getMode() !== 4) continue;
				const material = prim.getMaterial();
				const { bits: own, files: needed } = needsOf({ prim, material, skinned, levels });
				const template = templateOf(prim, material);
				const format = formatOf(prim, prim.listTargets().length > 0);
				const key = `${template} ${format || 'position'} ${
					ASSET_PERMUTATIONS.filter((bit) => own.includes(bit)).join('+') || 'plain'
				}`;
				const bucket = buckets.get(key) ?? { template, format, permutations: own, key, objects: 0 };
				bucket.objects += objects;
				buckets.set(key, bucket);
				for (const bit of own) bits.add(bit);
				for (const file of needed) files.add(file);
			}
		}
		for (const child of node.listChildren()) visit(child);
	};
	for (const scene of doc.getRoot().listScenes())
		for (const node of scene.listChildren()) visit(node);
	return {
		permutations: ASSET_PERMUTATIONS.filter((bit) => bits.has(bit)),
		features: ASSET_SHADER_FILES.filter((file) => files.has(file)),
		buckets: [...buckets.values()].sort(
			(a, b) => b.objects - a.objects || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
		),
	};
}

/**
 * Records the list with the document, under `asset.extras.NULL3D_shaders`, where the engine reads
 * it when it loads the file.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {ShaderList} list
 */
export function writeShaderList(doc, list) {
	const asset = doc.getRoot().getAsset();
	const extras = /** @type {Record<string, unknown>} */ (asset.extras ?? {});
	extras[NULL3D_SHADERS] = { permutations: list.permutations, features: list.features };
	asset.extras = extras;
}

/**
 * The list that a document already holds, or null when it holds none.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {{ permutations: string[], features: string[] } | null}
 */
export function recordedShaderList(doc) {
	const extras = /** @type {Record<string, unknown>} */ (doc.getRoot().getAsset().extras ?? {});
	const held = /** @type {any} */ (extras[NULL3D_SHADERS]);
	if (typeof held !== 'object' || held === null) return null;
	return {
		permutations: Array.isArray(held.permutations) ? held.permutations.map(String) : [],
		features: Array.isArray(held.features) ? held.features.map(String) : [],
	};
}
