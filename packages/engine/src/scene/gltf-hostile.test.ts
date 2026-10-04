// Small hostile glTF files, built in code, that once hung the glTF worker or made it allocate far
// more than the file holds. Each must now fail fast with E1416 and a reason that names its part.

import { describe, expect, test } from 'bun:test';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { armBuilder, GltfBuilder, type GltfJson } from '../../../../tests/pages/lib/gltf-files';
import { FILE_LIMITS, FileBudget, modelAllowance } from './file-limits';
import { meshoptDecoder } from './gltf-meshopt';
import { type GltfData, GltfError, parseGltf, readContainer } from './gltf-parse';

const URL_OF = 'https://example.com/models/hostile.glb';

/** How long any of these files may take to parse or fail, in milliseconds. */
const QUICK_MS = 1500;

/** Parses a file whose buffers are all inside it, and checks that it took little time. */
function parse(file: Uint8Array, decode?: Parameters<typeof parseGltf>[3]): GltfData {
	const start = performance.now();
	try {
		return parseGltf(readContainer(file, URL_OF), new Map(), URL_OF, decode);
	} finally {
		expect(performance.now() - start).toBeLessThan(QUICK_MS);
	}
}

/** The code and message of the error that parsing a file throws. */
function refusal(file: Uint8Array, decode?: Parameters<typeof parseGltf>[3]): [string, string] {
	try {
		parse(file, decode);
	} catch (error) {
		if (error instanceof GltfError) return [error.code, error.message];
		throw error;
	}
	throw new Error('the file parsed');
}

/** A triangle whose POSITION accessor the test then changes. */
function triangle(): { b: GltfBuilder; positions: GltfJson } {
	const b = new GltfBuilder();
	const at = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	b.node({ mesh: b.mesh([{ attributes: { POSITION: at } }]) });
	return { b, positions: b.json.accessors[at] };
}

/** A POSITION accessor of `count` vertices with no buffer view, which glTF fills with zeros. */
function zeros(b: GltfBuilder, count: number, componentType = 5126): number {
	return (
		b.json.accessors.push({
			componentType,
			count,
			type: 'VEC3',
			min: [0, 0, 0],
			max: [0, 0, 0],
		}) - 1
	);
}

