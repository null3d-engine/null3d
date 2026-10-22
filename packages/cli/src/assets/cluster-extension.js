// The engine's own glTF extension for a primitive's tree of cluster patches, which the tool
// writes and the engine's loader reads. It is not required: other loaders ignore it and draw the
// primitive's whole mesh.
//
// NULL3D_clusters, on a primitive:
//   { "indices": <accessor>, "bounds": <accessor>, "patches": <accessor>, "root": <number> }
// `indices` is a scalar accessor of unsigned 32-bit integers that holds every patch's triangles
// one patch after another, as indices into the primitive's own vertex streams. `bounds` is a
// vector-of-four accessor of 32-bit floats that holds each patch's bounding sphere: its centre
// and its radius. `patches` is a vector-of-four accessor of unsigned 32-bit integers that holds
// each patch's first index, its index count, the patch of its parent plus one (0 for the root),
// and its error as the bits of a 32-bit float. `root` is the patch index of the tree's root.
//
// A patch draws while its own error passes the view's threshold and the error of its parent does
// not, so the patches that draw always cover the primitive once, however near or far the camera
// is. A patch with no children is exact geometry and has an error of 0.
//
// glTF-Transform drops extensions it does not know, so the tool reads and writes this one itself.
import { Extension, ExtensionProperty, PropertyType } from '@gltf-transform/core';

/** @import { Accessor, Primitive, ReaderContext, WriterContext } from '@gltf-transform/core' */

export const NULL3D_CLUSTERS = 'NULL3D_clusters';

/**
 * A primitive's tree of cluster patches.
 *
 * @extends {ExtensionProperty<any>}
 */
export class Clusters extends ExtensionProperty {
	static EXTENSION_NAME = NULL3D_CLUSTERS;
	/** @type {string} */
	extensionName = NULL3D_CLUSTERS;
	/** @type {string} */
	propertyType = 'Clusters';
	/** @type {string[]} */
	parentTypes = [PropertyType.PRIMITIVE];

	/** Sets nothing: the fields above name the property. */
	init() {}

	/** @returns {any} */
	getDefaults() {
		return Object.assign(super.getDefaults(), {
			indices: null,
			bounds: null,
			patches: null,
			root: 0,
		});
	}

	/** @returns {Accessor | null} */
	getIndices() {
		return this.getRef('indices');
	}

	/** @returns {Accessor | null} */
	getBounds() {
		return this.getRef('bounds');
	}

	/** @returns {Accessor | null} */
	getPatches() {
		return this.getRef('patches');
	}

	/** The patch index of the tree's root. */
	getRoot() {
		return /** @type {number} */ (this.get('root'));
	}

	/**
	 * @param {Accessor} indices
	 * @param {Accessor} bounds
	 * @param {Accessor} patches
	 * @param {number} root
	 */
	setTree(indices, bounds, patches, root) {
		return this.setRef('indices', indices, { usage: 'OTHER' })
			.setRef('bounds', bounds, { usage: 'OTHER' })
			.setRef('patches', patches, { usage: 'OTHER' })
			.set('root', root);
	}
}

/**
 * @param {Primitive} prim
 * @returns {Clusters | null}
 */
export const clustersOf = (prim) =>
	/** @type {Clusters | null} */ (prim.getExtension(NULL3D_CLUSTERS));

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

/** The NULL3D_clusters extension for glTF-Transform's reader and writer. */
export class Null3dClusters extends Extension {
	static EXTENSION_NAME = NULL3D_CLUSTERS;
	/** @type {string} */
	extensionName = NULL3D_CLUSTERS;

	createClusters() {
		return new Clusters(this.document.getGraph());
	}

	/** @param {ReaderContext} context */
	read(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const def = /** @type {any} */ (context.jsonDoc.json.meshes?.[m]?.primitives[p])
				?.extensions?.[NULL3D_CLUSTERS];
			if (!def) continue;
			const indices = context.accessors[def.indices];
			const bounds = context.accessors[def.bounds];
			const patches = context.accessors[def.patches];
			if (!indices || !bounds || !patches) continue;
			const root = Number(def.root ?? 0);
			prim.setExtension(
				NULL3D_CLUSTERS,
				/** @type {any} */ (this.createClusters().setTree(indices, bounds, patches, root)),
			);
		}
		return this;
	}

	/** @param {WriterContext} context */
	write(context) {
		for (const { prim, m, p } of primitiveDefs(this.document)) {
			const clusters = clustersOf(prim);
			const def = context.jsonDoc.json.meshes?.[m]?.primitives[p];
			if (!clusters || !def) continue;
			const indices = clusters.getIndices();
			const bounds = clusters.getBounds();
			const patches = clusters.getPatches();
			if (!indices || !bounds || !patches) continue;
			def.extensions ??= {};
			def.extensions[NULL3D_CLUSTERS] = {
				indices: context.accessorIndexMap.get(indices),
				bounds: context.accessorIndexMap.get(bounds),
				patches: context.accessorIndexMap.get(patches),
				root: clusters.getRoot(),
			};
		}
		return this;
	}
}
