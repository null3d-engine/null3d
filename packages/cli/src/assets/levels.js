// The tool's levels of detail. The planner itself is the engine's (`@null3d/engine/levels-planner`),
// which the engine also runs on meshes made in code: this file reads a glTF file's meshes into its
// plain arrays, poses a skinned mesh at rest, and writes the planned levels into the file, as
// MSFT_lod gives them or as separate downloads.
import { MathUtils } from '@gltf-transform/core';
import {
	LOD_FLOOR_TRIANGLES,
	LOD_MAX_LEVELS,
	LOD_MIN_TRIANGLES,
	longestSide,
	planMeshLevels,
	simplifyTries as planTries,
	simplifierFlags,
	simplifyStep,
	weldList,
} from '@null3d/engine/levels-planner';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
	cacheOrder,
	reorderVertices,
	setIndices,
	triangleIndices,
	triangleLists,
} from './geometry.js';
import { lodOf, MSFT_LOD, MSFTLod } from './lod-extension.js';

/** @import { Accessor, Buffer, Document, Mesh, Node, Primitive, Skin } from '@gltf-transform/core' */
/** @import { Meshopt, PlannedLevel, PlanningList as ListPlan, SimplifierFlag } from '@null3d/engine/levels-planner' */
/** @import { ClusterPlan } from './clusters.js' */

export { LOD_FLOOR_TRIANGLES, LOD_MAX_LEVELS, LOD_MIN_TRIANGLES };

/**
 * The screen height in pixels that the stored screen coverage assumes, for readers of MSFT_lod
 * that pick levels by coverage. The engine reads each level's error instead.
 */
export const LOD_SCREEN_PIXELS = 1080;

/**
 * The largest error of a simplified base mesh by default, as a share of the mesh's longest side:
 * gltfpack's default.
 */
export const SIMPLIFY_MAX_ERROR = 0.01;

/** The planner's calls of meshoptimizer, from its npm package, which the tool awaits first. */
const MESHOPT = /** @type {Meshopt} */ ({
	simplifyWithAttributes: MeshoptSimplifier.simplifyWithAttributes,
	cacheOrder,
});

/**
 * Simplifies a triangle list toward a share of its triangles in each of the simplifier's four
 * ways, as the shared planner's `simplifyTries` does, with the npm package's simplifier: the whole
 * levels and the patches of a cluster tree both choose this way.
 *
 * @param {PlanningList} list
 * @param {Uint32Array} indices The triangles to simplify, a subset of the list's welded ones.
 * @param {number} share
 * @param {number} limit The largest error, in planning units.
 * @param {SimplifierFlag[]} flags
 * @param {[Uint8Array | null, Uint8Array | null]} [locks]
 */
export const simplifyTries = (list, indices, share, limit, flags, locks) =>
	planTries(MESHOPT, list, indices, share, limit, flags, locks);

/**
 * An accessor's values in the mesh's units: normalized integers become the fractions they
 * stand for.
 *
 * @param {Accessor} accessor
 */
function floats(accessor) {
	const out = Float32Array.from(/** @type {ArrayLike<number>} */ (accessor.getArray()));
	if (accessor.getNormalized()) {
		const type = accessor.getComponentType();
		for (let i = 0; i < out.length; i++)
			out[i] = MathUtils.decodeNormalizedInt(/** @type {number} */ (out[i]), type);
	}
	return out;
}

/**
 * The product of two column-major 4 x 4 matrices.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
function multiply(a, b) {
	const out = new Float64Array(16);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let sum = 0;
			for (let k = 0; k < 4; k++)
				sum += /** @type {number} */ (a[k * 4 + r]) * /** @type {number} */ (b[c * 4 + k]);
			out[c * 4 + r] = sum;
		}
	return out;
}

/**
 * The positions of a skinned triangle list in its skeleton's rest pose: each vertex moved by its
 * joints as the file places them, through their inverse bind matrices. A vertex with no weight
 * keeps its place.
 *
 * @param {Primitive} prim
 * @param {Float32Array} positions
 * @param {Skin} skin
 */
