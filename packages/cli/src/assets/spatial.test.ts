import { describe, expect, it } from 'bun:test';
import { Document, type Mesh, NodeIO } from '@gltf-transform/core';
import { parseGltf, readContainer } from '../../../engine/src/scene/gltf-parse.ts';
import { meshBvh } from './formats.js';
import { addSpatialData } from './spatial.js';
import {
	meshBvhOf,
	NULL3D_MESH_BVH,
	NULL3D_OCCLUDER,
	Null3dMeshBvh,
	Null3dOccluder,
	occluderOf,
} from './spatial-extensions.js';

/** The corners and outward triangles of a box from `min` to `max`. */
function boxArrays(min: number[], max: number[]) {
	const positions: number[] = [];
	for (let k = 0; k < 8; k++)
		positions.push(k & 1 ? max[0]! : min[0]!, k & 2 ? max[1]! : min[1]!, k & 4 ? max[2]! : min[2]!);
	// Each face as four corners, counterclockwise from outside.
	const faces = [
		[0, 4, 6, 2],
		[1, 3, 7, 5],
		[0, 1, 5, 4],
		[2, 6, 7, 3],
		[0, 2, 3, 1],
		[4, 5, 7, 6],
	];
	const indices = faces.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]);
	return { positions, indices };
}

/** A mesh of one primitive, drawn by a node of the document's scene. */
function addMesh(doc: Document, name: string, positions: number[], indices: number[]): Mesh {
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const prim = doc
		.createPrimitive()
		.setAttribute(
			'POSITION',
			doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
		)
		.setIndices(
			doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer),
		);
	const mesh = doc.createMesh(name).addPrimitive(prim);
	const scene = doc.getRoot().getDefaultScene() ?? doc.createScene();
	doc.getRoot().setDefaultScene(scene);
	scene.addChild(doc.createNode(name).setMesh(mesh));
	return mesh;
}

/** A box of 12 triangles from -1 to 1. */
const box = (doc: Document, name: string) => {
	const { positions, indices } = boxArrays([-1, 0, -1], [1, 2, 1]);
	return addMesh(doc, name, positions, indices);
};

/** A box with no top: 10 triangles, open to the sky. */
const openBox = (doc: Document, name: string) => {
	const { positions, indices } = boxArrays([-1, 0, -1], [1, 2, 1]);
	return addMesh(doc, name, positions, indices.slice(0, 18).concat(indices.slice(24)));
};

/** A square of 2 triangles. */
const plane = (doc: Document, name: string) =>
	addMesh(doc, name, [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], [0, 2, 1, 0, 3, 2]);

describe('blockers', () => {
	it('gives a closed mesh a blocker inside it, and names why an open one gets none', () => {
		const doc = new Document();
		const solid = box(doc, 'solid');
		plane(doc, 'floor');
		const report = addSpatialData(doc, { blockers: true, bvhMinTriangles: Infinity });
		expect(report).toMatchObject({ blockers: 1, ownBlockers: 0, trees: 0, treeBytes: 0 });
		expect(report.noBlocker.map((n) => n.mesh)).toEqual(['floor']);
		expect(report.noBlocker[0]!.reason.length).toBeGreaterThan(0);
		const occluder = occluderOf(solid.listPrimitives()[0]!)!;
		const corners = occluder.getPositions()!.getArray()!;
		const indices = occluder.getIndices()!.getArray()!;
		expect(indices.length).toBe(report.blockerTriangles * 3);
		expect(indices.length % 3).toBe(0);
		// Every corner lies inside the box, apart from its faces.
		for (let i = 0; i < corners.length; i += 3) {
			expect(Math.abs(corners[i]!)).toBeLessThan(1);
			expect(corners[i + 1]!).toBeGreaterThan(0);
			expect(corners[i + 1]!).toBeLessThan(2);
			expect(Math.abs(corners[i + 2]!)).toBeLessThan(1);
		}
		expect(
			doc
				.getRoot()
				.listExtensionsUsed()
				.map((e) => e.extensionName),
		).toEqual([NULL3D_OCCLUDER]);
	});

	it('takes each mesh setting: false gives no blocker, true blocks with the mesh itself', () => {
		const doc = new Document();
		const off = box(doc, 'off').setExtras({ occluder: false });
		const own = plane(doc, 'own').setExtras({ occluder: true });
		const report = addSpatialData(doc, { blockers: true, bvhMinTriangles: Infinity });
		expect(report).toMatchObject({ blockers: 0, ownBlockers: 1 });
		expect(occluderOf(off.listPrimitives()[0]!)).toBeNull();
		const ownOccluder = occluderOf(own.listPrimitives()[0]!)!;
		expect([ownOccluder.getPositions(), ownOccluder.getIndices()]).toEqual([null, null]);
	});

	it('gives a mesh open at the bottom a blocker when it stands on the ground, and none otherwise', () => {
		// Open to the sky, nothing closes it.
		const doc = new Document();
		openBox(doc, 'cup');
		expect(
			addSpatialData(doc, { blockers: true, bvhMinTriangles: Infinity }).noBlocker.map(
				(n) => n.mesh,
			),
		).toEqual(['cup']);
		// Open at the bottom, as a building is: the ground closes it while it stands upright.
		const building = () => {
			const doc = new Document();
			const prim = openBox(doc, 'building').listPrimitives()[0]!;
			const positions = prim.getAttribute('POSITION')!.getArray()!;
			const indices = prim.getIndices()!.getArray()!;
			// Mirror y, and turn each triangle so it still faces out.
			for (let i = 1; i < positions.length; i += 3) positions[i] = 2 - positions[i]!;
			for (let t = 0; t < indices.length; t += 3)
				[indices[t + 1], indices[t + 2]] = [indices[t + 2]!, indices[t + 1]!];
			return doc;
		};
		const standing = building();
		expect(addSpatialData(standing, { blockers: true, bvhMinTriangles: Infinity }).blockers).toBe(
			1,
		);
		// Turned over, its open side faces the sky.
		const turned = building();
		turned.getRoot().listNodes()[0]!.setRotation([1, 0, 0, 0]);
		expect(addSpatialData(turned, { blockers: true, bvhMinTriangles: Infinity }).blockers).toBe(0);
	});

	it('gives no blocker with the option off, and none to skinned meshes', () => {
		const doc = new Document();
		box(doc, 'solid');
		expect(addSpatialData(doc, { blockers: false, bvhMinTriangles: Infinity }).blockers).toBe(0);
		expect(doc.getRoot().listExtensionsUsed()).toEqual([]);
		const skinned = new Document();
		box(skinned, 'skinned');
		const node = skinned.getRoot().listNodes()[0]!;
		node.setSkin(skinned.createSkin().addJoint(skinned.createNode('bone')));
		expect(addSpatialData(skinned, { blockers: true, bvhMinTriangles: 1 })).toMatchObject({
			blockers: 0,
			trees: 0,
			noBlocker: [],
		});
	});
});

