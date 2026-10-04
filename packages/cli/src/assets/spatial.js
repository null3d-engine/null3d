// The tool's step for the data that culling and raycasts read: a blocker mesh for each mesh that
// encloses space, which software occlusion culling draws in its place, and the stored tree over
// the triangles of each large mesh, which raycasts load instead of building. Both come from the
// engine's Rust core through the formats module, so their bytes are the same on every machine.
// The step runs after quantization, on the positions that the engine reads.
import { blockerMesh, meshBvh } from './formats.js';
import { triangleIndices, triangleLists } from './geometry.js';
import { Null3dMeshBvh, Null3dOccluder } from './spatial-extensions.js';

/** @import { Accessor, Document, Mesh, Node, Primitive } from '@gltf-transform/core' */

/**
 * The fewest triangles of a primitive whose tree the tool stores, by default. A stored tree takes
 * about 20 bytes per triangle in the file, where a job worker builds one in about a quarter of a
 * microsecond per triangle, so only large meshes, whose build would hold up a frame, gain.
 */
export const BVH_MIN_TRIANGLES = 20_000;

/**
 * @typedef {object} SpatialOptions
 * @property {boolean} blockers Make blockers.
 * @property {number} bvhMinTriangles The fewest triangles of a primitive whose tree the file
 *   stores, or `Infinity` for none.
 */

/**
 * @typedef {object} SpatialReport
 * @property {number} blockers Meshes that got a blocker.
 * @property {number} blockerTriangles The triangles of their blockers.
 * @property {number} ownBlockers Meshes that block with their own triangles, as their settings
 *   ask.
 * @property {{ mesh: string, reason: string }[]} noBlocker Meshes that could block but got no
 *   blocker, and why.
 * @property {number} trees Primitives whose tree the file stores.
 * @property {number} treeBytes The bytes of those trees.
 */

/**
 * The positions of a primitive as the engine reads them: floats, or integers that are not
 * normalized, as 32-bit floats. Null for normalized integers, which the engine divides.
 *
 * @param {Primitive} prim
 */
function enginePositions(prim) {
	const position = /** @type {Accessor} */ (prim.getAttribute('POSITION'));
	if (position.getNormalized()) return null;
	return Float32Array.from(/** @type {ArrayLike<number>} */ (position.getArray()));
}

/**
 * The meshes that nodes of the document's scenes draw, each with those nodes.
 *
 * @param {Document} doc
 * @returns {Map<Mesh, Node[]>}
 */
function drawnMeshes(doc) {
	/** @type {Map<Mesh, Node[]>} */
	const drawn = new Map();
	/** @param {Node} node */
	const visit = (node) => {
		const mesh = node.getMesh();
		if (mesh) {
			const nodes = drawn.get(mesh);
			if (nodes) nodes.push(node);
			else drawn.set(mesh, [node]);
		}
		for (const child of node.listChildren()) visit(child);
	};
	for (const scene of doc.getRoot().listScenes())
		for (const node of scene.listChildren()) visit(node);
	return drawn;
}

/**
 * The mesh's setting from its extras, as `"extras": { "occluder": false }` gives it: false keeps
 * the mesh from blocking, true makes it block with its own triangles when it gets no blocker.
 *
 * @param {Mesh} mesh
 * @returns {boolean | undefined}
 */
function occluderSetting(mesh) {
	const value = /** @type {Record<string, unknown>} */ (mesh.getExtras()).occluder;
	return typeof value === 'boolean' ? value : undefined;
}

/**
 * True when every node keeps the mesh upright: its vertical axis points up in the world. The
 * ground then lies below the mesh's lowest point.
 *
 * @param {Node[]} nodes
 */
function upright(nodes) {
	return nodes.every((node) => {
		const m = node.getWorldMatrix();
		const [x, y, z] = [m[4], m[5], m[6]];
		return y > 0 && Math.abs(x) <= y * 1e-6 && Math.abs(z) <= y * 1e-6;
	});
}

/**
 * True when a primitive draws a solid surface: no blending and no alpha mask, which would leave
 * gaps that a blocker would cover.
 *
 * @param {Primitive} prim
 */