function restPose(prim, positions, skin) {
	const bind = skin.getInverseBindMatrices();
	const matrices = skin
		.listJoints()
		.map((joint, j) =>
			multiply(
				joint.getWorldMatrix(),
				bind ? bind.getElement(j, []) : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
			),
		);
	const sets = [];
	for (let k = 0; prim.getAttribute(`JOINTS_${k}`) && prim.getAttribute(`WEIGHTS_${k}`); k++)
		sets.push({
			joints: /** @type {ArrayLike<number>} */ (
				/** @type {Accessor} */ (prim.getAttribute(`JOINTS_${k}`)).getArray()
			),
			weights: floats(/** @type {Accessor} */ (prim.getAttribute(`WEIGHTS_${k}`))),
		});
	const out = new Float32Array(positions.length);
	for (let v = 0; v < positions.length / 3; v++) {
		const x = /** @type {number} */ (positions[v * 3]);
		const y = /** @type {number} */ (positions[v * 3 + 1]);
		const z = /** @type {number} */ (positions[v * 3 + 2]);
		let px = 0;
		let py = 0;
		let pz = 0;
		let total = 0;
		for (const { joints, weights } of sets)
			for (let i = v * 4; i < v * 4 + 4; i++) {
				const w = /** @type {number} */ (weights[i]);
				const m = matrices[/** @type {number} */ (joints[i])];
				if (w === 0 || !m) continue;
				const at = (/** @type {number} */ k) => /** @type {number} */ (m[k]);
				px += w * (at(0) * x + at(4) * y + at(8) * z + at(12));
				py += w * (at(1) * x + at(5) * y + at(9) * z + at(13));
				pz += w * (at(2) * x + at(6) * y + at(10) * z + at(14));
				total += w;
			}
		out.set(total > 0 ? [px / total, py / total, pz / total] : [x, y, z], v * 3);
	}
	return out;
}

/**
 * A triangle list as the simplifier plans it, with the primitive it came from.
 *
 * @typedef {ListPlan & { prim: Primitive }} PlanningList
 */

/**
 * Welds a primitive's vertices for planning, as the shared planner's `weldList` does: vertices
 * merge when they share their place, texture coordinates, color and tangent handedness, and their
 * normals lie within 20 degrees.
 *
 * @param {Primitive} prim
 * @param {Float32Array} positions
 * @param {boolean} posed
 * @param {number} [side] The mesh's longest side, which a texture coordinate's unit weighs; 0
 *   leaves the texture coordinates out of the error, for a caller that reads only the triangles.
 * @returns {PlanningList}
 */
export function weld(prim, positions, posed = false, side = 0) {
	const stream = (/** @type {string} */ semantic) => {
		const accessor = prim.getAttribute(semantic);
		return accessor ? { values: floats(accessor), size: accessor.getElementSize() } : null;
	};
	const list = weldList(
		{
			positions,
			normal: stream('NORMAL'),
			color: stream('COLOR_0'),
			tangent: stream('TANGENT'),
			texcoords: prim
				.listSemantics()
				.filter((s) => s.startsWith('TEXCOORD_'))
				.map((s) => /** @type {{ values: Float32Array, size: number }} */ (stream(s))),
			indices: triangleIndices(prim, positions.length / 3),
		},
		posed,
		side,
	);
	return { ...list, prim };
}

/**
 * The skin of the first node that draws a mesh with one, or null.
 *
 * @param {Mesh} mesh
 */
const skinOf = (mesh) =>
	/** @type {Node[]} */ (mesh.listParents().filter((p) => p.propertyType === 'Node'))
		.map((node) => node.getSkin())
		.find((skin) => skin !== null) ?? null;

/**
 * A mesh's triangle lists as the simplifier plans them, with the mesh's longest side. A skinned
 * mesh plans in its skeleton's rest pose, as it draws, so its distances are in the units of the
 * scene that holds the skeleton.
 *
 * @param {Mesh} mesh
 * @param {Primitive[]} prims
 */
function planningLists(mesh, prims) {
	const skin = skinOf(mesh);
	let side = 0;
	const placed = prims.map((prim) => {
		const own = floats(/** @type {Accessor} */ (prim.getAttribute('POSITION')));
		const posed =
			skin && prim.getAttribute('JOINTS_0') && prim.getAttribute('WEIGHTS_0')
				? restPose(prim, own, skin)
				: own;
		side = Math.max(side, longestSide(posed));
		return { own, posed };
	});
	const lists = prims.map((prim, p) => {
		const { own, posed } = /** @type {{ own: Float32Array, posed: Float32Array }} */ (placed[p]);
		return weld(prim, posed, posed !== own, side);
	});
	return { lists, side };
}

