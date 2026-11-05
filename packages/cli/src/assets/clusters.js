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
// The build reads a mesh as the file stores it: welding, attribute weights, seam marks and the
// choice among the simplifier's ways are the same as the whole levels' planning (see `levels.js`).
// A patch's error is its measured distance from the full mesh below it, not the simplifier's own
// estimate, so a view switches each patch in at the distance its surface needs.
import { Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { NULL3D_CLUSTERS, Null3dClusters } from './cluster-extension.js';
import { copiesOf } from './geometry.js';
import { bandFile, simplifyTries, weld } from './levels.js';
import { TriangleTree } from './surface-distance.js';

/** @import { Accessor, Document, Mesh } from '@gltf-transform/core' */

/** The triangles that a leaf patch aims for. */
export const CLUSTER_TRIANGLES = 128;

/** The fewest triangles of a mesh that gets a tree. */
export const CLUSTER_MIN_TRIANGLES = 20_000;

/** The most triangles of the coarsest patch: the chain above the tree stops here. */
export const CLUSTER_ROOT_TRIANGLES = 32;

/** The share of a group's triangles that its patch keeps. */
const CLUSTER_SHARE = 0.5;

/** The turn of the mesh's open edge, in radians, past which a vertex of that edge stays put. */
const CORNER_ANGLE = Math.PI / 6;

/** The part of the mesh's longest side within which two open edges count as one seam. */
const SEAM_SHARE = 1e-5;

/** The part of the mesh's longest side that a patch above the leaves errs by at least. */
const LEAST_ERROR = 1e-6;

/** The most copies of a mesh that still gets a tree: many copies cost more than they save. */
const CLUSTER_MAX_COPIES = 4;

/** @typedef {import('./levels.js').PlanningList} PlanningList */

/**
 * One patch of a tree.
 *
 * @typedef {object} Patch
 * @property {Patch[]} children The patches that this one replaces.
 * @property {Uint32Array} indices The patch's triangles, as indices into the mesh's vertices.
 * @property {number} error The largest distance between the patch's surface and the full mesh below
 *   it, in the units of the mesh's stored positions, and at least its children's errors.
 * @property {number[]} sphere The patch's centre and radius, as 32-bit floats: around its own
 *   triangles for a leaf, and around its children's spheres for every other patch.
 * @property {[number, number]} leaves The run of leaves below the patch, as the first and the end.
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
 * The 32-bit float nearest to `radius` that is at least `radius`, so a sphere that the file stores
 * never shrinks below the one that the build measured. A radius is never below 0, so the next float
 * up is the one whose bits come next.
 *
 * @param {number} radius
 */
function radiusUp(radius) {
	const stored = Math.fround(radius);
	if (stored >= radius) return stored;
	const view = new DataView(new ArrayBuffer(4));
	view.setFloat32(0, stored, true);
	view.setUint32(0, view.getUint32(0, true) + 1, true);
	return view.getFloat32(0, true);
}

/**
 * The sphere around a group's spheres: the middle of the box around them, and the distance to the
 * farthest point of any of them, as 32-bit floats that still enclose them. A parent's sphere then
 * holds each child's, so a camera is never nearer the child than the parent, and a parent whose
 * error passes a view's threshold leaves every child below it passing too.
 *
 * @param {number[][]} spheres
 */
function sphereAround(spheres) {
	if (spheres.length === 1) return [.../** @type {number[]} */ (spheres[0])];
	const centre = [0, 1, 2].map((k) => {
		let low = Infinity;
		let high = -Infinity;
		for (const sphere of spheres) {
			const middle = /** @type {number} */ (sphere[k]);
			const radius = /** @type {number} */ (sphere[3]);
			low = Math.min(low, middle - radius);
			high = Math.max(high, middle + radius);
		}
		return Math.fround((low + high) / 2);
	});
	let radius = 0;
	for (const sphere of spheres) {
		const reach =
			Math.hypot(
				/** @type {number} */ (sphere[0]) - /** @type {number} */ (centre[0]),
				/** @type {number} */ (sphere[1]) - /** @type {number} */ (centre[1]),
				/** @type {number} */ (sphere[2]) - /** @type {number} */ (centre[2]),
			) + /** @type {number} */ (sphere[3]);
		radius = Math.max(radius, reach);
	}
	return [...centre, radiusUp(radius)];
}

/**
 * The full mesh that a patch's error is measured against: its triangles in a box tree, and the
 * vertices of each leaf, one leaf after another, with the place where each leaf's vertices start.
 * A patch covers a run of leaves, so the vertices below it are one run of the list.
 *
 * @typedef {object} FullSurface
 * @property {TriangleTree} tree
 * @property {Uint32Array} vertices
 * @property {Uint32Array} starts
 */

/**
 * The full mesh of a list and its leaves, as {@link FullSurface} gives it.
 *
 * @param {PlanningList} list
 * @param {Patch[]} leaves
 * @returns {FullSurface}
 */
function fullSurface(list, leaves) {
	const stamp = new Int32Array(list.positions.length / 3).fill(-1);
	const vertices = new Uint32Array(list.indices.length);
	const starts = new Uint32Array(leaves.length + 1);
	let at = 0;
	leaves.forEach((leaf, k) => {
		starts[k] = at;
		for (const v of leaf.indices)
			if (stamp[v] !== k) {
				stamp[v] = k;
				vertices[at++] = v;
			}
	});
	starts[leaves.length] = at;
	return {
		tree: new TriangleTree(list.positions, list.indices),
		vertices: vertices.subarray(0, at),
		starts,
	};
}

/**
 * The largest distance between a patch's surface and the full mesh below it, in the units of the
 * mesh's stored positions. It measures each vertex of the full mesh below the patch against the
 * patch's triangles, and the middle and the edge midpoints of each of the patch's triangles
 * against the full mesh. The patch's own vertices are vertices of the mesh, so they need no test.
 *
 * The simplifier's own error measures each vertex against the planes of the triangles that it
 * merged, which run on past them. On a large, curved patch those planes pass far from the surface,
 * so that error can reach many times the real distance.
 *
 * Only distances above `floor` matter to the caller, so each search stops at the first triangle
 * within the largest distance found so far. The result is at least `floor`.
 *
 * @param {PlanningList} list
 * @param {FullSurface} full
 * @param {Uint32Array} indices The patch's triangles.
 * @param {[number, number]} leaves The run of leaves below the patch.
 * @param {number} floor
 */
function surfaceError(list, full, indices, leaves, floor) {
	const p = list.positions;
	/** @param {number} at */
	const read = (at) => /** @type {number} */ (p[at]);
	const own = new TriangleTree(p, indices);
	let worst = floor;
	const end = /** @type {number} */ (full.starts[leaves[1]]);
	for (let i = /** @type {number} */ (full.starts[leaves[0]]); i < end; i++) {
		const v = /** @type {number} */ (full.vertices[i]) * 3;
		worst = Math.max(worst, own.distance(read(v), read(v + 1), read(v + 2), worst));
	}
	/**
	 * The distance from the full mesh to the point at the weights `wa`, `wb` and `wc` of the
	 * corners at `a`, `b` and `c`.
	 *
	 * @param {number} a @param {number} b @param {number} c
	 * @param {number} wa @param {number} wb @param {number} wc
	 */
	const probe = (a, b, c, wa, wb, wc) =>
		full.tree.distance(
			read(a) * wa + read(b) * wb + read(c) * wc,
			read(a + 1) * wa + read(b + 1) * wb + read(c + 1) * wc,
			read(a + 2) * wa + read(b + 2) * wb + read(c + 2) * wc,
			worst,
		);
	const third = 1 / 3;
	for (let t = 0; t < indices.length; t += 3) {
		const a = /** @type {number} */ (indices[t]) * 3;
		const b = /** @type {number} */ (indices[t + 1]) * 3;
		const c = /** @type {number} */ (indices[t + 2]) * 3;
		worst = Math.max(worst, probe(a, b, c, third, third, third));
		worst = Math.max(worst, probe(a, b, c, 0.5, 0.5, 0));
		worst = Math.max(worst, probe(a, b, c, 0, 0.5, 0.5));
		worst = Math.max(worst, probe(a, b, c, 0.5, 0, 0.5));
	}
	return worst;
}

/**
 * The vertices of the mesh's own open edge that stay put, marked 1: where the edge turns by more
 * than {@link CORNER_ANGLE}, where more than two open edges meet, and where another open edge runs
 * within {@link SEAM_SHARE} of the mesh's side. The simplifier moves a vertex of an open edge only
 * along that edge, but its own error hardly sees a corner cut off a flat surface. And two open
 * edges that meet, as the two sides of a seam that the file left unwelded, would part if each
 * moved on its own. So those vertices stay, and the free runs between them simplify.
 *
 * @param {PlanningList} list
 * @param {number} side
 */
function rimCorners(list, side) {
	const count = list.positions.length / 3;
	/** @type {Map<number, number>} */
	const uses = new Map();
	const { indices } = list;
	for (let t = 0; t < indices.length; t += 3)
		for (let k = 0; k < 3; k++) {
			const a = /** @type {number} */ (indices[t + k]);
			const b = /** @type {number} */ (indices[t + ((k + 1) % 3)]);
			const key = Math.min(a, b) * count + Math.max(a, b);
			uses.set(key, (uses.get(key) ?? 0) + 1);
		}
	/** Each vertex's neighbours along the open edge: the first two, and a count of them all. */
	const ends = new Int32Array(count * 2).fill(-1);
	const degree = new Uint8Array(count);
	for (const [key, used] of uses) {
		if (used !== 1) continue;
		const a = Math.floor(key / count);
		const b = key - a * count;
		for (const [v, other] of [
			[a, b],
			[b, a],
		]) {
			const at = /** @type {number} */ (v);
			const seen = /** @type {number} */ (degree[at]);
			if (seen < 2) ends[at * 2 + seen] = /** @type {number} */ (other);
			degree[at] = Math.min(seen + 1, 3);
		}
	}
	const p = list.positions;
	const corners = new Uint8Array(count);
	const limit = Math.cos(CORNER_ANGLE);
	for (let v = 0; v < count; v++) {
		const seen = /** @type {number} */ (degree[v]);
		if (seen === 0) continue;
		if (seen !== 2) {
			corners[v] = 1;
			continue;
		}
		const a = /** @type {number} */ (ends[v * 2]);
		const b = /** @type {number} */ (ends[v * 2 + 1]);
		/** @param {number} from @param {number} to */
		const along = (from, to) => {
			const d = [0, 1, 2].map(
				(k) => /** @type {number} */ (p[to * 3 + k]) - /** @type {number} */ (p[from * 3 + k]),
			);
			const length = Math.hypot(...d) || 1;
			return d.map((x) => x / length);
		};
		const into = along(a, v);
		const out = along(v, b);
		const turn =
			/** @type {number} */ (into[0]) * /** @type {number} */ (out[0]) +
			/** @type {number} */ (into[1]) * /** @type {number} */ (out[1]) +
			/** @type {number} */ (into[2]) * /** @type {number} */ (out[2]);
		if (turn < limit) corners[v] = 1;
	}
	// Open-edge vertices that share a cell of the seam's size, or a cell beside it, meet.
	const cell = side * SEAM_SHARE;
	/** @param {number} v @param {number} k */
	const at = (v, k) => Math.floor(/** @type {number} */ (p[v * 3 + k]) / cell);
	/** @type {Map<string, number[]>} */
	const cells = new Map();
	for (let v = 0; v < count; v++) {
		if (degree[v] === 0) continue;
		const key = `${at(v, 0)},${at(v, 1)},${at(v, 2)}`;
		const list = cells.get(key);
		if (list) list.push(v);
		else cells.set(key, [v]);
	}
	for (let v = 0; v < count; v++) {
		if (degree[v] === 0 || corners[v]) continue;
		const [x, y, z] = [at(v, 0), at(v, 1), at(v, 2)];
		search: for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (let dz = -1; dz <= 1; dz++)
					for (const w of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
						if (w === v) continue;
						const gap = Math.hypot(
							/** @type {number} */ (p[v * 3]) - /** @type {number} */ (p[w * 3]),
							/** @type {number} */ (p[v * 3 + 1]) - /** @type {number} */ (p[w * 3 + 1]),
							/** @type {number} */ (p[v * 3 + 2]) - /** @type {number} */ (p[w * 3 + 2]),
						);
						if (gap <= cell) {
							corners[v] = 1;
							break search;
						}
					}
	}
	return corners;
}

/**
 * The vertex marks of one level's groups: 1 for each vertex that two groups share, which the
 * group's simplification keeps in place, so a patch that draws beside a finer patch of another
 * group still meets it, and 1 for each corner of the mesh's open edge (`corners`). Any other vertex
 * of the open edge stays free, and the simplifier moves it only along that edge. The second marks
 * add the list's seams, for the permissive ways.
 *
 * @param {PlanningList} list
 * @param {Patch[][]} groups
 * @param {Uint8Array} corners
 * @returns {[Uint8Array, Uint8Array]}
 */
function groupLocks(list, groups, corners) {
	const owner = new Int32Array(list.positions.length / 3).fill(-1);
	const locked = Uint8Array.from(corners);
	groups.forEach((group, g) => {
		for (const patch of group)
			for (const v of patch.indices) {
				const first = /** @type {number} */ (owner[v]);
				if (first === -1) owner[v] = g;
				else if (first !== g) locked[v] = 1;
			}
	});
	const sealed = Uint8Array.from(list.seams, (seam, v) => (locked[v] ? 1 : seam));
	return [locked, sealed];
}

/**
 * A patch that simplifies its children's triangles toward half of them, under no error limit, as
 * the whole levels choose among the simplifier's ways ({@link simplifyTries}). The rule draws the
 * patch only where its error passes the view's threshold. The vertices that its group shares with
 * other groups stay in place, so a patch that draws beside a finer patch still meets it. A group
 * that no way simplifies keeps its children's triangles, and draws what they draw.
 *
 * The patch's error is its measured distance from the full mesh below it ({@link surfaceError}),
 * and at least its children's, so errors never fall from a patch to its parent. Its sphere holds
 * its children's. Together they let a view test each patch and its parent apart and still draw
 * every part of the mesh once.
 *
 * @param {PlanningList} list
 * @param {FullSurface} full
 * @param {Patch[]} children
 * @param {[Uint8Array | null, Uint8Array | null]} locks The group's vertex marks.
 * @param {number} side
 * @returns {Patch}
 */
function simplifyPatch(list, full, children, locks, side) {
	const input = unionIndices(children);
	const childError = children.reduce((most, child) => Math.max(most, child.error), 0);
	const simplified =
		input.length >= 6
			? simplifyTries(list, input, CLUSTER_SHARE, side, ['Sparse', 'ErrorAbsolute'], locks)
			: undefined;
	const indices = simplified ? Uint32Array.from(simplified[0]) : input;
	const first = /** @type {Patch} */ (children[0]);
	const last = /** @type {Patch} */ (children[children.length - 1]);
	/** @type {[number, number]} */
	const leaves = [first.leaves[0], last.leaves[1]];
	return {
		children,
		indices,
		error: surfaceError(list, full, indices, leaves, Math.max(childError, side * LEAST_ERROR)),
		sphere: sphereAround(children.map((child) => child.sphere)),
		leaves,
		parent: 0,
	};
}

/**
 * A leaf patch: triangles of the mesh as they are, with no error.
 *
 * @param {PlanningList} list
 * @param {Uint32Array} triangles
 * @param {number} place The leaf's place among the leaves.
 * @returns {Patch}
 */
function leafPatch(list, triangles, place) {
	const indices = new Uint32Array(triangles.length * 3);
	for (let t = 0; t < triangles.length; t++)
		for (let k = 0; k < 3; k++)
			indices[t * 3 + k] = /** @type {number} */ (
				list.indices[/** @type {number} */ (triangles[t]) * 3 + k]
			);
	return {
		children: [],
		indices,
		error: 0,
		sphere: sphereOf(list.positions, indices),
		leaves: [place, place + 1],
		parent: 0,
	};
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
	const leaves = leafTriangles(centres, list.indices.length / 3).map((triangles, k) =>
		leafPatch(list, triangles, k),
	);
	const full = fullSurface(list, leaves);
	const corners = rimCorners(list, side);
	/** @type {Patch[]} */
	let level = leaves;
	while (level.length > 1) {
		/** @type {Patch[][]} */
		const groups = [];
		for (let k = 0; k < level.length; k += 2)
			groups.push(/** @type {Patch[]} */ (level[k + 1] ? [level[k], level[k + 1]] : [level[k]]));
		const locks = groupLocks(list, groups, corners);
		level = groups.map((group) => simplifyPatch(list, full, group, locks, side));
	}
	let root = /** @type {Patch} */ (level[0]);
	const rootLocks = groupLocks(list, [[root]], corners);
	// A patch that cannot lose a triangle keeps its children's, so the chain stops at the first
	// step that does not shrink the patch.
	while (root.indices.length / 3 > CLUSTER_ROOT_TRIANGLES) {
		const coarser = simplifyPatch(list, full, [root], rootLocks, side);
		if (coarser.indices.length >= root.indices.length) break;
		root = coarser;
	}
	return { root, leaves: leaves.length };
}

/**
 * The sphere around a patch's own triangles: the middle of their box, and the distance to their
 * farthest vertex, as 32-bit floats that still enclose every vertex.
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
		return Math.fround((first + second) / 2);
	};
	const centre = [middle(0), middle(1), middle(2)];
	let radius = 0;
	for (const v of indices) {
		const dx = /** @type {number} */ (positions[v * 3]) - /** @type {number} */ (centre[0]);
		const dy = /** @type {number} */ (positions[v * 3 + 1]) - /** @type {number} */ (centre[1]);
		const dz = /** @type {number} */ (positions[v * 3 + 2]) - /** @type {number} */ (centre[2]);
		radius = Math.max(radius, Math.hypot(dx, dy, dz));
	}
	return [...centre, radiusUp(radius)];
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
	const list = weld(prim, positions);
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
		bounds.set(patch.sphere, k * 4);
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

