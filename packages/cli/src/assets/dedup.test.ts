import { describe, expect, it } from 'bun:test';
import { Document, NodeIO } from '@gltf-transform/core';
import { dedup } from './dedup.js';

/** A triangle mesh with its own accessors and the given material. */
function triangle(doc: Document, name: string, material: ReturnType<Document['createMaterial']>) {
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	const accessor = (
		array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
		type: 'VEC3' | 'SCALAR',
	) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
	return doc.createMesh(name).addPrimitive(
		doc
			.createPrimitive()
			.setAttribute('POSITION', accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3'))
			.setAttribute('NORMAL', accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3'))
			.setIndices(accessor(new Uint16Array([0, 1, 2]), 'SCALAR'))
			.setMaterial(material),
	);
}

describe('dedup', () => {
	it('leaves one copy of repeated meshes and materials, which every node then draws', async () => {
		const doc = new Document();
		const red = () => doc.createMaterial('red').setBaseColorFactor([1, 0, 0, 1]);
		const blue = doc.createMaterial('blue').setBaseColorFactor([0, 0, 1, 1]);
		const meshes = [
			triangle(doc, 'a', red()),
			triangle(doc, 'b', red()),
			triangle(doc, 'c', red()),
			triangle(doc, 'd', blue),
		];
		const scene = doc.createScene();
		const nodes = meshes.map((mesh) => doc.createNode(mesh.getName()).setMesh(mesh));
		for (const node of nodes) scene.addChild(node);
		expect(dedup(doc)).toEqual({ textures: 0, materials: 2, accessors: 9, meshes: 2 });
		const root = doc.getRoot();
		expect(root.listMeshes().map((m) => m.getName())).toEqual(['a', 'd']);
		expect(root.listMaterials().map((m) => m.getName())).toEqual(['blue', 'red']);
		expect(nodes.map((node) => node.getMesh()!.getName())).toEqual(['a', 'a', 'a', 'd']);
		// The meshes of two materials share their vertices and indices.
		const [a, d] = root.listMeshes().map((m) => m.listPrimitives()[0]!);
		expect(d!.getAttribute('POSITION')).toBe(a!.getAttribute('POSITION'));
		expect(d!.getIndices()).toBe(a!.getIndices());
		const json = (await new NodeIO().writeJSON(doc)).json;
		expect(json.meshes?.length).toBe(2);
		expect(json.accessors?.length).toBe(3);
	});

	it('keeps accessors of equal bytes apart when one holds indices and one vertices', () => {
		const doc = new Document();
		const buffer = doc.createBuffer();
		const values = () => new Uint16Array([0, 1, 2]);
		const indices = doc.createAccessor().setType('SCALAR').setArray(values()).setBuffer(buffer);
		const ids = doc.createAccessor().setType('SCALAR').setArray(values()).setBuffer(buffer);
		const positions = doc
			.createAccessor()
			.setType('VEC3')
			.setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
			.setBuffer(buffer);
		doc
			.createMesh()
			.addPrimitive(
				doc
					.createPrimitive()
					.setAttribute('POSITION', positions)
					.setAttribute('_ID', ids)
					.setIndices(indices),
			);
		expect(dedup(doc).accessors).toBe(0);
		expect(doc.getRoot().listAccessors().length).toBe(3);
	});
});
