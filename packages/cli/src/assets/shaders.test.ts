// The shader list that the tool records with a model: the permutation bits, the first-use shader
// files and the pipeline keys of its draws. The tests check the list on scenes built here, that
// the engine reads the list back, and that every name the tool writes exists in the engine's own
// tables.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import {
	EXTMeshGPUInstancing,
	KHRMaterialsClearcoat,
	KHRMaterialsTransmission,
} from '@gltf-transform/extensions';
import { parseGltf, readContainer } from '../../../engine/src/scene/gltf-parse.ts';
import { lodOf, MSFT_LOD, MSFTLod } from './lod-extension.js';
import { budgetWarnings, PRESET_TEXTURE_MEMORY_MIB } from './report.js';
import {
	ASSET_PERMUTATIONS,
	ASSET_SHADER_FILES,
	ASSET_TEMPLATES,
	recordedShaderList,
	shaderList,
	writeShaderList,
} from './shaders.js';

const ROOT = new URL('../../../../', import.meta.url);

/** An accessor of `array` in the document's own buffer. */
function accessor(
	doc: Document,
	array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
	type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR',
) {
	const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
	return doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
}

/** A triangle of three vertices with the given attributes and material. */
function triangle(
	doc: Document,
	material: ReturnType<Document['createMaterial']>,
	attributes: Record<
		string,
		[Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, 'VEC2' | 'VEC3' | 'VEC4']
	> = {},
) {
	const prim = doc
		.createPrimitive()
		.setAttribute('POSITION', accessor(doc, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3'))
		.setAttribute('NORMAL', accessor(doc, new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3'))
		.setAttribute('TEXCOORD_0', accessor(doc, new Float32Array([0, 0, 1, 0, 0, 1]), 'VEC2'))
		.setIndices(accessor(doc, new Uint16Array([0, 1, 2]), 'SCALAR'))
		.setMaterial(material);
	for (const [name, [values, type]] of Object.entries(attributes))
		prim.setAttribute(name, accessor(doc, values, type));
	return prim;
}

describe('shaderList', () => {
	it('lists the bits, the shader files and the pipeline keys of a scene', () => {
		const doc = new Document();
		const plain = doc.createMaterial('plain');
		const painted = doc
			.createMaterial('painted')
			.setAlphaMode('MASK')
			.setBaseColorTexture(doc.createTexture())
			.setNormalTexture(doc.createTexture());
		const transmission = doc
			.createExtension(KHRMaterialsTransmission)
			.createTransmission()
			.setTransmissionFactor(0.9);
		const glass = doc
			.createMaterial('glass')
			.setExtension('KHR_materials_transmission', transmission);
		const scene = doc.createScene();
		scene.addChild(
			doc
				.createNode('ball')
				.setMesh(
					doc
						.createMesh('ball')
						.addPrimitive(triangle(doc, painted, { TANGENT: [new Float32Array(12), 'VEC4'] })),
				),
		);
		scene.addChild(
			doc.createNode('floor').setMesh(doc.createMesh('floor').addPrimitive(triangle(doc, plain))),
		);
		scene.addChild(
			doc.createNode('pool').setMesh(doc.createMesh('drop').addPrimitive(triangle(doc, plain))),
		);
		scene.addChild(
			doc.createNode('water').setMesh(doc.createMesh('water').addPrimitive(triangle(doc, glass))),
		);
		const list = shaderList(doc, { lodOf });
		expect(list.permutations).toEqual(['ALPHA_MASK', 'VERTEX_TANGENT', 'TRANSMISSION']);
		expect(list.features).toEqual(['cutout', 'coverage', 'transmission']);
		expect(list.buckets).toEqual([
			{
				template: 'lit',
				format: 'uv0',
				permutations: [],
				key: 'lit uv0 plain',
				objects: 2,
			},
			{
				template: 'lit',
				format: 'uv0',
				permutations: ['TRANSMISSION'],
				key: 'lit uv0 TRANSMISSION',
				objects: 1,
			},
			{
				template: 'standard_maps',
				format: 'uv0+tangent',
				permutations: ['ALPHA_MASK', 'VERTEX_TANGENT'],
				key: 'standard_maps uv0+tangent ALPHA_MASK+VERTEX_TANGENT',
				objects: 1,
			},
		]);
	});

	it('gives a skinned, morphed mesh with levels its own bits and files', () => {
		const doc = new Document();
		const material = doc.createMaterial('skin');
		const mesh = doc.createMesh('knight').addPrimitive(
			triangle(doc, material, {
				COLOR_0: [new Float32Array(12), 'VEC4'],
				JOINTS_0: [new Uint16Array(12), 'VEC4'],
				WEIGHTS_0: [new Float32Array(12), 'VEC4'],
			}),
		);
		mesh
			.listPrimitives()[0]
			?.addTarget(
				doc
					.createPrimitiveTarget()
					.setAttribute('POSITION', accessor(doc, new Float32Array(9), 'VEC3')),
			);
		const joint = doc.createNode('joint');
		const skin = doc.createSkin('skin').addJoint(joint).setSkeleton(joint);
		doc.createScene().addChild(doc.createNode('knight').setMesh(mesh).setSkin(skin));
		// The tool marks the nodes with levels of detail; the fake says which one.
		const list = shaderList(doc, { lodOf: (node) => (node.getName() === 'knight' ? {} : null) });
		expect(list.permutations).toEqual(['VERTEX_COLOR', 'SKIN', 'MORPH', 'LOD_FADE']);
		expect(list.features).toEqual(['lod_fade', 'morph', 'skinning']);
		expect(list.buckets[0]?.key).toBe(
			'lit uv0+color+joints+weights+morph VERTEX_COLOR+SKIN+MORPH+LOD_FADE',
		);
	});

	it('lists the fade file only for levels that fade', () => {
		/** The list of a document whose one node has levels with `errors` and `coverage`. */
		const list = (errors: number[], coverage?: number[]) => {
			const doc = new Document();
			const lod = doc.createExtension(MSFTLod).createLod().setErrors(errors);
			if (coverage) lod.setCoverage(coverage);
			const node = doc
				.createNode('hill')
				.setMesh(doc.createMesh('hill').addPrimitive(triangle(doc, doc.createMaterial('rock'))));
			node.setExtension(MSFT_LOD, lod);
			doc.createScene().addChild(node);
			return shaderList(doc, { lodOf });
		};
		// The tool writes the coverage beside each measured error, so those levels switch at once.
		const measured = list([0.02, 0.04], [0.5, 0.2]);
		expect(measured.permutations).toEqual([]);
		expect(measured.features).toEqual([]);
		// A hand-set error comes alone, so its levels fade.
		const handSet = list([0.02, 0.04]);
		expect(handSet.permutations).toEqual(['LOD_FADE']);
		expect(handSet.features).toEqual(['lod_fade']);
	});

	it('names the clear coat and sheen of a layered material', () => {
		const doc = new Document();
		const clearcoat = doc
			.createExtension(KHRMaterialsClearcoat)
			.createClearcoat()
			.setClearcoatFactor(1);
		const coated = doc.createMaterial('coated').setExtension('KHR_materials_clearcoat', clearcoat);
		doc
			.createScene()
			.addChild(
				doc.createNode('ball').setMesh(doc.createMesh('ball').addPrimitive(triangle(doc, coated))),
			);
		const list = shaderList(doc, { lodOf });
		expect(list.permutations).toEqual(['COAT_SHEEN']);
		expect(list.features).toEqual(['coat_sheen']);
		expect(list.buckets[0]?.key).toBe('lit uv0 COAT_SHEEN');
	});

	it('counts each instance of an instancing node as one object', () => {
		const doc = new Document();
		const instancing = doc.createExtension(EXTMeshGPUInstancing).setRequired(false);
		const instances = instancing
			.createInstancedMesh()
			.setAttribute('TRANSLATION', accessor(doc, new Float32Array(12), 'VEC3'));
		const node = doc
			.createNode('posts')
			.setMesh(doc.createMesh('post').addPrimitive(triangle(doc, doc.createMaterial('post'))))
			.setExtension('EXT_mesh_gpu_instancing', instances);
		doc.createScene().addChild(node);
		const list = shaderList(doc, { lodOf });
		expect(list.buckets).toEqual([
			{ template: 'lit', format: 'uv0', permutations: [], key: 'lit uv0 plain', objects: 4 },
		]);
	});

	it('records the list with the file, where the engine reads it', async () => {
		const doc = new Document();
		doc
			.createScene()
			.addChild(
				doc
					.createNode('ball')
					.setMesh(
						doc
							.createMesh('ball')
							.addPrimitive(triangle(doc, doc.createMaterial('masked').setAlphaMode('MASK'))),
					),
			);
		writeShaderList(doc, shaderList(doc, { lodOf }));
		expect(recordedShaderList(doc)).toEqual({
			permutations: ['ALPHA_MASK'],
			features: ['cutout', 'coverage'],
		});
		const glb = new Uint8Array(await new NodeIO().writeBinary(doc));
		const container = readContainer(glb, 'file:///a.glb');
		expect(container.json.asset?.extras).toMatchObject({
			NULL3D_shaders: { permutations: ['ALPHA_MASK'], features: ['cutout', 'coverage'] },
		});
		const parsed = parseGltf(container, new Map(), 'file:///a.glb');
		expect(parsed.shaders).toEqual({
			permutations: ['ALPHA_MASK'],
			features: ['cutout', 'coverage'],
		});
	});
});

describe('the names and budgets that the list names', () => {
	const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

	it('names permutation bits and mesh templates that the engine builds', () => {
		const table = /pub const NAMES: \[\(&str, u32\); (\d+)\] = \[([^\]]*)\];/.exec(
			read('crates/null3d-gpu/src/drawlist.rs'),
		);
		expect(table).not.toBeNull();
		const declared = Number(table?.[1]);
		const bits = [...String(table?.[2]).matchAll(/\("([A-Z_]+)", [A-Z_]+\)/g)].map((m) => m[1]);
		expect(declared).toBeGreaterThan(0);
		expect(bits.length).toBe(declared);
		for (const bit of ASSET_PERMUTATIONS) expect(bits).toContain(bit);
		const shaders = [
			...read('crates/null3d-shaders/shaders.toml').matchAll(/^\[shaders\.([a-z_0-9]+)\]/gm),
		].map((m) => m[1]);
		for (const template of ASSET_TEMPLATES) expect(shaders).toContain(template);
	});

	it('names first-use shader files that the engine loads', () => {
		const features = [
			...read('crates/null3d-shaders/shaders.toml').matchAll(/^\[first_use\.([a-z_0-9]+)\]/gm),
		].map((m) => m[1]);
		for (const file of ASSET_SHADER_FILES) expect(features).toContain(file);
		expect(ASSET_SHADER_FILES.length).toBeLessThan(features.length);
	});

	it('gives each preset the texture memory budget that the engine gives it', () => {
		const array = /textureMemoryMiB:\s*\{\s*presets:\s*\[([^\]]+)\]/.exec(
			read('packages/engine/src/quality/presets.ts'),
		);
		expect(array?.[1]).toBeDefined();
		expect(
			String(array?.[1])
				.split(',')
				.map((v) => Number(v.trim())),
		).toEqual(PRESET_TEXTURE_MEMORY_MIB);
	});
});

describe('budgetWarnings', () => {
	const MIB = 1024 * 1024;

	it('warns for each preset whose budget the textures pass', () => {
		expect(budgetWarnings({ etc2: 100 * MIB, bc7: 100 * MIB, rgba8: 0 })).toEqual([]);
		expect(budgetWarnings({ etc2: 300 * MIB, bc7: 1100 * MIB, rgba8: 0 })).toEqual([
			{ preset: 'low', limitMiB: 256, bytes: 300 * MIB, figure: 'etc2' },
			{ preset: 'high', limitMiB: 1024, bytes: 1100 * MIB, figure: 'bc7' },
		]);
	});
});
