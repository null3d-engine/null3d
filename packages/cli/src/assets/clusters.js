// The tool's cluster levels: a large static mesh becomes a tree of small patches of about 128
// triangles, and the tree stores every patch's triangles, its bounds and its error. Each frame a
// view draws the patches whose own error passes its threshold and whose parent's error does not,
// so a mesh that stretches from near to far draws fine geometry near the camera and coarse
// geometry far from it, with no pop and no gap.
//
// Every patch's indices name the mesh's own vertices, so the patches add no vertex and the mesh
// keeps one vertex stream. A patch simplifies the triangles of its children, so the tree holds
// about twice the mesh's triangles.
//
// The build reads a mesh as the file stores it: welding, attribute weights and seam marks are the
// same as the whole levels' planning (see `levels.js`), so a patch errs by the same measure as a
// whole level.
import { Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NULL3D_CLUSTERS, Null3dClusters } from './cluster-extension.js';
import { weld } from './levels.js';

/** @import { Accessor, Document, Mesh } from '@gltf-transform/core' */

/** The triangles that a leaf patch aims for. */
export const CLUSTER_TRIANGLES = 128;

/** The fewest triangles of a mesh that gets a tree. */
export const CLUSTER_MIN_TRIANGLES = 20_000;

/** The most triangles of the coarsest patch: the chain above the tree stops here. */
export const CLUSTER_ROOT_TRIANGLES = 32;

/** The share of a group's triangles that its patch keeps. */
const CLUSTER_SHARE = 0.5;

/** A group's patch errs by at least this many times its children's error. */
const ERROR_GROWTH = 1.5;

/** The part of the mesh's longest side that a patch errs by at least, which keeps errors rising. */
const LEAST_ERROR = 1e-6;

/** The most copies of a mesh that still gets a tree: many copies cost more than they save. */
const CLUSTER_MAX_COPIES = 4;

/** The ways each simplification tries, on top of the flags that every one takes. */
const TRIES = /** @type {const} */ ([
	{ flags: [], seams: false },
	{ flags: ['Prune'], seams: false },
	{ flags: ['Permissive'], seams: true },
	{ flags: ['Permissive', 'Prune'], seams: true },
]);

/**
 * A triangle list as the planning reads it: the vertices it draws, the attributes in the
 * simplifier's error, seam marks, and its triangles.
 *
 * @typedef {object} PlanningList
 * @property {Float32Array} positions
 * @property {Float32Array} attributes
 * @property {number} stride
 * @property {number[]} weights
 * @property {Uint8Array} seams
 * @property {Uint32Array} indices
 */

/**
 * One patch of a tree.
 *
 * @typedef {object} Patch
 * @property {Patch[]} children The patches that this one replaces.
 * @property {Uint32Array} indices The patch's triangles, as indices into the mesh's vertices.
 * @property {number} error The largest distance between the patch's surface and the mesh's, in
 *   the units of the mesh's stored positions, plus its children's errors.
 * @property {number} parent The patch's place in the tree, 0 for the root until a walk fills in
 *   the places of its children.
 */

/**
 * A primitive's tree of patches, as the file stores it.
 *
 * @typedef {object} ClusterPlan
 * @property {Primitive} prim The primitive that draws the tree.
 * @property {Uint32Array} indices Every patch's indices, one patch after another.
 * @property {Float32Array} bounds Each patch's centre and radius, as four floats.
 * @property {Uint32Array} patches Each patch's first index, index count, its parent's place plus
 *   one, and its error's bits, as four integers.
 * @property {number} root The patch index of the tree's root.
 * @property {number} side The mesh's longest side, in the units of its errors.
 * @property {number} triangles The mesh's triangles.
 * @property {number} treeTriangles Every patch's triangles added up.
 * @property {number} leaves The number of patches with no children.
 * @property {number} depth The levels of patches above the leaves, the root's included.
 */

