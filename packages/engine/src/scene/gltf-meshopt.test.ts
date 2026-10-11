// Meshopt data in glTF files made in code, with meshoptimizer's encoder: every mode and filter, both
// extension names and both vertex codecs, fallback buffers, and data that breaks the rules. The
// test files of tests/lib/meshopt-fixtures.ts cover files from gltfpack and the Khronos samples.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { referenceDecoder, rotated, shippedDecoder } from '../../../../tests/lib/meshopt-checks';
import { boxArrays, GltfBuilder } from '../../../../tests/pages/lib/gltf-files';
import {
	installedMeshoptWasm,
	MESHOPT_VENDOR,
	MESHOPT_WASM,
} from '../../../../tools/lib/meshopt-wasm';
import {
	type GltfData,
	GltfError,
	type MeshoptDecode,
	parseGltf,
	readContainer,
	usesMeshopt,
} from './gltf-parse';

const URL_OF = 'https://example.com/models/test.glb';
const BYTE = 5120;
const UNSIGNED_BYTE = 5121;
const SHORT = 5122;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const FLOAT = 5126;

/** meshoptimizer's WebAssembly decoder, from the file that the engine ships. */
let decode: MeshoptDecode;
/** meshoptimizer's reference decoder, written in plain JavaScript to follow the format's rules. */
let reference: MeshoptDecode;

beforeAll(async () => {
	decode = await shippedDecoder();
	reference = await referenceDecoder();
	await MeshoptEncoder.ready;
});

/** Parses a file whose buffers are all inside it, with `decoder`. */
function parse(file: Uint8Array, decoder: MeshoptDecode | undefined = decode): GltfData {
	return parseGltf(readContainer(file, URL_OF), new Map(), URL_OF, { meshopt: decoder });
}

/** The code and message of the error that parsing a file throws. */
function refusal(file: Uint8Array, decoder: MeshoptDecode | undefined = decode): [string, string] {
	try {
		parse(file, decoder);
	} catch (error) {
		if (error instanceof GltfError) return [error.code, error.message];
		throw error;
	}
	throw new Error('the file parsed');
}

const bytesOf = (array: ArrayBufferView) =>
	new Uint8Array(array.buffer, array.byteOffset, array.byteLength).slice();

/** Each meshopt mode and filter that a test file uses, with the codec version and the name. */
interface Compression {
	extension: 'EXT_meshopt_compression' | 'KHR_meshopt_compression';
	version: 0 | 1;
}

/**
 * Adds `data`, `count` elements of `stride` bytes, as a compressed buffer view, and returns its
 * index. Filtered data comes from the encoder's filter of `floats`.
 */
function compressed(
	b: GltfBuilder,
	{ extension, version }: Compression,
	data: Uint8Array,
	count: number,
	stride: number,
	mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES',
	filter?: string,
	viewStride?: number,
): number {
	const encoded = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode, version);
	return b.meshoptView(encoded, { count, byteStride: stride, mode, filter }, extension, viewStride);
}

/** Four floats per element from `components` per element, the rest filled with `w`. */
function widen(values: Float32Array, components: number, w = 0): Float32Array {
	const n = values.length / components;
	const out = new Float32Array(n * 4);
	for (let i = 0; i < n; i++) {
		for (let c = 0; c < components; c++) out[i * 4 + c] = values[i * components + c] as number;
		if (components < 4) out[i * 4 + 3] = w;
	}
	return out;
}

/** The arrays a test file compresses, so the tests can compare the decoded ones with them. */
const BOX = boxArrays(2);
const VERTICES = BOX.positions.length / 3;
const COLORS = new Float32Array(VERTICES * 4).map((_, i) => ((i * 37) % 101) / 100);
const INSTANCES = 6;
const TRANSLATIONS = new Float32Array(INSTANCES * 3).map((_, i) => i * 0.75 - 3.1);
const ROTATIONS = (() => {
	const out = new Float32Array(INSTANCES * 4);
	for (let i = 0; i < INSTANCES; i++) {
		const angle = i * 0.4;
		out.set([0, Math.sin(angle / 2), 0, Math.cos(angle / 2)], i * 4);
	}
	return out;
})();
const SCALES = new Float32Array(INSTANCES * 3).fill(1.5);

