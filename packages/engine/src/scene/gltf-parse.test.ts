import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	armBuilder,
	blenderMorphBuilder,
	boxArrays,
	boxPrimitive,
	faceTargets,
	GltfBuilder,
	type GltfJson,
	iorBuilder,
	morphBuilder,
	shipBuilder,
	specularBuilder,
} from '../../../../tests/pages/lib/gltf-files';
import {
	type GltfData,
	GltfError,
	MAX_ACCESSOR_BYTES,
	type MaterialData,
	parseGltf,
	readContainer,
} from './gltf-parse';

const URL_OF = 'https://example.com/models/test.glb';

/** Parses a file whose buffers are all inside it. */
function parse(file: Uint8Array, url = URL_OF): GltfData {
	return parseGltf(readContainer(file, url), new Map(), url);
}

/** The code and message of the error that parsing a file throws. */
function refusal(file: Uint8Array): [string, string] {
	try {
		parse(file);
	} catch (error) {
		if (error instanceof GltfError) return [error.code, error.message];
		throw error;
	}
	throw new Error('the file parsed');
}

/** A .gltf file of a JSON object, with no buffer. */
const jsonFile = (json: GltfJson) => new TextEncoder().encode(JSON.stringify(json));

/** The component types that glTF allows for sparse indices, with their sizes in bits. */
const SPARSE_INDEX_TYPES = [
	[5121, 8],
	[5123, 16],
	[5125, 32],
] as const;

describe('the container', () => {
	test('a .glb file and its .gltf twin give the same data', () => {
		const glb = parse(shipBuilder().glb());
		const gltf = parse(shipBuilder().gltf());
		expect(gltf).toEqual(glb);
		expect(glb.nodes.map((n) => n.name)).toEqual(['Ship', 'Hull', 'Turret']);
	});

	test('a .gltf file lists the buffers it names by address, resolved against its own', () => {
		const container = readContainer(shipBuilder().gltf('ship.bin'), URL_OF);
		expect([...container.external]).toEqual([[0, 'https://example.com/models/ship.bin']]);
		const bytes = shipBuilder().bytes();
		const data = parseGltf(container, new Map([[0, bytes]]), URL_OF);
		expect(data.meshes).toHaveLength(2);
	});

	test('broken containers and JSON are refused with E1416', () => {
		const glb = shipBuilder().glb();
		expect(refusal(glb.slice(0, 16))[0]).toBe('E1416');
		const version = glb.slice();
		new DataView(version.buffer).setUint32(4, 1, true);
		expect(refusal(version)[1]).toContain('version 1');
		expect(refusal(new TextEncoder().encode('{"asset": '))[1]).toContain('does not parse');
		expect(refusal(jsonFile({ asset: { version: '1.0' } }))[1]).toContain('glTF 1.0');
		expect(refusal(jsonFile([]))[1]).toContain('not an object');
		const cut = glb.slice();
		new DataView(cut.buffer).setUint32(12, 1 << 20, true);
		expect(refusal(cut)[1]).toContain('past its end');
	});

	test('an extension that the file requires and the engine does not read gives E1417', () => {
		const b = shipBuilder().uses('KHR_draco_mesh_compression', true);
		expect(refusal(b.glb())).toEqual([
			'E1417',
			'it requires KHR_draco_mesh_compression, which the engine does not read',
		]);
		// One that the file only uses is left alone.
		expect(() => parse(shipBuilder().uses('KHR_materials_clearcoat').glb())).not.toThrow();
		expect(() => parse(shipBuilder().uses('KHR_materials_unlit', true).glb())).not.toThrow();
	});
});

