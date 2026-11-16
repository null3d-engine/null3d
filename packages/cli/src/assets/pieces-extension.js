// The engine's own glTF extension for the pieces of a primitive's triangle list (see
// `@null3d/engine/pieces-planner`), which the tool writes and the engine's loader reads. It is not required: other loaders draw the
// primitive's triangles as they are, since the pieces only order them.
//
// NULL3D_pieces, on a primitive:
//   { "triangles": [<number>, ...], "bounds": [<number>, ...], "groups": <accessor>,
//     "groupBounds": <accessor>, "version": <number> }
// `triangles` holds the triangles of each piece, one piece after another, in the order of the
// primitive's indices: the first piece is the list's first triangles, and the counts add up to
// all of them. `bounds` holds eight numbers for each piece, in the units of the primitive's
// stored positions: its bounding sphere's centre and radius, then its cone's unit axis and its
// cutoff. A piece whose sphere's centre `c`, relative to the eye, and radius `r` meet
// `dot(c, axis) >= cutoff * |c| + r` faces away from the eye with every triangle. A cutoff of 1 or
// more never culls. Every number is a 32-bit float, rounded so that it culls no more than the
// exact bounds. `version` is the layout's version (`NULL3D_PIECES_VERSION` below).
//
// A large list's pieces also split into groups of up to 128 triangles each. `groups` is a scalar
// accessor of unsigned bytes that holds the triangles of each group, one group after another in
// the order of the primitive's indices: the groups of each piece hold its triangles and no
// other. `groupBounds` is a vector-of-four accessor of 32-bit floats that holds two entries for
// each group, its sphere and then its cone, as `bounds` holds a piece's. A list without groups
// names neither.
//
// glTF-Transform drops extensions it does not know, so the tool reads and writes this one itself.
import { Extension, ExtensionProperty, PropertyType } from '@gltf-transform/core';
import { listPieces, piecesInOrder, planGroups } from '@null3d/engine/pieces-planner';
import { cacheOrder, clusterOrder, triangleIndices, triangleLists } from './geometry.js';
import { lodOf } from './lod-extension.js';

/** @import { Accessor, Document, Mesh, Node, Primitive, ReaderContext, WriterContext } from '@gltf-transform/core' */

export const NULL3D_PIECES = 'NULL3D_pieces';

/**
 * The version of the layout that the tool writes. The first version held no groups; the engine
 * reads its pieces all the same.
 */
export const NULL3D_PIECES_VERSION = 2;

/**
 * A primitive's pieces.
 *
 * @extends {ExtensionProperty<any>}
 */
export class Pieces extends ExtensionProperty {
	static EXTENSION_NAME = NULL3D_PIECES;
	/** @type {string} */
	extensionName = NULL3D_PIECES;
	/** @type {string} */
	propertyType = 'Pieces';
	/** @type {string[]} */
	parentTypes = [PropertyType.PRIMITIVE];

	/** Sets nothing: the fields above name the property. */
	init() {}

	/** @returns {any} */
	getDefaults() {
		return Object.assign(super.getDefaults(), {
			triangles: [],
			bounds: [],
			groups: null,
			groupBounds: null,
		});
	}

	/** The triangles of each piece. @returns {number[]} */
	getTriangles() {
		return /** @type {number[]} */ (this.get('triangles'));
	}

	/** Eight numbers for each piece: its sphere, then its cone. @returns {number[]} */
	getBounds() {
		return /** @type {number[]} */ (this.get('bounds'));
	}

	/**
	 * @param {number[]} triangles
	 * @param {number[]} bounds
	 */
	setPieces(triangles, bounds) {
		return this.set('triangles', triangles).set('bounds', bounds);
	}

	/** The triangles of each group, or `null` for pieces without groups. @returns {Accessor | null} */
	getGroups() {
		return this.getRef('groups');
	}

	/** Two entries for each group: its sphere, then its cone. @returns {Accessor | null} */
	getGroupBounds() {
		return this.getRef('groupBounds');
	}

	/**
	 * @param {Accessor} groups
	 * @param {Accessor} bounds
	 */
	setGroups(groups, bounds) {
		return this.setRef('groups', groups, { usage: 'OTHER' }).setRef('groupBounds', bounds, {
			usage: 'OTHER',
		});
	}
}

/**
 * @param {Primitive} prim
 * @returns {Pieces | null}
 */
export const piecesOf = (prim) => /** @type {Pieces | null} */ (prim.getExtension(NULL3D_PIECES));

/**
 * The primitives of a document's meshes with their index in the file, in the order the writer
 * writes them.
 *
 * @param {Document} doc
 */
function primitiveDefs(doc) {
	return doc
		.getRoot()
		.listMeshes()
		.flatMap((mesh, m) => mesh.listPrimitives().map((prim, p) => ({ prim, m, p })));
}

/** The NULL3D_pieces extension for glTF-Transform's reader and writer. */
export class Null3dPieces extends Extension {
	static EXTENSION_NAME = NULL3D_PIECES;
	/** @type {string} */
	extensionName = NULL3D_PIECES;

	createPieces() {
		return new Pieces(this.document.getGraph());
	}