/**
 * The centroid of each triangle of a triangle list.
 *
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 */
function centroids(positions, indices) {
	const triangles = indices.length / 3;
	const out = new Float32Array(triangles * 3);
	for (let t = 0; t < triangles; t++)
		for (let k = 0; k < 3; k++) {
			const a = /** @type {number} */ (indices[t * 3]);
			const b = /** @type {number} */ (indices[t * 3 + 1]);
			const c = /** @type {number} */ (indices[t * 3 + 2]);
			const x = /** @type {number} */ (positions[a * 3 + k]);
			const y = /** @type {number} */ (positions[b * 3 + k]);
			const z = /** @type {number} */ (positions[c * 3 + k]);
			out[t * 3 + k] = (x + y + z) / 3;
		}
	return out;
}

/**
 * The axis of the box around the given triangles that spans the most.
 *
 * @param {Float32Array} centres
 * @param {Uint32Array} triangles The triangles to measure.
 */
function longestAxis(centres, triangles) {
	let axis = 0;
	let widest = -1;
	for (let k = 0; k < 3; k++) {
		let low = Infinity;
		let high = -Infinity;
		for (const t of triangles) {
			const value = /** @type {number} */ (centres[t * 3 + k]);
			if (value < low) low = value;
			if (value > high) high = value;
		}
		if (high - low > widest) {
			widest = high - low;
			axis = k;
		}
	}
	return axis;
}

/**
 * Splits the triangles into leaves of at most {@link CLUSTER_TRIANGLES} triangles, each leaf a
 * compact piece of the surface: the box around the triangles is cut across its longest axis at
 * its middle, again and again. Triangles are ordered by their place, and by their number where two
 * share a place, so the same mesh gives the same leaves on every machine.
 *
 * @param {Float32Array} centres
 * @param {number} triangles
 */
function leafTriangles(centres, triangles) {
	/** @type {Uint32Array[]} */
	const leaves = [];
	/**
	 * @param {Uint32Array} ids
	 * @param {number} depth
	 */
	const visit = (ids, depth) => {
		if (ids.length <= CLUSTER_TRIANGLES || depth >= 32) {
			leaves.push(ids);
			return;
		}
		const axis = longestAxis(centres, ids);
		ids.sort(
			(a, b) =>
				/** @type {number} */ (centres[a * 3 + axis]) -
					/** @type {number} */ (centres[b * 3 + axis]) || a - b,
		);
		const middle = ids.length >> 1;
		visit(ids.subarray(0, middle), depth + 1);
		visit(ids.subarray(middle), depth + 1);
	};
	visit(
		Uint32Array.from({ length: triangles }, (_, t) => t),
		0,
	);
	return leaves;
}

/**
 * A group's triangles, one after another.
 *
 * @param {Patch[]} children
 */
function unionIndices(children) {
	const total = children.reduce((sum, child) => sum + child.indices.length, 0);
	const out = new Uint32Array(total);
	let at = 0;
	for (const child of children) {
		out.set(child.indices, at);
		at += child.indices.length;
	}
	return out;
}

/**
 * A patch that simplifies its children's triangles toward half of them, under no error limit: the
 * patch's own error is measured and stored, and the rule draws it only where that error passes the
 * view's threshold. The patch keeps its group's border in place, so a patch that draws beside a
 * finer patch still meets it.
 *
 * A group that no way simplifies keeps its children's triangles, and draws what they draw.
 *
 * @param {PlanningList} list
 * @param {Patch[]} children
 * @param {number} side
 * @returns {Patch}
 */
function simplifyPatch(list, children, side) {
	const input = unionIndices(children);
	const target = Math.floor((input.length / 3) * CLUSTER_SHARE) * 3;
	const childError = children.reduce((most, child) => Math.max(most, child.error), 0);
	/** @type {{ indices: Uint32Array, error: number } | undefined} */
	let best;
	if (target >= 3) {
		for (const { flags, seams } of TRIES) {
			const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(
				input,
				list.positions,
				3,
				list.attributes,
				list.stride,
				list.weights,
				seams ? list.seams : null,
				target,
				side,
				['LockBorder', 'Sparse', 'ErrorAbsolute', ...flags],
			);
			if (simplified.length === 0) continue;
			const better =
				!best ||
				simplified.length < best.indices.length ||
				(simplified.length === best.indices.length && error < best.error);
			if (better) best = { indices: Uint32Array.from(simplified), error };
		}
	}
	const patch = best ?? { indices: input, error: 0 };
	return {
		children,
		indices: patch.indices,
		error: Math.max(childError + patch.error, childError * ERROR_GROWTH, side * LEAST_ERROR),
		parent: 0,
	};
}

