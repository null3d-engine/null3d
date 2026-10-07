// Merges the equal parts of a model, as gltfpack does: textures of the same image, materials of
// the same settings, mesh accessors of the same values, and meshes of the same triangle lists.
// The engine draws all objects of one mesh and material in one bucket, so objects whose meshes
// were copies then share a bucket, and the copies upload once.
import { createHash } from 'node:crypto';

/** @import { Accessor, Document, Material, Mesh, Property } from '@gltf-transform/core' */

/**
 * @typedef {object} DedupReport The parts that merged into an equal part.
 * @property {number} textures
 * @property {number} materials
 * @property {number} accessors
 * @property {number} meshes
 */

/**
 * Points every place that uses a part at its equal, then drops the part.
 *
 * @param {Property} from
 * @param {Property} to
 */
function replace(from, to) {
	for (const parent of from.listParents())
		if (parent.propertyType !== 'Root') /** @type {any} */ (parent).swap(from, to);
	from.dispose();
}

/**
 * Merges each group of parts that share a key into the group's first part.
 *
 * @template {Property} T
 * @param {T[]} parts
 * @param {(part: T) => string | null} key Null keeps a part out of every group.
 * @param {(a: T, b: T) => boolean} [same] A check of two parts with one key.
 * @returns {number} The parts merged.
 */
function mergeEqual(parts, key, same = () => true) {
	/** @type {Map<string, T[]>} */
	const firsts = new Map();
	let merged = 0;
	for (const part of parts) {
		const k = key(part);
		if (k === null) continue;
		const group = firsts.get(k) ?? [];
		firsts.set(k, group);
		const match = group.find((first) => same(first, part));
		if (match) {
			replace(part, match);
			merged++;
		} else group.push(part);
	}
	return merged;
}

/** @param {Uint8Array | ArrayBufferView} bytes */
const hash = (bytes) =>
	createHash('sha256')
		.update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
		.digest('base64');

/**
 * The places that use an accessor, by kind, such as a primitive's indices or a morph target's
 * attributes. Only accessors that meshes alone use take part: two equal accessors of different
 * kinds would need one buffer view of two kinds.
 *
 * @param {Document} doc
 * @param {Accessor} accessor
 */
function meshUse(doc, accessor) {
	const kinds = new Set(
		doc
			.getGraph()
			.listParentEdges(accessor)
			.filter((edge) => edge.getName() !== 'accessors')
			.map((edge) => `${edge.getParent().propertyType}.${edge.getName()}`),
	);
	if (kinds.size === 0) return null;
	for (const kind of kinds)
		if (!['Primitive.indices', 'Primitive.attributes', 'PrimitiveTarget.attributes'].includes(kind))
			return null;
	return [...kinds].sort().join(' ');
}

/**
 * Merges the mesh accessors of equal values. The steps that reorder a mesh's vertices give a
 * stream that two meshes share a copy each, so the tool merges accessors again after them.
 *
 * @param {Document} doc
 * @returns {number} The accessors merged.
 */
export function dedupAccessors(doc) {
	return mergeEqual(doc.getRoot().listAccessors(), (accessor) => {
		const use = meshUse(doc, accessor);
		const array = accessor.getArray();
		if (use === null || !array) return null;
		return [
			use,
			accessor.getType(),
			accessor.getComponentType(),
			accessor.getNormalized(),
			accessor.getCount(),
			hash(array),
		].join(' ');
	});
}

/**
 * Merges the equal parts of a document.
 *
 * @param {Document} doc
 * @returns {DedupReport}
 */
export function dedup(doc) {
	const root = doc.getRoot();
	const textures = mergeEqual(root.listTextures(), (texture) => {
		const image = texture.getImage();
		return image ? `${texture.getMimeType()} ${hash(image)}` : null;
	});
	const skipName = new Set(['name']);
	const materials = mergeEqual(
		root.listMaterials(),
		() => '',
		(/** @type {Material} */ a, b) => a.equals(b, skipName),
	);
	const accessors = dedupAccessors(doc);
	/** @type {Map<Property | null, number>} */
	const ids = new Map([[null, -1]]);
	const id = (/** @type {Property | null} */ part) => {
		if (!ids.has(part)) ids.set(part, ids.size);
		return ids.get(part);
	};
	const meshes = mergeEqual(root.listMeshes(), (/** @type {Mesh} */ mesh) =>
		JSON.stringify([
			mesh.getWeights(),
			mesh
				.listPrimitives()
				.map((prim) => [
					prim.getMode(),
					id(prim.getMaterial()),
					id(prim.getIndices()),
					prim.listSemantics().map((s) => [s, id(prim.getAttribute(s))]),
					prim
						.listTargets()
						.map((target) => target.listSemantics().map((s) => [s, id(target.getAttribute(s))])),
					prim.getExtras(),
					prim.listExtensions().length > 0 ? id(prim) : null,
				]),
			mesh.getExtras(),
			mesh.listExtensions().length > 0 ? id(mesh) : null,
		]),
	);
	return { textures, materials, accessors, meshes };
}