describe('meshes', () => {
	test('a primitive keeps its arrays in the types the file holds them in', () => {
		const data = parse(shipBuilder().glb());
		const [hull] = data.meshes;
		const [first] = hull?.primitives ?? [];
		expect(first?.positions.array).toBeInstanceOf(Float32Array);
		expect(first?.positions.array.length).toBe(72);
		expect(first?.indices).toBeInstanceOf(Uint16Array);
		expect(first?.indices?.length).toBe(36);
		expect(first?.min).toEqual([-0.5, -0.5, -0.5]);
		expect(first?.max).toEqual([0.5, 0.5, 0.5]);
		expect(hull?.primitives.map((p) => p.material)).toEqual([0, 1]);
	});

	test('quantized attributes keep their integers, and normalized ones say so', () => {
		const b = new GltfBuilder().uses('KHR_mesh_quantization', true);
		const positions = b.positions(new Uint16Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]));
		const normals = b.accessor(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, {
			normalized: true,
		});
		const uvs = b.accessor(new Uint16Array([0, 0, 65535, 0, 0, 65535]), 2, { normalized: true });
		const mesh = b.mesh([
			{ attributes: { POSITION: positions, NORMAL: normals, TEXCOORD_0: uvs } },
		]);
		b.node({ mesh, scale: [0.001, 0.001, 0.001] });
		const [p] = parse(b.glb()).meshes[0]?.primitives ?? [];
		expect(p?.positions).toEqual({
			array: new Uint16Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]),
			normalized: false,
		});
		expect(p?.normals?.array).toBeInstanceOf(Int8Array);
		expect(p?.normals?.normalized).toBe(true);
		expect(p?.uvs?.normalized).toBe(true);
		expect(p?.indices).toBeUndefined();
	});

	test('a type that glTF does not allow for an attribute gives E1416', () => {
		const b = new GltfBuilder();
		const positions = b.positions(new Float32Array(9));
		const normals = b.accessor(new Int8Array(9), 3);
		b.node({ mesh: b.mesh([{ attributes: { POSITION: positions, NORMAL: normals } }]) });
		expect(refusal(b.glb())[1]).toContain(
			'NORMAL is 3 values of component type 5120, which glTF does not allow',
		);
	});

	test('interleaved views, 8-bit indices and sparse values read as glTF says', () => {
		const b = new GltfBuilder();
		// Position then normal per vertex, 24 bytes apart.
		const interleaved = new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1]);
		const view = b.view(new Uint8Array(interleaved.buffer), 24);
		b.json.accessors.push(
			{
				bufferView: view,
				componentType: 5126,
				count: 3,
				type: 'VEC3',
				min: [0, 0, 0],
				max: [1, 1, 0],
			},
			{ bufferView: view, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC3' },
		);
		const indices = b.accessor(new Uint8Array([0, 1, 2]), 1);
		const sparseIndices = b.view(new Uint8Array(new Uint16Array([2]).buffer));
		const sparseValues = b.view(new Uint8Array(new Float32Array([5, 6, 7]).buffer));
		const sparse =
			b.json.accessors.push({
				componentType: 5126,
				count: 3,
				type: 'VEC3',
				sparse: {
					count: 1,
					indices: { bufferView: sparseIndices, componentType: 5123 },
					values: { bufferView: sparseValues },
				},
			}) - 1;
		const mesh = b.mesh([
			{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_1: undefined, COLOR_0: sparse }, indices },
		]);
		b.node({ mesh });
		const [p] = parse(b.glb()).meshes[0]?.primitives ?? [];
		expect(Array.from(p?.positions.array ?? [])).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		expect(Array.from(p?.normals?.array ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
		expect(p?.indices).toEqual(new Uint16Array([0, 1, 2]));
		expect(Array.from(p?.colors?.array ?? [])).toEqual([0, 0, 0, 0, 0, 0, 5, 6, 7]);
	});

	for (const [indexType, bits] of SPARSE_INDEX_TYPES)
		test(`sparse values over a buffer view, with ${bits}-bit indices, replace their elements`, () => {
			const b = new GltfBuilder();
			const base = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
			// Lifts every vertex but the second, so the sparse list holds three of the four.
			const lifted = base.map((v, k) => (k % 3 === 2 && k !== 5 ? 0.5 : v));
			const positions = b.sparse(lifted, 3, { base, indexType });
			expect(b.json.accessors[positions].sparse.count).toBe(3);
			const indices = b.accessor(new Uint8Array([0, 1, 2, 0, 2, 3]), 1);
			b.node({ mesh: b.mesh([{ attributes: { POSITION: positions }, indices }]) });
			const [p] = parse(b.glb()).meshes[0]?.primitives ?? [];
			expect(Array.from(p?.positions.array ?? [])).toEqual(Array.from(lifted));
		});

	test('strips and fans become triangle lists, and points and lines are noted and left out', () => {
		const b = new GltfBuilder();
		const positions = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]));
		b.node({
			mesh: b.mesh([
				{ attributes: { POSITION: positions }, mode: 5 },
				{ attributes: { POSITION: positions }, mode: 6 },
				{ attributes: { POSITION: positions }, mode: 1 },
			]),
		});
		const data = parse(b.glb());
		const [strip, fan] = data.meshes[0]?.primitives ?? [];
		expect(data.meshes[0]?.primitives).toHaveLength(2);
		expect(Array.from(strip?.indices ?? [])).toEqual([0, 1, 2, 3, 2, 1]);
		expect(Array.from(fan?.indices ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
		expect(data.notes).toHaveLength(1);
		expect(data.notes[0]).toContain('points or lines');
	});
});