/**
 * True for a mesh whose lists bend, with joints or morph targets, which the simplifier keeps in
 * evener triangles.
 *
 * @param {Primitive[]} prims
 */
const bends = (prims) =>
	prims.some((prim) => prim.getAttribute('JOINTS_0') !== null || prim.listTargets().length > 0);

/**
 * The levels of detail of one mesh: each level's indices for each triangle list, its error, and
 * the positions of the lists whose vertices a step moved.
 *
 * @typedef {object} MeshLevels
 * @property {Primitive[]} prims The mesh's triangle lists, in the order of each level's indices.
 * @property {number} side The mesh's longest side, in the units of its errors.
 * @property {PlannedLevel[]} levels The lower levels, from the most detailed down. A list of cards
 *   keeps its own positions, with each kept card grown; the other lists share the mesh's. The
 *   error is the largest distance between the level's surface and the full mesh's, in the units of
 *   the mesh's stored positions, or of the scene that holds its skeleton for a skinned mesh, in
 *   its rest pose.
 */

/**
 * True for a mesh that a file's own levels already use, as the full mesh or as a level.
 *
 * @param {Mesh} mesh
 */
const hasLevels = (mesh) =>
	mesh
		.listParents()
		.some(
			(p) =>
				p.propertyType === 'Node' &&
				(lodOf(/** @type {Node} */ (p)) !== null ||
					p.listParents().some((q) => q.propertyType === 'Lod')),
		);

/**
 * Plans levels of detail for each mesh of enough triangles, with the shared planner
 * (`planMeshLevels`). Meshes whose levels the file already has keep them.
 *
 * A mesh with a tree of cluster patches gets the same levels, whatever `simplify` says: a viewer
 * that draws no patches, and every copy that draws whole levels, draws them in place of the tree.
 *
 * Run after quantizing: the planning reads the positions as stored, so the errors are in the
 * units that the file's mesh has.
 *
 * @param {Document} doc
 * @param {Map<Primitive, ClusterPlan>} [trees] The trees of cluster patches, by the primitive that
 *   draws each.
 * @param {boolean} [simplify] Whether meshes without a tree get levels too.
 * @returns {Promise<Map<Mesh, MeshLevels>>}
 */
export async function planLevels(doc, trees = new Map(), simplify = true) {
	await MeshoptSimplifier.ready;
	/** @type {Map<Mesh, MeshLevels>} */
	const plans = new Map();
	for (const mesh of doc.getRoot().listMeshes()) {
		const prims = triangleLists(mesh);
		const total = prims.reduce((sum, prim) => {
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			return sum + (prim.getIndices()?.getCount() ?? count) / 3;
		}, 0);
		if (total < LOD_MIN_TRIANGLES || hasLevels(mesh)) continue;
		if (!simplify && !prims.some((prim) => trees.has(prim))) continue;
		const { lists, side } = planningLists(mesh, prims);
		if (side === 0) continue;
		const levels = planMeshLevels(MESHOPT, lists, total, side, simplifierFlags(bends(prims)));
		if (levels.length > 0) plans.set(mesh, { prims, side, levels });
	}
	return plans;
}

/**
 * Orders each planned mesh's vertices so that a coarse level names a prefix of them, as
 * meshoptimizer's README advises: the coarsest level's vertices first, then each finer level's new
 * ones, then the base mesh's own, and any vertex that no triangle uses last. A viewer can then send
 * a coarse level's part of the buffer first and add the finer parts as they download. The base and
 * every level keep their triangles: only the vertex numbering changes.
 *
 * @param {Document} doc
 * @param {Map<Mesh, MeshLevels>} plans
 * @param {Map<Primitive, ClusterPlan>} [trees] The trees whose indices name the same vertices,
 *   which the new numbering renames too.
 */