/** The fewest patches that the model file holds in a tree before its bands start. */
export const BAND_MIN_PATCHES = 8;

/**
 * The most bands that one tree splits into, the file's own counted: the engine counts a band's
 * picks in a 32-bit mask.
 */
export const BAND_MAX = 32;

/**
 * The patches of a tree cut into bands, in the order they stream: the file holds the first band,
 * which reaches {@link BAND_MIN_PATCHES} patches or the whole tree, and each band after it holds
 * the patches of one depth, so a patch's parent always lies in an earlier band. A tree with more
 * depths than {@link BAND_MAX} joins its deepest ones into the last band.
 *
 * @param {ClusterPlan} plan
 * @returns {number[][]} The patches of each band, by their place in the plan.
 */
export function splitTree(plan) {
	const count = plan.patches.length / 4;
	/** The depth of each patch, which the plan's order gives: parents come before their children. */
	const depth = new Uint32Array(count);
	for (let k = 0; k < count; k++) {
		const parent = /** @type {number} */ (plan.patches[k * 4 + 2]) - 1;
		depth[k] = parent < 0 ? 0 : /** @type {number} */ (depth[parent]) + 1;
	}
	/** @type {number[][]} */
	const byDepth = [];
	for (let k = 0; k < count; k++) {
		const d = /** @type {number} */ (depth[k]);
		let list = byDepth[d];
		if (!list) {
			list = [];
			byDepth[d] = list;
		}
		list.push(k);
	}
	/** @type {number[][]} */
	const bands = [];
	/** @type {number[]} */
	let run = [];
	let first = true;
	/**
	 * Appends the patches of one list to another, which a tree of many leaves may fill.
	 *
	 * @param {number[]} to
	 * @param {number[]} ids
	 */
	const add = (to, ids) => {
		for (const id of ids) to.push(id);
	};
	for (const ids of byDepth) {
		if (!ids) continue;
		add(run, ids);
		if (first && run.length >= BAND_MIN_PATCHES) {
			bands.push(run);
			run = [];
			first = false;
		} else if (!first) {
			bands.push(run);
			run = [];
		}
	}
	if (run.length > 0) {
		if (bands.length === 0) {
			bands.push(run);
		} else {
			add(/** @type {number[]} */ (bands[bands.length - 1]), run);
		}
	}
	while (bands.length > BAND_MAX) {
		const last = /** @type {number[]} */ (bands.pop());
		add(/** @type {number[]} */ (bands[bands.length - 1]), last);
	}
	return bands;
}

