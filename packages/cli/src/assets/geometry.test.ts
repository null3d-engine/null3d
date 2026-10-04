import { describe, expect, it } from 'bun:test';
import { type Accessor, Document, type Node } from '@gltf-transform/core';
import { EXTMeshGPUInstancing } from '@gltf-transform/extensions';
import {
	LOD_SCREEN_PIXELS,
	levelCoverage,
	POSITION_BITS,
	planLevels,
	quantizeMeshes,
	reorderMeshes,
	storeLevels,
} from './geometry.js';
import { lodOf } from './lod-extension.js';

type Vec3 = [number, number, number];

/** A column-major matrix times a point. */
const transform = (m: ArrayLike<number>, p: readonly number[]): Vec3 =>
	[0, 1, 2].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!) as Vec3;

/** The value of an accessor's element as the GPU reads it. */
function element(accessor: Accessor, i: number): number[] {
	return accessor.getElement(i, []);
}

/** A grid of `n` x `n` squares in the XZ plane, `size` wide, with normals and coordinates. */
function grid(doc: Document, n: number, size: number, offset: Vec3 = [0, 0, 0]) {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let z = 0; z <= n; z++)
		for (let x = 0; x <= n; x++) {
			const h = Math.sin(x * 0.7) * Math.cos(z * 0.5) * 0.1;
			positions.push((x / n) * size + offset[0], h + offset[1], (z / n) * size + offset[2]);
			normals.push(0, 1, 0);
			uvs.push(x / n, z / n);
		}
	for (let z = 0; z < n; z++)
		for (let x = 0; x < n; x++) {
			const a = z * (n + 1) + x;
			indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
		}
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const accessor = (
		array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
		type: 'VEC3' | 'VEC2' | 'SCALAR',
	) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor(new Float32Array(positions), 'VEC3'))
		.setAttribute('NORMAL', accessor(new Float32Array(normals), 'VEC3'))
		.setAttribute('TEXCOORD_0', accessor(new Float32Array(uvs), 'VEC2'))
		.setIndices(accessor(new Uint32Array(indices), 'SCALAR'));
	return doc.createMesh('grid').addPrimitive(prim);
}

/** Each drawn vertex of a node's mesh in the scene, by its index. */
function worldVertices(node: Node): Vec3[] {
	const prim = node.getMesh()!.listPrimitives()[0]!;
	const position = prim.getAttribute('POSITION')!;
	return Array.from({ length: position.getCount() }, (_, i) =>
		transform(node.getWorldMatrix(), element(position, i)),
	);
}

/** The scene's vertices, as a sorted list of rounded points, which ignores their order. */
const pointSet = (points: Vec3[], step: number) =>
	points.map((p) => p.map((v) => Math.round(v / step)).join(',')).sort();

describe('reorderMeshes', () => {
	it('drops vertices that no triangle uses, and gives a stream that two meshes share a copy', async () => {
		const doc = new Document();
		const a = grid(doc, 4, 1);
		const prim = a.listPrimitives()[0]!;
		const shared = prim.getAttribute('POSITION')!;
		const b = doc.createMesh('half').addPrimitive(
			doc
				.createPrimitive()
				.setAttribute('POSITION', shared)
				.setIndices(
					doc
						.createAccessor()
						.setType('SCALAR')
						.setArray(new Uint32Array([0, 5, 1])),
				),
		);
		const used = [0, 5, 1].map((i) => element(shared, i).join(',')).sort();
		await reorderMeshes(doc);
		expect(a.listPrimitives()[0]!.getAttribute('POSITION')!.getCount()).toBe(25);
		const small = b.listPrimitives()[0]!;
		expect(small.getAttribute('POSITION')!.getCount()).toBe(3);
		expect(Array.from(small.getIndices()!.getArray()!)).toEqual([0, 1, 2]);
		expect(small.getIndices()!.getArray()).toBeInstanceOf(Uint16Array);
		const kept = small.getAttribute('POSITION')!;
		expect([0, 1, 2].map((i) => element(kept, i).join(',')).sort()).toEqual(used);
	});
});