/**
 * A file with every meshopt mode and filter: a box whose positions use the exponential filter,
 * normals the octahedral one at 8 and 16 bits, tangents the octahedral one, colors the color filter
 * at 8 and 16 bits and texture coordinates none. Its triangles use the triangle mode with 16-bit and
 * 32-bit indices, and the index mode. Its instancing uses the quaternion and exponential filters.
 */
function everyModeFile(compression: Compression): GltfBuilder {
	const b = new GltfBuilder();
	const on = (
		data: Uint8Array,
		count: number,
		stride: number,
		mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES',
		filter?: string,
		viewStride?: number,
	) => compressed(b, compression, data, count, stride, mode, filter, viewStride);
	const n = VERTICES;
	const positions = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterExp(BOX.positions, n, 12, 15),
			n,
			12,
			'ATTRIBUTES',
			'EXPONENTIAL',
		),
		FLOAT,
		n,
		3,
		{ min: [-1, -1, -1], max: [1, 1, 1] },
	);
	const normals8 = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterOct(widen(BOX.normals, 3), n, 4, 8),
			n,
			4,
			'ATTRIBUTES',
			'OCTAHEDRAL',
			4,
		),
		BYTE,
		n,
		3,
		{ normalized: true },
	);
	const normals16 = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterOct(widen(BOX.normals, 3), n, 8, 12),
			n,
			8,
			'ATTRIBUTES',
			'OCTAHEDRAL',
			8,
		),
		SHORT,
		n,
		3,
		{ normalized: true },
	);
	const tangents = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterOct(widen(BOX.normals, 3, 1), n, 4, 8),
			n,
			4,
			'ATTRIBUTES',
			'OCTAHEDRAL',
		),
		BYTE,
		n,
		4,
		{ normalized: true },
	);
	const colors8 = b.accessorOf(
		on(MeshoptEncoder.encodeFilterColor(COLORS, n, 4, 8), n, 4, 'ATTRIBUTES', 'COLOR'),
		UNSIGNED_BYTE,
		n,
		4,
		{ normalized: true },
	);
	const colors16 = b.accessorOf(
		on(MeshoptEncoder.encodeFilterColor(COLORS, n, 8, 12), n, 8, 'ATTRIBUTES', 'COLOR'),
		UNSIGNED_SHORT,
		n,
		4,
		{ normalized: true },
	);
	const uvs = b.accessorOf(on(bytesOf(BOX.uvs), n, 8, 'ATTRIBUTES'), FLOAT, n, 2);
	const triangles = BOX.indices.length;
	const indices16 = b.accessorOf(
		on(bytesOf(BOX.indices), triangles, 2, 'TRIANGLES'),
		UNSIGNED_SHORT,
		triangles,
		1,
	);
	const indices32 = b.accessorOf(
		on(bytesOf(Uint32Array.from(BOX.indices)), triangles, 4, 'TRIANGLES'),
		UNSIGNED_INT,
		triangles,
		1,
	);
	const sequence16 = b.accessorOf(
		on(bytesOf(BOX.indices), triangles, 2, 'INDICES'),
		UNSIGNED_SHORT,
		triangles,
		1,
	);
	const sequence32 = b.accessorOf(
		on(bytesOf(Uint32Array.from(BOX.indices)), triangles, 4, 'INDICES'),
		UNSIGNED_INT,
		triangles,
		1,
	);
	const primitive = (fields: Record<string, number>, indices: number) => ({
		attributes: { POSITION: positions, TEXCOORD_0: uvs, ...fields },
		indices,
	});
	const mesh = b.mesh([
		primitive({ NORMAL: normals8, TANGENT: tangents, COLOR_0: colors8 }, indices16),
		primitive({ NORMAL: normals16, COLOR_0: colors16 }, indices32),
		primitive({ NORMAL: normals8 }, sequence16),
		primitive({ NORMAL: normals16 }, sequence32),
	]);
	const translation = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterExp(TRANSLATIONS, INSTANCES, 12, 16),
			INSTANCES,
			12,
			'ATTRIBUTES',
			'EXPONENTIAL',
		),
		FLOAT,
		INSTANCES,
		3,
	);
	const rotation = b.accessorOf(
		on(
			MeshoptEncoder.encodeFilterQuat(ROTATIONS, INSTANCES, 8, 12),
			INSTANCES,
			8,
			'ATTRIBUTES',
			'QUATERNION',
		),
		SHORT,
		INSTANCES,
		4,
		{ normalized: true },
	);
	const scale = b.accessorOf(on(bytesOf(SCALES), INSTANCES, 12, 'ATTRIBUTES'), FLOAT, INSTANCES, 3);
	b.node({
		mesh,
		extensions: {
			EXT_mesh_gpu_instancing: {
				attributes: { TRANSLATION: translation, ROTATION: rotation, SCALE: scale },
			},
		},
	});
	return b.uses(compression.extension, true).uses('EXT_mesh_gpu_instancing', true);
}