/**
 * A leaf patch: triangles of the mesh as they are, with no error.
 *
 * @param {PlanningList} list
 * @param {Uint32Array} triangles
 * @returns {Patch}
 */
function leafPatch(list, triangles) {
	const indices = new Uint32Array(triangles.length * 3);
	for (let t = 0; t < triangles.length; t++)
		for (let k = 0; k < 3; k++)
			indices[t * 3 + k] = /** @type {number} */ (
				list.indices[/** @type {number} */ (triangles[t]) * 3 + k]
			);
	return { children: [], indices, error: 0, parent: 0 };
}

/**
 * The patches of one triangle list, from the leaves up: pairs of patches join into a parent, whose
 * patch simplifies their triangles, until one patch holds the whole list. Then one patch after
 * another simplifies that one toward {@link CLUSTER_ROOT_TRIANGLES} triangles, so that a distant
 * view draws a handful of triangles.
 *
 * @param {PlanningList} list
 * @param {number} side
 */
function buildTree(list, side) {
	const centres = centroids(list.positions, list.indices);
	const leaves = leafTriangles(centres, list.indices.length / 3).map((triangles) =>
		leafPatch(list, triangles),
	);
	/** @type {Patch[]} */
	let level = leaves;
	while (level.length > 1) {
		/** @type {Patch[]} */
		const parents = [];
		for (let k = 0; k < level.length; k += 2) {
			const pair = level[k + 1] ? [level[k], level[k + 1]] : [level[k]];
			parents.push(simplifyPatch(list, /** @type {Patch[]} */ (pair), side));
		}
		level = parents;
	}
	let root = /** @type {Patch} */ (level[0]);
	// A patch that cannot lose a triangle keeps its children's, so the chain stops at the first
	// step that does not shrink the patch.
	while (root.indices.length / 3 > CLUSTER_ROOT_TRIANGLES) {
		const coarser = simplifyPatch(list, [root], side);
		if (coarser.indices.length >= root.indices.length) break;
		root = coarser;
	}
	return { root, leaves: leaves.length };
}

/**
 * The sphere around a patch: the middle of its box, and the distance to its farthest vertex.
 *
 * @param {Float32Array} positions
 * @param {Uint32Array} indices
 */
function sphereOf(positions, indices) {
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	for (const v of indices)
		for (let k = 0; k < 3; k++) {
			const value = /** @type {number} */ (positions[v * 3 + k]);
			if (value < /** @type {number} */ (low[k])) low[k] = value;
			if (value > /** @type {number} */ (high[k])) high[k] = value;
		}
	/** @param {number} k */
	const middle = (k) => {
		const first = /** @type {number} */ (low[k]);
		const second = /** @type {number} */ (high[k]);
		return (first + second) / 2;
	};
	const centre = [middle(0), middle(1), middle(2)];
	let radius = 0;
	for (const v of indices) {
		const dx = /** @type {number} */ (positions[v * 3]) - /** @type {number} */ (centre[0]);
		const dy = /** @type {number} */ (positions[v * 3 + 1]) - /** @type {number} */ (centre[1]);
		const dz = /** @type {number} */ (positions[v * 3 + 2]) - /** @type {number} */ (centre[2]);
		radius = Math.max(radius, Math.hypot(dx, dy, dz));
	}
	return [...centre, radius];
}

/**
 * The patches of a tree in the order that the file stores them: the root first, then each patch's
 * children in turn, which keeps the patches of one region of the mesh together.
 *
 * @param {Patch} root
 */
function patchOrder(root) {
	/** @type {Patch[]} */
	const order = [];
	/** @type {Patch[]} */
	const stack = [root];
	while (stack.length > 0) {
		const patch = /** @type {Patch} */ (stack.pop());
		order.push(patch);
		for (let k = patch.children.length - 1; k >= 0; k--)
			stack.push(/** @type {Patch} */ (patch.children[k]));
	}
	return order;
}

