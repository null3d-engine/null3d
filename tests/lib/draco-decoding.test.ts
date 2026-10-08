// Draco data in glTF files, read with the decoder that the engine ships: the Khronos sample model
// RiggedSimple against its uncompressed twin, the repository's Draco test file, the quantized
// types, and files whose Draco data breaks the rules.
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DracoDecoder, dracoDecoder } from '../../packages/engine/src/scene/gltf-draco.ts';
import {
	type GltfData,
	GltfError,
	type PrimitiveData,
	parseGltf,
	readContainer,
	usesDraco,
} from '../../packages/engine/src/scene/gltf-parse.ts';
import { samplePath } from '../../tools/lib/samples.ts';
import { DRACO_FIXTURE } from './draco-fixtures.ts';
import { MODELS_DIR } from './meshopt-fixtures.ts';

const URL_OF = 'https://example.com/models/RiggedSimple.gltf';

/** The decoder's compiled module, from the file that the engine ships. */
let compiled: WebAssembly.Module;
let decoder: DracoDecoder;

beforeAll(async () => {
	compiled = await WebAssembly.compile(
		readFileSync(
			join(import.meta.dir, '../../packages/engine/vendor/draco/draco_decoder_gltf.wasm'),
		),
	);
	decoder = await dracoDecoder(compiled);
});

/** The parts of RiggedSimple's JSON that the tests change. */
interface RiggedJson {
	meshes: {
		primitives: {
			attributes: Record<string, number>;
			indices: number;
			extensions: {
				KHR_draco_mesh_compression: { bufferView: number; attributes: Record<string, number> };
			};
		}[];
	}[];
	accessors: { count: number; type: string }[];
	bufferViews: { byteLength: number }[];
}

/** RiggedSimple's Draco copy: its JSON, which a test may change, and its buffer. */
function rigged(): { json: RiggedJson; bin: Uint8Array } {
	return {
		json: JSON.parse(
			readFileSync(samplePath('sources/khronos/RiggedSimple/glTF-Draco/RiggedSimple.gltf'), 'utf8'),
		),
		bin: readFileSync(samplePath('sources/khronos/RiggedSimple/glTF-Draco/RiggedSimple0.bin')),
	};
}

/** Parses a .gltf file's JSON with its one buffer, with `decode` as its Draco decoder. */
function parseRigged(
	json: unknown,
	bin: Uint8Array,
	decode: DracoDecoder | undefined = decoder,
): GltfData {
	const file = new TextEncoder().encode(JSON.stringify(json));
	return parseGltf(readContainer(file, URL_OF), new Map([[0, bin]]), URL_OF, {
		draco: decode?.decode,
	});
}

/** The code and message of the error that parsing throws. */
function refusal(parse: () => unknown): [string, string] {
	try {
		parse();
	} catch (error) {
		if (error instanceof GltfError) return [error.code, error.message];
		throw error;
	}
	throw new Error('the file parsed');
}

/**
 * The code and message of the error that parsing RiggedSimple's JSON gives, with a fresh decoder,
 * since a decoder that fails is spent.
 */
async function refusalOf(json: unknown, bin: Uint8Array): Promise<[string, string]> {
	const fresh = await dracoDecoder(compiled);
	return refusal(() => parseRigged(json, bin, fresh));
}

/** RiggedSimple's one primitive. */
function primitiveOf(json: RiggedJson): RiggedJson['meshes'][number]['primitives'][number] {
	return json.meshes[0]!.primitives[0]!;
}

/** The Draco extension of RiggedSimple's one primitive. */
function extensionOf(json: RiggedJson) {
	return primitiveOf(json).extensions.KHR_draco_mesh_compression;
}

/** A primitive's vertex values as floats, normalized integers read as fractions. */
function floats(data: PrimitiveData['normals']): number[] {
	if (!data) return [];
	const { array, normalized } = data;
	if (!normalized || array instanceof Float32Array) return [...array];
	const max = array instanceof Int8Array ? 127 : array instanceof Uint16Array ? 65535 : 255;
	return [...array].map((value) => Math.max(value / max, -1));
}

