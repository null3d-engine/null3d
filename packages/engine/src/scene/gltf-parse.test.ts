import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	armBuilder,
	blenderMorphBuilder,
	boxArrays,
	boxPrimitive,
	colorMorphBuilder,
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
	needleLightMap,
	parseGltf,
	parseNeedleLightMaps,
	readContainer,
} from './gltf-parse';

const URL_OF = 'https://example.com/models/test.glb';

/** Parses a file whose buffers are all inside it. */
function parse(file: Uint8Array, url = URL_OF): GltfData {
	return parseGltf(readContainer(file, url), new Map(), url);
}

/** A number rounded to a thousandth, past the steps of 8-bit and 16-bit fractions. */
const rounded = (value: number) => Math.round(value * 1000) / 1000;

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
		const b = shipBuilder().uses('KHR_materials_variants', true);
		expect(refusal(b.glb())).toEqual([
			'E1417',
			'it requires KHR_materials_variants, which the engine does not read',
		]);
	});

	test('a used extension that nothing reads is listed, with an add-on that reads it', () => {
		const unread = (file: Uint8Array, handled: readonly string[] = []) => {
			const data = parseGltf(readContainer(file, URL_OF, handled), new Map(), URL_OF, {}, handled);
			return data.unread;
		};
		// The loader reads these two, so the file lists nothing.
		expect(unread(shipBuilder().uses('KHR_materials_clearcoat').glb())).toBeUndefined();
		expect(unread(shipBuilder().uses('KHR_materials_unlit', true).glb())).toBeUndefined();
		// The asset tool's own extensions sit on primitives, which the loader reads.
		expect(unread(shipBuilder().uses('NULL3D_mesh_bvh').glb())).toBeUndefined();
		// An add-on that reads one is named, and a file with its handler reads it too.
		expect(unread(shipBuilder().uses('KHR_gaussian_splatting').glb())).toEqual([
			{ name: 'KHR_gaussian_splatting', addon: '@null3d/splats' },
		]);
		expect(
			unread(shipBuilder().uses('KHR_gaussian_splatting').glb(), ['KHR_gaussian_splatting']),
		).toBeUndefined();
		// Nothing reads this one, so no package is named.
		expect(unread(shipBuilder().uses('KHR_materials_variants').glb())).toEqual([
			{ name: 'KHR_materials_variants' },
		]);
		// A name that the file lists twice comes once.
		const twice = shipBuilder().uses('KHR_materials_variants');
		twice.json.extensionsUsed?.push('KHR_materials_variants');
		expect(unread(twice.glb())).toEqual([{ name: 'KHR_materials_variants' }]);
		// A file that lists no extension has no note.
		expect(unread(shipBuilder().glb())).toBeUndefined();
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

	test('a primitive records the accessor behind each attribute, which a level shares with its base', () => {
		const b = new GltfBuilder();
		const positions = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
		const normals = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3);
		const base = b.mesh([{ attributes: { POSITION: positions, NORMAL: normals } }], 'base');
		const level = b.mesh([{ attributes: { POSITION: positions, NORMAL: normals } }], 'base_lod1');
		b.node({ mesh: base });
		b.node({ mesh: level });
		const [first, second] = parse(b.glb()).meshes;
		// The second mesh names the first's accessors, so the parser can tell that it shares them.
		expect(second?.primitives[0]?.accessors).toEqual(first?.primitives[0]?.accessors);
		expect(first?.primitives[0]?.accessors).toEqual({ POSITION: positions, NORMAL: normals });
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
			// Each map keeps its own transform: only the base color map's texture info gives one.
			uvTransforms: { map: { offset: [0.5, 0], repeat: [2, 3], rotation: 0.25 } },
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

	test('an image inside the file notes where its bytes lie there, to read them again', () => {
		const glb = texturedBuilder().glb();
		const data = parse(glb);
		const source = data.images[0]?.source;
		expect(source?.url).toBe(URL_OF);
		expect(source?.length).toBe(4);
		const at = source?.offset ?? 0;
		expect(glb.subarray(at, at + 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
		expect(data.images[1]?.source).toBeUndefined();
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

	test('KHR_materials_diffuse_transmission gives its factors, maps and volume', () => {
		const b = specularBuilder()
			.uses('KHR_materials_diffuse_transmission')
			.uses('KHR_materials_volume')
			.uses('KHR_materials_transmission');
		const [leaf, shiny, glass] = b.json.materials as [GltfJson, GltfJson, GltfJson];
		leaf.extensions = {
			KHR_materials_diffuse_transmission: {
				diffuseTransmissionFactor: 0.75,
				diffuseTransmissionColorFactor: [0.5, 1, 0.25],
				diffuseTransmissionTexture: { index: 0 },
				diffuseTransmissionColorTexture: { index: 1 },
			},
			KHR_materials_volume: {
				thicknessFactor: 0.2,
				attenuationColor: [1, 0.5, 0.5],
				attenuationDistance: 0.1,
			},
		};
		shiny.extensions = {
			KHR_materials_diffuse_transmission: { diffuseTransmissionFactor: 1 },
			KHR_materials_specular: { specularTexture: { index: 0 } },
		};
		glass.extensions = {
			KHR_materials_diffuse_transmission: { diffuseTransmissionFactor: 1 },
			KHR_materials_transmission: { transmissionFactor: 1 },
		};
		const data = parse(b.glb());
		const [first, second, third] = data.materials;
		expect(first?.diffuseTransmission).toEqual({
			factor: 0.75,
			color: [0.5, 1, 0.25],
			thickness: 0.2,
			attenuationColor: [1, 0.5, 0.5],
			attenuationDistance: 0.1,
		});
		const map = first?.maps.diffuseTransmissionMap ?? -1;
		const colorMap = first?.maps.diffuseTransmissionColorMap ?? -1;
		expect(data.textures[map]?.colorSpace).toBe('linear');
		expect(data.textures[colorMap]?.colorSpace).toBe('srgb');
		// The diffuse transmission maps take the specular maps' slots, so those maps stay out.
		expect(second?.diffuseTransmission?.factor).toBe(1);
		expect(second?.maps.specularIntensityMap).toBeUndefined();
		// Transmission wins where a material has both.
		expect(third?.transmission?.factor).toBe(1);
		expect(third?.diffuseTransmission).toBeUndefined();
		expect(data.notes).toEqual(
			expect.arrayContaining([
				"material 1's specularIntensityMap, which a material with diffuse transmission does not take",
				"material 2's diffuse transmission, which its transmission replaces in the engine",
			]),
		);
		// A material without the extension lets no light through to its other side.
		expect(data.materials[3]?.diffuseTransmission).toBeUndefined();
	});

	test('KHR_materials_transmission and KHR_materials_volume give the transmission and thickness maps', () => {
		const b = specularBuilder()
			.uses('KHR_materials_transmission')
			.uses('KHR_materials_volume')
			.uses('KHR_materials_specular');
		const [glass, shiny, dull] = b.json.materials as [GltfJson, GltfJson, GltfJson];
		glass.extensions = {
			KHR_materials_transmission: { transmissionFactor: 1, transmissionTexture: { index: 0 } },
			KHR_materials_volume: { thicknessFactor: 0.4, thicknessTexture: { index: 1 } },
		};
		shiny.extensions = {
			KHR_materials_specular: { specularTexture: { index: 2 } },
			KHR_materials_transmission: { transmissionFactor: 0.5, transmissionTexture: { index: 0 } },
		};
		// A material that lets no light through takes neither map.
		dull.extensions = {
			KHR_materials_transmission: { transmissionFactor: 0, transmissionTexture: { index: 0 } },
			KHR_materials_volume: { thicknessTexture: { index: 1 } },
		};
		const data = parse(b.glb());
		const [first, second, third] = data.materials;
		expect(first?.transmission).toMatchObject({ factor: 1, thickness: 0.4 });
		const transmission = first?.maps.transmissionMap ?? -1;
		const thickness = first?.maps.thicknessMap ?? -1;
		expect(transmission).toBeGreaterThanOrEqual(0);
		expect(thickness).toBeGreaterThanOrEqual(0);
		expect(data.textures[transmission]?.colorSpace).toBe('linear');
		expect(data.textures[thickness]?.colorSpace).toBe('linear');
		// The specular textures keep their slots, which the transmission textures would take.
		expect(second?.maps.specularIntensityMap).toBeDefined();
		expect(second?.maps.transmissionMap).toBeUndefined();
		expect(second?.maps.thicknessMap).toBeUndefined();
		expect(third?.transmission).toBeUndefined();
		expect(third?.maps.transmissionMap).toBeUndefined();
		expect(third?.maps.thicknessMap).toBeUndefined();
		expect(data.notes).toEqual(
			expect.arrayContaining([
				"material 1's transmissionTexture, which it leaves out beside a specular texture",
			]),
		);
	});

	test('KHR_materials_dispersion gives the volume its dispersion', () => {
		const b = specularBuilder().uses('KHR_materials_transmission').uses('KHR_materials_dispersion');
		const [glass, plain] = b.json.materials as [GltfJson, GltfJson];
		glass.extensions = {
			KHR_materials_transmission: { transmissionFactor: 1 },
			KHR_materials_dispersion: { dispersion: 0.36 },
		};
		plain.extensions = { KHR_materials_transmission: { transmissionFactor: 1 } };
		const data = parse(b.glb());
		expect(data.materials[0]?.dispersion).toBe(0.36);
		// A material without the extension bends every color alike.
		expect(data.materials[1]?.dispersion).toBe(0);
		const negative = specularBuilder().uses('KHR_materials_dispersion');
		(negative.json.materials[0] as GltfJson).extensions = {
			KHR_materials_dispersion: { dispersion: -1 },
		};
		const [code, text] = refusal(negative.glb());
		expect([code, text.includes("material 0's dispersion is -1")]).toEqual(['E1416', true]);
	});

	test('a layered material keeps the transmission and thickness textures that fit', () => {
		const b = specularBuilder()
			.uses('KHR_materials_transmission')
			.uses('KHR_materials_volume')
			.uses('KHR_materials_clearcoat');
		const [coated, normal, bare] = b.json.materials as [GltfJson, GltfJson, GltfJson];
		// The stained-glass lamp's glass: one texture holds the clear coat and the transmission.
		coated.extensions = {
			KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: { index: 0 } },
			KHR_materials_transmission: { transmissionFactor: 1, transmissionTexture: { index: 0 } },
			KHR_materials_volume: { thicknessFactor: 0.4, thicknessTexture: { index: 1 } },
		};
		// A coat normal texture fills the specular intensity slot, so the transmission texture stays
		// out; the thickness texture fits beside it, since nothing fills the other slot.
		normal.extensions = {
			KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatNormalTexture: { index: 0 } },
			KHR_materials_transmission: { transmissionFactor: 1, transmissionTexture: { index: 0 } },
			KHR_materials_volume: { thicknessFactor: 0.4, thicknessTexture: { index: 1 } },
		};
		// A clear coat's value alone leaves both slots free.
		bare.extensions = {
			KHR_materials_clearcoat: { clearcoatFactor: 1 },
			KHR_materials_transmission: { transmissionFactor: 1, transmissionTexture: { index: 0 } },
			KHR_materials_volume: { thicknessFactor: 0.4, thicknessTexture: { index: 1 } },
		};
		const data = parse(b.glb());
		const [first, second, third] = data.materials;
		expect(first?.maps.transmissionMap).toBeDefined();
		expect(first?.maps.thicknessMap).toBeDefined();
		expect(first?.maps.clearcoatMap).toBeDefined();
		expect(second?.maps.clearcoatNormalMap).toBeDefined();
		expect(second?.maps.transmissionMap).toBeUndefined();
		expect(second?.maps.thicknessMap).toBeDefined();
		expect(data.notes).toContain(
			"material 1's transmissionTexture, which it leaves out where the clear coat's normal texture fills the same slot",
		);
		expect(third?.maps.transmissionMap).toBeDefined();
		expect(third?.maps.thicknessMap).toBeDefined();
		expect(third?.maps.clearcoatMap).toBeUndefined();
	});

	test('a clear coat or a sheen wins over KHR_materials_diffuse_transmission', () => {
		const b = specularBuilder()
			.uses('KHR_materials_diffuse_transmission')
			.uses('KHR_materials_sheen');
		const [velvet] = b.json.materials as [GltfJson];
		velvet.extensions = {
			KHR_materials_diffuse_transmission: {
				diffuseTransmissionFactor: 0.5,
				diffuseTransmissionTexture: { index: 0 },
			},
			KHR_materials_sheen: { sheenColorFactor: [1, 0.5, 0.5] },
		};
		const data = parse(b.glb());
		const [first] = data.materials;
		expect(first?.layers?.sheenColor).toEqual([1, 0.5, 0.5]);
		expect(first?.diffuseTransmission).toBeUndefined();
		expect(first?.maps.diffuseTransmissionMap).toBeUndefined();
		expect(data.notes).toContain(
			"material 0's diffuse transmission, which the engine does not draw beside a clear coat, a sheen, iridescence or anisotropy",
		);
	});

	test('KHR_materials_volume_scatter gives each channel the attenuation distance times its color', () => {
		const b = specularBuilder().uses('KHR_materials_volume_scatter').uses('KHR_materials_volume');
		const [skin, endless, black] = b.json.materials as [GltfJson, GltfJson, GltfJson];
		skin.extensions = {
			KHR_materials_volume_scatter: { multiscatterColor: [0.8, 0.4, 0.2], scatterAnisotropy: 0.3 },
			KHR_materials_volume: { attenuationDistance: 0.02 },
		};
		endless.extensions = { KHR_materials_volume_scatter: { multiscatterColor: [1, 1, 1] } };
		black.extensions = {
			KHR_materials_volume_scatter: {},
			KHR_materials_volume: { attenuationDistance: 0.02 },
		};
		const data = parse(b.glb());
		const [first, second, third] = data.materials;
		expect(first?.scatter?.radius).toBeCloseTo(0.016, 6);
		expect(first?.scatter?.color).toEqual([1, 0.5, 0.25]);
		// A volume that absorbs nothing, or a black multiscatter color, spreads no light.
		expect(second?.scatter).toBeUndefined();
		expect(third?.scatter).toBeUndefined();
		expect(data.materials[3]?.scatter).toBeUndefined();
		expect(data.notes).toEqual(
			expect.arrayContaining([
				"material 0's scatterAnisotropy, which the engine does not draw",
				"material 1's volume scatter without an attenuation distance, which spreads no light",
			]),
		);
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

	/** The ship with three images and a texture of each, and the given layer extensions. */
	const layered = (extensions: GltfJson, more: GltfJson = {}) => {
		const b = shipBuilder()
			.uses('KHR_materials_clearcoat')
			.uses('KHR_materials_sheen')
			.uses('KHR_materials_specular');
		b.json.images = [0, 1, 2].map((k) => ({
			bufferView: b.view(new Uint8Array([0x89, 0x50, 0x4e, 0x47, k])),
			mimeType: 'image/png',
		}));
		b.json.textures = [{ source: 0 }, { source: 1 }, { source: 2 }];
		b.json.materials[0].extensions = extensions;
		Object.assign(b.json.materials[0], more);
		return parse(b.glb());
	};

	test('KHR_materials_clearcoat and KHR_materials_sheen give the layers, each pair one texture', () => {
		const data = layered({
			KHR_materials_clearcoat: {
				clearcoatFactor: 0.8,
				clearcoatRoughnessFactor: 0.2,
				clearcoatTexture: { index: 0 },
				clearcoatRoughnessTexture: { index: 0 },
				clearcoatNormalTexture: { index: 1, scale: 0.5 },
			},
			KHR_materials_sheen: {
				sheenColorFactor: [1, 0.5, 0],
				sheenRoughnessFactor: 0.3,
				sheenColorTexture: { index: 2 },
				sheenRoughnessTexture: { index: 2 },
			},
		});
		const [material] = data.materials;
		expect(material?.layers).toEqual({
			clearcoat: 0.8,
			clearcoatRoughness: 0.2,
			clearcoatNormalScale: 0.5,
			sheenColor: [1, 0.5, 0],
			sheenRoughness: 0.3,
		});
		const maps = material?.maps ?? {};
		expect(maps.clearcoatRoughnessMap).toBe(maps.clearcoatMap as number);
		expect(maps.sheenRoughnessMap).toBe(maps.sheenColorMap as number);
		expect(data.textures[maps.clearcoatMap ?? -1]).toMatchObject({
			image: 0,
			colorSpace: 'linear',
		});
		expect(data.textures[maps.clearcoatNormalMap ?? -1]).toMatchObject({
			image: 1,
			colorSpace: 'linear',
		});
		// An sRGB texture keeps its alpha linear, so the sheen's roughness reads the color's texture.
		expect(data.textures[maps.sheenColorMap ?? -1]).toMatchObject({ image: 2, colorSpace: 'srgb' });
		expect(data.notes).toEqual([]);
	});

	test('a material without the layer extensions has no layers, and either one gives them', () => {
		expect(parse(shipBuilder().glb()).materials[0]?.layers).toBeUndefined();
		const [sheen] = layered({ KHR_materials_sheen: {} }).materials;
		expect(sheen?.layers).toEqual({
			clearcoat: 0,
			clearcoatRoughness: 0,
			clearcoatNormalScale: 1,
			sheenColor: [0, 0, 0],
			sheenRoughness: 0,
		});
	});

	test('a layered material keeps one texture of each pair, goes without specular maps, and notes both', () => {
		const data = layered({
			KHR_materials_clearcoat: {
				clearcoatFactor: 1,
				clearcoatTexture: { index: 0 },
				clearcoatRoughnessTexture: { index: 1 },
			},
			KHR_materials_sheen: { sheenRoughnessTexture: { index: 2 } },
			KHR_materials_specular: { specularColorTexture: { index: 2 } },
		});
		const maps = data.materials[0]?.maps ?? {};
		expect(data.textures[maps.clearcoatMap ?? -1]?.image).toBe(0);
		expect(maps.clearcoatRoughnessMap).toBeUndefined();
		expect(data.textures[maps.sheenRoughnessMap ?? -1]?.image).toBe(2);
		expect(maps.specularColorMap).toBeUndefined();
		expect(data.notes).toEqual([
			"material 0's specular textures, which the engine does not draw beside a clear coat, a sheen, iridescence or anisotropy",
			"material 0's clearcoatRoughnessTexture, which is not the texture of its pair and is not drawn",
		]);
	});

	test('clearcoat and sheen values outside their ranges give E1416', () => {
		const withExtensions = (extensions: GltfJson) => {
			const b = shipBuilder().uses('KHR_materials_clearcoat').uses('KHR_materials_sheen');
			b.json.materials[0].extensions = extensions;
			return b.glb();
		};
		const cases: [GltfJson, string][] = [
			[{ KHR_materials_clearcoat: { clearcoatFactor: 2 } }, "material 0's clearcoatFactor is 2"],
			[
				{ KHR_materials_clearcoat: { clearcoatRoughnessFactor: -1 } },
				"material 0's clearcoatRoughnessFactor is -1",
			],
			[
				{ KHR_materials_sheen: { sheenColorFactor: [1, 2, 0] } },
				"material 0's sheenColorFactor has a component outside 0 to 1",
			],
			[
				{ KHR_materials_sheen: { sheenRoughnessFactor: 1.5 } },
				"material 0's sheenRoughnessFactor is 1.5",
			],
			[
				{ KHR_materials_clearcoat: { clearcoatTexture: { index: 9 } } },
				"material 0's clearcoatTexture",
			],
		];
		for (const [extensions, message] of cases) {
			const [code, text] = refusal(withExtensions(extensions));
			expect([code, text.includes(message)]).toEqual(['E1416', true]);
		}
	});

	test('KHR_materials_iridescence and KHR_materials_anisotropy give their values and maps', () => {
		const data = layered({
			KHR_materials_iridescence: {
				iridescenceFactor: 0.75,
				iridescenceIor: 1.8,
				iridescenceThicknessMinimum: 200,
				iridescenceThicknessMaximum: 600,
				iridescenceTexture: { index: 0 },
				iridescenceThicknessTexture: { index: 1 },
			},
			KHR_materials_anisotropy: {
				anisotropyStrength: 0.6,
				anisotropyRotation: 0.5,
				anisotropyTexture: { index: 2 },
			},
		});
		const material = data.materials[0];
		expect(material?.layers).toMatchObject({
			iridescence: 0.75,
			iridescenceIor: 1.8,
			iridescenceThicknessRange: [200, 600],
			anisotropy: 0.6,
			anisotropyRotation: 0.5,
		});
		const maps = material?.maps ?? {};
		expect(data.textures[maps.iridescenceMap ?? -1]).toMatchObject({
			image: 0,
			colorSpace: 'linear',
		});
		expect(data.textures[maps.iridescenceThicknessMap ?? -1]).toMatchObject({
			image: 1,
			colorSpace: 'linear',
		});
		expect(data.textures[maps.anisotropyMap ?? -1]).toMatchObject({
			image: 2,
			colorSpace: 'linear',
		});
		expect(data.notes).toEqual([]);
	});

	test('a material keeps its anisotropy with no texture of any kind', () => {
		const data = layered({
			KHR_materials_anisotropy: { anisotropyStrength: 0.75, anisotropyRotation: 0.4 },
		});
		expect(data.materials[0]?.layers).toMatchObject({
			anisotropy: 0.75,
			anisotropyRotation: 0.4,
		});
		expect(data.materials[0]?.maps).toEqual({});
		expect(data.notes).toEqual([]);
	});

	test('a clear coat or a sheen map keeps its slots ahead of iridescence and anisotropy, and notes them', () => {
		const data = layered({
			KHR_materials_clearcoat: { clearcoatTexture: { index: 0 } },
			KHR_materials_iridescence: {
				iridescenceTexture: { index: 1 },
				iridescenceThicknessTexture: { index: 2 },
			},
			KHR_materials_anisotropy: { anisotropyTexture: { index: 2 } },
		});
		const maps = data.materials[0]?.maps ?? {};
		expect(data.textures[maps.clearcoatMap ?? -1]?.image).toBe(0);
		expect(maps.iridescenceMap).toBeUndefined();
		expect(maps.anisotropyMap).toBeUndefined();
		expect(data.notes).toEqual([
			"material 0's iridescence or anisotropy textures, which the engine does not draw beside a clear coat's or a sheen's",
		]);
	});

	test('iridescence and anisotropy values outside their ranges give E1416', () => {
		const withExtensions = (extensions: GltfJson) => {
			const b = shipBuilder().uses('KHR_materials_iridescence').uses('KHR_materials_anisotropy');
			b.json.materials[0].extensions = extensions;
			return b.glb();
		};
		const cases: [GltfJson, string][] = [
			[
				{ KHR_materials_iridescence: { iridescenceFactor: 2 } },
				"material 0's iridescenceFactor is 2",
			],
			[
				{ KHR_materials_iridescence: { iridescenceIor: 0.5 } },
				"material 0's iridescenceIor is 0.5",
			],
			[
				{
					KHR_materials_iridescence: {
						iridescenceThicknessMinimum: 600,
						iridescenceThicknessMaximum: 400,
					},
				},
				"material 0's iridescenceThicknessMinimum is 600 and its maximum 400",
			],
			[
				{ KHR_materials_anisotropy: { anisotropyStrength: 2 } },
				"material 0's anisotropyStrength is 2",
			],
			[
				{ KHR_materials_anisotropy: { anisotropyTexture: { index: 9 } } },
				"material 0's anisotropyTexture",
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

	test('EXT_texture_webp and EXT_texture_avif name the image of a texture, after KTX2', () => {
		const b = shipBuilder()
			.uses('EXT_texture_webp', true)
			.uses('EXT_texture_avif', true)
			.uses('KHR_texture_basisu');
		b.json.images = ['image/png', 'image/webp', 'image/avif', 'image/ktx2'].map((mimeType, k) => ({
			bufferView: b.view(new Uint8Array([k])),
			mimeType,
		}));
		const webp = { EXT_texture_webp: { source: 1 } };
		const avif = { EXT_texture_avif: { source: 2 } };
		const basisu = { KHR_texture_basisu: { source: 3 } };
		b.json.textures = [
			{ source: 0, extensions: webp },
			{ source: 0, extensions: avif },
			{ extensions: { ...avif, ...webp } },
			{ source: 0, extensions: { ...avif, ...basisu } },
			{ source: 0 },
		];
		const slots = ['baseColorTexture', 'metallicRoughnessTexture'] as const;
		b.json.materials = b.json.textures.map((_: unknown, k: number) => ({
			pbrMetallicRoughness: { [slots[k % 2] as string]: { index: k } },
		}));
		const data = parse(b.glb());
		// Each material's map names its image: WebP, AVIF, WebP before AVIF, KTX2 before both, and
		// the texture's own source without an extension.
		const images = data.materials.map(({ maps }, k) => {
			const use = data.textures[(k % 2 ? maps.metalnessRoughnessMap : maps.map) ?? -1];
			return use && data.images[use.image]?.mimeType;
		});
		expect(images).toEqual(['image/webp', 'image/avif', 'image/webp', 'image/ktx2', 'image/png']);
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

	test('KHR_animation_pointer moves nodes, materials and lights, and notes what it cannot', () => {
		const b = new GltfBuilder();
		b.json.extensionsUsed = ['KHR_animation_pointer', 'KHR_lights_punctual'];
		b.json.extensions = {
			KHR_lights_punctual: {
				lights: [{ type: 'spot', color: [0.5, 0.5, 0.5], intensity: 3, range: 5 }],
			},
		};
		const material = b.material({
			name: 'glow',
			pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 0.8], metallicFactor: 0 },
		});
		const mesh = b.mesh([boxPrimitive(b, material)], 'box');
		const box = b.node({ name: 'Box', mesh });
		const lamp = b.node({ name: 'Lamp', translation: [0, 2, 0] });
		b.json.nodes[lamp].extensions = { KHR_lights_punctual: { light: 0 } };
		b.json.scenes[0].nodes = [box, lamp];
		const at = (seconds: number[]) =>
			b.accessor(new Float32Array(seconds), 1, { min: [0], max: [seconds.at(-1) ?? 0] });
		const pointer = (path: string) => ({
			path: 'pointer',
			extensions: { KHR_animation_pointer: { pointer: path } },
		});
		b.json.animations = [
			{
				name: 'Move',
				samplers: [
					{ input: at([0, 1]), output: b.accessor(new Float32Array([0, 0, 0, 1, 1, 1]), 3) },
					{
						input: at([0, 1]),
						output: b.accessor(new Float32Array([1, 1, 1, 1, 0, 0, 0, 0.5]), 4),
					},
					{ input: at([0, 1]), output: b.accessor(new Float32Array([1, 4]), 1) },
					{
						input: at([0, 1]),
						output: b.accessor(new Float32Array([1, 0]), 1),
						interpolation: 'STEP',
					},
					{ input: at([0, 1]), output: b.accessor(new Float32Array([0, 0, 0.5, 0.5]), 2) },
					{ input: at([0, 1]), output: b.accessor(new Float32Array([0.5, 1]), 1) },
				],
				channels: [
					{ sampler: 0, target: pointer('/nodes/0/translation') },
					{ sampler: 1, target: pointer('/materials/0/pbrMetallicRoughness/baseColorFactor') },
					{ sampler: 2, target: pointer('/extensions/KHR_lights_punctual/lights/0/intensity') },
					{ sampler: 3, target: pointer('/nodes/1/extensions/KHR_node_visibility/visible') },
					{
						sampler: 4,
						target: pointer(
							'/materials/0/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/offset',
						),
					},
					{ sampler: 5, target: pointer('/cameras/0/perspective/yfov') },
				],
			},
		];
		const data = parse(b.glb());
		const clip = data.animation?.clips[0];
		// A pointer to a node's transform becomes that node's track, as a channel of its own does.
		expect(clip?.tracks.map((t) => [t.channel, t.interpolation])).toEqual([
			['translation', 'linear'],
		]);
		expect(
			clip?.properties?.map((p) => [p.target.kind, p.target.index, p.target.value, p.components]),
		).toEqual([
			['material', 0, 'color', 3],
			['material', 0, 'opacity', 1],
			['light', 0, 'intensity', 1],
			['node', 1, 'visible', 1],
			['material', 0, 'uvOffset', 2],
		]);
		// A base color factor's fourth number becomes the opacity, key by key.
		const [color, opacity] = clip?.properties ?? [];
		expect(Array.from(color?.values ?? [])).toEqual([1, 1, 1, 0, 0, 0]);
		expect(Array.from(opacity?.values ?? [])).toEqual([1, 0.5]);
		expect(data.notes).toEqual([
			'animation 0 moves a camera property, and the engine reads no cameras from files',
		]);
	});

	test('KHR_animation_pointer moves the map transforms that three.js moves, and no others', () => {
		const b = new GltfBuilder().uses('KHR_animation_pointer').uses('KHR_texture_transform');
		b.json.images = [{ uri: 'tex/base.png' }];
		b.json.textures = [{ source: 0 }];
		b.json.materials = [
			{
				name: 'uv',
				pbrMetallicRoughness: {
					baseColorTexture: {
						index: 0,
						extensions: { KHR_texture_transform: { offset: [0.25, 0.5] } },
					},
				},
				emissiveTexture: { index: 0 },
			},
		];
		const mesh = b.mesh([boxPrimitive(b, 0)], 'box');
		b.node({ name: 'Box', mesh });
		const at = (seconds: number[]) =>
			b.accessor(new Float32Array(seconds), 1, { min: [0], max: [seconds.at(-1) ?? 0] });
		const pointer = (path: string) => ({
			path: 'pointer',
			extensions: { KHR_animation_pointer: { pointer: path } },
		});
		const pairs = (values: number[]) => b.accessor(new Float32Array(values), 2);
		const transform = (texture: string, part: string) =>
			pointer(`/materials/0/${texture}/extensions/KHR_texture_transform/${part}`);
		b.json.animations = [
			{
				name: 'Move',
				samplers: [
					{ input: at([0, 1]), output: pairs([0, 0, 1, 1]) },
					{ input: at([0, 1]), output: pairs([1, 1, 2, 2]) },
					{ input: at([0, 1]), output: pairs([0, 0, 0.5, 0.5]) },
					{ input: at([0, 1]), output: pairs([1, 1, 3, 3]) },
					{ input: at([0, 1]), output: pairs([0, 0, 1, 1]) },
				],
				channels: [
					{ sampler: 0, target: transform('pbrMetallicRoughness/baseColorTexture', 'offset') },
					{ sampler: 1, target: transform('pbrMetallicRoughness/baseColorTexture', 'scale') },
					{ sampler: 2, target: transform('emissiveTexture', 'offset') },
					{ sampler: 3, target: transform('emissiveTexture', 'scale') },
					{ sampler: 4, target: transform('normalTexture', 'offset') },
				],
			},
		];
		const clip = parse(b.glb()).animation?.clips[0];
		expect(
			clip?.properties?.map((p) => [
				p.target.kind,
				p.target.index,
				p.target.value,
				p.target.kind === 'material' ? p.target.key : '',
				p.components,
			]),
		).toEqual([
			['material', 0, 'uvOffset', 'baseColorOffset', 2],
			['material', 0, 'uvScale', 'baseColorScale', 2],
			['material', 0, 'uvOffset', 'emissiveOffset', 2],
			['material', 0, 'uvScale', 'emissiveScale', 2],
		]);
		expect(Array.from(clip?.properties?.[2]?.values ?? [])).toEqual([0, 0, 0.5, 0.5]);
		expect(parse(b.glb()).notes).toEqual([
			"animation 0 moves a material's normalTexture/extensions/KHR_texture_transform/offset, which the engine does not animate",
		]);
	});

	test('a texture transform whose keys are not pairs fails with the numbers it has', () => {
		const b = new GltfBuilder().uses('KHR_animation_pointer').uses('KHR_texture_transform');
		b.json.images = [{ uri: 'tex/base.png' }];
		b.json.textures = [{ source: 0 }];
		b.json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
		const mesh = b.mesh([boxPrimitive(b, 0)], 'box');
		b.node({ name: 'Box', mesh });
		const at = b.accessor(new Float32Array([0, 1]), 1, { min: [0], max: [1] });
		b.json.animations = [
			{
				name: 'Move',
				samplers: [{ input: at, output: b.accessor(new Float32Array([0, 1]), 1) }],
				channels: [
					{
						sampler: 0,
						target: {
							path: 'pointer',
							extensions: {
								KHR_animation_pointer: {
									pointer:
										'/materials/0/pbrMetallicRoughness/baseColorTexture/extensions/KHR_texture_transform/offset',
								},
							},
						},
					},
				],
			},
		];
		const [code, message] = refusal(b.glb());
		expect(code).toBe('E1416');
		expect(message).toContain('holds 1 numbers per key, and a texture transform takes two');
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

	/** The box and the place at rest of a node's copy that joints move, rounded. */
	const restOf = (b: GltfBuilder, name = 'Sleeve') => {
		const data = parse(b.glb());
		const node = data.nodes.find((n) => n.name === name);
		const p = data.meshes[node?.mesh ?? -1]?.primitives[0];
		return {
			box: [p?.min.map(rounded), p?.max.map(rounded)],
			matrix: p?.rest?.matrix.map((v) => rounded(v) + 0),
			exact: p?.rest?.exact,
		};
	};
	const IDENTITY_ROWS = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

	test("a skinned copy's box holds its vertices where its joints place them at rest", () => {
		expect(restOf(armBuilder())).toEqual({
			box: [
				[-0.2, 1, -0.2],
				[0.2, 3, 0.2],
			],
			matrix: IDENTITY_ROWS,
			exact: true,
		});
		// The joints carry the sleeve 2 m further along z, and the skinned node's own place counts
		// for nothing, as glTF says.
		const b = armBuilder();
		b.json.nodes.find((n: GltfJson) => n.name === 'Arm').translation = [0, 0, 3];
		b.json.nodes.find((n: GltfJson) => n.name === 'Sleeve').translation = [5, 5, 5];
		expect(restOf(b)).toEqual({
			box: [
				[-0.2, 1, 1.8],
				[0.2, 3, 2.2],
			],
			matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 2],
			exact: true,
		});
	});

	test('positions stored as integers, with their scale in the inverse bind matrices, give the same box', () => {
		// The asset tool's quantization: 14-bit steps of the mesh's volume, with the transform that
		// turns them back into meters folded into each inverse bind matrix.
		const b = armBuilder();
		const tall = boxArrays(0.4).positions.map((p, i) => (i % 3 === 1 ? p * 5 + 2 : p));
		const offset = [-0.2, 1, -0.2] as const;
		const step = 2 / 16383;
		const steps = Uint16Array.from(tall, (p, i) =>
			Math.round((p - (offset[i % 3] as number)) / step),
		);
		b.json.meshes[1].primitives[0].attributes.POSITION = b.positions(steps);
		const binds = [
			[0, 2, 1],
			[0, 1, 1],
			[0, 3, 1],
		].flatMap(([x = 0, y = 0, z = 0]) => [
			...[step, 0, 0, 0, 0, step, 0, 0, 0, 0, step, 0],
			...[offset[0] - x, offset[1] - y, offset[2] - z, 1],
		]);
		b.json.skins[0].inverseBindMatrices = b.accessor(new Float32Array(binds), 16, {
			type: 'MAT4',
			count: 3,
		});
		const { box, matrix, exact } = restOf(b);
		expect(box).toEqual([
			[-0.2, 1, -0.2],
			[0.2, 3, 0.2],
		]);
		// A batch draws the integers through the scale and offset that turn them back.
		expect(exact).toBe(true);
		expect(matrix).toEqual([0, 0, 0, -0.2, 0, 0, 0, 1, 0, 0, 0, -0.2]);
	});

	test('a skinned copy whose rest pose is not its bind pose has no exact place', () => {
		// Elbow turns a quarter about z at rest, and the skin binds it straight. Shoulder carries
		// most of the sleeve's weight, and rests where it binds.
		const b = armBuilder();
		b.json.nodes.find((n: GltfJson) => n.name === 'Elbow').rotation = [
			0,
			0,
			Math.SQRT1_2,
			Math.SQRT1_2,
		];
		const { box, matrix, exact } = restOf(b);
		expect(exact).toBe(false);
		expect(matrix).toEqual(IDENTITY_ROWS);
		// The upper half swings toward -x.
		expect(box[0]?.[0]).toBeLessThan(-0.2);
	});

	test('a copy that one joint moves rests where the joint does', () => {
		expect(restOf(armBuilder(), 'Sword')).toEqual({
			box: [
				[-0.05, 3, 0.95],
				[0.05, 4, 1.05],
			],
			matrix: [0.1, 0, 0, 0, 0, 1, 0, 3.5, 0, 0, 0.1, 1],
			exact: true,
		});
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

	test('COLOR_0 targets read as deltas of as many numbers per vertex as the colors hold', () => {
		const data = parse(colorMorphBuilder().glb());
		expect(data.notes).toEqual([]);
		const [left, middle, right] = data.meshes[0]?.primitives ?? [];
		const plain = (deltas: Float32Array | undefined) => Array.from(deltas ?? []).map(rounded);
		// The left panel's colors have alpha and its targets do not, so their alpha deltas are 0.
		// Its second target is sparse and moves only the right half.
		expect(left?.morph?.colors).toHaveLength(2);
		const warm = left?.morph?.colors?.[0] ?? new Float32Array();
		expect(warm).toHaveLength(49 * 4);
		expect(plain(warm.subarray(48 * 4, 49 * 4))).toEqual([0.8, -0.5, 0, 0]);
		const blue = left?.morph?.colors?.[1] ?? new Float32Array();
		expect(plain(blue.subarray(0, 4))).toEqual([0, 0, 0, 0]);
		expect(plain(blue.subarray(6 * 4, 7 * 4))).toEqual([-0.2, 0, 0.8, 0]);
		// The middle panel's deltas of normalized 16-bit integers read as fractions, alpha too.
		const fade = middle?.morph?.colors?.[0] ?? new Float32Array();
		expect(plain(fade.subarray(48 * 4, 49 * 4))).toEqual([-0.8, 0.6, 0, -0.5]);
		// The right panel's targets move only positions.
		expect(right?.morph?.colors).toBeUndefined();
		expect(right?.morph?.positions).toHaveLength(2);
	});

	test('a COLOR_0 target of colors without alpha keeps no alpha delta', () => {
		const b = colorMorphBuilder();
		const right = b.json.meshes[0].primitives[2];
		right.attributes.COLOR_0 = b.accessor(new Float32Array(49 * 3).fill(0.5), 3);
		right.targets[1].COLOR_0 = b.accessor(
			new Float32Array(49 * 4).map((_, k) => k % 4),
			4,
		);
		const colors = parse(b.glb()).meshes[0]?.primitives[2]?.morph?.colors;
		expect(Array.from(colors?.[0] ?? [])).toEqual(new Array(49 * 3).fill(0));
		expect(Array.from(colors?.[1]?.subarray(0, 6) ?? [])).toEqual([0, 1, 2, 0, 1, 2]);
	});

	test('a target that leaves out an attribute that another target moves moves it by nothing', () => {
		const b = morphBuilder();
		const [up] = b.json.meshes[0].primitives[0].targets;
		b.json.meshes[0].primitives[0].targets = [{}, up];
		const morph = parse(b.glb()).meshes[0]?.primitives[0]?.morph;
		expect(morph?.positions?.[0]?.every((d) => d === 0)).toBe(true);
		expect(morph?.positions?.[1]?.some((d) => d !== 0)).toBe(true);
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
		expect(parse(e.glb()).notes.join()).toContain(
			"move COLOR_0, which the engine does not morph (COLOR_0 needs the primitive's own COLOR_0)",
		);
		const f = colorMorphBuilder();
		const quantized = f.accessor(new Uint8Array(49 * 3), 3);
		f.json.meshes[0].primitives[0].targets[0].COLOR_0 = quantized;
		expect(refusal(f.glb())[1]).toContain('COLOR_0 deltas are integers that are not normalized');
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

describe('trees of cluster patches', () => {
	/** A box whose primitive carries the patch tree that `extensions` makes. */
	const boxWith = (extensions: (b: GltfBuilder) => GltfJson) => {
		const b = new GltfBuilder();
		b.node({ mesh: b.mesh([{ ...boxPrimitive(b), extensions: extensions(b) }]) });
		return b;
	};
	/** A tree of two patches over the box's vertices: a root and the leaf below it. */
	const TREE = (b: GltfBuilder) => ({
		NULL3D_clusters: {
			indices: b.accessor(new Uint32Array([0, 1, 2, 3, 4, 5]), 1),
			bounds: b.accessor(new Float32Array([0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5]), 4),
			patches: b.accessor(new Uint32Array([0, 3, 0, 0x3dcc_cccd, 3, 3, 1, 0]), 4),
			root: 0,
		},
	});

	test('a primitive keeps the tree of patches that the tool built', () => {
		const [p] = parse(boxWith(TREE).glb()).meshes[0]?.primitives ?? [];
		expect(p?.patches?.root).toBe(0);
		expect(Array.from(p?.patches?.indices ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
		expect(Array.from(p?.patches?.words ?? [])).toEqual([0, 3, 0, 0x3dcc_cccd, 3, 3, 1, 0]);
		expect(Array.from(p?.patches?.bounds ?? [])).toEqual([0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5]);
	});

	test('a plain primitive has no tree', () => {
		expect(parse(shipBuilder().glb()).meshes[0]?.primitives[0]?.patches).toBeUndefined();
	});

	test('a tree that breaks the rules gives E1416', () => {
		const broken = (change: (tree: GltfJson, b: GltfBuilder) => void) =>
			boxWith((b) => {
				const extensions = TREE(b);
				change(/** @type {GltfJson} */ (extensions.NULL3D_clusters), b);
				return extensions;
			});
		const message = (b: GltfBuilder) => refusal(b.glb())[1];
		expect(
			message(
				broken((tree) => {
					tree.patches = 0;
				}),
			),
		).toContain('patches are not four unsigned integers per patch');
		expect(
			message(
				broken((tree, b) => {
					tree.bounds = b.accessor(new Float32Array(3), 3);
				}),
			),
		).toContain('patch bounds are not four floats per patch');
		expect(
			message(
				broken((tree) => {
					tree.root = 2;
				}),
			),
		).toContain('patch tree has no root among its patches');
		// Indices that name no whole triangles, and bounds that are not four floats a patch.
		expect(
			message(
				broken((tree, b) => {
					tree.bounds = b.accessor(new Float32Array(4), 2);
				}),
			),
		).toContain('patch bounds are not four floats per patch');
		const withWords = (words: number[]) => (tree: GltfJson, b: GltfBuilder) => {
			tree.patches = b.accessor(new Uint32Array(words), 4);
		};
		// A run that is not whole triangles.
		expect(message(broken(withWords([0, 4, 0, 0, 3, 3, 1, 0])))).toContain(
			'patch 0 names no whole triangles of its tree',
		);
		// A run past the tree's indices.
		expect(message(broken(withWords([4, 3, 0, 0, 3, 3, 1, 0])))).toContain(
			'patch 0 names no whole triangles of its tree',
		);
		// A patch that is its own parent.
		expect(message(broken(withWords([0, 3, 1, 0, 3, 3, 1, 0])))).toContain(
			'patch 0 names the patch 1 as its parent',
		);
		// An index past the box's vertices.
		expect(
			message(
				broken((tree, b) => {
					tree.indices = b.accessor(new Uint32Array([0, 1, 2, 3, 4, 99]), 1);
				}),
			),
		).toContain('past its 24 vertices');
	});
});

describe("the asset tool's shader list", () => {
	test('reads the recorded bits and files, and leaves out a name that is not text', () => {
		const builder = shipBuilder();
		builder.json.asset.extras = {
			NULL3D_shaders: {
				permutations: ['ALPHA_MASK', 7],
				features: ['cutout', 'skinning'],
			},
			other: true,
		};
		expect(parse(builder.glb()).shaders).toEqual({
			permutations: ['ALPHA_MASK'],
			features: ['cutout', 'skinning'],
		});
	});

	test('gives no list for a file without one, or one that holds nothing', () => {
		expect(parse(shipBuilder().glb()).shaders).toBeUndefined();
		const empty = shipBuilder();
		empty.json.asset.extras = { NULL3D_shaders: { permutations: [], features: [] } };
		expect(parse(empty.glb()).shaders).toBeUndefined();
		const wrong = shipBuilder();
		wrong.json.asset.extras = { NULL3D_shaders: 'skinning' };
		expect(parse(wrong.glb()).shaders).toBeUndefined();
	});
});

describe("the asset tool's staged levels", () => {
	test('reads each stage with the error of the level that the file holds', () => {
		const builder = shipBuilder();
		builder.json.nodes[0].extras = {
			NULL3D_stages: {
				error: 0.2,
				levels: [
					{ url: 'ship.m0.lod2.bin', bytes: 120, error: 0.1 },
					{ url: 'ship.m0.lod3.bin', bytes: 60, error: 0.04 },
				],
			},
		};
		const hull = parse(builder.glb()).nodes.find((node) => node.name === 'Hull');
		expect(hull?.stages).toEqual({
			error: 0.2,
			levels: [
				{ url: 'ship.m0.lod2.bin', bytes: 120, error: 0.1 },
				{ url: 'ship.m0.lod3.bin', bytes: 60, error: 0.04 },
			],
		});
	});

	test('stops at a stage that holds no address, no length or no error', () => {
		const builder = shipBuilder();
		builder.json.nodes[0].extras = {
			NULL3D_stages: {
				error: 0.2,
				levels: [
					{ url: 'a.bin', bytes: 120, error: 0.1 },
					{ url: '', bytes: 60, error: 0.04 },
					{ url: 'c.bin', bytes: 30, error: 0.01 },
				],
			},
		};
		const hull = parse(builder.glb()).nodes.find((node) => node.name === 'Hull');
		expect(hull?.stages?.levels).toEqual([{ url: 'a.bin', bytes: 120, error: 0.1 }]);
	});

	test('gives no stages for a file without them, or one whose own level has no error', () => {
		const plain = parse(shipBuilder().glb()).nodes.find((node) => node.name === 'Hull');
		expect(plain?.stages).toBeUndefined();
		const wrong = shipBuilder();
		wrong.json.nodes[0].extras = { NULL3D_stages: { levels: [{ url: 'a', bytes: 1, error: 1 }] } };
		const hull = parse(wrong.glb()).nodes.find((node) => node.name === 'Hull');
		expect(hull?.stages).toBeUndefined();
	});
});

describe('the Needle light maps', () => {
	/** Parses the reduced Needle sample beside the test pages, with its buffer beside it. */
	function parseSample(): GltfData {
		const folder = join(import.meta.dir, '../../../../tests/pages/assets/models/needle-lightmap');
		const file = new Uint8Array(readFileSync(join(folder, 'scene.gltf')));
		const buffer = new Uint8Array(readFileSync(join(folder, 'scene.bin')));
		return parseGltf(
			readContainer(file, 'https://example.com/needle/scene.gltf'),
			new Map([[0, buffer]]),
			'https://example.com/needle/scene.gltf',
		);
	}

	test("a real Needle file gives each node its light map and its coordinates' scale and offset", () => {
		const data = parseSample();
		// The extension registers one light map, and every mesh reads it in linear color at the
		// second texture coordinates, as Needle's viewer does before it decodes the RGBM texels.
		expect(data.lightMaps).toHaveLength(1);
		const use = data.textures[data.lightMaps[0] as number];
		expect(use).toMatchObject({ colorSpace: 'linear', uvSet: 1 });
		const pillars = data.nodes.filter((node) => node.lightMap);
		expect(pillars).toHaveLength(data.nodes.filter((node) => node.mesh >= 0).length);
		expect(data.nodes[1]?.lightMap).toEqual({
			index: 0,
			scale: [0.059030436, 0.059030436],
			offset: [0.913736939, 0.247483984],
		});
	});

	test('reads a light map entry and leaves out the other kinds and other pointers', () => {
		const uses: unknown[] = [];
		const maps = parseNeedleLightMaps(
			{
				extensions: {
					NEEDLE_lightmaps: {
						textures: [
							{ pointer: '/textures/3', type: 0, index: 0 },
							{ pointer: 'textures/4', type: 0, index: 1 },
							{ pointer: '/textures/5', type: 1, index: 0 },
							{ pointer: '/textures/6', type: 2, index: 0 },
							{ pointer: 'skybox.exr', type: 0, index: 2 },
							{ pointer: '/textures/7', type: 0, index: 3 },
						],
					},
				},
			} as never,
			(info, colorSpace) => {
				uses.push([info, colorSpace]);
				return { use: uses.length - 1 };
			},
		);
		expect(uses).toEqual([
			[{ index: 3, texCoord: 1 }, 'linear'],
			[{ index: 4, texCoord: 1 }, 'linear'],
			[{ index: 7, texCoord: 1 }, 'linear'],
		]);
		// The skybox, the reflection and the file pointer are left out, so the map at index 2 has
		// no texture.
		expect(maps).toEqual([0, 1, -1, 2]);
	});

	test('a MeshRenderer without a light map, or without scale and offset, gives none or the identity', () => {
		const node = (component: Record<string, unknown>) => ({
			builtin_components: [{ name: 'MeshRenderer', ...component }],
		});
		expect(needleLightMap({ NEEDLE_components: node({ lightmapIndex: -1 }) })).toBeUndefined();
		expect(needleLightMap({})).toBeUndefined();
		expect(needleLightMap({ NEEDLE_components: node({ lightmapIndex: 2 }) })).toEqual({
			index: 2,
			scale: [1, 1],
			offset: [0, 0],
		});
		expect(
			needleLightMap({
				NEEDLE_components: node({
					lightmapIndex: 1,
					lightmapScaleOffset: { x: 0.5, y: 0.25, z: 0.125, w: 0.75 },
				}),
			}),
		).toEqual({ index: 1, scale: [0.5, 0.25], offset: [0.125, 0.75] });
	});
});
