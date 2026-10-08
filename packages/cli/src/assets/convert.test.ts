import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { ASSET_SCENE } from '../../../../tests/lib/asset-scene.ts';
import { CONVERT_FILES, cubePly, pyramidStl } from '../../../../tests/lib/convert-files.ts';
import { shippedDecoder } from '../../../../tests/lib/meshopt-checks.ts';
import { type GltfData, parseGltf, readContainer } from '../../../engine/src/scene/gltf-parse.ts';
import { main } from '../cli.js';
import { convertModel, parseConvertArgs } from './convert.js';
import { phongRoughness, readUfbx, sampleLinear, UFBX_WASM } from './fbx.js';
import { srgbToLinear } from './images.js';
import { plyDocument, readPlyHeader } from './ply.js';
import { readStl, weldSolid } from './stl.js';

setDefaultTimeout(30_000);

const ROOT = join(import.meta.dir, '../../../..');
const at = (path: string) => join(ROOT, path);
const source = (name: string) => at(join(CONVERT_FILES.sources, name));

/**
 * Set to write the STL and PLY test files and the outputs again, after a change that the outputs
 * must take: NULL3D_WRITE_CONVERTED=1 bun test packages/cli/src/assets/convert.test.ts
 */
const WRITE = process.env.NULL3D_WRITE_CONVERTED !== undefined;

if (WRITE) {
	mkdirSync(at(CONVERT_FILES.converted), { recursive: true });
	writeFileSync(source('pyramid.stl'), pyramidStl());
	writeFileSync(source('cube.ply'), cubePly());
}