	/** @param {ReaderContext} context */
	read(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const def = /** @type {any} */ (context.jsonDoc.json.meshes?.[m]?.primitives[p])
				?.extensions?.[NULL3D_PIECES];
			if (!def || !Array.isArray(def.triangles) || !Array.isArray(def.bounds)) continue;
			const pieces = this.createPieces().setPieces(def.triangles, def.bounds);
			const groups = context.accessors[def.groups];
			const bounds = context.accessors[def.groupBounds];
			if (groups && bounds) pieces.setGroups(groups, bounds);
			prim.setExtension(NULL3D_PIECES, /** @type {any} */ (pieces));
		}
		return this;
	}

	/** @param {WriterContext} context */
	write(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const pieces = piecesOf(prim);
			const def = context.jsonDoc.json.meshes?.[m]?.primitives[p];
			if (!pieces || !def) continue;
			const groups = pieces.getGroups();
			const bounds = pieces.getGroupBounds();
			def.extensions ??= {};
			def.extensions[NULL3D_PIECES] = {
				triangles: pieces.getTriangles(),
				bounds: pieces.getBounds(),
				...(groups &&
					bounds && {
						groups: context.accessorIndexMap.get(groups),
						groupBounds: context.accessorIndexMap.get(bounds),
					}),
				version: NULL3D_PIECES_VERSION,
			};
		}
		return this;
	}
}

/**
 * A primitive's positions as the GPU reads them: three numbers for each vertex, with normalized
 * integers read as fractions.
 *
 * @param {Accessor} accessor
 */
function readPositions(accessor) {
	const array = /** @type {ArrayLike<number>} */ (accessor.getArray());
	if (!accessor.getNormalized()) return array;
	const signed = array instanceof Int8Array || array instanceof Int16Array;
	const largest = 2 ** (8 * accessor.getComponentSize() - (signed ? 1 : 0)) - 1;
	return Float32Array.from(array, (v) => Math.max(v / largest, -1));
}

/**
 * The meshes whose triangle lists may get pieces: each mesh that draws a level set, with every
 * level's mesh. A list gets pieces by the pieces planner's rule ({@link listPieces}), whatever
 * copies the file places, since a page may place many copies of a mesh that the file holds once;
 * the engine draws a smaller list's facing pieces only once the scene's copies pay for them. A mesh
 * that a skin poses and one with morph targets keep their lists as they are, since a posed list has
 * no fixed bounds. A mesh with a tree of cluster patches gets pieces too: its whole levels draw on
 * the paths that draw no patches, and its tree keeps its own indices.
 *
 * @param {Document} doc
 * @returns {Mesh[]}
 */
function piecedMeshes(doc) {
	/** @type {Set<Mesh>} */
	const meshes = new Set();
	for (const node of doc.getRoot().listNodes()) {
		const lod = lodOf(node);
		const mesh = node.getMesh();
		if (!lod || !mesh || node.getSkin()) continue;
		if (triangleLists(mesh).some((prim) => prim.listTargets().length > 0)) continue;
		meshes.add(mesh);
		for (const level of lod.listLevels()) {
			const lower = /** @type {Node} */ (level).getMesh();
			if (lower) meshes.add(lower);
		}
	}
	return [...meshes];
}

/**
 * True for a list whose material lets its copies drop a piece by the way it faces: one that draws
 * one face and does not blend.
 *
 * @param {Primitive} prim
 */
function facesOneWay(prim) {
	const material = prim.getMaterial();
	return !material || (!material.getDoubleSided() && material.getAlphaMode() !== 'BLEND');
}

/**
 * Sorts each triangle list of a mesh with levels that the pieces planner's rule gives pieces into
 * them: a large list, or a smaller one whose triangles face a few ways.
 * It orders each piece's triangles for the vertex cache, splits the pieces of a large list into
 * groups, which keep the order that the clusterizer gives them, and stores the pieces in
 * `NULL3D_pieces`. The clusterizer must be ready. The vertices stay as they are, so the levels keep sharing them. Run after the
 * levels are stored, since a level's own mesh gets pieces too, and before any step that reads
 * triangles by their place, such as the raycast trees.
 *
 * @param {Document} doc
 * @returns {{ lists: number, pieces: number, groups: number }} The lists that got pieces, their
 *   pieces and the pieces' groups.
 */
export function storePieces(doc) {
	const summary = { lists: 0, pieces: 0, groups: 0 };
	const meshes = piecedMeshes(doc);
	if (meshes.length === 0) return summary;
	/** @type {Null3dPieces | undefined} */
	let extension;
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	for (const mesh of meshes)
		for (const prim of triangleLists(mesh)) {
			const position = /** @type {Accessor} */ (prim.getAttribute('POSITION'));
			const vertices = position.getCount();
			const indices = triangleIndices(prim, vertices);
			const positions = readPositions(position);
			const plan = listPieces(positions, indices, facesOneWay(prim));
			if (!plan || plan.counts.length < 2) continue;
			const inPieces = piecesInOrder(indices, plan, cacheOrder);
			const groups = planGroups(positions, inPieces, plan.counts, clusterOrder);
			const sorted = groups?.indices ?? inPieces;
			prim.setIndices(
				doc
					.createAccessor()
					.setType('SCALAR')
					.setArray(vertices <= 0xffff ? Uint16Array.from(sorted) : sorted)
					.setBuffer(buffer),
			);
			// A file names the extension only when a list holds pieces.
			extension ??= doc.createExtension(Null3dPieces);
			const pieces = extension
				.createPieces()
				.setPieces(Array.from(plan.counts), Array.from(plan.bounds));
			if (groups) {
				pieces.setGroups(
					doc.createAccessor().setType('SCALAR').setArray(groups.counts).setBuffer(buffer),
					doc.createAccessor().setType('VEC4').setArray(groups.bounds).setBuffer(buffer),
				);
				summary.groups += groups.counts.length;
			}
			prim.setExtension(NULL3D_PIECES, /** @type {any} */ (pieces));
			summary.lists += 1;
			summary.pieces += plan.counts.length;
		}
	return summary;
}