describe('stored trees', () => {
	it('stores the tree of each part with at least the fewest triangles, as the core builds it', () => {
		const doc = new Document();
		const solid = box(doc, 'solid');
		const floor = plane(doc, 'floor');
		const report = addSpatialData(doc, { blockers: false, bvhMinTriangles: 12 });
		const prim = solid.listPrimitives()[0]!;
		const tree = meshBvhOf(prim)!.getTree()!.getArray()!;
		const expected = meshBvh(
			Float32Array.from(prim.getAttribute('POSITION')!.getArray()!),
			Uint32Array.from(prim.getIndices()!.getArray()!),
		);
		expect(Array.from(new Uint8Array(tree.buffer, tree.byteOffset, tree.byteLength))).toEqual(
			Array.from(expected),
		);
		expect(String.fromCharCode(...expected.subarray(0, 4))).toBe('N3BV');
		expect(meshBvhOf(floor.listPrimitives()[0]!)).toBeNull();
		expect(report).toMatchObject({ trees: 1, treeBytes: expected.byteLength });
	});

	it('round-trips through a file, and the engine reads both extensions', async () => {
		const doc = new Document();
		const solid = box(doc, 'solid');
		const report = addSpatialData(doc, { blockers: true, bvhMinTriangles: 1 });
		expect(report).toMatchObject({ blockers: 1, trees: 1 });
		const io = new NodeIO().registerExtensions([Null3dOccluder, Null3dMeshBvh]);
		const glb = await io.writeBinary(doc);
		const again = await io.readBinary(glb);
		const prim = again.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
		const source = solid.listPrimitives()[0]!;
		expect(Array.from(meshBvhOf(prim)!.getTree()!.getArray()!)).toEqual(
			Array.from(meshBvhOf(source)!.getTree()!.getArray()!),
		);
		expect(Array.from(occluderOf(prim)!.getPositions()!.getArray()!)).toEqual(
			Array.from(occluderOf(source)!.getPositions()!.getArray()!),
		);
		const url = 'https://example.com/solid.glb';
		const [parsed] = parseGltf(readContainer(glb, url), new Map(), url).meshes[0]!.primitives;
		const tree = meshBvhOf(source)!.getTree()!.getArray()!;
		expect(parsed!.bvh).toEqual(new Uint8Array(tree.buffer, tree.byteOffset, tree.byteLength));
		const blocker = occluderOf(source)!;
		expect(parsed!.occluder).toEqual({
			positions: Float32Array.from(blocker.getPositions()!.getArray()!),
			indices: Uint32Array.from(blocker.getIndices()!.getArray()!),
		});
		const json = await io.writeJSON(doc);
		expect(json.json.extensionsUsed?.sort()).toEqual([NULL3D_MESH_BVH, NULL3D_OCCLUDER]);
		expect(json.json.extensionsRequired ?? []).toEqual([]);
		expect(Object.keys(json.json.meshes![0]!.primitives[0]!.extensions!).sort()).toEqual([
			NULL3D_MESH_BVH,
			NULL3D_OCCLUDER,
		]);
	});
});