describe('names that every JavaScript object has', () => {
	for (const type of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'])
		test(`an accessor of the type "${type}" is refused at once, at any count`, () => {
			const { b, positions } = triangle();
			positions.type = type;
			positions.count = 0x7fffffff;
			positions.byteStride = 12;
			const [code, message] = refusal(b.glb());
			expect(code).toBe('E1416');
			expect(message).toBe(`accessor 0 has the type ${type}`);
		});

	test('a channel path and an interpolation named "constructor" are refused', () => {
		const path = armBuilder();
		path.json.animations[0].channels[0].target.path = 'constructor';
		expect(refusal(path.glb())[1]).toContain('has the path constructor');
		const interpolation = armBuilder();
		interpolation.json.animations[0].samplers[0].interpolation = 'constructor';
		expect(refusal(interpolation.glb())[1]).toContain('has the interpolation constructor');
	});

	test('a meshopt mode and filter named "constructor" are refused', async () => {
		const decode = await meshoptDecoder();
		for (const [field, words] of [
			['mode', 'has the mode constructor'],
			['filter', 'has the filter constructor'],
		] as const) {
			const b = new GltfBuilder().uses('EXT_meshopt_compression', true);
			const data = MeshoptEncoder.encodeGltfBuffer(new Uint8Array(48), 3, 16, 'ATTRIBUTES');
			const view = b.meshoptView(data, { count: 3, byteStride: 16, mode: 'ATTRIBUTES' });
			b.json.bufferViews[view].extensions.EXT_meshopt_compression[field] = 'constructor';
			const at = b.accessorOf(view, 5126, 3, 3, { min: [0, 0, 0], max: [0, 0, 0], byteStride: 16 });
			b.node({ mesh: b.mesh([{ attributes: { POSITION: at } }]) });
			expect(refusal(b.glb(), decode)[1]).toContain(words);
		}
	});
});

describe("a file's total allocation", () => {
	test('primitives that name one accessor share one copy of it', () => {
		const b = new GltfBuilder();
		const shared = zeros(b, 999_999);
		b.node({
			mesh: b.mesh(Array.from({ length: 50 }, () => ({ attributes: { POSITION: shared } }))),
		});
		const [mesh] = parse(b.glb()).meshes;
		const arrays = new Set(mesh?.primitives.map((p) => p.positions.array));
		expect(mesh?.primitives).toHaveLength(50);
		expect(arrays.size).toBe(1);
	});

	test('accessors filled with zeros stop at what a file of its size may decode to', () => {
		const b = new GltfBuilder();
		const primitives = Array.from({ length: 50 }, () => ({
			attributes: { POSITION: zeros(b, 999_999) },
		}));
		b.node({ mesh: b.mesh(primitives) });
		const file = b.glb();
		expect(file.length).toBeLessThan(8192);
		const [code, message] = refusal(file);
		expect(code).toBe('E1416');
		expect(message).toContain('that a file of its size may decode to');
	});

	test("a triangle strip's list counts against the file's limit", () => {
		const b = new GltfBuilder();
		b.node({ mesh: b.mesh([{ mode: 5, attributes: { POSITION: zeros(b, 5_000_000, 5121) } }]) });
		const [code, message] = refusal(b.glb());
		expect(code).toBe('E1416');
		expect(message).toContain("primitive 0's triangles would bring");
	});

	test('meshopt data that decodes to far more than its file stops at the limit', async () => {
		const decode = await meshoptDecoder();
		const b = new GltfBuilder().uses('EXT_meshopt_compression', true);
		const count = 2_097_150;
		const data = MeshoptEncoder.encodeGltfBuffer(
			new Uint8Array(count * 16),
			count,
			16,
			'ATTRIBUTES',
		);
		const primitives = Array.from({ length: 6 }, () => {
			const view = b.meshoptView(data, { count, byteStride: 16, mode: 'ATTRIBUTES' });
			const at = b.accessorOf(view, 5126, count, 3, { min: [0, 0, 0], max: [0, 0, 0] });
			b.json.bufferViews[view].byteStride = 16;
			return { attributes: { POSITION: at } };
		});
		b.node({ mesh: b.mesh(primitives) });
		const file = b.glb();
		expect(count * 16 * 6).toBeGreaterThan(modelAllowance(file.length));
		const [code, message] = refusal(file, decode);
		expect(code).toBe('E1416');
		expect(message).toContain('would bring what the file decodes to');
	});

	test('morph targets that leave an attribute out count the zeros they stand for', () => {
		const b = new GltfBuilder();
		const positions = zeros(b, 999_999);
		const moved = zeros(b, 999_999);
		const targets = [
			{ POSITION: moved, NORMAL: moved },
			...Array.from({ length: 10 }, () => ({ POSITION: moved })),
		];
		b.node({ mesh: b.mesh([{ attributes: { POSITION: positions, NORMAL: moved }, targets }]) });
		const [code, message] = refusal(b.glb());
		expect(code).toBe('E1416');
		expect(message).toMatch(/target \d+ NORMAL would bring/);
	});
});

describe('the parent loop check', () => {
	/** A chain of `n` nodes, each the only child of the one before. */
	function chain(n: number): GltfBuilder {
		const b = new GltfBuilder();
		for (let k = 0; k < n; k++) b.json.nodes.push(k + 1 < n ? { children: [k + 1] } : {});
		b.json.scenes[0].nodes.push(0);
		return b;
	}

	test('a chain of 100,000 nodes parses in linear time', () => {
		expect(parse(chain(100_000).gltf()).nodes).toHaveLength(100_000);
	});

	test('a loop below a long chain names a node of the loop', () => {
		const b = chain(50_000);
		// Nodes 50,000 to 50,002 form a loop of their own, which no scene node reaches.
		b.json.nodes.push({ children: [50_001] }, { children: [50_002] }, { children: [50_000] });
		const [code, message] = refusal(b.gltf());
		expect(code).toBe('E1416');
		expect(message).toMatch(/^node 5000[012] is in a loop of parents$/);
	});
});

describe('the shared limits', () => {
	test("a model file's allowance grows with its bytes, between the floor and the cap", () => {
		expect(modelAllowance(0)).toBe(FILE_LIMITS.modelFloorBytes);
		expect(modelAllowance(1 << 20)).toBe(
			FILE_LIMITS.modelFloorBytes + FILE_LIMITS.modelRatio * (1 << 20),
		);
		expect(modelAllowance(1 << 30)).toBe(FILE_LIMITS.modelCapBytes);
	});

	test('a budget refuses one item past the item limit, and items that together pass the allowance', () => {
		const fail = (reason: string): never => {
			throw new Error(reason);
		};
		const budget = new FileBudget(0, fail);
		expect(() => budget.take(FILE_LIMITS.itemBytes + 1, 'the array')).toThrow(
			'the array decodes to 256 MiB, more than the 256 MiB that one array or texture may hold',
		);
		expect(() => budget.take(Number.NaN, 'the array')).toThrow('more bytes than a number holds');
		budget.take(FILE_LIMITS.modelFloorBytes - 10, 'the first array');
		expect(() => budget.take(11, 'the second array')).toThrow(
			'the second array would bring what the file decodes to 64 MiB, more than the 64 MiB that a file of its size may decode to',
		);
		expect(budget.used).toBe(FILE_LIMITS.modelFloorBytes - 10);
	});
});