export function orderLevels(doc, plans, trees = new Map()) {
	for (const [, plan] of plans) {
		plan.prims.forEach((prim, p) => {
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			/** @type {number[]} */
			const order = [];
			const seen = new Uint8Array(count);
			/** @param {Uint32Array} indices */
			const take = (indices) => {
				for (const vertex of indices)
					if (!seen[vertex]) {
						seen[vertex] = 1;
						order.push(vertex);
					}
			};
			// The coarsest level first, then each finer one, then the base mesh itself.
			for (let k = plan.levels.length - 1; k >= 0; k--) {
				const level = plan.levels[k];
				if (level) take(/** @type {Uint32Array} */ (level.indices[p]));
			}
			take(triangleIndices(prim, count));
			for (let vertex = 0; vertex < count; vertex++) if (!seen[vertex]) order.push(vertex);
			const remap = new Uint32Array(count);
			order.forEach((vertex, at) => {
				remap[vertex] = at;
			});
			reorderVertices(doc, prim, remap);
			for (const level of plan.levels) {
				const indices = /** @type {Uint32Array} */ (level.indices[p]);
				level.indices[p] = Uint32Array.from(
					indices,
					(vertex) => /** @type {number} */ (remap[vertex]),
				);
				const positions = level.positions[p];
				if (!positions) continue;
				const moved = new Float32Array(positions.length);
				for (let vertex = 0; vertex < count; vertex++)
					for (let c = 0; c < 3; c++)
						moved[/** @type {number} */ (remap[vertex]) * 3 + c] = /** @type {number} */ (
							positions[vertex * 3 + c]
						);
				level.positions[p] = moved;
			}
			const tree = trees.get(prim);
			if (tree)
				for (let i = 0; i < tree.indices.length; i++)
					tree.indices[i] = /** @type {number} */ (remap[/** @type {number} */ (tree.indices[i])]);
		});
	}
}

/**
 * Simplifies each triangle list to a share of its triangles, as far as an error limit allows, as
 * gltfpack's `-si` and `-se` do. The base mesh then draws fewer triangles at
 * every distance. A list that cannot lose a triangle keeps its own indices. Vertices that no
 * triangle uses stay until the reorder step drops them.
 *
 * @param {Document} doc
 * @param {number} share From 0 to 1.
 * @param {number} [maxError] The largest error, as a share of each mesh's longest side.
 */
export async function simplifyMeshes(doc, share, maxError = SIMPLIFY_MAX_ERROR) {
	await MeshoptSimplifier.ready;
	for (const mesh of doc.getRoot().listMeshes()) {
		const prims = triangleLists(mesh);
		if (prims.length === 0 || hasLevels(mesh)) continue;
		const { lists, side } = planningLists(mesh, prims);
		if (side === 0) continue;
		const step = simplifyStep(
			MESHOPT,
			lists,
			lists.map((list) => list.indices),
			share,
			maxError * side,
			simplifierFlags(bends(prims)),
		);
		prims.forEach((prim, p) => {
			const indices = /** @type {Uint32Array} */ (step.indices[p]);
			const list = /** @type {PlanningList} */ (lists[p]);
			if (indices.length === list.indices.length) return;
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			setIndices(doc, prim, indices, count);
		});
	}
}

/**
 * The screen coverage of each level, for readers that pick levels by it: the share of the
 * screen's height below which the level after it errs by less than a pixel of a screen
 * {@link LOD_SCREEN_PIXELS} high. The lowest level's is 0, so it draws at any distance.
 *
 * @param {readonly { error: number }[]} levels The lower levels.
 * @param {number} side The mesh's longest side, in the units of the errors.
 */
export function levelCoverage(levels, side) {
	const coverage = levels.map(({ error }) =>
		error > 0 ? Math.min(1, side / (LOD_SCREEN_PIXELS * error)) : 1,
	);
	return [...coverage, 0];
}

/**
 * A copy of a position accessor with new values, in the accessor's own component type, so that a
 * mesh keeps one vertex format. Values outside the type's range take its ends.
 *
 * @param {Document} doc
 * @param {Accessor} base
 * @param {Float32Array} values
 * @param {Buffer} buffer
 */