describe('quantizeMeshes', () => {
	it('keeps every vertex in its place, through the node, a new child or each instance', async () => {
		const doc = new Document();
		const scene = doc.createScene();
		const mesh = grid(doc, 8, 3, [10, 2, -5]);
		const rotation: [number, number, number, number] = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
		const plain = doc
			.createNode('plain')
			.setMesh(mesh)
			.setTranslation([1, 2, 3])
			.setRotation(rotation)
			.setScale([2, 0.5, -1]);
		const parent = doc.createNode('parent').setMesh(mesh).setTranslation([-4, 0, 0]);
		const child = doc.createNode('child').setTranslation([0, 1, 0]);
		parent.addChild(child);
		const instanced = doc.createNode('instanced').setMesh(mesh);
		const instancing = doc.createExtension(EXTMeshGPUInstancing);
		const buffer = doc.getRoot().listBuffers()[0]!;
		instanced.setExtension(
			'EXT_mesh_gpu_instancing',
			instancing
				.createInstancedMesh()
				.setAttribute(
					'TRANSLATION',
					doc
						.createAccessor()
						.setType('VEC3')
						.setArray(new Float32Array([0, 0, 0, 5, 0, 5]))
						.setBuffer(buffer),
				)
				.setAttribute(
					'ROTATION',
					doc
						.createAccessor()
						.setType('VEC4')
						.setArray(new Float32Array([0, 0, 0, 1, ...rotation]))
						.setBuffer(buffer),
				),
		);
		scene.addChild(plain).addChild(parent).addChild(instanced);
		const before = [worldVertices(plain), worldVertices(parent)];
		const childBefore = child.getWorldMatrix().slice();
		/** Each vertex of each instance in the scene. */
		const instancedAfter = () => {
			const batch = instanced.getExtension('EXT_mesh_gpu_instancing') as unknown as {
				getAttribute(semantic: string): Accessor | null;
			};
			const position = mesh.listPrimitives()[0]!.getAttribute('POSITION')!;
			return [0, 1].flatMap((k) => {
				const read = (semantic: string, fallback: number[]) => {
					const accessor = batch.getAttribute(semantic);
					return accessor ? element(accessor, k) : fallback;
				};
				const matrix = doc
					.createNode()
					.setTranslation(read('TRANSLATION', [0, 0, 0]) as Vec3)
					.setRotation(read('ROTATION', [0, 0, 0, 1]) as never)
					.setScale(read('SCALE', [1, 1, 1]) as Vec3)
					.getMatrix();
				return Array.from({ length: position.getCount() }, (_, i) =>
					transform(matrix, element(position, i)),
				);
			});
		};
		await reorderMeshes(doc);
		const reordered = [worldVertices(plain), worldVertices(parent)];
		const instancedBefore = instancedAfter();
		quantizeMeshes(doc);

		const position = mesh.listPrimitives()[0]!.getAttribute('POSITION')!;
		expect(position.getArray()).toBeInstanceOf(Uint16Array);
		expect(position.getNormalized()).toBe(false);
		expect(Math.max(...(position.getArray() as Uint16Array))).toBe(2 ** POSITION_BITS - 1);
		expect(
			doc
				.getRoot()
				.listExtensionsUsed()
				.map((e) => e.extensionName),
		).toContain('KHR_mesh_quantization');
		// The mesh is 3 m wide, so a step is 3 / 16,383 m, and the scale of 2 doubles it.
		const step = (3 / (2 ** POSITION_BITS - 1)) * 2;
		expect(worldVertices(plain).length).toBe(reordered[0]!.length);
		worldVertices(plain).forEach((p, i) => {
			for (let c = 0; c < 3; c++)
				expect(Math.abs(p[c]! - reordered[0]![i]![c]!)).toBeLessThan(step);
		});
		expect(pointSet(reordered[0]!, 0.01)).toEqual(pointSet(before[0]!, 0.01));
		// The node with a child keeps its transform; a new child takes the mesh.
		expect(parent.getMesh()).toBeNull();
		const holder = parent.listChildren().find((n) => n.getMesh() === mesh)!;
		expect(holder.getName()).toBe('parent');
		worldVertices(holder).forEach((p, i) => {
			for (let c = 0; c < 3; c++)
				expect(Math.abs(p[c]! - reordered[1]![i]![c]!)).toBeLessThan(step);
		});
		expect(Array.from(child.getWorldMatrix())).toEqual(Array.from(childBefore));
		// Each instance carries the dequantizing transform after its own.
		instancedAfter().forEach((p, i) => {
			for (let c = 0; c < 3; c++)
				expect(Math.abs(p[c]! - instancedBefore[i]![c]!)).toBeLessThan(step);
		});
	});

	it('folds the dequantizing transform into the inverse bind matrices of a skin', async () => {
		const doc = new Document();
		const scene = doc.createScene();
		const mesh = grid(doc, 4, 2, [1, 0, 1]);
		const prim = mesh.listPrimitives()[0]!;
		const count = prim.getAttribute('POSITION')!.getCount();
		const buffer = doc.getRoot().listBuffers()[0]!;
		const joints = new Uint8Array(count * 4);
		const weights = new Float32Array(count * 4);
		for (let v = 0; v < count; v++) {
			joints.set([0, 1, 0, 0], v * 4);
			const w = (v % 5) / 4;
			weights.set([1 - w, w, 0, 0], v * 4);
		}
		prim
			.setAttribute(
				'JOINTS_0',
				doc.createAccessor().setType('VEC4').setArray(joints).setBuffer(buffer),
			)
			.setAttribute(
				'WEIGHTS_0',
				doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer),
			);
		const root = doc.createNode('root').setTranslation([0, 1, 0]);
		const arm = doc
			.createNode('arm')
			.setTranslation([1, 0, 0])
			.setRotation([0, 0, 0.3826834, 0.9238795]);
		root.addChild(arm);
		const skin = doc.createSkin().addJoint(root).addJoint(arm);
		skin.setInverseBindMatrices(
			doc
				.createAccessor()
				.setType('MAT4')
				.setArray(
					new Float32Array([
						1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1,
						-1, 0, 1,
					]),
				)
				.setBuffer(buffer),
		);
		const holder = doc.createNode('character').setMesh(mesh).setSkin(skin);
		scene.addChild(root).addChild(holder);
		/** The skinned place of each vertex: the weighted joint matrices times the bind matrices. */
		const skinned = () => {
			const position = prim.getAttribute('POSITION')!;
			const ibm = skin.getInverseBindMatrices()!;
			const w = prim.getAttribute('WEIGHTS_0')!;
			return Array.from({ length: count }, (_, v) => {
				const p = element(position, v);
				const weight = element(w, v).map((x) => (w.getNormalized() ? x : x));
				const out = [0, 0, 0];
				skin.listJoints().forEach((joint, j) => {
					const local = transform(element(ibm, j), p);
					const world = transform(joint.getWorldMatrix(), local);
					for (let c = 0; c < 3; c++) out[c]! += world[c]! * weight[j]!;
				});
				return out;
			});
		};
		await reorderMeshes(doc);
		const before = skinned();
		quantizeMeshes(doc);
		expect(prim.getAttribute('POSITION')!.getArray()).toBeInstanceOf(Uint16Array);
		expect(prim.getAttribute('WEIGHTS_0')!.getArray()).toBeInstanceOf(Uint8Array);
		const after = skinned();
		after.forEach((p, v) => {
			for (let c = 0; c < 3; c++) expect(Math.abs(p[c]! - before[v]![c]!)).toBeLessThan(0.01);
		});
	});

	it('keeps joint weights adding up to one in bytes, and leaves coordinates past 1 as floats', async () => {
		const doc = new Document();
		const mesh = grid(doc, 2, 1);
		const prim = mesh.listPrimitives()[0]!;
		const count = prim.getAttribute('POSITION')!.getCount();
		const weights = new Float32Array(count * 4);
		for (let v = 0; v < count; v++) weights.set([0.333, 0.333, 0.334, 0], v * 4);
		const buffer = doc.getRoot().listBuffers()[0]!;
		prim.setAttribute(
			'WEIGHTS_0',
			doc.createAccessor().setType('VEC4').setArray(weights).setBuffer(buffer),
		);
		const far = new Float32Array(count * 2).map((_, i) => i * 0.5);
		prim.setAttribute(
			'TEXCOORD_1',
			doc.createAccessor().setType('VEC2').setArray(far).setBuffer(buffer),
		);
		doc.createScene().addChild(doc.createNode().setMesh(mesh));
		quantizeMeshes(doc);
		const bytes = prim.getAttribute('WEIGHTS_0')!.getArray() as Uint8Array;
		for (let v = 0; v < count; v++)
			expect(bytes[v * 4]! + bytes[v * 4 + 1]! + bytes[v * 4 + 2]! + bytes[v * 4 + 3]!).toBe(255);
		expect(prim.getAttribute('TEXCOORD_1')!.getArray()).toBeInstanceOf(Float32Array);
		expect(prim.getAttribute('TEXCOORD_0')!.getArray()).toBeInstanceOf(Uint16Array);
		expect(prim.getAttribute('NORMAL')!.getArray()).toBeInstanceOf(Int8Array);
	});
});