describe('files that break the rules give E1416 and never allocate their counts', () => {
	const broken = (change: (json: GltfJson) => void) => {
		const b = shipBuilder();
		const glb = b.glb();
		change(b.json);
		const bin = b.bytes();
		const text = new TextEncoder().encode(JSON.stringify(b.json));
		const padded = Math.ceil(text.length / 4) * 4;
		const out = new Uint8Array(28 + padded + bin.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, 0x46546c67, true);
		view.setUint32(4, 2, true);
		view.setUint32(8, out.length, true);
		view.setUint32(12, padded, true);
		view.setUint32(16, 0x4e4f534a, true);
		out.fill(0x20, 20, 20 + padded);
		out.set(text, 20);
		view.setUint32(20 + padded, bin.length, true);
		view.setUint32(24 + padded, 0x004e4942, true);
		out.set(bin, 28 + padded);
		expect(glb.length).toBeGreaterThan(0);
		return refusal(out);
	};

	test.each([
		[
			'an accessor past its view',
			(j: GltfJson) => {
				j.accessors[0].byteOffset = 4096;
			},
			'reads',
		],
		[
			'a view past its buffer',
			(j: GltfJson) => {
				j.bufferViews[0].byteLength = 1 << 24;
			},
			'which holds',
		],
		[
			'a missing buffer',
			(j: GltfJson) => {
				j.bufferViews[0].buffer = 3;
			},
			"bufferView 0's buffer is 3, and there are 1",
		],
		[
			'a buffer with no uri past the first',
			(j: GltfJson) => {
				j.buffers.push({ byteLength: 4 });
			},
			'has no uri',
		],
		[
			'a loop of parents',
			(j: GltfJson) => {
				j.nodes[0].children = [1];
				j.nodes[1].children = [0];
			},
			'more than one parent',
		],
		[
			'a node that is its own child',
			(j: GltfJson) => {
				j.nodes[2].children.push(2);
			},
			'more than one parent, or is its own',
		],
		[
			'a scene that names a child node',
			(j: GltfJson) => {
				j.scenes[0].nodes.push(1);
			},
			'which has a parent',
		],
		[
			'a huge count',
			(j: GltfJson) => {
				j.accessors[0].count = 2_000_000_000;
			},
			'more than the',
		],
		[
			'a huge count without a view',
			(j: GltfJson) => {
				delete j.accessors[0].bufferView;
				j.accessors[0].count = MAX_ACCESSOR_BYTES;
			},
			'more than the',
		],
		[
			'a count that is not a whole number',
			(j: GltfJson) => {
				j.accessors[0].count = -3;
			},
			'not a whole number',
		],
		[
			'an index past the vertices',
			(j: GltfJson) => {
				j.meshes[0].primitives[0].indices = j.accessors.length;
				j.accessors.push({ ...j.accessors[3], count: 3 });
				j.accessors[0].count = 1;
			},
			'POSITION has',
		],
		[
			'a material that does not exist',
			(j: GltfJson) => {
				j.meshes[0].primitives[0].material = 9;
			},
			'names material 9',
		],
		[
			'a texture that does not exist',
			(j: GltfJson) => {
				j.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 4 };
			},
			"baseColorTexture's texture is 4, and there are 0",
		],
		[
			'a light of an unknown type',
			(j: GltfJson) => {
				j.extensions = { KHR_lights_punctual: { lights: [{ type: 'area' }] } };
			},
			'has the type area',
		],
	])('%s', (_, change, words) => {
		const [code, message] = broken(change);
		expect(code).toBe('E1416');
		expect(message).toContain(words);
	});
});

describe('nodes', () => {
	test('parents come first, each child names its parent, and a matrix splits into its parts', () => {
		const b = new GltfBuilder();
		const leaf = b.node(
			{ name: 'leaf', matrix: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1] },
			true,
		);
		const middle = b.node({ name: 'middle', children: [leaf] }, true);
		b.node({ name: 'root', children: [middle], translation: [1, 2, 3] });
		const nodes = parse(b.glb()).nodes;
		expect(nodes.map((n) => [n.name, n.parent])).toEqual([
			['root', -1],
			['middle', 0],
			['leaf', 1],
		]);
		expect(Array.from(nodes[2]?.transform ?? [])).toEqual([5, 6, 7, 0, 0, 0, 1, 2, 3, 4]);
		expect(Array.from(nodes[0]?.transform ?? [])).toEqual([1, 2, 3, 0, 0, 0, 1, 1, 1, 1]);
	});

	test('without scenes, every node without a parent is a root', () => {
		const b = shipBuilder();
		delete b.json.scenes;
		delete b.json.scene;
		expect(parse(b.glb()).nodes.map((n) => n.name)).toEqual(['Ship', 'Hull', 'Turret']);
	});

	test('instancing gives each instance its transform, with what the file leaves out filled in', () => {
		const b = shipBuilder().uses('EXT_mesh_gpu_instancing');
		const translations = b.accessor(new Float32Array([0, 0, 0, 3, 0, 0]), 3);
		const rotations = b.accessor(new Int16Array([0, 0, 0, 32767, 0, 32767, 0, 0]), 4, {
			normalized: true,
		});
		// The hull is the file's first node, and the ship's first child.
		b.json.nodes[0].extensions = {
			EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: translations, ROTATION: rotations } },
		};
		const hull = parse(b.glb()).nodes[1];
		expect(hull?.instancing?.count).toBe(2);
		expect(Array.from(hull?.instancing?.positions ?? [])).toEqual([0, 0, 0, 3, 0, 0]);
		expect(Array.from(hull?.instancing?.rotations ?? [])).toEqual([0, 0, 0, 1, 0, 1, 0, 0]);
		expect(Array.from(hull?.instancing?.scales ?? [])).toEqual([1, 1, 1, 1, 1, 1]);
	});
});