/**
 * One band of a tree as the file or a stage file holds it: each patch's sphere and record, and the
 * band's indices. A record's first index counts from the band's own indices, and its parent names
 * the patch's place in the whole streamed tree, plus one.
 *
 * @param {ClusterPlan} plan
 * @param {number[]} ids The band's patches, by their place in the plan.
 * @param {Uint32Array} places Each patch's place in the streamed tree.
 */
function bandArrays(plan, ids, places) {
	const total = ids.reduce((sum, id) => sum + /** @type {number} */ (plan.patches[id * 4 + 1]), 0);
	const indices = new Uint32Array(total);
	const bounds = new Float32Array(ids.length * 4);
	const records = new Uint32Array(ids.length * 4);
	let at = 0;
	ids.forEach((id, k) => {
		const first = /** @type {number} */ (plan.patches[id * 4]);
		const count = /** @type {number} */ (plan.patches[id * 4 + 1]);
		const parent = /** @type {number} */ (plan.patches[id * 4 + 2]) - 1;
		bounds.set(plan.bounds.subarray(id * 4, id * 4 + 4), k * 4);
		records[k * 4] = at;
		records[k * 4 + 1] = count;
		records[k * 4 + 2] = parent < 0 ? 0 : /** @type {number} */ (places[parent]) + 1;
		records[k * 4 + 3] = /** @type {number} */ (plan.patches[id * 4 + 3]);
		indices.set(plan.indices.subarray(first, first + count), at);
		at += count;
	});
	return { bounds, records, indices };
}