/** Normalized integers as fractions, as glTF reads them. */
function fractions(array: ArrayLike<number>, scale: number): number[] {
	return Array.from(array, (v) => Math.max(v / scale, -1));
}

/** The largest difference between two lists of numbers of the same length. */
function largestDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
	expect(a.length).toBe(b.length);
	let most = 0;
	for (let i = 0; i < a.length; i++)
		most = Math.max(most, Math.abs((a[i] as number) - (b[i] as number)));
	return most;
}

const COMPRESSIONS: readonly Compression[] = [
	{ extension: 'EXT_meshopt_compression', version: 0 },
	{ extension: 'KHR_meshopt_compression', version: 0 },
	{ extension: 'KHR_meshopt_compression', version: 1 },
];

describe('meshopt data', () => {
	test('the shipped decoder is the SIMD module of the meshoptimizer package that the engine pins', () => {
		expect(
			Buffer.from(installedMeshoptWasm()).equals(readFileSync(join(MESHOPT_VENDOR, MESHOPT_WASM))),
		).toBe(true);
	});

	for (const compression of COMPRESSIONS) {
		const name = `${compression.extension}, vertex codec ${compression.version}`;

		test(`every mode and filter decodes as meshoptimizer's reference decoder does: ${name}`, () => {
			const file = everyModeFile(compression).glb();
			expect(usesMeshopt(readContainer(file, URL_OF))).toBe(true);
			expect(parse(file)).toEqual(parse(file, reference));
		});

		test(`decoded arrays match the arrays that were compressed: ${name}`, () => {
			const data = parse(everyModeFile(compression).glb());
			const [first, second, third, fourth] = data.meshes[0]?.primitives ?? [];
			if (!first || !second || !third || !fourth) throw new Error('the mesh lost a primitive');
			// Modes without a filter give back the bytes they were given.
			expect(first.uvs?.array).toEqual(BOX.uvs);
			expect(rotated(first.indices)).toEqual(rotated(BOX.indices));
			expect(rotated(second.indices)).toEqual(rotated(Uint32Array.from(BOX.indices)));
			expect(third.indices).toEqual(BOX.indices);
			expect(fourth.indices).toEqual(Uint32Array.from(BOX.indices));
			// Filters keep each value within the precision of the bits they keep.
			expect(largestDifference(first.positions.array, BOX.positions)).toBeLessThan(1e-4);
			expect(
				largestDifference(fractions(first.normals?.array ?? [], 127), BOX.normals),
			).toBeLessThan(0.02);
			expect(
				largestDifference(fractions(second.normals?.array ?? [], 32767), BOX.normals),
			).toBeLessThan(0.002);
			expect(largestDifference(fractions(first.colors?.array ?? [], 255), COLORS)).toBeLessThan(
				0.02,
			);
			expect(largestDifference(fractions(second.colors?.array ?? [], 65535), COLORS)).toBeLessThan(
				0.002,
			);
			const instancing = data.nodes[0]?.instancing;
			expect(instancing?.count).toBe(INSTANCES);
			expect(largestDifference(instancing?.positions ?? [], TRANSLATIONS)).toBeLessThan(1e-4);
			expect(largestDifference(instancing?.rotations ?? [], ROTATIONS)).toBeLessThan(0.002);
			expect(instancing?.scales).toEqual(SCALES);
		});
	}

	test('a fallback buffer is never asked for, and a file that requires meshopt loads', () => {
		const b = everyModeFile(COMPRESSIONS[0] as Compression);
		const file = JSON.parse(new TextDecoder().decode(b.gltf('test.bin')));
		file.buffers[1].uri = 'fallback.bin';
		const container = readContainer(new TextEncoder().encode(JSON.stringify(file)), URL_OF);
		expect([...container.external]).toEqual([[0, 'https://example.com/models/test.bin']]);
		const data = parseGltf(container, new Map([[0, b.bytes()]]), URL_OF, { meshopt: decode });
		expect(data).toEqual(parse(b.glb()));
	});

	test('a view reads its fallback buffer when no decoder is given and the buffer is there', () => {
		const b = everyModeFile(COMPRESSIONS[0] as Compression);
		const glb = b.glb();
		const decoded = parse(glb);
		// The fallback buffer of a file without the decoder: each view's decoded bytes at its offset.
		const json = b.json;
		const fallback = new Uint8Array(json.buffers[1].byteLength);
		const source = b.bytes();
		for (const view of json.bufferViews) {
			const ext: Record<string, number> & { mode: string; filter?: string } =
				view.extensions.EXT_meshopt_compression;
			const at = ext.byteOffset ?? 0;
			const target = new Uint8Array((ext.count as number) * (ext.byteStride as number));
			decode(
				target,
				ext.count as number,
				ext.byteStride as number,
				source.subarray(at, at + (ext.byteLength as number)),
				ext.mode,
				ext.filter ?? 'NONE',
			);
			fallback.set(target, view.byteOffset);
		}
		const container = readContainer(glb, URL_OF);
		expect(parseGltf(container, new Map([[1, fallback]]), URL_OF)).toEqual(decoded);
		expect(() => parseGltf(container, new Map(), URL_OF)).toThrow('the parser has no decoder');
	});
});