function positionAccessor(doc, base, values, buffer) {
	const source = /** @type {Float32Array} */ (base.getArray());
	const Type =
		/** @type {Float32ArrayConstructor | Uint16ArrayConstructor | Int16ArrayConstructor | Uint8ArrayConstructor | Int8ArrayConstructor} */ (
			source.constructor
		);
	const out = new Type(values.length);
	if (Type === Float32Array) out.set(values);
	else {
		const normalized = base.getNormalized();
		const unsigned = Type === Uint8Array || Type === Uint16Array;
		const bits = 8 * Type.BYTES_PER_ELEMENT;
		const max = normalized || unsigned ? 2 ** bits - 1 : 2 ** (bits - 1) - 1;
		const min = normalized || unsigned ? 0 : -(2 ** (bits - 1));
		for (let i = 0; i < values.length; i++)
			out[i] = Math.min(max, Math.max(min, Math.round(/** @type {number} */ (values[i]))));
	}
	return doc
		.createAccessor(base.getName())
		.setType('VEC3')
		.setNormalized(base.getNormalized())
		.setArray(out)
		.setBuffer(buffer);
}

/**
 * The magic number that a stage file starts with, as the word `N3DS` counted little-endian.
 * @type {number}
 */
export const STAGE_MAGIC = 0x5344334e;
/** The version of the stage layout that the tool writes. */
export const STAGE_VERSION = 1;
/** The kind of a stage that holds a level's triangles, one list for each of a mesh's primitives. */
export const STAGE_LEVELS = 0;
/** The kind of a stage that holds one band of a tree of cluster patches. */
export const STAGE_BAND = 1;
/** The words of a stage file's header: its magic number, its version, its kind and a count. */
export const STAGE_HEADER_SIZE = 4;

/**
 * A stage file: its header, then for each triangle list its index count, the number of bytes of
 * each index, and its indices padded to a whole word. The lists follow the order of a mesh's
 * primitives. Every number counts little-endian, as the engine reads it.
 *
 * @param {Uint32Array[]} lists
 * @returns {Uint8Array}
 */
export function stageFile(lists) {
	const placed = lists.map((indices) => {
		const size = indices.some((index) => index > 0xffff) ? 4 : 2;
		return { indices, size, bytes: Math.ceil((indices.length * size) / 4) * 4 };
	});
	const length = STAGE_HEADER_SIZE * 4 + placed.reduce((sum, list) => sum + 8 + list.bytes, 0);
	const out = new Uint8Array(length);
	const view = new DataView(out.buffer);
	view.setUint32(0, STAGE_MAGIC, true);
	view.setUint32(4, STAGE_VERSION, true);
	view.setUint32(8, STAGE_LEVELS, true);
	view.setUint32(12, lists.length, true);
	let at = STAGE_HEADER_SIZE * 4;
	for (const { indices, size, bytes } of placed) {
		view.setUint32(at, indices.length, true);
		view.setUint32(at + 4, size, true);
		const array = size === 2 ? new Uint16Array(bytes / 2) : new Uint32Array(bytes / 4);
		array.set(indices);
		out.set(new Uint8Array(array.buffer), at + 8);
		at += 8 + bytes;
	}
	return out;
}

/**
 * A stage file of one band of a tree of cluster patches: the header with the band's kind and its
 * count of 1, then the patch count, then each patch's sphere and record, then the band's indices as
 * kind 0 frames a list. A record's first index counts from the band's own indices, and its parent
 * names a patch that the model file or an earlier band holds. Every number counts little-endian,
 * as the engine reads it.
 *
 * @param {Float32Array} bounds Each patch's centre and radius, as four floats.
 * @param {Uint32Array} records Each patch's first index, index count, parent's place plus one, and
 *   error's bits, as four integers.
 * @param {Uint32Array} indices The band's indices.
 * @returns {Uint8Array}
 */
export function bandFile(bounds, records, indices) {
	const patches = records.length / 4;
	const size = indices.some((index) => index > 0xffff) ? 4 : 2;
	const bytes = Math.ceil((indices.length * size) / 4) * 4;
	const length = (STAGE_HEADER_SIZE + 1) * 4 + patches * 32 + 8 + bytes;
	const out = new Uint8Array(length);
	const view = new DataView(out.buffer);
	view.setUint32(0, STAGE_MAGIC, true);
	view.setUint32(4, STAGE_VERSION, true);
	view.setUint32(8, STAGE_BAND, true);
	view.setUint32(12, 1, true);
	view.setUint32(16, patches, true);
	let at = (STAGE_HEADER_SIZE + 1) * 4;
	// Eight words a patch: its sphere's four floats, then its record's four integers.
	for (let k = 0; k < patches; k++) {
		for (let c = 0; c < 4; c++) {
			view.setFloat32(at, /** @type {number} */ (bounds[k * 4 + c]), true);
			at += 4;
		}
		for (let c = 0; c < 4; c++) {
			view.setUint32(at, /** @type {number} */ (records[k * 4 + c]), true);
			at += 4;
		}
	}
	view.setUint32(at, indices.length, true);
	view.setUint32(at + 4, size, true);
	const array = size === 2 ? new Uint16Array(bytes / 2) : new Uint32Array(bytes / 4);
	array.set(indices);
	out.set(new Uint8Array(array.buffer), at + 8);
	return out;
}