describe('Draco data', () => {
	test('RiggedSimple decodes to the triangles, normals, joints and weights of its uncompressed twin', () => {
		const { json, bin } = rigged();
		const data = parseRigged(json, bin);
		const glb = readFileSync(
			samplePath('sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb'),
		);
		const twin = parseGltf(readContainer(glb, URL_OF), new Map(), URL_OF);
		expect(data.draco).toBe(true);
		expect(twin.draco).toBeUndefined();
		const p = data.meshes[0]?.primitives[0] as PrimitiveData;
		const q = twin.meshes[0]?.primitives[0] as PrimitiveData;
		// Normals become normalized bytes, and the joints and weights keep their accessors' types.
		expect(p.normals?.array).toBeInstanceOf(Int8Array);
		expect(p.normals?.normalized).toBe(true);
		expect(p.joints?.array).toBeInstanceOf(Uint16Array);
		expect(p.weights?.array).toBeInstanceOf(Float32Array);
		expect(p.positions.array).toBeInstanceOf(Float32Array);
		expect(p.indices?.length).toBe(q.indices?.length);
		// Draco orders vertices its own way, so each one meets its twin by position, and by normal
		// where the cylinder's caps place two vertices at one point.
		const [a, b] = [p.positions.array as Float32Array, q.positions.array as Float32Array];
		const [na, nb] = [floats(p.normals), floats(q.normals)];
		const [wa, wb] = [floats(p.weights), floats(q.weights)];
		const gap = (x: number[] | Float32Array, i: number, y: number[] | Float32Array, j: number) =>
			Math.hypot(
				(x[i * 3] as number) - (y[j * 3] as number),
				(x[i * 3 + 1] as number) - (y[j * 3 + 1] as number),
				(x[i * 3 + 2] as number) - (y[j * 3 + 2] as number),
			);
		const n = a.length / 3;
		const twinOf = new Int32Array(n).fill(-1);
		for (let i = 0; i < n; i++) {
			let best = -1;
			for (let j = 0; j < b.length / 3; j++)
				if (gap(a, i, b, j) < 0.005 && (best < 0 || gap(na, i, nb, j) < gap(na, i, nb, best)))
					best = j;
			expect(best).toBeGreaterThanOrEqual(0);
			twinOf[i] = best;
		}
		for (let i = 0; i < n; i++) {
			const j = twinOf[i] as number;
			for (let c = 0; c < 3; c++)
				expect(Math.abs((na[i * 3 + c] as number) - (nb[j * 3 + c] as number))).toBeLessThan(0.02);
			for (let c = 0; c < 4; c++) {
				expect(p.joints?.array[i * 4 + c]).toBe(q.joints?.array[j * 4 + c] as number);
				expect(Math.abs((wa[i * 4 + c] as number) - (wb[j * 4 + c] as number))).toBeLessThan(0.01);
			}
		}
		// The same triangles, each named by its twin's vertices from its lowest one.
		const triangles = (indices: ArrayLike<number>, map: (k: number) => number) => {
			const list: string[] = [];
			for (let t = 0; t < indices.length; t += 3) {
				const c = [0, 1, 2].map((k) => map(indices[t + k] as number));
				const low = c.indexOf(Math.min(...c));
				list.push([0, 1, 2].map((k) => c[(low + k) % 3]).join(','));
			}
			return list.sort();
		};
		expect(triangles(p.indices as Uint16Array, (k) => twinOf[k] as number)).toEqual(
			triangles(q.indices as Uint16Array, (k) => k),
		);
	});

	test('the test file decodes its texture coordinates to 16-bit integers that hold the same values', () => {
		const file = readFileSync(join(MODELS_DIR, DRACO_FIXTURE));
		const container = readContainer(file, URL_OF);
		expect(usesDraco(container)).toBe(true);
		const data = parseGltf(container, new Map(), URL_OF, { draco: decoder.decode });
		const twin = parseGltf(
			readContainer(
				readFileSync(
					samplePath('sources/khronos/TextureCoordinateTest/glTF-Binary/TextureCoordinateTest.glb'),
				),
				URL_OF,
			),
			new Map(),
			URL_OF,
		);
		expect(data.meshes.length).toBe(twin.meshes.length);
		data.meshes.forEach((mesh, k) => {
			const p = mesh.primitives[0] as PrimitiveData;
			const q = twin.meshes[k]?.primitives[0] as PrimitiveData;
			expect(p.indices?.length).toBe(q.indices?.length);
			if (!q.uvs) {
				expect(p.uvs).toBeUndefined();
				return;
			}
			expect(p.uvs?.array).toBeInstanceOf(Uint16Array);
			expect(p.uvs?.normalized).toBe(true);
			// Each decoded corner's coordinates are those of a corner of the twin at the same place.
			const [pa, qa] = [p.positions.array as Float32Array, q.positions.array as Float32Array];
			const [ua, ub] = [floats(p.uvs), floats(q.uvs)];
			for (let i = 0; i < pa.length / 3; i++) {
				const j = [0, 1, 2, 3].find(
					(j) =>
						Math.hypot(
							(pa[i * 3] as number) - (qa[j * 3] as number),
							(pa[i * 3 + 1] as number) - (qa[j * 3 + 1] as number),
						) < 1e-3,
				) as number;
				expect(Math.abs((ua[i * 2] as number) - (ub[j * 2] as number))).toBeLessThan(1e-3);
				expect(Math.abs((ua[i * 2 + 1] as number) - (ub[j * 2 + 1] as number))).toBeLessThan(1e-3);
			}
		});
	});

	test('a file without Draco data needs no decoder', () => {
		const glb = readFileSync(
			samplePath('sources/khronos/RiggedSimple/glTF-Binary/RiggedSimple.glb'),
		);
		expect(usesDraco(readContainer(glb, URL_OF))).toBe(false);
	});
});