const scratch = mkdtempSync(join(tmpdir(), 'null3d-convert-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The SHA-256 of the reader that tools/build-ufbx.ts builds from ufbx v0.23.1. */
const UFBX_SHA256 = '892ee4824c1e168f03113e4deee27c7a149aa4e68a250366917b859f9ff11168';

const decode = await shippedDecoder();

/** A file's data as the engine's loader parses it. */
const parse = (glb: Uint8Array): GltfData =>
	parseGltf(
		readContainer(glb, 'https://example.com/model.glb'),
		new Map(),
		'https://example.com/model.glb',
		decode,
	);

/** The JSON of a binary glTF file. */
function glbJson(glb: Uint8Array) {
	const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

/** Writes a file into the scratch folder and returns its path. */
function scratchFile(name: string, bytes: Uint8Array | string) {
	const path = join(scratch, name);
	writeFileSync(path, bytes);
	return path;
}

/**
 * The bounds of a node's mesh in the scene's space, by the node's transform. A skinned mesh in
 * its bind pose has the same bounds.
 */
function worldBounds(node: Node): [number[], number[]] {
	const m = node.getWorldMatrix();
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const prim of node.getMesh()!.listPrimitives()) {
		const positions = prim.getAttribute('POSITION')!;
		for (let i = 0; i < positions.getCount(); i++) {
			const [x = 0, y = 0, z = 0] = positions.getElement(i, []);
			for (let r = 0; r < 3; r++) {
				const v = m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!;
				min[r] = Math.min(min[r]!, v);
				max[r] = Math.max(max[r]!, v);
			}
		}
	}
	return [min, max];
}

/** A glTF document of a converted file, as glTF-Transform reads it. */
const readGlb = (glb: Uint8Array) =>
	new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb);

const outputs = new Map<string, Awaited<ReturnType<typeof convertModel>>>(
	await Promise.all(
		CONVERT_FILES.models.map(
			async ([input, output]) => [output, await convertModel(source(input))] as const,
		),
	),
);
const output = (name: string) => outputs.get(name)!;

describe('assets convert', () => {
	it('reads its arguments', () => {
		expect(parseConvertArgs(['a.fbx', 'b.glb'])).toMatchObject({ compression: undefined });
		expect(parseConvertArgs(['a.obj', 'b.glb', '--compression', 'meshopt']).compression).toBe(
			'meshopt',
		);
		expect(() => parseConvertArgs(['a.fbx'])).toThrow('not 1 argument');
		expect(() => parseConvertArgs(['a.dae', 'b.glb'])).toThrow(
			'.gltf, .glb, .obj, .fbx, .stl or .ply',
		);
		expect(() => parseConvertArgs(['a.fbx', 'b.gltf'])).toThrow('must be a .glb file');
		expect(() => parseConvertArgs(['a.fbx', 'b.glb', '--compression', 'draco'])).toThrow(
			'none or meshopt',
		);
	});

	it('writes the bytes that the repository holds, the same on every run', async () => {
		for (const [input, name] of CONVERT_FILES.models) {
			const { glb } = output(name);
			const path = at(join(CONVERT_FILES.converted, name));
			if (WRITE) writeFileSync(path, glb);
			expect(Buffer.from(glb).equals(readFileSync(path))).toBe(true);
			const again = await convertModel(source(input));
			expect(Buffer.from(again.glb).equals(Buffer.from(glb))).toBe(true);
		}
	});

	it('writes files that the engine loads', () => {
		for (const [, name] of CONVERT_FILES.models) {
			const data = parse(output(name).glb);
			expect(data.meshes.length).toBeGreaterThan(0);
		}
	});

	it('uses the reader that the build tool makes', () => {
		const hash = createHash('sha256').update(readFileSync(UFBX_WASM)).digest('hex');
		expect(hash).toBe(UFBX_SHA256);
	});
});

describe('assets convert of FBX files', () => {
	it("keeps the column's skin, clip, morph target and materials", async () => {
		const { glb, notes } = output('column-fbx.glb');
		expect(notes).toEqual([]);
		const doc = await readGlb(glb);
		const root = doc.getRoot();
		const [skin] = root.listSkins();
		expect(skin?.listJoints().map((joint) => joint.getName())).toEqual(['Lower', 'Upper']);
		const mesh = root.listMeshes()[0]!;
		expect(mesh.getExtras()).toEqual({ targetNames: ['Bulge'] });
		expect(mesh.getWeights()).toEqual([0]);
		const [clip] = root.listAnimations();
		expect(clip?.getName()).toBe('Scene');
		const paths = clip!
			.listChannels()
			.map((channel) => `${channel.getTargetNode()?.getName()} ${channel.getTargetPath()}`);
		expect(paths).toContain('Upper rotation');
		expect(paths).toContain('Column weights');
		// The bend reaches 45 degrees about X at the clip's end, one second in.
		const rotation = clip!
			.listChannels()
			.find((c) => c.getTargetNode()?.getName() === 'Upper' && c.getTargetPath() === 'rotation')!;
		const times = rotation.getSampler()!.getInput()!.getArray()!;
		expect(times[times.length - 1]).toBeCloseTo(1, 4);
		const weights = clip!.listChannels().find((c) => c.getTargetPath() === 'weights')!;
		const values = weights.getSampler()!.getOutput()!.getArray()!;
		expect(values[0]).toBeCloseTo(0, 5);
		expect(values[values.length - 1]).toBeCloseTo(1, 5);
		const [body, cap] = root.listMaterials();
		expect(body?.getName()).toBe('Body');
		expect(body?.getBaseColorTexture()?.getMimeType()).toBe('image/png');
		expect(body?.getBaseColorFactor()).toEqual([1, 1, 1, 1]);
		expect(body?.getRoughnessFactor()).toBeCloseTo(0.8, 5);
		expect(cap?.getMetallicFactor()).toBe(1);
		expect(cap?.getRoughnessFactor()).toBeCloseTo(0.3, 5);
		expect(cap?.getBaseColorFactor()[0]).toBeCloseTo(0.8, 5);
	});

	it('stands the column 2 meters tall with Y up, in meters', async () => {
		const root = (await readGlb(output('column-fbx.glb').glb)).getRoot();
		const node = root.listNodes().find((n) => n.getName() === 'Column')!;
		const [min, max] = worldBounds(node);
		expect(max.map((v, i) => v - min[i]!)).toEqual([
			expect.closeTo(0.6, 4),
			expect.closeTo(2, 4),
			expect.closeTo(0.6, 4),
		]);
		expect(min[1]).toBeCloseTo(0, 4);
	});

	it('says why a file is not one it can read', async () => {
		await expect(
			readUfbx(new TextEncoder().encode('not an fbx file'), { obj: false }),
		).rejects.toThrow();
		const path = scratchFile('broken.fbx', 'Kaydara FBX Binary  \0\x1a\0');
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(await main(['assets', 'convert', path, join(scratch, 'broken.glb')])).toBe(1);
			expect(String(error.mock.calls[0]?.[0])).toContain('broken.fbx: ufbx');
		} finally {
			error.mockRestore();
		}
	});
});