describe('materials, textures and lights', () => {
	/** A material with every map of one texture, with texture transforms and extensions. */
	function texturedBuilder(): GltfBuilder {
		const b = shipBuilder().uses('KHR_texture_transform').uses('KHR_materials_emissive_strength');
		const image = b.view(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		b.json.images = [{ bufferView: image, mimeType: 'image/png' }, { uri: 'tex/rough.png' }];
		b.json.samplers = [{ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9729 }];
		b.json.textures = [{ source: 0 }, { source: 1, sampler: 0 }];
		b.json.materials[0] = {
			name: 'painted',
			pbrMetallicRoughness: {
				baseColorFactor: [0.5, 0.25, 1, 0.5],
				baseColorTexture: {
					index: 0,
					extensions: {
						KHR_texture_transform: { offset: [0.5, 0], scale: [2, 3], rotation: 0.25 },
					},
				},
				metallicRoughnessTexture: { index: 1 },
				metallicFactor: 0.25,
				roughnessFactor: 0.75,
			},
			normalTexture: { index: 0, scale: 0.5, texCoord: 1 },
			occlusionTexture: { index: 1, strength: 0.4 },
			emissiveTexture: { index: 0 },
			emissiveFactor: [1, 0.5, 0],
			alphaMode: 'MASK',
			alphaCutoff: 0.3,
			doubleSided: true,
			extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
		};
		b.json.materials[1].extensions = { KHR_materials_unlit: {} };
		return b;
	}

	test('a material becomes the engine options, with its maps as texture uses', () => {
		const data = parse(texturedBuilder().glb());
		const [painted, unlit] = data.materials;
		expect(painted).toMatchObject({
			name: 'painted',
			unlit: false,
			color: [0.5, 0.25, 1],
			opacity: 0.5,
			alphaMode: 'mask',
			alphaCutoff: 0.3,
			doubleSided: true,
			metalness: 0.25,
			roughness: 0.75,
			emissive: [1, 0.5, 0],
			emissiveIntensity: 4,
			normalScale: 0.5,
			aoMapIntensity: 0.4,
			uvTransform: { offset: [0.5, 0], repeat: [2, 3], rotation: 0.25 },
		});
		expect(unlit?.unlit).toBe(true);
		const uses = data.textures;
		const maps: MaterialData['maps'] = painted?.maps ?? {};
		expect(uses[maps.map ?? -1]).toEqual({
			image: 0,
			colorSpace: 'srgb',
			uvSet: 0,
			wrap: ['repeat', 'repeat'],
			filter: 'linear',
			mipmaps: true,
		});
		expect(uses[maps.normalMap ?? -1]).toMatchObject({ image: 0, colorSpace: 'linear', uvSet: 1 });
		expect(uses[maps.metalnessRoughnessMap ?? -1]).toEqual({
			image: 1,
			colorSpace: 'linear',
			uvSet: 0,
			wrap: ['clamp', 'mirror'],
			filter: 'nearest',
			mipmaps: false,
		});
		// The occlusion map is the same use as the metal-rough map, so they share a texture.
		expect(maps.aoMap).toBe(maps.metalnessRoughnessMap);
		expect(maps.emissiveMap).toBe(maps.map);
		expect(data.images[0]?.bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		expect(data.images[1]).toEqual({
			url: 'https://example.com/models/tex/rough.png',
			mimeType: undefined,
		});
	});

	test('a material without KHR_materials_specular or KHR_materials_ior takes their defaults', () => {
		const [red] = parse(shipBuilder().glb()).materials;
		expect(red).toMatchObject({ ior: 1.5, specularIntensity: 1, specularColor: [1, 1, 1] });
		expect(red?.maps.specularIntensityMap).toBeUndefined();
		expect(red?.maps.specularColorMap).toBeUndefined();
	});

	test('KHR_materials_specular gives the factors, and its textures in their color spaces', () => {
		const data = parse(specularBuilder().glb());
		const byName = new Map(data.materials.map((m) => [m.name, m]));
		expect(byName.get('factor 3')).toMatchObject({
			specularIntensity: 0.520996,
			specularColor: [1, 1, 1],
			ior: 1.5,
		});
		expect(byName.get('yellow 2')?.specularColor).toEqual([0.212231, 0.212231, 0]);
		// Color factors above 1 stay, as glTF allows; the shader caps the reflectance.
		expect(byName.get('bright 4')?.specularColor).toEqual([25, 25, 25]);
		const intensity = byName.get('texture 0')?.maps.specularIntensityMap ?? -1;
		const color = byName.get('gray texture 0')?.maps.specularColorMap ?? -1;
		expect(data.textures[intensity]).toMatchObject({
			image: 0,
			colorSpace: 'linear',
			filter: 'nearest',
		});
		expect(data.textures[color]).toMatchObject({ image: 1, colorSpace: 'srgb' });
		expect(byName.get('texture 0')?.maps.specularColorMap).toBeUndefined();
	});

	test('KHR_materials_ior gives the index, and 0 stands for a very large one', () => {
		const data = parse(iorBuilder().glb());
		const iors = data.materials.filter((m) => m.name.startsWith('smooth')).map((m) => m.ior);
		expect(iors).toEqual([1, 1.25, 1.5, 2, 3, 1000]);
		expect(data.materials.find((m) => m.name === 'half metal ior 2')).toMatchObject({
			ior: 2,
			metalness: 0.5,
			specularIntensity: 0.6,
			specularColor: [1, 0.6, 0.3],
		});
	});

	test('specular and ior values outside their ranges give E1416', () => {
		const withExtensions = (extensions: GltfJson) => {
			const b = shipBuilder().uses('KHR_materials_specular').uses('KHR_materials_ior');
			b.json.materials[0].extensions = extensions;
			return b.glb();
		};
		const cases: [GltfJson, string][] = [
			[{ KHR_materials_ior: { ior: 0.5 } }, "material 0's ior is 0.5"],
			[{ KHR_materials_ior: { ior: 'glass' } }, "material 0's ior is glass"],
			[{ KHR_materials_specular: { specularFactor: 2 } }, "material 0's specularFactor is 2"],
			[
				{ KHR_materials_specular: { specularColorFactor: [1, -1, 1] } },
				"material 0's specularColorFactor has a component below 0",
			],
			[
				{ KHR_materials_specular: { specularColorFactor: [1, 1] } },
				"material 0's specularColorFactor is not 3 numbers",
			],
			[
				{ KHR_materials_specular: { specularTexture: { index: 9 } } },
				"material 0's specularTexture",
			],
		];
		for (const [extensions, message] of cases) {
			const [code, text] = refusal(withExtensions(extensions));
			expect([code, text.includes(message)]).toEqual(['E1416', true]);
		}
	});

	test('KHR_texture_basisu names the KTX2 image of a texture', () => {
		const b = shipBuilder().uses('KHR_texture_basisu', true);
		const ktx2 = readFileSync(
			join(import.meta.dirname, '../../../../tests/pages/assets/textures/quarters-etc1s.ktx2'),
		);
		b.json.images = [{ bufferView: b.view(new Uint8Array(ktx2)), mimeType: 'image/ktx2' }];
		b.json.textures = [{ extensions: { KHR_texture_basisu: { source: 0 } } }];
		b.json.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
		const data = parse(b.glb());
		expect(data.textures[0]?.image).toBe(0);
		expect(data.images[0]?.mimeType).toBe('image/ktx2');
		expect(data.images[0]?.bytes?.length).toBe(ktx2.length);
	});

	test('lights keep glTF units, and spot cones take three.js penumbras', () => {
		const b = shipBuilder().uses('KHR_lights_punctual');
		b.json.extensions = {
			KHR_lights_punctual: {
				lights: [
					{ type: 'point', color: [1, 0.5, 0.25], intensity: 20 },
					{
						type: 'spot',
						intensity: 5,
						range: 8,
						spot: { innerConeAngle: 0.2, outerConeAngle: 0.4 },
					},
					{ type: 'directional', intensity: 2 },
				],
			},
		};
		b.json.nodes[0].extensions = { KHR_lights_punctual: { light: 1 } };
		const data = parse(b.glb());
		expect(data.lights).toEqual([
			{
				type: 'point',
				color: [1, 0.5, 0.25],
				intensity: 20,
				range: 0,
				angle: Math.PI / 4,
				penumbra: 1,
			},
			{ type: 'spot', color: [1, 1, 1], intensity: 5, range: 8, angle: 0.4, penumbra: 0.5 },
			{
				type: 'directional',
				color: [1, 1, 1],
				intensity: 2,
				range: 0,
				angle: Math.PI / 4,
				penumbra: 1,
			},
		]);
		expect(data.nodes[1]?.light).toBe(1);
	});

	test('a primitive without a material takes glTF default material', () => {
		const b = new GltfBuilder();
		b.node({ mesh: b.mesh([boxPrimitive(b)]) });
		expect(parse(b.glb()).meshes[0]?.primitives[0]?.material).toBe(-1);
	});
});

describe('skins and clips', () => {
	test('one skeleton holds the skin joints, the nodes clips move, what is below and above them', () => {
		const data = parse(armBuilder().glb());
		const animation = data.animation;
		expect(animation?.joints.map((j) => [j.name, j.parent, j.bone === true])).toEqual([
			['Arm', -1, false],
			['Shoulder', 0, true],
			['Elbow', 1, true],
			['Hand', 2, true],
			['Sword', 3, false],
		]);
		// Each skin joint carries its inverse bind matrix by rows; the others have none.
		expect(Array.from(animation?.joints[2]?.inverseBind ?? []).map((v) => v + 0)).toEqual([
			1, 0, 0, 0, 0, 1, 0, -2, 0, 0, 1, -1,
		]);
		expect(Array.from(animation?.joints[1]?.inverseBind ?? []).map((v) => v + 0)).toEqual([
			1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1, -1,
		]);
		expect(Array.from(animation?.joints[4]?.inverseBind ?? [])).toEqual([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
		]);
		const byName = new Map(data.nodes.map((n) => [n.name, n]));
		// Joints are no objects; a node below one goes under the copy's group, where it rests.
		expect(data.nodes.filter((n) => (n.joint ?? -1) < 0).map((n) => n.name)).toEqual([
			'Sleeve',
			'Rock',
		]);
		expect(byName.get('Rock')?.parent).toBe(-1);
		expect([...(byName.get('Rock')?.transform ?? [])]).toEqual([2, 0, 1, 0, 0, 0, 1, 1, 1, 1]);
		expect(byName.get('Sword')?.moving).toBe(true);
		expect(byName.get('Rock')?.moving).toBe(false);
	});

	test('skinned meshes name the skeleton joints, and a mesh on a moving node gets its own', () => {
		const data = parse(armBuilder().glb());
		const byName = new Map(data.nodes.map((n) => [n.name, n]));
		const sleeve = byName.get('Sleeve');
		expect(sleeve?.skinned).toBe(true);
		const skinned = data.meshes[sleeve?.mesh ?? -1]?.primitives[0];
		const joints = [...(skinned?.joints?.array ?? [])];
		// The skin's joint 0 is Elbow, joint 2 of the skeleton, and its joint 1 is Shoulder, joint 1.
		expect(new Set(joints.filter((_, i) => i % 4 === 0))).toEqual(new Set([2, 1]));
		expect(joints.filter((_, i) => i % 4 === 1 && skinned?.weights?.array[i] !== 0)).toEqual(
			new Array(12).fill(1),
		);
		const sword = byName.get('Sword');
		expect(sword?.skinned).toBe(true);
		const rigid = data.meshes[sword?.mesh ?? -1]?.primitives[0];
		expect(rigid?.joints?.array.slice(0, 8)).toEqual(new Uint8Array([4, 0, 0, 0, 4, 0, 0, 0]));
		expect(rigid?.weights).toEqual({
			array: expect.any(Uint8Array) as unknown as Uint8Array,
			normalized: true,
		});
		expect(rigid?.weights?.array.slice(0, 4)).toEqual(new Uint8Array([255, 0, 0, 0]));
		// The rock keeps the file's mesh: nothing moves it.
		expect(byName.get('Rock')?.mesh).toBe(0);
	});

	test('clips keep their keys, with joints in place of nodes and three.js names', () => {
		const clips = parse(armBuilder().glb()).animation?.clips ?? [];
		expect(clips.map((c) => c.name)).toEqual(['Wave', 'animation_1']);
		const [bend, step] = clips[0]?.tracks ?? [];
		expect([bend?.joint, bend?.channel, bend?.interpolation, bend?.values.length]).toEqual([
			2,
			'rotation',
			'cubic',
			24,
		]);
		expect([
			step?.joint,
			step?.channel,
			step?.interpolation,
			Array.from(step?.times ?? []),
		]).toEqual([1, 'translation', 'step', [0, 0.5]]);
		expect(clips[1]?.tracks.map((t) => [t.joint, t.channel, t.interpolation])).toEqual([
			[3, 'scale', 'linear'],
		]);
	});

	test('two clips of one name both stay, the second with a number', () => {
		const b = armBuilder();
		b.json.animations[1].name = 'Wave';
		expect(parse(b.glb()).animation?.clips.map((c) => c.name)).toEqual(['Wave', 'Wave 2']);
	});

	test('a joint that two skins bind differently gets a joint at rest under it for the second', () => {
		const b = armBuilder();
		// Elbow at a new bind place, and Shoulder where the first skin binds it.
		const second = b.accessor(
			new Float32Array([
				...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -3, 0, 1],
				...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, -1, 1],
			]),
			16,
			{ type: 'MAT4', count: 2 },
		);
		b.json.skins.push({ joints: [2, 3], inverseBindMatrices: second });
		b.node({ name: 'Glove', mesh: b.json.nodes[6].mesh, skin: 1 });
		const data = parse(b.glb());
		const joints = data.animation?.joints ?? [];
		expect(joints).toHaveLength(6);
		expect([joints[5]?.name, joints[5]?.parent, Array.from(joints[5]?.inverseBind ?? [])]).toEqual([
			'Elbow',
			2,
			[1, 0, 0, 0, 0, 1, 0, -3, 0, 0, 1, 0],
		]);
		const glove = data.nodes.find((n) => n.name === 'Glove');
		const array = [...(data.meshes[glove?.mesh ?? -1]?.primitives[0]?.joints?.array ?? [])];
		expect(new Set(array.filter((_, i) => i % 4 === 0))).toEqual(new Set([5, 1]));
	});

	test('a file without skins or clips has no animation data', () => {
		expect(parse(shipBuilder().glb()).animation).toBeUndefined();
	});

	test('broken skins and clips are refused with E1416', () => {
		const broken = (change: (b: GltfBuilder) => void) => {
			const b = armBuilder();
			change(b);
			return refusal(b.glb());
		};
		expect(
			broken((b) => {
				b.json.animations[0].samplers[0].interpolation = 'BEZIER';
			})[1],
		).toContain('the interpolation BEZIER');
		expect(
			broken((b) => {
				b.json.animations[0].samplers[1].interpolation = 'CUBICSPLINE';
			})[1],
		).toContain('has 6 values for 2 keys of 9');
		expect(
			broken((b) => {
				b.json.animations[0].channels[1] = b.json.animations[0].channels[0];
			})[1],
		).toContain('twice');
		expect(
			broken((b) => {
				b.json.animations[0].channels[0].target.path = 'color';
			})[1],
		).toContain('the path color');
		expect(
			broken((b) => {
				b.json.skins[0].joints = [2, 2];
			})[1],
		).toContain('names a node twice');
		expect(
			broken((b) => {
				b.json.skins[0].joints = [2, 99];
			})[1],
		).toContain("skin 0's joint is 99");
		expect(
			broken((b) => {
				b.json.skins[0].joints = [2];
			})[1],
		).toContain('names joint 1, and the skin has 1');
		// Key times that fall back.
		expect(
			broken((b) => {
				const times = b.accessor(new Float32Array([1, 0]), 1);
				b.json.animations[1].samplers[0].input = times;
			})[1],
		).toContain('never fall back');
		expect(
			broken((b) => {
				b.json.nodes[6].skin = 3;
			})[1],
		).toContain("node 6's skin is 3");
	});
});