describe('broken meshopt data', () => {
	/** A file of one compressed view, of 16-bit triangle indices, with its extension changed. */
	const broken = (
		change: (ext: Record<string, unknown>, view: Record<string, unknown>) => void,
	) => {
		const b = new GltfBuilder();
		const view = compressed(
			b,
			{ extension: 'EXT_meshopt_compression', version: 0 },
			bytesOf(BOX.indices),
			BOX.indices.length,
			2,
			'TRIANGLES',
		);
		const positions = b.positions(BOX.positions);
		const indices = b.accessorOf(view, UNSIGNED_SHORT, BOX.indices.length, 1);
		b.node({ mesh: b.mesh([{ attributes: { POSITION: positions }, indices }]) });
		const json = b.json.bufferViews[view];
		change(json.extensions.EXT_meshopt_compression, json);
		return b.glb();
	};

	test('each rule of the extension refuses a file with E1416, which says what broke', () => {
		const cases: [(ext: Record<string, unknown>, view: Record<string, unknown>) => void, string][] =
			[
				[(ext) => (ext.mode = 'POINTS'), 'has the mode POINTS'],
				[(ext) => (ext.filter = 'OCTAHEDRAL'), 'which only the ATTRIBUTES mode takes'],
				[(ext) => (ext.filter = 'SHARPEN'), 'has the filter SHARPEN'],
				[(ext) => (ext.byteStride = 3), 'byteStride 3'],
				[
					(ext, view) => {
						ext.count = 35;
						view.byteLength = 70;
					},
					'make no whole triangles',
				],
				[(ext) => (ext.count = 2_000_000_001), 'more than the'],
				[(_, view) => (view.byteLength = 10), "the view's byteLength says 10"],
				[(ext) => (ext.byteOffset = 1 << 20), 'reads bytes'],
				[(ext) => (ext.buffer = 1), 'a fallback buffer that holds no data'],
				[(ext) => (ext.buffer = 5), 'buffer is 5'],
			];
		for (const [change, message] of cases) {
			const [code, text] = refusal(broken(change));
			expect(code).toBe('E1416');
			expect(text).toContain(message);
		}
	});

	test('data that does not decode is refused with E1416', () => {
		const file = broken((ext) => {
			ext.byteLength = 4;
		});
		const [code, text] = refusal(file);
		expect(code).toBe('E1416');
		expect(text).toContain('does not decode');
	});
});