describe('Draco data that breaks the rules', () => {
	test('a file with Draco data and no decoder gives E1416', () => {
		const { json, bin } = rigged();
		expect(refusal(() => parseRigged(json, bin, null as never))).toEqual([
			'E1416',
			"mesh 0's primitive 0 holds Draco data, and the parser has no decoder",
		]);
	});

	test('data cut short gives E1416, and a fresh decoder takes over from the spent one', async () => {
		const { json, bin } = rigged();
		const fresh = await dracoDecoder(compiled);
		json.bufferViews[extensionOf(json).bufferView]!.byteLength = 100;
		const [code, message] = refusal(() => parseRigged(json, bin, fresh));
		expect(code).toBe('E1416');
		expect(message).toContain("mesh 0's primitive 0's Draco data does not decode");
		expect(fresh.spent).toBe(true);
		const { json: whole } = rigged();
		expect(refusal(() => parseRigged(whole, bin, fresh))[1]).toContain(
			'the decoder failed on an earlier file',
		);
		const next = await dracoDecoder(compiled);
		expect(parseRigged(whole, bin, next).meshes[0]?.primitives.length).toBe(1);
	});

	test('accessors whose counts differ from the decoded mesh give E1416', async () => {
		const { json, bin } = rigged();
		const { attributes } = primitiveOf(json);
		for (const k of Object.values(attributes)) json.accessors[k]!.count = 1_000_000;
		expect((await refusalOf(json, bin))[1]).toContain(
			'it holds 160 vertices, and the accessors say 1000000',
		);
		const { json: other } = rigged();
		other.accessors[primitiveOf(other).indices]!.count = 6;
		expect((await refusalOf(other, bin))[1]).toContain(
			'it holds 564 indices, and the accessor says 6',
		);
	});

	test('an attribute that the data or the primitive lacks gives E1416', async () => {
		const { json, bin } = rigged();
		extensionOf(json).attributes.NORMAL = 9;
		expect((await refusalOf(json, bin))[1]).toContain('it holds no attribute 9');
		const { json: other } = rigged();
		extensionOf(other).attributes.TEXCOORD_0 = 1;
		expect((await refusalOf(other, bin))[1]).toBe(
			"mesh 0's primitive 0's Draco data holds TEXCOORD_0, which the primitive's attributes do not name",
		);
		const { json: none } = rigged();
		extensionOf(none).attributes = {};
		expect((await refusalOf(none, bin))[1]).toBe(
			"mesh 0's primitive 0's Draco data holds no attributes",
		);
	});

	test('an accessor whose components differ from the attribute gives E1416', async () => {
		const { json, bin } = rigged();
		json.accessors[primitiveOf(json).attributes.NORMAL!]!.type = 'VEC4';
		expect((await refusalOf(json, bin))[1]).toContain(
			'its attribute 1 has 3 components, and the accessor of NORMAL 4',
		);
	});

	test('a buffer view of other data gives E1416 quickly', async () => {
		const { json, bin } = rigged();
		extensionOf(json).bufferView = 1;
		const started = performance.now();
		expect((await refusalOf(json, bin))[1]).toContain('it is not Draco data');
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
