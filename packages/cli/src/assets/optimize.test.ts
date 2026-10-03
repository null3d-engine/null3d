import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { ASSET_SCENE, assetSceneGlb } from '../../../../tests/lib/asset-scene.ts';
import {
	type GltfData,
	type NodeData,
	parseGltf,
	readContainer,
} from '../../../engine/src/scene/gltf-parse.ts';
import { main } from '../cli.js';
import { encodeOnce, encoderPool } from './encoder-pool.js';
import { lodOf, MSFTLod } from './lod-extension.js';
import { findModels, parseOptimizeArgs } from './optimize.js';
import { DEFAULT_OPTIONS, optimizeModel } from './pipeline.js';

// Texture encodes take seconds each on a busy machine or a CI runner of four cores.
setDefaultTimeout(60_000);

const ROOT = join(import.meta.dir, '../../../..');
const at = (path: string) => join(ROOT, path);

/**
 * Set to write the scene and the tool's outputs again, after a change that the outputs must take:
 * NULL3D_WRITE_ASSET_SCENE=1 bun test packages/cli/src/assets/optimize.test.ts
 */
const WRITE = process.env.NULL3D_WRITE_ASSET_SCENE !== undefined;

if (WRITE) {
	mkdirSync(join(at(ASSET_SCENE.source), '..'), { recursive: true });
	writeFileSync(at(ASSET_SCENE.source), assetSceneGlb());
}

const pool = encoderPool(4);
const encode = encodeOnce((job) => pool.encode(job));
afterAll(() => pool.close());