describe('levels of detail', () => {
	it('give each level a coverage at which its error spans under a pixel', () => {
		expect(levelCoverage([{ error: 0.01 }, { error: 0.05 }])).toEqual([
			1 / (LOD_SCREEN_PIXELS * 0.01),
			1 / (LOD_SCREEN_PIXELS * 0.05),
			0,
		]);
		expect(levelCoverage([{ error: 0 }])).toEqual([1, 0]);
	});

	it('simplify a large mesh into levels with fewer triangles that share its vertices', async () => {
		const doc = new Document();
		const mesh = grid(doc, 32, 4);
		const node = doc.createNode('terrain').setMesh(mesh).setTranslation([0, 3, 0]);
		doc.createScene().addChild(node);
		const small = doc.createNode('tiny').setMesh(grid(doc, 4, 1));
		doc.getRoot().listScenes()[0]!.addChild(small);
		await reorderMeshes(doc);
		const plans = await planLevels(doc);
		expect([...plans.keys()]).toEqual([mesh]);
		quantizeMeshes(doc);
		storeLevels(doc, plans);
		const lod = lodOf(node)!;
		const counts = [node, ...lod.listLevels()].map(
			(n) => n.getMesh()!.listPrimitives()[0]!.getIndices()!.getCount() / 3,
		);
		expect(counts[0]).toBe(32 * 32 * 2);
		for (let k = 1; k < counts.length; k++) expect(counts[k]!).toBeLessThan(counts[k - 1]!);
		for (const level of lod.listLevels()) {
			expect(level.getTranslation()).toEqual(node.getTranslation());
			expect(level.getScale()).toEqual(node.getScale());
		}
		expect(lodOf(small)).toBeNull();
	});

	it('simplify a mesh of flat faces, whose every edge is a seam, by letting the seams move', async () => {
		const doc = new Document();
		const smooth = grid(doc, 24, 4).listPrimitives()[0]!;
		const indices = smooth.getIndices()!.getArray()!;
		const source = smooth.getAttribute('POSITION')!;
		const positions = new Float32Array(indices.length * 3);
		const normals = new Float32Array(indices.length * 3);
		for (let k = 0; k < indices.length; k++) {
			positions.set(element(source, indices[k]!), k * 3);
			normals.set([0, 1, (k % 7) / 10], k * 3);
		}
		const buffer = doc.getRoot().listBuffers()[0]!;
		const flat = doc
			.createMesh('flat')
			.addPrimitive(
				doc
					.createPrimitive()
					.setAttribute(
						'POSITION',
						doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
					)
					.setAttribute(
						'NORMAL',
						doc.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer),
					),
			);
		doc.createScene().addChild(doc.createNode('flat').setMesh(flat));
		await reorderMeshes(doc);
		const plans = await planLevels(doc);
		const levels = plans.get(flat)?.levels ?? [];
		expect(levels.length).toBeGreaterThan(0);
		expect(levels[0]!.triangles).toBeLessThan(24 * 24 * 2 * 0.8);
	});
});