const solid = (prim) => (prim.getMaterial()?.getAlphaMode() ?? 'OPAQUE') === 'OPAQUE';

/**
 * Gives the document's meshes their blockers and their stored trees. The document holds neither
 * yet.
 *
 * @param {Document} doc
 * @param {SpatialOptions} options
 * @returns {SpatialReport}
 */
export function addSpatialData(doc, { blockers, bvhMinTriangles }) {
	/** @type {SpatialReport} */
	const report = {
		blockers: 0,
		blockerTriangles: 0,
		ownBlockers: 0,
		noBlocker: [],
		trees: 0,
		treeBytes: 0,
	};
	const occluders = doc.createExtension(Null3dOccluder);
	const trees = doc.createExtension(Null3dMeshBvh);
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	/** @param {ArrayLike<number>} array @param {'SCALAR' | 'VEC3'} type */
	const accessor = (array, type) =>
		doc
			.createAccessor()
			.setType(type)
			.setArray(/** @type {any} */ (array))
			.setBuffer(buffer);
	for (const [mesh, nodes] of drawnMeshes(doc)) {
		const prims = triangleLists(mesh);
		// Skins and morph targets move the triangles, so neither a blocker nor a tree fits them.
		if (nodes.some((node) => node.getSkin()) || prims.some((prim) => prim.listTargets().length > 0))
			continue;
		const sources = prims.map((prim) => {
			const positions = enginePositions(prim);
			const count = /** @type {Accessor} */ (prim.getAttribute('POSITION')).getCount();
			return { prim, positions, indices: triangleIndices(prim, count) };
		});
		for (const { prim, positions, indices } of sources) {
			if (!positions || indices.length / 3 < bvhMinTriangles) continue;
			const bytes = meshBvh(positions, indices);
			const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
			prim.setExtension(
				trees.extensionName,
				/** @type {any} */ (trees.createMeshBvh().setTree(accessor(words, 'SCALAR'))),
			);
			report.trees++;
			report.treeBytes += bytes.byteLength;
		}
		const setting = occluderSetting(mesh);
		const opaque = sources.filter((s) => solid(s.prim) && s.positions);
		const first = opaque[0];
		if (!blockers || setting === false || !first) continue;
		// The solid primitives share the mesh's space, so they make one shape.
		const corners = opaque.reduce(
			(sum, s) => sum + /** @type {Float32Array} */ (s.positions).length,
			0,
		);
		const positions = new Float32Array(corners);
		const indices = new Uint32Array(opaque.reduce((sum, s) => sum + s.indices.length, 0));
		let at = 0;
		let base = 0;
		for (const s of opaque) {
			const own = /** @type {Float32Array} */ (s.positions);
			positions.set(own, base * 3);
			for (let i = 0; i < s.indices.length; i++)
				indices[at + i] = /** @type {number} */ (s.indices[i]) + base;
			at += s.indices.length;
			base += own.length / 3;
		}
		const blocker = blockerMesh(positions, indices, { ground: upright(nodes) });
		if ('dropped' in blocker) {
			report.noBlocker.push({ mesh: mesh.getName(), reason: blocker.dropped });
			if (setting !== true) continue;
			// Each solid primitive then blocks with its own triangles.
			for (const s of opaque)
				s.prim.setExtension(
					occluders.extensionName,
					/** @type {any} */ (occluders.createOccluder()),
				);
			report.ownBlockers++;
			continue;
		}
		// The first solid primitive draws the blocker of the whole mesh.
		const occluder = occluders
			.createOccluder()
			.setBlocker(
				accessor(blocker.positions.slice(), 'VEC3'),
				accessor(blocker.indices.slice(), 'SCALAR'),
			);
		first.prim.setExtension(occluders.extensionName, /** @type {any} */ (occluder));
		report.blockers++;
		report.blockerTriangles += blocker.indices.length / 3;
	}
	if (report.trees === 0) trees.dispose();
	if (report.blockers + report.ownBlockers === 0) occluders.dispose();
	return report;
}