describe('morph targets', () => {
	test('primitives keep their deltas, and meshes their weights and target names', () => {
		const data = parse(morphBuilder().glb());
		const mesh = data.meshes[0];
		expect(mesh?.weights).toEqual([0.25, 0.5]);
		expect(mesh?.targetNames).toEqual(['Up', 'Out']);
		const morph = mesh?.primitives[0]?.morph;
		expect(morph?.positions).toHaveLength(2);
		expect(morph?.positions?.[0]?.length).toBe(72);
		expect(morph?.normals).toBeUndefined();
		// The clip animates both weights through one joint that moves no vertex: a root at rest at
		// the origin with scale 0, which no skin names.
		const joints = data.animation?.joints ?? [];
		expect(joints.map((j) => [j.name, j.parent, j.translation, j.scale, j.bone])).toEqual([
			['Blob', -1, [0, 0, 0], [0, 0, 0], undefined],
		]);
		expect(data.nodes[0]?.morphJoint).toBe(0);
		// The weights move the joint along x and y, and one key of scale 1 marks them as the clip's.
		const [pulse] = data.animation?.clips ?? [];
		expect(
			pulse?.tracks.map((t) => [
				t.joint,
				t.channel,
				t.interpolation,
				Array.from(t.times),
				Array.from(t.values),
			]),
		).toEqual([
			[0, 'translation', 'linear', [0, 1], [0, 0, 0, 1, 1, 0]],
			[0, 'scale', undefined, [0], [1, 1, 1]],
		]);
	});

	test('weights tracks give three weights to a joint, with cubic keys kept in order', () => {
		const b = morphBuilder();
		const primitive = b.json.meshes[0].primitives[0];
		const [up] = primitive.targets;
		primitive.targets = [up, up, up, up];
		b.json.meshes[0].weights = [0, 0, 0, 0];
		delete b.json.meshes[0].extras;
		b.json.nodes[0].weights = [0.1, 0.2, 0.3, 0.4];
		// One key of four in-tangents, four weights and four out-tangents.
		const keys = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		b.json.animations[0].samplers[0] = {
			input: b.accessor(new Float32Array([0]), 1, { min: [0], max: [0] }),
			output: b.accessor(keys, 1),
			interpolation: 'CUBICSPLINE',
		};
		const data = parse(b.glb());
		expect(data.nodes[0]?.weights).toEqual([0.1, 0.2, 0.3, 0.4]);
		expect(data.animation?.joints).toHaveLength(2);
		const moves = (data.animation?.clips[0]?.tracks ?? []).filter(
			(t) => t.channel === 'translation',
		);
		expect(moves.map((t) => [t.joint, t.interpolation, Array.from(t.values)])).toEqual([
			[0, 'cubic', [1, 2, 3, 5, 6, 7, 9, 10, 11]],
			[1, 'cubic', [4, 0, 0, 8, 0, 0, 12, 0, 0]],
		]);
	});

	for (const [indexType, bits] of SPARSE_INDEX_TYPES)
		test(`a target in a sparse accessor with ${bits}-bit indices keeps its deltas`, () => {
			const b = morphBuilder();
			const up = boxArrays(1).positions.map((p, i) => (i % 3 === 1 && p > 0 ? 0.5 : 0));
			const target = b.sparse(up, 3, { indexType });
			expect(b.json.accessors[target].sparse.count).toBeGreaterThan(1);
			b.json.meshes[0].primitives[0].targets[0].POSITION = target;
			const morph = parse(b.glb()).meshes[0]?.primitives[0]?.morph;
			expect(Array.from(morph?.positions?.[0] ?? [])).toEqual(Array.from(up));
		});

	test('a face with shape keys loads as Blender writes it, in sparse accessors', () => {
		const b = blenderMorphBuilder();
		const types = b.json.meshes[0].primitives[0].targets.map(
			(t: GltfJson) => b.json.accessors[t.POSITION].sparse?.indices.componentType,
		);
		expect(types).toEqual([5123, 5121, undefined]);
		const data = parse(b.glb());
		const mesh = data.meshes[0];
		const expected = faceTargets();
		expect(mesh?.targetNames).toEqual(expected.names);
		expect(mesh?.weights).toEqual([0.5, 0, 0]);
		const morph = mesh?.primitives[0]?.morph;
		const plain = (deltas: Float32Array[] | undefined) => deltas?.map((d) => Array.from(d));
		expect(plain(morph?.positions)).toEqual(plain(expected.positions));
		expect(plain(morph?.normals)).toEqual(plain(expected.normals));
		expect(data.animation?.clips.map((c) => c.name)).toEqual(['Talk']);
	});

	test('broken morph targets are refused with E1416', () => {
		const b = morphBuilder();
		b.json.meshes[0].weights = [1];
		expect(refusal(b.glb())[1]).toContain('1 weights for 2 morph targets');
		const c = morphBuilder();
		c.json.animations[0].samplers[0].output = c.accessor(new Float32Array([0, 1, 1]), 1);
		expect(refusal(c.glb())[1]).toContain('3 values for 2 keys of 2');
		const e = morphBuilder();
		e.json.meshes[0].primitives[0].targets[1].COLOR_0 = e.accessor(new Float32Array(96), 4);
		expect(parse(e.glb()).notes.join()).toContain('move COLOR_0, which the engine does not morph');
		const d = morphBuilder();
		d.json.nodes[0].weights = [1, 2, 3];
		expect(refusal(d.glb())[1]).toContain("node 0's weights is not 2 numbers");
	});
});