const scratch = mkdtempSync(join(tmpdir(), 'null3d-assets-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const optimized = optimizeModel(at(ASSET_SCENE.source), DEFAULT_OPTIONS, encode);
const lodMeshopt = optimizeModel(
	at(ASSET_SCENE.source),
	{ ...DEFAULT_OPTIONS, lod: true, meshopt: true },
	encode,
);

/**
 * An output as glTF-Transform reads it, with meshopt's decoder: written to a folder with its
 * texture files, since a binary file that names other files reads only from disk.
 */
async function readOutput(model: { glb: Uint8Array; files: Map<string, Uint8Array> }) {
	const folder = mkdtempSync(join(scratch, 'read-'));
	mkdirSync(join(folder, 'textures'));
	for (const [name, bytes] of model.files) writeFileSync(join(folder, 'textures', name), bytes);
	writeFileSync(join(folder, 'model.glb'), model.glb);
	await MeshoptDecoder.ready;
	return new NodeIO()
		.registerExtensions([...ALL_EXTENSIONS, MSFTLod])
		.registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
		.read(join(folder, 'model.glb'));
}

/** The JSON of a binary glTF file. */
function glbJson(glb: Uint8Array) {
	const length = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
	return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

/** A file's data as the engine's loader parses it, with the buffers inside it. */
const parse = (glb: Uint8Array): GltfData =>
	parseGltf(
		readContainer(glb, 'https://example.com/scene.glb'),
		new Map(),
		'https://example.com/scene.glb',
	);

/** A node's matrix in the scene, column-major, from the parsed nodes. */
function worldMatrix(nodes: readonly NodeData[], k: number): number[] {
	const node = nodes[k] as NodeData;
	const local = trs(node.transform);
	return node.parent < 0 ? local : multiply(worldMatrix(nodes, node.parent), local);
}

function trs(t: ArrayLike<number>): number[] {
	const [px, py, pz, x, y, z, w, sx, sy, sz] = Array.from(t) as number[];
	return [
		(1 - 2 * (y! * y! + z! * z!)) * sx!,
		2 * (x! * y! + z! * w!) * sx!,
		2 * (x! * z! - y! * w!) * sx!,
		0,
		2 * (x! * y! - z! * w!) * sy!,
		(1 - 2 * (x! * x! + z! * z!)) * sy!,
		2 * (y! * z! + x! * w!) * sy!,
		0,
		2 * (x! * z! + y! * w!) * sz!,
		2 * (y! * z! - x! * w!) * sz!,
		(1 - 2 * (x! * x! + y! * y!)) * sz!,
		0,
		px!,
		py!,
		pz!,
		1,
	];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
	const out = new Array(16).fill(0);
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++)
			for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
	return out;
}

/** The value of an attribute's element as the GPU reads it: normalized integers as fractions. */
function read(
	data: { array: ArrayLike<number> & { BYTES_PER_ELEMENT: number }; normalized: boolean },
	i: number,
) {
	const value = data.array[i] as number;
	if (!data.normalized || data.array instanceof Float32Array) return value;
	const bits = data.array.BYTES_PER_ELEMENT * 8;
	const signed = data.array instanceof Int8Array || data.array instanceof Int16Array;
	const max = 2 ** (signed ? bits - 1 : bits) - 1;
	return Math.max(value / max, -1);
}

/**
 * Every triangle that a parsed scene draws, in the scene's space: each corner's position, normal
 * and first texture coordinates, by node and instance.
 */
function drawnTriangles(data: GltfData) {
	const corners: { position: number[]; normal: number[]; uv: number[] }[][] = [];
	data.nodes.forEach((node, k) => {
		if (node.mesh < 0) return;
		const world = worldMatrix(data.nodes, k);
		const instances = node.instancing
			? Array.from({ length: node.instancing.count }, (_, i) =>
					trs([
						...node.instancing!.positions.subarray(i * 3, i * 3 + 3),
						...node.instancing!.rotations.subarray(i * 4, i * 4 + 4),
						...node.instancing!.scales.subarray(i * 3, i * 3 + 3),
					]),
				)
			: [trs([0, 0, 0, 0, 0, 0, 1, 1, 1, 1])];
		for (const instance of instances) {
			const m = multiply(world, instance);
			for (const prim of data.meshes[node.mesh]!.primitives) {
				const count = prim.positions.array.length / 3;
				const indices = prim.indices ?? Uint32Array.from({ length: count }, (_, i) => i);
				const corner = (v: number) => {
					const p = [0, 1, 2].map((c) => read(prim.positions as never, v * 3 + c));
					const n = prim.normals
						? [0, 1, 2].map((c) => read(prim.normals as never, v * 3 + c))
						: [0, 0, 0];
					return {
						position: [0, 1, 2].map(
							(r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!,
						),
						normal: [0, 1, 2].map((r) => m[r]! * n[0]! + m[4 + r]! * n[1]! + m[8 + r]! * n[2]!),
						uv: prim.uvs
							? [read(prim.uvs as never, v * 2), read(prim.uvs as never, v * 2 + 1)]
							: [0, 0],
					};
				};
				for (let t = 0; t < indices.length; t += 3)
					corners.push([corner(indices[t]!), corner(indices[t + 1]!), corner(indices[t + 2]!)]);
			}
		}
	});
	return corners;
}

type Corner = ReturnType<typeof drawnTriangles>[number][number];

/** A triangle's center. */
const center = (tri: readonly Corner[]) =>
	[0, 1, 2].map((c) => (tri[0]!.position[c]! + tri[1]!.position[c]! + tri[2]!.position[c]!) / 3);

/**
 * For each triangle of `output`, the triangle of `source` whose center lies nearest, found through
 * a grid of cells `step` wide.
 */
function nearestTwins(source: Corner[][], output: Corner[][], step: number) {
	const cells = new Map<string, Corner[][]>();
	const cell = (p: number[]) => p.map((v) => Math.floor(v / step));
	for (const tri of source) {
		const key = cell(center(tri)).join(',');
		cells.set(key, [...(cells.get(key) ?? []), tri]);
	}
	return output.map((tri) => {
		const c = center(tri);
		const [x, y, z] = cell(c) as [number, number, number];
		let best: Corner[] | undefined;
		let bestDistance = Infinity;
		for (let dx = -1; dx <= 1; dx++)
			for (let dy = -1; dy <= 1; dy++)
				for (let dz = -1; dz <= 1; dz++)
					for (const twin of cells.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
						const d = Math.hypot(...center(twin).map((v, k) => v - c[k]!));
						if (d < bestDistance) [best, bestDistance] = [twin, d];
					}
		return best;
	});
}

describe('assets optimize on the test scene', () => {
	it('writes the bytes that the repository holds, which CI checks on another CPU and system', async () => {
		const model = await optimized;
		const lod = await lodMeshopt;
		if (WRITE) {
			rmSync(at(ASSET_SCENE.textures), { recursive: true, force: true });
			mkdirSync(at(ASSET_SCENE.textures), { recursive: true });
			writeFileSync(at(ASSET_SCENE.optimized), model.glb);
			writeFileSync(at(ASSET_SCENE.lodMeshopt), lod.glb);
			for (const [name, bytes] of [...model.files, ...lod.files])
				writeFileSync(join(at(ASSET_SCENE.textures), name), bytes);
		}
		expect(Buffer.from(model.glb).equals(readFileSync(at(ASSET_SCENE.optimized)))).toBe(true);
		expect(Buffer.from(lod.glb).equals(readFileSync(at(ASSET_SCENE.lodMeshopt)))).toBe(true);
		expect(readdirSync(at(ASSET_SCENE.textures)).sort()).toEqual([...model.files.keys()].sort());
		for (const [name, bytes] of model.files)
			expect(Buffer.from(bytes).equals(readFileSync(join(at(ASSET_SCENE.textures), name)))).toBe(
				true,
			);
		expect([...lod.files.keys()].sort()).toEqual([...model.files.keys()].sort());
	});

	it('writes the same bytes again, with one encoder thread or several', async () => {
		const model = await optimized;
		const single = encoderPool(1);
		try {
			const again = await optimizeModel(at(ASSET_SCENE.source), DEFAULT_OPTIONS, (job) =>
				single.encode(job),
			);
			expect(Buffer.from(again.glb).equals(Buffer.from(model.glb))).toBe(true);
			expect([...again.files].map(([n, b]) => [n, Buffer.from(b).toString('base64')])).toEqual(
				[...model.files].map(([n, b]) => [n, Buffer.from(b).toString('base64')]),
			);
		} finally {
			await single.close();
		}
	});

	it("draws the source's triangles, within a step of the quantized positions", async () => {
		const source = drawnTriangles(parse(readFileSync(at(ASSET_SCENE.source))));
		const output = drawnTriangles(parse((await optimized).glb));
		expect(output.length).toBe(source.length);
		// The scene spans 6 m, which 14-bit positions split into steps of 0.37 mm.
		const twins = nearestTwins(source, output, 0.005);
		for (const [k, tri] of output.entries()) {
			const twin = twins[k];
			expect(twin).toBeDefined();
			if (!twin) continue;
			const corner = (t: typeof tri, i: number) => t[i]!;
			// The corners may start at another one; match each output corner to its nearest.
			for (let i = 0; i < 3; i++) {
				const out = corner(tri, i);
				// Corners at one place may differ in coordinates, as at a seam, so both count.
				const distance = (a: typeof out) =>
					Math.hypot(...a.position.map((v, c) => v - out.position[c]!)) +
					Math.hypot(...a.uv.map((v, c) => v - out.uv[c]!));
				const near = [0, 1, 2]
					.map((j) => corner(twin, j))
					.sort((a, b) => distance(a) - distance(b))[0]!;
				for (let c = 0; c < 3; c++) {
					expect(Math.abs(out.position[c]! - near.position[c]!)).toBeLessThan(0.001);
					const length = Math.hypot(...near.normal);
					const outLength = Math.hypot(...out.normal);
					expect(Math.abs(out.normal[c]! / outLength - near.normal[c]! / length)).toBeLessThan(
						0.02,
					);
				}
				for (let c = 0; c < 2; c++) expect(Math.abs(out.uv[c]! - near.uv[c]!)).toBeLessThan(1e-4);
			}
		}
	});

	it('stores what meshopt compressed exactly as the uncompressed file holds it', async () => {
		const plain = await readOutput(await optimized);
		const compressed = await readOutput(
			await optimizeModel(at(ASSET_SCENE.source), { ...DEFAULT_OPTIONS, meshopt: true }, encode),
		);
		// meshopt's index codec may start each triangle at another corner, which draws the same.
		const turned = (array: number[]) => {
			const out: number[] = [];
			for (let t = 0; t < array.length; t += 3) {
				const tri = array.slice(t, t + 3);
				const first = tri.indexOf(Math.min(...tri));
				out.push(...[0, 1, 2].map((k) => tri[(first + k) % 3]!));
			}
			return out;
		};
		const values = (accessor: { getArray(): ArrayLike<number> | null } | null) =>
			Array.from(accessor?.getArray() ?? []);
		const streams = (doc: typeof plain) =>
			doc
				.getRoot()
				.listMeshes()
				.flatMap((mesh) =>
					mesh.listPrimitives().map((prim) => ({
						indices: turned(values(prim.getIndices())),
						attributes: prim
							.listSemantics()
							.map((semantic) => [semantic, values(prim.getAttribute(semantic))]),
					})),
				);
		expect(streams(compressed)).toEqual(streams(plain));
		expect(
			compressed
				.getRoot()
				.listExtensionsUsed()
				.map((e) => e.extensionName),
		).toContain('EXT_meshopt_compression');
	});

	it('gives the ball levels of detail that share its vertices, and leaves the small meshes alone', async () => {
		const doc = await readOutput(await lodMeshopt);
		const ball = doc
			.getRoot()
			.listNodes()
			.find((n) => n.getName() === 'Ball')!;
		const lod = lodOf(ball)!;
		const levels = lod.listLevels();
		expect(levels.length).toBe(3);
		const triangles = [ball, ...levels].map(
			(n) => n.getMesh()!.listPrimitives()[0]!.getIndices()!.getCount() / 3,
		);
		expect(triangles[0]).toBe(48 * 24 * 2);
		for (let k = 1; k < triangles.length; k++)
			expect(triangles[k]!).toBeLessThan(triangles[k - 1]! * 0.8);
		const coverage = lod.getCoverage();
		expect(coverage.length).toBe(4);
		expect(coverage.at(-1)).toBe(0);
		for (let k = 1; k < coverage.length; k++) expect(coverage[k]!).toBeLessThan(coverage[k - 1]!);
		for (const level of levels) {
			expect(level.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION')).toBe(
				ball.getMesh()!.listPrimitives()[0]!.getAttribute('POSITION'),
			);
			expect(level.getTranslation()).toEqual(ball.getTranslation());
			expect(level.listParents().some((p) => p.propertyType === 'Scene')).toBe(false);
		}
		const withLevels = doc
			.getRoot()
			.listNodes()
			.filter((n) => lodOf(n) !== null);
		expect(withLevels.map((n) => n.getName())).toEqual(['Ball']);
	});

	it('reads Draco data, and writes the meshes without it', async () => {
		const require = createRequire(import.meta.url);
		const draco3d = require('draco3d');
		const io = new NodeIO().registerExtensions([...ALL_EXTENSIONS, MSFTLod]).registerDependencies({
			'draco3d.encoder': await draco3d.createEncoderModule(),
			'draco3d.decoder': await draco3d.createDecoderModule(),
		});
		const doc = await io.read(at(ASSET_SCENE.source));
		doc.createExtension(KHRDracoMeshCompression).setRequired(true);
		const file = join(scratch, 'draco.glb');
		writeFileSync(file, await io.writeBinary(doc));
		expect(glbJson(readFileSync(file)).extensionsRequired).toContain('KHR_draco_mesh_compression');
		const model = await optimizeModel(file, DEFAULT_OPTIONS, encode);
		expect(glbJson(model.glb).extensionsUsed).not.toContain('KHR_draco_mesh_compression');
		// Draco drops triangles whose corners meet, such as those at the ball's poles, so compare
		// with what the Draco file holds.
		const held = (await io.read(file))
			.getRoot()
			.listMeshes()
			.map((mesh) => mesh.listPrimitives()[0]!.getIndices()!.getCount());
		expect(parse(model.glb).meshes.map((mesh) => mesh.primitives[0]!.indices!.length)).toEqual(
			held,
		);
	});

	it('quantizes each stream to the type its values allow', async () => {
		const data = parse((await optimized).glb);
		const named = (name: string) => data.meshes.find((m) => m.name === name)!.primitives[0]!;
		const ball = named('ball');
		expect(ball.positions.array).toBeInstanceOf(Uint16Array);
		expect(ball.positions.normalized).toBe(false);
		expect(ball.normals?.array).toBeInstanceOf(Int8Array);
		expect(ball.uvs?.array).toBeInstanceOf(Uint16Array);
		expect(named('post').colors?.array).toBeInstanceOf(Uint8Array);
		// The floor's coordinates run to 3, past what normalized integers hold.
		expect(named('floor').uvs?.array).toBeInstanceOf(Float32Array);
		// The stand's node has a child, so its mesh moved to a new child with the dequantizing transform.
		const stand = data.nodes.findIndex((n) => n.name === 'Stand');
		expect(data.nodes[stand]!.mesh).toBe(-1);
		expect(data.nodes.filter((n) => n.parent === stand).map((n) => n.name)).toEqual([
			'Badge',
			'Stand',
		]);
	});

	it('reports what the scene draws and what its textures take', async () => {
		const { report } = await optimized;
		expect(report).toMatchObject({
			name: 'asset-scene.glb',
			meshes: 4,
			parts: 4,
			objects: 8,
			triangles: 6 * 2 * 6 + 2 + 48 * 24 * 2,
			lodMeshes: 0,
		});
		expect(report.bounds.min.map((v) => Math.round(v * 100) / 100)).toEqual([-3, -0.2, -3]);
		expect(report.textureGroups).toEqual([
			{ key: '128x64 etc1s srgb', count: 1 },
			{ key: '32x32 etc1s linear', count: 1 },
			{ key: '64x64 uastc linear', count: 1 },
		]);
		const color = report.textures.find((t) => t.name === 'stripes')!;
		expect([color.sourceWidth, color.sourceHeight, color.width, color.height]).toEqual([
			96, 48, 128, 64,
		]);
		// ETC1S without alpha takes 8 bytes for each block of 4 x 4 texels with ETC2, and 16 with
		// BC7. Every level counts, down to 1 x 1, and a level under 4 texels takes a whole block.
		const mips = (w: number, h: number, block: number) => {
			let total = 0;
			for (; ; w = Math.max(1, w / 2), h = Math.max(1, h / 2)) {
				total += block ? Math.ceil(w / 4) * Math.ceil(h / 4) * block : w * h * 4;
				if (w === 1 && h === 1) return total;
			}
		};
		expect(report.textureMemory).toEqual({
			etc2: mips(128, 64, 8) + mips(32, 32, 8) + mips(64, 64, 16),
			bc7: mips(128, 64, 16) + mips(32, 32, 16) + mips(64, 64, 16),
			rgba8: mips(128, 64, 0) + mips(32, 32, 0) + mips(64, 64, 0),
		});
	});
});

describe('the command', () => {
	const log = spyOn(console, 'log').mockImplementation(() => {});
	const error = spyOn(console, 'error').mockImplementation(() => {});
	afterAll(() => {
		log.mockRestore();
		error.mockRestore();
	});

	it('reads its options and refuses wrong ones', () => {
		expect(
			parseOptimizeArgs(['in.glb', 'out', '--lod', '--max-texture-size', '512', '--jobs', '2']),
		).toMatchObject({
			options: { lod: true, maxTextureSize: 512, textureQuality: 'size', meshopt: false },
			jobs: 2,
		});
		expect(() => parseOptimizeArgs(['in.glb'])).toThrow(
			'it takes an input file or folder and an output folder, not 1 argument',
		);
		expect(() => parseOptimizeArgs(['a', 'b', '--max-texture-size', '4096'])).toThrow(
			'a power of two from 1 to 2048',
		);
		expect(() => parseOptimizeArgs(['a', 'b', '--max-texture-size', '1000'])).toThrow('not "1000"');
		expect(() => parseOptimizeArgs(['a', 'b', '--texture-quality', 'best'])).toThrow(
			'takes size or high',
		);
		expect(parseOptimizeArgs(['a', 'b', '--compression', 'meshopt']).options.meshopt).toBe(true);
		expect(() => parseOptimizeArgs(['a', 'b', '--compression', 'draco'])).toThrow(
			'takes none or meshopt',
		);
	});

	it('optimizes each model of a folder into the output folder, with the textures in one folder', async () => {
		const input = join(scratch, 'in');
		mkdirSync(join(input, 'props'), { recursive: true });
		const scene = readFileSync(at(ASSET_SCENE.source));
		writeFileSync(join(input, 'a.glb'), scene);
		writeFileSync(join(input, 'props', 'b.glb'), scene);
		const output = join(input, 'out');
		expect(findModels(input, output).map((m) => m.place)).toEqual([
			'a.glb',
			join('props', 'b.glb'),
		]);
		expect(
			await main([
				'assets',
				'optimize',
				input,
				output,
				'--jobs',
				'2',
				'--report',
				join(scratch, 'report.json'),
			]),
		).toBe(0);
		const textures = readdirSync(join(output, 'textures')).sort();
		expect(textures).toEqual([...(await optimized).files.keys()].sort());
		const uris = (file: string) =>
			glbJson(readFileSync(file)).images.map((i: { uri: string }) => i.uri);
		expect(uris(join(output, 'a.glb')).every((uri: string) => uri.startsWith('textures/'))).toBe(
			true,
		);
		expect(
			uris(join(output, 'props', 'b.glb')).every((uri: string) => uri.startsWith('../textures/')),
		).toBe(true);
		const json = JSON.parse(readFileSync(join(scratch, 'report.json'), 'utf8'));
		expect(json.models.map((m: { name: string }) => m.name)).toEqual(['a.glb', 'b.glb']);
		// A second run into the same folder skips the files it wrote.
		expect(findModels(input, output)).toHaveLength(2);
	});

	it('names a model it cannot read, and fails', async () => {
		const input = join(scratch, 'broken.glb');
		writeFileSync(input, 'not a model');
		expect(await main(['assets', 'optimize', input, join(scratch, 'broken-out')])).toBe(1);
		expect(error.mock.calls.flat().join('\n')).toContain(
			'broken.glb is not a glTF file the tool can read',
		);
	});
});