/**
 * The longest side of the box around a mesh's vertices.
 *
 * @param {Float32Array} positions
 */
function longestSide(positions) {
	const low = [Infinity, Infinity, Infinity];
	const high = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i++) {
		const k = i % 3;
		const value = /** @type {number} */ (positions[i]);
		if (value < /** @type {number} */ (low[k])) low[k] = value;
		if (value > /** @type {number} */ (high[k])) high[k] = value;
	}
	return Math.max(0, ...high.map((value, k) => value - /** @type {number} */ (low[k])));
}

/**
 * The places that draw a mesh: its nodes, and the rows of their instancing.
 *
 * @param {Mesh} mesh
 */
function copiesOf(mesh) {
	let copies = 0;
	for (const parent of mesh.listParents()) {
		if (parent.propertyType !== 'Node') continue;
		const node = /** @type {import('@gltf-transform/core').Node} */ (parent);
		const instancing = /** @type {any} */ (node.getExtension('EXT_mesh_gpu_instancing'));
		const rows = instancing?.listAttributes?.()[0]?.getCount() ?? 1;
		copies += rows;
	}
	return copies;
}

/**
 * True for a primitive that a tree serves: a mesh that does not bend, whose material neither cuts
 * nor blends, drawn by few copies.
 *
 * @param {Mesh} mesh
 * @param {Primitive} prim
 */
function servesTree(mesh, prim) {
	if (prim.getMode() !== Primitive.Mode.TRIANGLES) return false;
	if (prim.listTargets().length > 0) return false;
	const material = prim.getMaterial();
	if (material && material.getAlphaMode() !== 'OPAQUE') return false;
	// A mesh that another mesh's levels name draws in place of a whole level, so a tree of its
	// own would never pay for itself.
	const isLevel = mesh
		.listParents()
		.some(
			(parent) =>
				parent.propertyType === 'Node' &&
				parent.listParents().some((above) => above.propertyType === 'Lod'),
		);
	if (isLevel) return false;
	const nodes = mesh
		.listParents()
		.filter((parent) => parent.propertyType === 'Node')
		.map((parent) => /** @type {import('@gltf-transform/core').Node} */ (parent));
	if (nodes.some((node) => node.getSkin() !== null)) return false;
	return nodes.length > 0 && copiesOf(mesh) <= CLUSTER_MAX_COPIES;
}

/**
 * The bits of a 32-bit float.
 *
 * @param {number} value
 */
function floatBits(value) {
	const view = new DataView(new ArrayBuffer(4));
	view.setFloat32(0, value, true);
	return view.getUint32(0, true);
}

/**
 * The number of levels of patches below a patch, its own level included.
 *
 * @param {Patch} patch
 * @returns {number}
 */
function treeDepth(patch) {
	if (patch.children.length === 0) return 1;
	return 1 + Math.max(...patch.children.map(treeDepth));
}

/**
 * The tree of one primitive, or undefined for a primitive that a tree does not serve.
 *
 * @param {Primitive} prim
 * @returns {ClusterPlan | undefined}
 */
function planPatch(prim) {
	const positions = Float32Array.from(
		/** @type {ArrayLike<number>} */ (
			/** @type {Accessor} */ (prim.getAttribute('POSITION')).getArray()
		),
	);
	const list = /** @type {PlanningList} */ (/** @type {unknown} */ (weld(prim, positions)));
	if (list.indices.length / 3 < CLUSTER_MIN_TRIANGLES) return undefined;
	const side = longestSide(list.positions);
	if (side === 0) return undefined;
	const { root, leaves } = buildTree(list, side);
	const order = patchOrder(root);
	const patches = new Uint32Array(order.length * 4);
	const bounds = new Float32Array(order.length * 4);
	const indices = new Uint32Array(order.reduce((sum, patch) => sum + patch.indices.length, 0));
	let at = 0;
	let treeTriangles = 0;
	for (let k = 0; k < order.length; k++) {
		const patch = /** @type {Patch} */ (order[k]);
		patch.parent = k;
		bounds.set(sphereOf(list.positions, patch.indices), k * 4);
		patches[k * 4] = at;
		patches[k * 4 + 1] = patch.indices.length;
		patches[k * 4 + 3] = floatBits(patch.error);
		indices.set(patch.indices, at);
		at += patch.indices.length;
		treeTriangles += patch.indices.length / 3;
	}
	// A patch names its parent's place, plus one, so that 0 marks the root's parent.
	for (const patch of order)
		for (const child of patch.children) patches[child.parent * 4 + 2] = patch.parent + 1;
	return {
		prim,
		indices,
		bounds,
		patches,
		root: 0,
		side,
		triangles: list.indices.length / 3,
		treeTriangles,
		leaves,
		depth: treeDepth(root),
	};
}

