import { afterAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Accessor, Document, NodeIO } from '@gltf-transform/core';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { parseGltf, readContainer } from '../../../engine/src/scene/gltf-parse.ts';
import { clustersOf, NULL3D_CLUSTERS, Null3dClusters } from './cluster-extension.js';
import { buildClusterFixture, CLUSTER_FILE, MODELS_DIR } from './cluster-fixture.js';
import {
	CLUSTER_MIN_TRIANGLES,
	CLUSTER_TRIANGLES,
	type ClusterPlan,
	clusterSummary,
	planClusters,
	storeClusters,
} from './clusters.js';

// The build of a mesh of 32,000 triangles simplifies its tree in a second or two on a busy
// machine, and a CI runner of four cores takes longer.
setDefaultTimeout(scaledBudget(60_000));

const scratch = mkdtempSync(join(tmpdir(), 'null3d-clusters-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The value at `at` of the values that a test reads, which always lie in them. */
function value(values: ArrayLike<number>, at: number): number {
	const found = values[at];
	if (found === undefined) throw new Error(`no value at ${at}`);
	return found;
}

/** The entry at `at` of a list that a test reads, which always lies in it. */
function entry<T>(list: T[], at: number): T {
	const found = list[at];
	if (found === undefined) throw new Error(`no entry at ${at}`);
	return found;
}

/** A sphere of `rings` bands of `segments` quads each: positions, normals, coordinates, triangles. */
function sphere(rings: number, segments: number) {
	/** @type {number[]} */
	const positions = [];
	/** @type {number[]} */
	const normals = [];
	/** @type {number[]} */
	const uvs = [];
	/** @type {number[]} */
	const indices = [];
	for (let r = 0; r <= rings; r++) {
		const v = r / rings;
		const phi = v * Math.PI;
		for (let s = 0; s <= segments; s++) {
			const u = s / segments;
			const theta = u * Math.PI * 2;
			const x = Math.sin(phi) * Math.cos(theta);
			const y = Math.cos(phi);
			const z = Math.sin(phi) * Math.sin(theta);
			positions.push(x, y, z);
			normals.push(x, y, z);
			uvs.push(u, v);
		}
	}
	const row = segments + 1;
	for (let r = 0; r < rings; r++)
		for (let s = 0; s < segments; s++) {
			const a = r * row + s;
			const b = a + 1;
			const c = a + row;
			const d = c + 1;
			indices.push(a, c, b, b, c, d);
		}
	return {
		positions: new Float32Array(positions),
		normals: new Float32Array(normals),
		uvs: new Float32Array(uvs),
		indices: new Uint32Array(indices),
	};
}

/** A document that draws one mesh, with the arrays that `mesh` gives, in `options.copies` nodes. */
function documentOf(
	mesh: {
		positions: Float32Array<ArrayBuffer>;
		normals?: Float32Array<ArrayBuffer>;
		uvs?: Float32Array<ArrayBuffer>;
		indices: Uint32Array<ArrayBuffer>;
	},
	options: { copies?: number; alphaMode?: 'OPAQUE' | 'MASK' } = {},
) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(mesh.positions).setBuffer(buffer),
		)
		.setIndices(
			doc
				.createAccessor()
				.setType('SCALAR')
				.setArray(new Uint16Array(mesh.indices))
				.setBuffer(buffer),
		)
		.setMaterial(
			doc
				.createMaterial('stone')
				.setBaseColorFactor([0.5, 0.5, 0.5, 1])
				.setAlphaMode(options.alphaMode ?? 'OPAQUE'),
		);
	if (mesh.normals)
		prim.setAttribute(
			'NORMAL',
			doc.createAccessor().setType('VEC3').setArray(mesh.normals).setBuffer(buffer),
		);
	if (mesh.uvs)
		prim.setAttribute(
			'TEXCOORD_0',
			doc.createAccessor().setType('VEC2').setArray(mesh.uvs).setBuffer(buffer),
		);
	const made = doc.createMesh('sphere').addPrimitive(prim);
	const root = doc.createScene().addChild(doc.createNode('sphere').setMesh(made));
	for (let k = 1; k < (options.copies ?? 1); k++)
		root.addChild(doc.createNode(`sphere ${k}`).setMesh(made));
	return doc;
}