/**
 * A mesh's level as a new accessor of its triangles, in the type that holds its vertex count.
 *
 * @param {Document} doc
 * @param {Accessor} positions
 * @param {Uint32Array} indices
 * @param {Buffer} buffer
 */
function indicesAccessor(doc, positions, indices, buffer) {
	const count = positions.getCount();
	return doc
		.createAccessor()
		.setType('SCALAR')
		.setArray(count <= 0xffff ? Uint16Array.from(indices) : Uint32Array.from(indices))
		.setBuffer(buffer);
}

/**
 * A level's triangle lists as index arrays, one for each of the mesh's primitives.
 *
 * @param {MeshLevels['levels'][number]} level
 * @returns {Uint32Array[]}
 */
function levelIndices(level) {
	return level.indices.map((indices) => /** @type {Uint32Array} */ (indices));
}

/**
 * Stores the planned levels as separate downloads, for a model that draws its coarse level first:
 * each mesh's own triangles become its coarsest level, and each finer level goes into a stage file
 * of its own beside the model. Every node that draws the mesh names its stages in
 * `NULL3D_stages`, with the error of each level, so the engine downloads them from the coarsest
 * down and draws each as it arrives.
 *
 * A mesh whose levels hold positions of their own, such as a level of cards, cannot share its
 * vertices with a stage, so its levels stay in the file as `MSFT_lod` gives them. A mesh with one
 * level has nothing to stream, and keeps its levels in the file too. A mesh with a tree of cluster
 * patches keeps its whole levels in the file as well: the tree's bands are what stream, and the
 * levels draw the mesh whole on the paths that draw no patches.
 *
 * @param {Document} doc
 * @param {Map<Mesh, MeshLevels>} plans
 * @param {Map<string, Uint8Array>} stages The stage files by their address beside the model.
 * @param {string} prefix The model's name, which the stages' names start with.
 * @param {Map<Primitive, ClusterPlan>} [trees] The trees that the mesh's primitives draw.
 * @returns {{ meshes: number, files: number, bytes: number, levels: number }} The staged meshes.
 */
export function storeStages(doc, plans, stages, prefix, trees = new Map()) {
	const extension = doc.createExtension(MSFTLod);
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const summary = { meshes: 0, files: 0, bytes: 0, levels: 0 };
	const meshes = doc.getRoot().listMeshes();
	plans.forEach((plan, mesh) => {
		const { prims, levels } = plan;
		if (prims.some((prim) => trees.has(prim))) {
			storeLevels(doc, new Map([[mesh, plan]]), extension);
			return;
		}
		const shared = levels.every((level) => level.positions.every((p) => p === undefined));
		if (!shared || levels.length < 2) {
			storeLevels(doc, new Map([[mesh, plan]]), extension);
			return;
		}
		const own = prims.map((prim) => prim.getIndices()?.getArray());
		if (own.some((values) => values === undefined)) {
			storeLevels(doc, new Map([[mesh, plan]]), extension);
			return;
		}
		const index = meshes.indexOf(mesh);
		/** @type {{ url: string, bytes: number, error: number }[]} */
		const names = [];
		/**
		 * Puts the triangles of one level, or of the mesh itself, into a stage file.
		 *
		 * @param {Uint32Array[]} lists
		 * @param {number} error
		 */
		const stage = (lists, error) => {
			const name = `${prefix}.m${index}.lod${names.length + 1}.bin`;
			const file = stageFile(lists);
			stages.set(name, file);
			summary.files += 1;
			summary.bytes += file.byteLength;
			summary.levels += 1;
			names.push({ url: name, bytes: file.byteLength, error });
		};
		// The file keeps the coarsest level. The stages follow from the next coarsest down to the
		// mesh itself, so each one refines the triangles that the one before it drew, and the
		// finest picture is the full mesh.
		const coarsest = /** @type {MeshLevels['levels'][number]} */ (levels[levels.length - 1]);
		prims.forEach((prim, p) => {
			const positions = /** @type {Accessor} */ (prim.getAttribute('POSITION'));
			prim.setIndices(
				indicesAccessor(doc, positions, /** @type {Uint32Array} */ (coarsest.indices[p]), buffer),
			);
		});
		for (let k = levels.length - 2; k >= 0; k--) {
			const level = /** @type {MeshLevels['levels'][number]} */ (levels[k]);
			stage(levelIndices(level), level.error);
		}
		stage(
			own.map((indices) => Uint32Array.from(/** @type {Uint16Array | Uint32Array} */ (indices))),
			0,
		);
		const staged = { error: coarsest.error, levels: names };
		for (const node of mesh.listParents().filter((p) => p.propertyType === 'Node')) {
			const base = /** @type {Node} */ (node);
			base.setExtras({ ...base.getExtras(), NULL3D_stages: staged });
		}
		summary.meshes += 1;
	});
	// The extension stays only when some mesh keeps its levels in the file.
	if (
		!doc
			.getRoot()
			.listExtensionsUsed()
			.some((e) => e.extensionName === MSFT_LOD)
	)
		extension.dispose();
	return summary;
}