describe('assets convert of OBJ files', () => {
	it('reads the MTL file and its texture, and turns the Phong exponent to roughness', async () => {
		const { glb, notes } = output('column-obj.glb');
		expect(notes).toEqual([]);
		const root = (await readGlb(glb)).getRoot();
		const [body, cap] = root.listMaterials();
		expect(body?.getBaseColorTexture()?.getImage()?.byteLength).toBe(
			readFileSync(source('checker.png')).byteLength,
		);
		expect(body?.getRoughnessFactor()).toBeCloseTo(phongRoughness(40), 5);
		expect(cap?.getBaseColorFactor()).toEqual([
			expect.closeTo(0.8, 5),
			expect.closeTo(0.05, 5),
			expect.closeTo(0.05, 5),
			1,
		]);
		expect(cap?.getRoughnessFactor()).toBeCloseTo(phongRoughness(490), 5);
	});

	it('turns a gray map in the bump slot into a normal map, and notes a missing texture', async () => {
		const obj = [
			'mtllib bumpy.mtl',
			'v 0 0 0',
			'v 1 0 0',
			'v 1 1 0',
			'vt 0 0',
			'vt 1 0',
			'vt 1 1',
			'usemtl Bumpy',
			'f 1/1 2/2 3/3',
			'usemtl Lost',
			'f 1/1 3/3 2/2',
		].join('\n');
		const gray = new Uint8Array(8 * 8 * 4).map((_, i) =>
			i % 4 === 3 ? 255 : (i >> 2) % 8 < 4 ? 40 : 200,
		);
		const { encodePng } = await import('../png.js');
		scratchFile('bumps.png', encodePng({ width: 8, height: 8, data: gray }));
		scratchFile('bumpy.mtl', 'newmtl Bumpy\nmap_Bump bumps.png\nnewmtl Lost\nmap_Kd missing.png\n');
		const { glb, notes } = await convertModel(scratchFile('bumpy.obj', obj));
		expect(notes).toEqual(['the texture missing.png is not beside the model, so it is left out']);
		const [bumpy] = (await readGlb(glb)).getRoot().listMaterials();
		expect(bumpy?.getNormalTexture()?.getName()).toBe('bumps-normal');
	});
});

describe('assets convert of STL files', () => {
	it('reads a binary file with colors, joining corners of a color at one place', () => {
		const [solid] = readStl(pyramidStl(), 'pyramid');
		expect(solid?.corners.length).toBe(6 * 9);
		const welded = weldSolid(solid!);
		// The gray base's four corners, and three for each colored side.
		expect(welded.positions.length / 3).toBe(4 + 4 * 3);
		expect(welded.colors?.[0]).toBeCloseTo(
			srgbToLinear(Math.round((Math.round((200 * 31) / 255) * 255) / 31)) / 65535,
			6,
		);
	});

	it('reads a text file of two solids, as two meshes', async () => {
		const facet = (z: number) =>
			`facet normal 0 0 1\nouter loop\nvertex 0 0 ${z}\nvertex 1 0 ${z}\nvertex 0 1 ${z}\nendloop\nendfacet`;
		const text = `solid first\n${facet(0)}\n${facet(1)}\nendsolid first\nsolid second\n${facet(2)}\nendsolid second\n`;
		const { glb } = await convertModel(scratchFile('two.stl', text));
		const data = parse(glb);
		expect(data.meshes.map((mesh) => mesh.name)).toEqual(['first', 'second']);
		expect(data.meshes[0]!.primitives[0]!.indices?.length).toBe(6);
		expect(data.meshes[0]!.primitives[0]!.normals).toBeUndefined();
		await expect(
			convertModel(scratchFile('bad.stl', 'solid x\nvertex 1 2\nendsolid')),
		).rejects.toThrow('not a corner');
	});
});