/** The patches of a stored tree, read back as the engine reads them. */
function readTree(
	plan: ClusterPlan,
): { first: number; count: number; parent: number; error: number }[] {
	const patches = [];
	const view = new DataView(plan.patches.buffer, plan.patches.byteOffset);
	for (let k = 0; k < plan.patches.length / 4; k++)
		patches.push({
			first: value(plan.patches, k * 4),
			count: value(plan.patches, k * 4 + 1),
			parent: value(plan.patches, k * 4 + 2) === 0 ? -1 : value(plan.patches, k * 4 + 2) - 1,
			error: view.getFloat32(k * 16 + 12, true),
		});
	return patches;
}

const mesh = sphere(128, 128);
const planned = (async () => {
	const doc = documentOf(mesh);
	return { doc, plans: await planClusters(doc) };
})();

/**
 * The one tree that the document of the test got. Throws rather than handing every test a check
 * for a tree that must be there.
 */
async function only() {
	const { plans } = await planned;
	const plan = [...plans.values()][0];
	if (!plan) throw new Error('the mesh of the test got no tree');
	return { plan };
}

/** An accessor's values, or none for an accessor that is not there. */
const arrayOf = (accessor: Accessor | null) => Array.from(accessor?.getArray() ?? []);

describe('the tree of a large mesh', () => {
	it('gives every leaf patch about 128 triangles and reuses the mesh vertices', async () => {
		const { plans } = await planned;
		expect(plans.size).toBe(1);
		const { plan } = await only();
		const patches = readTree(plan);
		// The root starts the walk, so its parent is none.
		expect(plan.root).toBe(0);
		expect(entry(patches, plan.root).parent).toBe(-1);
		const children = patches.map(() => 0);
		for (const patch of patches)
			if (patch.parent >= 0) children[patch.parent] = (children[patch.parent] ?? 0) + 1;
		const leaves = children.flatMap((count, k) => (count === 0 ? [entry(patches, k)] : []));
		expect(leaves.length).toBeGreaterThan(0);
		for (const patch of patches) {
			expect(patch.count % 3).toBe(0);
			expect(patch.count).toBeGreaterThan(0);
			expect(patch.first + patch.count).toBeLessThanOrEqual(plan.indices.length);
		}
		for (const patch of leaves) expect(patch.count / 3).toBeLessThanOrEqual(CLUSTER_TRIANGLES);
		let largest = 0;
		for (const index of plan.indices) largest = Math.max(largest, index);
		expect(largest).toBeLessThan(mesh.positions.length / 3);
		// The chain above the root stops where the simplifier can go no coarser, so the coarsest
		// patch holds a small share of the mesh.
		expect(entry(patches, plan.root).count / 3).toBeLessThan(plan.triangles / 10);
	});

	it('adds up to about twice the base mesh triangles', async () => {
		const { plan } = await only();
		expect(plan.triangles).toBe(mesh.indices.length / 3);
		expect(plan.treeTriangles).toBeGreaterThan(plan.triangles * 1.4);
		expect(plan.treeTriangles).toBeLessThan(plan.triangles * 2.6);
	});

	it('raises the error from every patch to its parent', async () => {
		const { plan } = await only();
		const patches = readTree(plan);
		for (const [k, patch] of patches.entries()) {
			expect(Number.isFinite(patch.error)).toBe(true);
			expect(patch.error).toBeGreaterThanOrEqual(0);
			if (patch.parent >= 0)
				expect(entry(patches, patch.parent).error).toBeGreaterThan(patch.error);
			else expect(k).toBe(plan.root);
		}
		const root = entry(patches, plan.root);
		expect(root.error).toBe(Math.max(...patches.map((patch) => patch.error)));
	});

	it('cuts the tree into patches that cover every leaf exactly once', async () => {
		const { plan } = await only();
		const patches = readTree(plan);
		const children = patches.map(() => 0);
		for (const patch of patches)
			if (patch.parent >= 0) children[patch.parent] = (children[patch.parent] ?? 0) + 1;
		const leaves = children.flatMap((count, k) => (count === 0 ? [k] : []));
		// The patches that draw at a threshold are those whose own error passes it and whose
		// parent's does not. Walking up from a leaf finds exactly one of them, which is what keeps
		// a view from drawing a gap or the same triangle twice.
		for (const threshold of [0.0001, 0.001, 0.005, 0.02, 10]) {
			/** @type {number[]} */
			const wrong = [];
			for (const leaf of leaves) {
				let drawn = 0;
				for (let k = leaf; k >= 0; k = entry(patches, k).parent) {
					const parent = entry(patches, k).parent;
					if (
						entry(patches, k).error <= threshold &&
						(parent < 0 || entry(patches, parent).error > threshold)
					)
						drawn++;
				}
				if (drawn !== 1) wrong.push(leaf);
			}
			expect(wrong).toEqual([]);
		}
	});

	it('bounds every patch with a sphere around its vertices', async () => {
		const { plan } = await only();
		/** @type {number[]} */
		const outside = [];
		for (let k = 0; k < plan.bounds.length / 4; k++) {
			const centre = [value(plan.bounds, k * 4), value(plan.bounds, k * 4 + 1)];
			const z = value(plan.bounds, k * 4 + 2);
			const radius = value(plan.bounds, k * 4 + 3);
			if (!(radius > 0)) outside.push(k);
			const first = value(plan.patches, k * 4);
			const count = value(plan.patches, k * 4 + 1);
			for (let i = first; i < first + count; i++) {
				const v = value(plan.indices, i) * 3;
				const distance = Math.hypot(
					value(mesh.positions, v) - (centre[0] as number),
					value(mesh.positions, v + 1) - (centre[1] as number),
					value(mesh.positions, v + 2) - z,
				);
				if (distance > radius + 1e-6) outside.push(k);
			}
		}
		expect(outside).toEqual([]);
	});

	it('gives a mesh of few triangles, many copies, or a cut material no tree', async () => {
		const tiny = documentOf({
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			indices: new Uint32Array([0, 1, 2]),
		});
		expect((await planClusters(tiny)).size).toBe(0);
		expect(mesh.indices.length / 3).toBeGreaterThan(CLUSTER_MIN_TRIANGLES);
		const many = documentOf(mesh, { copies: 8 });
		expect((await planClusters(many)).size).toBe(0);
		const cut = documentOf(mesh, { alphaMode: 'MASK' });
		expect((await planClusters(cut)).size).toBe(0);
	});

	it('stores the tree in the file and reads it back', async () => {
		const { doc, plans } = await planned;
		storeClusters(doc, plans);
		const { plan } = await only();
		const io = new NodeIO().registerExtensions([Null3dClusters]);
		const bytes = await io.writeBinary(doc);
		const read = await io.readBinary(bytes);
		const prim = read.getRoot().listMeshes()[0]?.listPrimitives()[0];
		const stored = prim ? clustersOf(prim) : null;
		if (!stored) throw new Error('the tree was not read back');
		expect(stored.getRoot()).toBe(plan.root);
		expect(arrayOf(stored.getIndices())).toEqual(Array.from(plan.indices));
		expect(arrayOf(stored.getPatches())).toEqual(Array.from(plan.patches));
		expect(arrayOf(stored.getBounds())).toEqual(Array.from(plan.bounds));
		// The extension is written under the engine's name, which other loaders ignore.
		const json = JSON.parse(
			new TextDecoder().decode(
				bytes.subarray(20, 20 + new DataView(bytes.buffer).getUint32(12, true)),
			),
		);
		expect(json.meshes[0].primitives[0].extensions[NULL3D_CLUSTERS].root).toBe(plan.root);
	});

	it('adds the trees up for the report', async () => {
		const { plans } = await planned;
		const summary = clusterSummary([...plans.values()]);
		expect(summary.meshes).toBe(1);
		expect(summary.patches).toBeGreaterThan(summary.leaves);
		expect(summary.triangles).toBeGreaterThan(summary.base);
		expect(summary.bytes).toBeGreaterThan(0);
	});

	it(
		'writes the model that the cluster sketch loads, byte for byte',
		async () => {
			const built = await buildClusterFixture();
			const committed = readFileSync(join(MODELS_DIR, CLUSTER_FILE));
			expect(Buffer.from(built).equals(committed)).toBe(true);
		},
		scaledBudget(180_000),
	);

	it('writes the tree where the engine reads it', async () => {
		const { doc, plans } = await planned;
		storeClusters(doc, plans);
		const { plan } = await only();
		const bytes = await new NodeIO().registerExtensions([Null3dClusters]).writeBinary(doc);
		const parsed = parseGltf(
			readContainer(bytes, 'https://example.com/sphere.glb'),
			new Map(),
			'https://example.com/sphere.glb',
		);
		const patches = parsed.meshes[0]?.primitives[0]?.patches;
		expect(patches?.root).toBe(plan.root);
		expect(Array.from(patches?.indices ?? [])).toEqual(Array.from(plan.indices));
		expect(Array.from(patches?.words ?? [])).toEqual(Array.from(plan.patches));
		expect(Array.from(patches?.bounds ?? [])).toEqual(Array.from(plan.bounds));
	});
});