/**
 * Stores the planned levels in the document, as MSFT_lod gives them: a mesh for each level, whose
 * triangle lists share the mesh's vertex streams and materials, and a node for each level beside
 * each node that draws the mesh, with that node's transform, skin and instances. A list of cards
 * takes its own positions, with each kept card grown, which the level's primitive reads in place
 * of the base mesh's. The node names its levels and gives each level's error and screen coverage.
 *
 * @param {Document} doc
 * @param {Map<Mesh, MeshLevels>} plans
 * @param {MSFTLod} [own] The extension to use, where a caller stores some meshes as downloads and
 *   keeps others in the file.
 */
export function storeLevels(doc, plans, own) {
	if (plans.size === 0) return;
	const extension = own ?? doc.createExtension(MSFTLod);
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	for (const [mesh, { prims, side, levels }] of plans) {
		const meshes = levels.map((level, k) => {
			const lower = doc.createMesh(`${mesh.getName()}_lod${k + 1}`);
			prims.forEach((prim, p) => {
				const indices = /** @type {Uint32Array} */ (level.indices[p]);
				if (indices.length === 0) return;
				const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
				const copy = doc
					.createPrimitive()
					.setMode(prim.getMode())
					.setMaterial(prim.getMaterial())
					.setIndices(
						doc
							.createAccessor()
							.setType('SCALAR')
							.setArray(count <= 0xffff ? Uint16Array.from(indices) : Uint32Array.from(indices))
							.setBuffer(buffer),
					);
				const positions = level.positions[p];
				for (const semantic of prim.listSemantics()) {
					const base = /** @type {Accessor} */ (prim.getAttribute(semantic));
					copy.setAttribute(
						semantic,
						semantic === 'POSITION' && positions
							? positionAccessor(doc, base, positions, buffer)
							: base,
					);
				}
				for (const target of prim.listTargets()) copy.addTarget(target);
				lower.addPrimitive(copy);
			});
			return lower;
		});
		const coverage = levelCoverage(levels, side);
		const errors = levels.map((level) => level.error);
		for (const node of mesh.listParents().filter((p) => p.propertyType === 'Node')) {
			const base = /** @type {Node} */ (node);
			const instancing = base.getExtension('EXT_mesh_gpu_instancing');
			const lod = extension.createLod().setCoverage(coverage).setErrors(errors);
			meshes.forEach((lower, k) => {
				const level = doc
					.createNode(`${base.getName()}_lod${k + 1}`)
					.setMesh(lower)
					.setSkin(base.getSkin())
					.setTranslation(base.getTranslation())
					.setRotation(base.getRotation())
					.setScale(base.getScale());
				if (instancing)
					level.setExtension('EXT_mesh_gpu_instancing', /** @type {any} */ (instancing).clone());
				lod.addLevel(level);
			});
			base.setExtension(MSFT_LOD, /** @type {any} */ (lod));
		}
	}
}