describe('assets convert of PLY files', () => {
	it('reads the binary cube with normals, sRGB colors and texture coordinates', () => {
		const data = parse(output('cube-ply.glb').glb);
		const prim = data.meshes[0]!.primitives[0]!;
		expect(prim.positions.array.length).toBe(24 * 3);
		expect(prim.indices?.length).toBe(36);
		expect(prim.normals).toBeDefined();
		expect(prim.uvs).toBeDefined();
		// The first corner, at +X, -Y, +Z, has the red of 240 in sRGB.
		expect(prim.colors!.array[0]).toBeCloseTo(srgbToLinear(240) / 65535, 6);
	});

	it('reads text files, big-endian files and point clouds', async () => {
		const text = [
			'ply',
			'format ascii 1.0',
			'element vertex 4',
			'property float x',
			'property float y',
			'property float z',
			'property uchar red',
			'property uchar green',
			'property uchar blue',
			'property uchar alpha',
			'element face 1',
			'property list uchar int vertex_index',
			'end_header',
			'0 0 0 255 0 0 128',
			'1 0 0 0 255 0 255',
			'1 1 0 0 0 255 255',
			'0 1 0 255 255 255 255',
			'4 0 1 2 3',
		].join('\n');
		const quad = parse((await convertModel(scratchFile('quad.ply', text))).glb).meshes[0]!
			.primitives[0]!;
		expect(Array.from(quad.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
		expect(quad.colors!.array.length).toBe(16);
		expect(quad.colors!.array[3]).toBeCloseTo(128 / 255, 6);

		const header = new TextEncoder().encode(
			'ply\nformat binary_big_endian 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nend_header\n',
		);
		const bytes = new Uint8Array(header.length + 3 * 24);
		bytes.set(header);
		const view = new DataView(bytes.buffer);
		for (const [i, v] of [0, 0, 0, 1, 2, 3, -1, 0.5, 4].entries())
			view.setFloat64(header.length + i * 8, v);
		const doc = plyDocument(bytes, 'points');
		const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
		expect(prim.getMode()).toBe(0);
		expect(Array.from(prim.getAttribute('POSITION')!.getArray()!)).toEqual([
			0, 0, 0, 1, 2, 3, -1, 0.5, 4,
		]);
	});

	it('says what is wrong with a broken file', () => {
		expect(() => readPlyHeader(new TextEncoder().encode('obj\nend_header\n'))).toThrow(
			'does not start with "ply"',
		);
		expect(() =>
			plyDocument(
				new TextEncoder().encode(
					'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n3 0 1 2\n',
				),
				'bad',
			),
		).toThrow('past its 1 vertices');
	});
});

describe('assets convert of glTF files', () => {
	it('puts a .gltf file, its buffer and its image into one .glb file', async () => {
		const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(at(ASSET_SCENE.source));
		const folder = join(scratch, 'gltf');
		mkdirSync(folder, { recursive: true });
		for (const [i, texture] of doc.getRoot().listTextures().entries())
			texture.setURI(`image-${i}.png`);
		doc.getRoot().listBuffers()[0]!.setURI('scene.bin');
		await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(join(folder, 'scene.gltf'), doc);
		const { glb, meshopt } = await convertModel(join(folder, 'scene.gltf'));
		expect(meshopt).toBe(false);
		const json = glbJson(glb);
		expect(json.buffers).toHaveLength(1);
		expect(json.images.every((image: { uri?: string }) => image.uri === undefined)).toBe(true);
		expect(parse(glb).meshes.length).toBe(
			parse(readFileSync(at(ASSET_SCENE.source))).meshes.length,
		);
	});

	it('turns Draco compression into meshopt compression', async () => {
		const require = createRequire(import.meta.url);
		const draco3d = require('draco3d');
		const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
			'draco3d.encoder': await draco3d.createEncoderModule(),
			'draco3d.decoder': await draco3d.createDecoderModule(),
		});
		const doc = await io.read(at(ASSET_SCENE.source));
		doc.createExtension(KHRDracoMeshCompression).setRequired(true);
		const file = scratchFile('draco.glb', await io.writeBinary(doc));
		const { glb, meshopt } = await convertModel(file);
		expect(meshopt).toBe(true);
		const json = glbJson(glb);
		expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
		expect(json.extensionsUsed).toContain('KHR_mesh_quantization');
		expect(json.extensionsUsed).not.toContain('KHR_draco_mesh_compression');
		const held = (await io.read(file))
			.getRoot()
			.listMeshes()
			.map((mesh) => mesh.listPrimitives()[0]!.getIndices()!.getCount());
		expect(parse(glb).meshes.map((mesh) => mesh.primitives[0]!.indices!.length)).toEqual(held);
		// Without compression, the meshes keep their floats.
		const plain = await convertModel(file, { compression: 'none' });
		expect(glbJson(plain.glb).extensionsUsed ?? []).not.toContain('EXT_meshopt_compression');
	});
});

describe('the clip helpers', () => {
	it('samples a track by straight lines between keys, held past its ends', () => {
		const times = Float32Array.from([0, 1, 3]);
		const values = Float32Array.from([0, 10, 30]);
		expect(sampleLinear(times, values, -1)).toBe(0);
		expect(sampleLinear(times, values, 0.5)).toBe(5);
		expect(sampleLinear(times, values, 2)).toBe(20);
		expect(sampleLinear(times, values, 9)).toBe(30);
	});

	it('turns Phong exponents into roughness', () => {
		expect(phongRoughness(0)).toBe(1);
		expect(phongRoughness(1000)).toBeCloseTo(0.211, 3);
		expect(phongRoughness(40)).toBeCloseTo(0.467, 3);
	});
});