describe('stored trees and blockers', () => {
	/** A box whose primitive carries the extensions that `extensions` makes. */
	const boxWith = (extensions: (b: GltfBuilder) => GltfJson) => {
		const b = new GltfBuilder();
		b.node({ mesh: b.mesh([{ ...boxPrimitive(b), extensions: extensions(b) }]) });
		return b;
	};

	test('a primitive keeps the bytes of its stored tree and its blocker', () => {
		const tree = new Uint32Array([0x5642_334e, 1, 12, 0]);
		const corners = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
		const b = boxWith((b) => ({
			NULL3D_mesh_bvh: { tree: b.accessor(tree, 1) },
			NULL3D_occluder: {
				positions: b.accessor(corners, 3),
				indices: b.accessor(new Uint8Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]), 1),
			},
		}));
		const [p] = parse(b.glb()).meshes[0]?.primitives ?? [];
		expect(new Uint32Array(p?.bvh?.slice().buffer ?? new ArrayBuffer(0))).toEqual(tree);
		expect(p?.occluder).toEqual({
			positions: corners,
			indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
		});
	});

	test('an occluder with no blocker blocks with its own mesh, and a plain primitive does not block', () => {
		const own = boxWith(() => ({ NULL3D_occluder: {} }));
		expect(parse(own.glb()).meshes[0]?.primitives[0]?.occluder).toBe(true);
		const plain = parse(shipBuilder().glb()).meshes[0]?.primitives[0];
		expect(plain?.occluder).toBeUndefined();
		expect(plain?.bvh).toBeUndefined();
	});

	test('a tree or a blocker that breaks the rules gives E1416', () => {
		const tree = boxWith((b) => ({ NULL3D_mesh_bvh: { tree: b.accessor(new Uint16Array(4), 1) } }));
		expect(refusal(tree.glb())[1]).toContain(
			'stored tree is not an accessor of unsigned 32-bit integers',
		);
		const flat = boxWith((b) => ({
			NULL3D_occluder: {
				positions: b.accessor(new Float32Array(6), 2),
				indices: b.accessor(new Uint8Array([0, 1, 2]), 1),
			},
		}));
		expect(refusal(flat.glb())[1]).toContain('blocker positions are not three floats per corner');
		const partial = boxWith((b) => ({
			NULL3D_occluder: {
				positions: b.accessor(new Float32Array(9), 3),
				indices: b.accessor(new Uint8Array([0, 1, 2, 0]), 1),
			},
		}));
		expect(refusal(partial.glb())[1]).toContain('blocker indices are not unsigned integers');
		const past = boxWith((b) => ({
			NULL3D_occluder: {
				positions: b.accessor(new Float32Array(9), 3),
				indices: b.accessor(new Uint8Array([0, 1, 3]), 1),
			},
		}));
		expect(refusal(past.glb())[1]).toContain('blocker has the index 3, past its 3 corners');
	});
});
