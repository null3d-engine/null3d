// The engine's own glTF extensions for the data that culling and raycasts read, which the tool
// writes and the engine's loader reads. Neither is required: other loaders ignore them.
//
// NULL3D_occluder, on a primitive, makes it block the view for software occlusion culling:
//   { "positions": <accessor>, "indices": <accessor> }
// `positions` holds three 32-bit floats per corner in the primitive's own space, and `indices`
// three unsigned integers per triangle, counterclockwise from outside: a closed blocker mesh
// that lies inside the primitive's mesh, which the engine draws in its place. With neither, the
// primitive blocks with its own mesh.
//
// NULL3D_mesh_bvh, on a primitive, stores the tree over its triangles that raycasts walk:
//   { "tree": <accessor> }
// `tree` is a scalar accessor of unsigned 32-bit integers whose bytes are the tree in the
// engine's stored format, which starts with the bytes N3BV and a format version. The engine
// checks a stored tree against the primitive's triangles, and builds its own for a tree that
// does not fit them.
//
// glTF-Transform drops extensions it does not know, so the tool reads and writes these itself.
import { Extension, ExtensionProperty, PropertyType } from '@gltf-transform/core';

/** @import { Accessor, Primitive, ReaderContext, WriterContext } from '@gltf-transform/core' */

export const NULL3D_OCCLUDER = 'NULL3D_occluder';
export const NULL3D_MESH_BVH = 'NULL3D_mesh_bvh';

/**
 * A primitive's blocker: its positions and indices, or neither when the primitive blocks with its
 * own mesh.
 *
 * @extends {ExtensionProperty<any>}
 */
export class Occluder extends ExtensionProperty {
	static EXTENSION_NAME = NULL3D_OCCLUDER;
	/** @type {string} */
	extensionName = NULL3D_OCCLUDER;
	/** @type {string} */
	propertyType = 'Occluder';
	/** @type {string[]} */
	parentTypes = [PropertyType.PRIMITIVE];

	/** Sets nothing: the fields above name the property. */
	init() {}

	/** @returns {any} */
	getDefaults() {
		return Object.assign(super.getDefaults(), { positions: null, indices: null });
	}

	/** @returns {Accessor | null} */
	getPositions() {
		return this.getRef('positions');
	}

	/** @returns {Accessor | null} */
	getIndices() {
		return this.getRef('indices');
	}

	/**
	 * @param {Accessor} positions
	 * @param {Accessor} indices
	 */
	setBlocker(positions, indices) {
		return this.setRef('positions', positions, { usage: 'OTHER' }).setRef('indices', indices, {
			usage: 'OTHER',
		});
	}
}

/**
 * A primitive's stored tree over its triangles.
 *
 * @extends {ExtensionProperty<any>}
 */
export class MeshBvh extends ExtensionProperty {
	static EXTENSION_NAME = NULL3D_MESH_BVH;
	/** @type {string} */
	extensionName = NULL3D_MESH_BVH;
	/** @type {string} */
	propertyType = 'MeshBvh';
	/** @type {string[]} */
	parentTypes = [PropertyType.PRIMITIVE];

	/** Sets nothing: the fields above name the property. */
	init() {}

	/** @returns {any} */
	getDefaults() {
		return Object.assign(super.getDefaults(), { tree: null });
	}

	/** @returns {Accessor | null} */
	getTree() {
		return this.getRef('tree');
	}

	/** @param {Accessor} tree */
	setTree(tree) {
		return this.setRef('tree', tree, { usage: 'OTHER' });
	}
}

/**
 * @param {Primitive} prim
 * @returns {Occluder | null}
 */
export const occluderOf = (prim) =>
	/** @type {Occluder | null} */ (prim.getExtension(NULL3D_OCCLUDER));

/**
 * @param {Primitive} prim
 * @returns {MeshBvh | null}
 */
export const meshBvhOf = (prim) =>
	/** @type {MeshBvh | null} */ (prim.getExtension(NULL3D_MESH_BVH));

/**
 * The primitives of a document's meshes with their index in the file, in the order the writer
 * writes them.
 *
 * @param {import('@gltf-transform/core').Document} doc
 */
function primitiveDefs(doc) {
	return doc
		.getRoot()
		.listMeshes()
		.flatMap((mesh, m) => mesh.listPrimitives().map((prim, p) => ({ prim, m, p })));
}

/** The NULL3D_occluder extension for glTF-Transform's reader and writer. */
export class Null3dOccluder extends Extension {
	static EXTENSION_NAME = NULL3D_OCCLUDER;
	/** @type {string} */
	extensionName = NULL3D_OCCLUDER;

	createOccluder() {
		return new Occluder(this.document.getGraph());
	}

	/** @param {ReaderContext} context */
	read(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const def = /** @type {any} */ (context.jsonDoc.json.meshes?.[m]?.primitives[p])
				?.extensions?.[NULL3D_OCCLUDER];
			if (!def) continue;
			const occluder = this.createOccluder();
			const positions = context.accessors[def.positions];
			const indices = context.accessors[def.indices];
			if (positions && indices) occluder.setBlocker(positions, indices);
			prim.setExtension(NULL3D_OCCLUDER, /** @type {any} */ (occluder));
		}
		return this;
	}

	/** @param {WriterContext} context */
	write(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const occluder = occluderOf(prim);
			const def = context.jsonDoc.json.meshes?.[m]?.primitives[p];
			if (!occluder || !def) continue;
			const positions = occluder.getPositions();
			const indices = occluder.getIndices();
			def.extensions ??= {};
			def.extensions[NULL3D_OCCLUDER] =
				positions && indices
					? {
							positions: context.accessorIndexMap.get(positions),
							indices: context.accessorIndexMap.get(indices),
						}
					: {};
		}
		return this;
	}
}

/** The NULL3D_mesh_bvh extension for glTF-Transform's reader and writer. */
export class Null3dMeshBvh extends Extension {
	static EXTENSION_NAME = NULL3D_MESH_BVH;
	/** @type {string} */
	extensionName = NULL3D_MESH_BVH;

	createMeshBvh() {
		return new MeshBvh(this.document.getGraph());
	}

	/** @param {ReaderContext} context */
	read(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const def = /** @type {any} */ (context.jsonDoc.json.meshes?.[m]?.primitives[p])
				?.extensions?.[NULL3D_MESH_BVH];
			const tree = def && context.accessors[def.tree];
			if (tree)
				prim.setExtension(NULL3D_MESH_BVH, /** @type {any} */ (this.createMeshBvh().setTree(tree)));
		}
		return this;
	}

	/** @param {WriterContext} context */
	write(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const tree = meshBvhOf(prim)?.getTree();
			const def = context.jsonDoc.json.meshes?.[m]?.primitives[p];
			if (!tree || !def) continue;
			def.extensions ??= {};
			def.extensions[NULL3D_MESH_BVH] = { tree: context.accessorIndexMap.get(tree) };
		}
		return this;
	}
}