/**
 * Plans a tree of patches for each large static mesh of a document.
 *
 * Run after quantizing: the planning reads the positions as stored, so the errors are in the units
 * that the file's mesh has.
 *
 * @param {Document} doc
 * @returns {Promise<Map<Primitive, ClusterPlan>>}
 */
export async function planClusters(doc) {
	await MeshoptSimplifier.ready;
	/** @type {Map<Primitive, ClusterPlan>} */
	const plans = new Map();
	for (const mesh of doc.getRoot().listMeshes())
		for (const prim of mesh.listPrimitives()) {
			if (!servesTree(mesh, prim)) continue;
			const plan = planPatch(prim);
			if (plan) plans.set(prim, plan);
		}
	return plans;
}

/**
 * An accessor that holds a tree's data, in the document's first buffer. Its component type follows
 * from the array: unsigned 32-bit integers for the indices and the patches, and floats for the
 * patches' spheres.
 *
 * @param {Document} doc
 * @param {'SCALAR' | 'VEC4'} type
 * @param {Uint32Array | Float32Array} array
 */
function accessor(doc, type, array) {
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	return doc
		.createAccessor()
		.setType(type)
		.setArray(/** @type {any} */ (array))
		.setBuffer(buffer);
}

/**
 * Stores the planned trees in the document, as `NULL3D_clusters` gives them: each primitive's
 * patches, their spheres and their errors, in accessors of the document's buffer.
 *
 * @param {Document} doc
 * @param {Map<Primitive, ClusterPlan>} plans
 */
export function storeClusters(doc, plans) {
	if (plans.size === 0) return;
	const extension = doc.createExtension(Null3dClusters);
	for (const [prim, plan] of plans) {
		const clusters = extension
			.createClusters()
			.setTree(
				accessor(doc, 'SCALAR', plan.indices),
				accessor(doc, 'VEC4', plan.bounds),
				accessor(doc, 'VEC4', plan.patches),
				plan.root,
			);
		prim.setExtension(NULL3D_CLUSTERS, /** @type {any} */ (clusters));
	}
}

/**
 * The trees of a document's plans added up.
 *
 * @typedef {object} ClusterSummary
 * @property {number} meshes The primitives with a tree.
 * @property {number} patches Every patch of every tree.
 * @property {number} leaves The patches with no children.
 * @property {number} triangles Every patch's triangles added up, against the base mesh's.
 * @property {number} base The base meshes' triangles.
 * @property {number} bytes The bytes that the trees take in the file.
 */

/**
 * The trees of a document's plans added up: the patches, their triangles against the base mesh's,
 * and the bytes that the file holds the trees in.
 *
 * @param {ClusterPlan[]} plans
 * @returns {ClusterSummary}
 */
export function clusterSummary(plans) {
	const patches = plans.reduce((sum, plan) => sum + plan.patches.length / 4, 0);
	const leaves = plans.reduce((sum, plan) => sum + plan.leaves, 0);
	const triangles = plans.reduce((sum, plan) => sum + plan.treeTriangles, 0);
	const base = plans.reduce((sum, plan) => sum + plan.triangles, 0);
	const bytes = plans.reduce(
		(sum, plan) => sum + plan.indices.byteLength + plan.bounds.byteLength + plan.patches.byteLength,
		0,
	);
	return { meshes: plans.length, patches, leaves, triangles, base, bytes };
}