/**
 * Keeps only one band of a tree in its plan, so that the model file stores that band as the tree
 * that draws the first picture.
 *
 * @param {ClusterPlan} plan
 * @param {number[]} ids
 * @param {Uint32Array} places
 */
function keepBand(plan, ids, places) {
	const band = bandArrays(plan, ids, places);
	plan.indices = band.indices;
	plan.bounds = band.bounds;
	plan.patches = band.records;
	plan.root = 0;
}

/**
 * Writes the bands of each tree after the one that its model file holds, and names them in the
 * extras of the nodes that draw the mesh. Only a tree that the engine draws as patches streams: a
 * mesh with one copy and one part, within the vertices that 16-bit indices reach. Every other tree
 * stays whole in the file. The plan keeps its first band, which the model file stores.
 *
 * @param {Document} doc
 * @param {Map<Primitive, ClusterPlan>} plans
 * @param {Map<string, Uint8Array>} stages The stage files by their address beside the model.
 * @param {string} prefix The model's name, which the stages' names start with.
 * @returns {{ trees: number, files: number, bytes: number, bands: number, patches: number }}
 */
export function bandClusters(doc, plans, stages, prefix) {
	const summary = { trees: 0, files: 0, bytes: 0, bands: 0, patches: 0 };
	const meshes = doc.getRoot().listMeshes();
	for (const [prim, plan] of plans) {
		const mesh = /** @type {Mesh | undefined} */ (
			prim.listParents().find((parent) => parent.propertyType === 'Mesh')
		);
		if (!mesh) continue;
		const vertices = prim.getAttribute('POSITION')?.getCount() ?? 0;
		if (vertices > 0xffff || copiesOf(mesh) !== 1) continue;
		const bands = splitTree(plan);
		if (bands.length < 2) continue;
		const places = new Uint32Array(plan.patches.length / 4);
		let next = 0;
		for (const ids of bands) for (const id of ids) places[id] = next++;
		const meshIndex = meshes.indexOf(mesh);
		const primIndex = mesh.listPrimitives().indexOf(prim);
		/** @type {{ primitive: number, url: string, bytes: number }[]} */
		const names = [];
		for (let k = 1; k < bands.length; k++) {
			const band = bandArrays(plan, /** @type {number[]} */ (bands[k]), places);
			const name = `${prefix}.m${meshIndex}.p${primIndex}.band${k}.bin`;
			const file = bandFile(band.bounds, band.records, band.indices);
			stages.set(name, file);
			summary.files += 1;
			summary.bytes += file.byteLength;
			summary.bands += 1;
			names.push({ primitive: primIndex, url: name, bytes: file.byteLength });
		}
		summary.patches += plan.patches.length / 4;
		summary.trees += 1;
		keepBand(plan, /** @type {number[]} */ (bands[0]), places);
		for (const parent of mesh.listParents()) {
			if (parent.propertyType !== 'Node') continue;
			const node = /** @type {import('@gltf-transform/core').Node} */ (parent);
			const extras = node.getExtras();
			const staged =
				/** @type {{ bands?: { primitive: number, url: string, bytes: number }[] }} */ (
					extras.NULL3D_stages ?? {}
				);
			// A mesh with several trees names the bands of each, so the earlier ones stay.
			node.setExtras({
				...extras,
				NULL3D_stages: { ...staged, bands: [...(staged.bands ?? []), ...names] },
			});
		}
	}
	return summary;
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
