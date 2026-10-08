import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	ARRAY_UVS,
	ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE,
	ARRAYS_PROBLEM_MORPH_NOT_FINITE,
	ARRAYS_PROBLEM_MORPH_TOO_LARGE,
	ARRAYS_PROBLEM_NOT_FINITE,
	ARRAYS_PROBLEM_POSED,
	MESH_ARRAYS_COLORS,
	MESH_ARRAYS_COLORS_ALPHA,
	MESH_ARRAYS_COMPUTE_TANGENTS,
	MESH_ARRAYS_INDICES,
	MESH_ARRAYS_JOINTS,
	MESH_ARRAYS_NORMALS,
	MESH_ARRAYS_UVS,
	MESH_ARRAYS_WEIGHTS,
	MORPH_COLORS,
	MORPH_NORMALS,
	MORPH_POSITIONS,
} from '../generated/core';
import {
	VERTEX_ATTRIBUTES,
	VERTEX_TYPE_SNORM8,
	VERTEX_TYPE_UINT16,
	VERTEX_TYPE_UNORM8,
	VERTEX_TYPE_UNORM16,
} from '../generated/gpu';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays, typeField, updateVertices } from './mesh-arrays';
import type { MeshArrays } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

const QUAD: MeshArrays = {
	positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

describe('the shape checks of geometry.fromArrays', () => {
	test('accept whole vertices and triangles, with or without indices', () => {
		expect(arraysProblem(QUAD)).toBeUndefined();
		const colors = new Float32Array(16);
		expect(arraysProblem({ ...QUAD, uvs: new Float32Array(8), colors })).toBeUndefined();
		expect(arraysProblem({ ...QUAD, colors: new Float32Array(12) })).toBeUndefined();
		const soup = { positions: new Float32Array(9), computeNormals: true };
		expect(arraysProblem(soup)).toBeUndefined();
	});

	test('name the array or option at fault', () => {
		const cases: [MeshArrays, string][] = [
			[{ ...QUAD, positions: [] }, 'got no positions.'],
			[
				{ ...QUAD, positions: [0, 0, 0, 1] },
				'got 4 numbers in positions, which is not three per vertex.',
			],
			[{ ...QUAD, normals: [0, 0, 1] }, 'got 3 numbers in normals for 4 vertices, not 12.'],
			[{ ...QUAD, uvs: new Float32Array(6) }, 'got 6 numbers in uvs for 4 vertices, not 8.'],
			[{ ...QUAD, tangents: [1, 0, 0, 1] }, 'got 4 numbers in tangents for 4 vertices, not 16.'],
			[
				{ ...QUAD, colors: new Float32Array(10) },
				'got 10 numbers in colors for 4 vertices, not 12 or 16.',
			],
			[{ ...QUAD, indices: [0, 1, 2, 3] }, 'got 4 indices, which is not three per triangle.'],
			[
				{ ...QUAD, indices: undefined },
				'got 4 vertices and no indices, and without indices each three vertices make a triangle.',
			],
			[{ ...QUAD, computeNormals: true }, 'got normals and computeNormals: true both.'],
			[{ ...QUAD, normals: undefined }, 'got no normals and no computeNormals: true.'],
			[
				{ ...QUAD, tangents: new Float32Array(16), computeTangents: true },
				'got tangents and computeTangents: true both.',
			],
			[{ ...QUAD, computeTangents: true }, 'got computeTangents: true but no uvs.'],
			[
				{ ...QUAD, normals: new Uint8Array(12) },
				'got normals in a Uint8Array; normals take a Float32Array, an Int8Array or an Int16Array, or a plain array of numbers.',
			],
			[
				{ ...QUAD, positions: new Float64Array(12) as unknown as Float32Array },
				'got positions in a Float64Array; positions take a Float32Array, a Uint8Array, an Int8Array, a Uint16Array or an Int16Array, or a plain array of numbers.',
			],
			[
				{ ...QUAD, normals: { array: new Int8Array(12), normalized: false } },
				'got normalized: false for normals, whose integers always read as fractions.',
			],
			[
				{ ...QUAD, positions: { array: new Float32Array(12), normalized: true } },
				'got normalized: true for positions in a Float32Array; only integers can be normalized.',
			],
			[{ ...QUAD, joints: new Uint8Array(16) }, 'got joints but no weights.'],
			[{ ...QUAD, weights: new Float32Array(16) }, 'got weights but no joints.'],
			[
				{ ...QUAD, joints: [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 1.5] },
				'got 1.5 at joints[15], which is not a whole number from 0 to 65535.',
			],
			[
				{ ...QUAD, joints: new Uint8Array(8), weights: new Uint8Array(16) },
				'got 8 numbers in joints for 4 vertices, not 16.',
			],
		];
		for (const [arrays, problem] of cases) expect(arraysProblem(arrays)).toBe(problem);
	});

	test('check the morph targets against the vertices', () => {
		const lift = new Float32Array(12);
		expect(arraysProblem({ ...QUAD, morphTargets: { positions: [lift, lift] } })).toBeUndefined();
		const cases: [MeshArrays['morphTargets'], string][] = [
			[{}, 'got morphTargets without any target.'],
			[{ positions: [] }, 'got morphTargets without any target.'],
			[
				{ positions: Array.from({ length: 257 }, () => lift) },
				'got 257 morph targets; a mesh takes up to 256.',
			],
			[
				{ positions: [lift, lift], normals: [lift] },
				'got 1 morph targets in normals and 2 in another list; every list needs one array per target.',
			],
			[
				{ positions: [lift, new Float32Array(9)] },
				'got 9 numbers in morphTargets.positions[1] for 4 vertices, not 12.',
			],
			[{ positions: [lift], names: ['Smile', 'Blink'] }, 'got 2 morph target names for 1 targets.'],
			[
				{ colors: [new Float32Array(12)] },
				"got morphTargets.colors but no colors; color targets move the mesh's own colors.",
			],
		];
		for (const [morphTargets, message] of cases)
			expect(arraysProblem({ ...QUAD, morphTargets })).toBe(message);
	});

	test('take as many numbers per vertex in color targets as the colors hold', () => {
		const rgb = new Float32Array(12);
		const rgba = new Float32Array(16);
		const tint = { ...QUAD, colors: rgb, morphTargets: { colors: [rgb, rgb] } };
		expect(arraysProblem(tint)).toBeUndefined();
		expect(arraysProblem({ ...QUAD, colors: rgba, morphTargets: { colors: [rgba] } })).toBe(
			undefined,
		);
		expect(arraysProblem({ ...QUAD, colors: rgba, morphTargets: { colors: [rgb] } })).toBe(
			'got 12 numbers in morphTargets.colors[0] for 4 vertices, not 16.',
		);
		expect(
			arraysProblem({
				...QUAD,
				colors: rgb,
				morphTargets: { positions: [rgb], colors: [rgb, rgb] },
			}),
		).toBe(
			'got 2 morph targets in colors and 1 in another list; every list needs one array per target.',
		);
	});
});

/** A core whose memory the arrays go into, and which records the mesh it is asked for. */
function fakeCore(failure?: { code: number; details: [number, number] }) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const asked: {
		words: number;
		vertices: number;
		indices: number;
		layout: number;
		types: number;
		targets?: number;
		morph?: number;
	}[] = [];
	const glue = {
		meshArrays: (words: number) => {
			asked.push({ words, vertices: 0, indices: 0, layout: 0, types: 0 });
			return 256;
		},
		createMeshFromArrays: (
			vertices: number,
			indices: number,
			layout: number,
			types: number,
			targets: number,
			morph: number,
		) => {
			const fields = { vertices, indices, layout, types, ...(targets ? { targets, morph } : {}) };
			Object.assign(asked[asked.length - 1] as object, fields);
			return failure ? 0 : 7;
		},
		lastErrorCode: () => failure?.code ?? 0,
		lastErrorDetail: (index: number) => failure?.details[index] ?? 0,
	} as unknown as CoreGlue;
	return { core: new CoreMemory(glue, memory), memory, asked };
}

describe('meshes from arrays in engine memory', () => {
	test('go in one array after another, with a layout that names each one', () => {
		const { core, memory, asked } = fakeCore();
		const arrays: MeshArrays = {
			...QUAD,
			uvs: [0, 0, 1, 0, 1, 1, 0, 1],
			colors: new Float32Array(16).fill(0.5),
			computeTangents: true,
		};
		expect(meshFromArrays(core, arrays, 'geometry.fromArrays')).toBe(7);
		const layout =
			MESH_ARRAYS_NORMALS |
			MESH_ARRAYS_UVS |
			MESH_ARRAYS_COLORS |
			MESH_ARRAYS_COLORS_ALPHA |
			MESH_ARRAYS_INDICES |
			MESH_ARRAYS_COMPUTE_TANGENTS;
		expect(asked).toEqual([
			{ words: 12 + 12 + 8 + 16 + 6, vertices: 4, indices: 6, layout, types: 0 },
		]);
		const floats = new Float32Array(memory.buffer, 256, 48);
		expect(Array.from(floats.subarray(0, 12))).toEqual([...(QUAD.positions as number[])]);
		expect(Array.from(floats.subarray(24, 32))).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
		expect(floats[32]).toBe(0.5);
		expect(Array.from(new Uint32Array(memory.buffer, 256 + 48 * 4, 6))).toEqual([0, 1, 2, 0, 2, 3]);
	});

	test('keep their integers, each array from a whole word, with its type in the format', () => {
		const { core, memory, asked } = fakeCore();
		const arrays: MeshArrays = {
			positions: new Uint16Array([0, 0, 0, 900, 0, 0, 900, 900, 0, 0, 900, 0]),
			normals: new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]),
			uvs: { array: new Uint8Array([0, 0, 255, 0, 255, 255, 0, 255]), normalized: true },
			colors: new Uint8Array(12).fill(200),
			joints: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 300],
			weights: new Float32Array(16).fill(0.25),
			indices: QUAD.indices,
		};
		expect(meshFromArrays(core, arrays, 'geometry.fromArrays')).toBe(7);
		// Positions 24 bytes, normals 12, texture coordinates 8, colors 12, joints as 16-bit
		// integers 32, weights 64, then the indices.
		expect(asked[0]?.words).toBe(6 + 3 + 2 + 3 + 8 + 16 + 6);
		const types =
			(typeField(0, VERTEX_TYPE_UINT16) ?? 0) |
			(typeField(1, VERTEX_TYPE_SNORM8) ?? 0) |
			(typeField(2, VERTEX_TYPE_UNORM8) ?? 0) |
			(typeField(5, VERTEX_TYPE_UNORM8) ?? 0) |
			(typeField(6, VERTEX_TYPE_UINT16) ?? 0);
		expect(asked[0]?.types).toBe(types);
		expect(asked[0]?.layout).toBe(
			MESH_ARRAYS_NORMALS |
				MESH_ARRAYS_UVS |
				MESH_ARRAYS_COLORS |
				MESH_ARRAYS_JOINTS |
				MESH_ARRAYS_WEIGHTS |
				MESH_ARRAYS_INDICES,
		);
		expect(Array.from(new Uint16Array(memory.buffer, 256, 4))).toEqual([0, 0, 0, 900]);
		expect(new Int8Array(memory.buffer, 256 + 24, 3)[2]).toBe(127);
		expect(Array.from(new Uint8Array(memory.buffer, 256 + 36, 3))).toEqual([0, 0, 255]);
		expect(new Uint16Array(memory.buffer, 256 + 56, 16)[15]).toBe(300);
		expect(new Float32Array(memory.buffer, 256 + 88, 1)[0]).toBe(0.25);
	});

	test('put the morph targets after the indices, positions first, then normals', () => {
		const { core, memory, asked } = fakeCore();
		const up = new Float32Array(12).fill(1);
		const turn = new Float32Array(12).fill(2);
		const morphTargets = { normals: [turn, turn], positions: [up, up.map((v) => v * 3)] };
		expect(meshFromArrays(core, { ...QUAD, morphTargets }, 'geometry.fromArrays')).toBe(7);
		expect(asked[0]).toMatchObject({
			words: 12 + 12 + 6 + 2 * 12 * 2,
			targets: 2,
			morph: MORPH_POSITIONS | MORPH_NORMALS,
		});
		const at = 256 + (12 + 12 + 6) * 4;
		const deltas = new Float32Array(memory.buffer, at, 48);
		expect([deltas[0], deltas[12], deltas[24], deltas[47]]).toEqual([1, 3, 2, 2]);
	});

	test('put color targets last, four numbers per vertex, with an alpha of 0 for colors without one', () => {
		const { core, memory, asked } = fakeCore();
		const colors = new Uint8Array(12).fill(255);
		const red = new Float32Array(12).map((_, k) => (k % 3 === 0 ? 0.5 : 0));
		const up = new Float32Array(12).fill(1);
		const morphTargets = { colors: [red], positions: [up] };
		expect(meshFromArrays(core, { ...QUAD, colors, morphTargets }, 'geometry.fromArrays')).toBe(7);
		// Positions 12 words, normals 12, colors 3, indices 6, then 12 words of position deltas
		// and 16 of color deltas.
		expect(asked[0]).toMatchObject({
			words: 12 + 12 + 3 + 6 + 12 + 16,
			targets: 1,
			morph: MORPH_POSITIONS | MORPH_COLORS,
		});
		const at = 256 + (12 + 12 + 3 + 6 + 12) * 4;
		const deltas = Array.from(new Float32Array(memory.buffer, at, 16));
		expect(deltas).toEqual([0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0]);
		// A bad color delta names its place in the array as given: the core counts four numbers
		// per vertex, and the array three.
		const badColor = fakeCore({
			code: 1206,
			details: [ARRAYS_PROBLEM_MORPH_NOT_FINITE, (3 << 28) | 9],
		});
		const bad = red.slice();
		bad[7] = Number.NaN;
		try {
			meshFromArrays(badColor.core, { ...QUAD, colors, morphTargets: { colors: [bad] } }, 'f');
			throw new Error('the mesh was built');
		} catch (error) {
			expect((error as EngineError).message).toStartWith(
				'E1206: f() got NaN at morphTargets.colors[0][7].',
			);
		}
	});

	test('that the core refuses name the value it found wrong', () => {
		const outside = fakeCore({ code: 1206, details: [ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE, 4] });
		const indices = new Uint16Array([0, 1, 2, 0, 7, 3]);
		const refuse = (core: CoreMemory, arrays: MeshArrays) => {
			try {
				meshFromArrays(core, arrays, 'geometry.fromArrays');
			} catch (error) {
				return error as EngineError;
			}
			throw new Error('the mesh was built');
		};
		const index = refuse(outside.core, { ...QUAD, indices });
		expect(index.code).toBe('E1206');
		expect(index.message).toStartWith(
			'E1206: geometry.fromArrays() got the index 7 at indices[4], past the last of 4 vertices.',
		);
		const notFinite = fakeCore({
			code: 1206,
			details: [ARRAYS_PROBLEM_NOT_FINITE + ARRAY_UVS, 3],
		});
		const uvs = [0, 0, 1, Number.NaN, 1, 1, 0, 1];
		expect(refuse(notFinite.core, { ...QUAD, uvs }).message).toStartWith(
			'E1206: geometry.fromArrays() got NaN at uvs[3].',
		);
		const lift = [0, 0, 0, 0, Number.POSITIVE_INFINITY, 0, 0, 0, 0, 0, 0, 0];
		const badDelta = fakeCore({ code: 1206, details: [ARRAYS_PROBLEM_MORPH_NOT_FINITE, 12 + 4] });
		const morphTargets = { positions: [new Float32Array(12), lift] };
		expect(refuse(badDelta.core, { ...QUAD, morphTargets }).message).toStartWith(
			'E1206: geometry.fromArrays() got Infinity at morphTargets.positions[1][4].',
		);
		const full = fakeCore({ code: 1206, details: [ARRAYS_PROBLEM_MORPH_TOO_LARGE, 4_194_304] });
		expect(refuse(full.core, { ...QUAD, morphTargets }).message).toContain(
			'move a vertex more than 255 times, or that would pass the 4,194,304 delta texels (32 MiB)',
		);
		const memoryFull = fakeCore({ code: 1109, details: [64 * 1024 * 1024, 0] });
		expect(refuse(memoryFull.core, QUAD).code).toBe('E1109');
	});
});

/** A core that takes vertex updates, recording each call's arguments. */
function updatingCore(failure?: { code: number; details: [number, number] }) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const calls: { words: number; args: number[] }[] = [];
	const glue = {
		meshArrays: (words: number) => {
			calls.push({ words, args: [] });
			return 256;
		},
		updateVertices: (...args: number[]) => {
			(calls[calls.length - 1] as { args: number[] }).args = args;
			return failure ? 1206 : 0;
		},
		lastErrorCode: () => failure?.code ?? 0,
		lastErrorDetail: (index: number) => failure?.details[index] ?? 0,
	} as unknown as CoreGlue;
	return { core: new CoreMemory(glue, memory), memory, calls };
}

/** The format bits of texture coordinates, colors and joints. */
const [MESH_UV0 = 0, MESH_COLOR = 0, MESH_JOINTS = 0] = [2, 5, 6].map(
	(k) => VERTEX_ATTRIBUTES[k]?.[0] ?? 0,
);

/** A mesh of four vertices with float positions and normals, and 16-bit normalized uvs. */
const LAYOUT = { count: 4, format: MESH_UV0 | (typeField(2, VERTEX_TYPE_UNORM16) ?? 0) };

describe('vertex updates', () => {
	const call = 'mesh.updateVertices';

	test('copy the named vertices of the whole array, in the type the mesh keeps', () => {
		const { core, memory, calls } = updatingCore();
		const positions = new Float32Array(12).map((_, k) => k);
		updateVertices(core, 7, LAYOUT, 'positions', positions, 0, 4, call);
		expect(Array.from(new Float32Array(memory.buffer, 256, 12))).toEqual(Array.from(positions));
		updateVertices(core, 7, LAYOUT, 'normals', [...positions], 1, 2, call);
		expect(Array.from(new Float32Array(memory.buffer, 256, 6))).toEqual([3, 4, 5, 6, 7, 8]);
		const uvs = new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7]);
		updateVertices(core, 7, LAYOUT, 'uvs', uvs, 3, 1, call);
		expect(Array.from(new Uint16Array(memory.buffer, 256, 2))).toEqual([6, 7]);
		expect(calls).toEqual([
			{ words: 12, args: [7, 0, 3, 0, 4] },
			{ words: 6, args: [7, 1, 3, 1, 2] },
			{ words: 1, args: [7, 2, 2, 3, 1] },
		]);
	});

	test('take three or four numbers of color per vertex, and skip an empty range', () => {
		const { core, calls } = updatingCore();
		const colors = { count: 4, format: MESH_COLOR };
		updateVertices(core, 7, colors, 'colors', new Float32Array(12), 0, 4, call);
		updateVertices(core, 7, colors, 'colors', new Float32Array(16), 2, 2, call);
		updateVertices(core, 7, colors, 'colors', new Float32Array(16), 4, 0, call);
		expect(calls.map(({ args }) => args)).toEqual([
			[7, 5, 3, 0, 4],
			[7, 5, 4, 2, 2],
		]);
	});

	test('name what does not fit, and send nothing', () => {
		const { core, calls } = updatingCore();
		const message = (
			name: string,
			values: Float32Array | Uint16Array | number[],
			start = 0,
			count = 4,
			layout = LAYOUT,
		) => {
			try {
				updateVertices(core, 7, layout, name as 'positions', values, start, count, call);
			} catch (error) {
				expect((error as EngineError).code).toBe('E1206');
				return (error as EngineError).message;
			}
			throw new Error('the update went through');
		};
		const twelve = new Float32Array(12);
		expect(message('joints', twelve)).toStartWith(
			'E1206: mesh.updateVertices() got joints; updates take positions, normals, uvs, uvs1, colors or tangents.',
		);
		expect(message('uvs1', new Float32Array(8))).toStartWith(
			'E1206: mesh.updateVertices() got uvs1 for a mesh without uvs1.',
		);
		expect(message('uvs', new Float32Array(8))).toStartWith(
			'E1206: mesh.updateVertices() got uvs in a Float32Array; the mesh keeps its uvs in a Uint16Array.',
		);
		expect(message('positions', new Uint16Array(12))).toStartWith(
			'E1206: mesh.updateVertices() got positions in a Uint16Array; the mesh keeps its positions in a Float32Array or a plain array.',
		);
		expect(message('positions', new Float32Array(9))).toStartWith(
			'E1206: mesh.updateVertices() got 9 numbers in positions for 4 vertices, not 12.',
		);
		expect(message('positions', twelve, 2, 3)).toStartWith(
			'E1206: mesh.updateVertices() got vertices 2 to 4, past the last of 4 vertices.',
		);
		expect(message('positions', twelve, 0.5, 1)).toStartWith(
			'E1206: mesh.updateVertices() got start 0.5 and count 1; both take whole numbers of 0 or more.',
		);
		expect(message('positions', twelve, 0, 4, { count: 4, format: MESH_JOINTS })).toStartWith(
			'E1206: mesh.updateVertices() got a mesh with joints or morph targets, whose vertices take no updates.',
		);
		expect(calls).toEqual([]);
	});

	test('that the core refuses name the value it found wrong', () => {
		const refused = (details: [number, number]) => {
			const { core } = updatingCore({ code: 1206, details });
			const positions = [0, 1, 2, 3, 4, 5, 6, Number.NaN, 8, 9, 10, 11];
			try {
				updateVertices(core, 7, LAYOUT, 'positions', positions, 1, 3, call);
			} catch (error) {
				return (error as EngineError).message;
			}
			throw new Error('the update went through');
		};
		expect(refused([ARRAYS_PROBLEM_NOT_FINITE, 4])).toStartWith(
			'E1206: mesh.updateVertices() got NaN at positions[7].',
		);
		expect(refused([ARRAYS_PROBLEM_POSED, 0])).toStartWith(
			'E1206: mesh.updateVertices() got a mesh with joints or morph targets, whose vertices take no updates.',
		);
	});

	test('reuse one view of engine memory for each type', () => {
		const { core } = updatingCore();
		const positions = new Float32Array(12);
		updateVertices(core, 7, LAYOUT, 'positions', positions, 0, 4, call);
		const view = core.heap(Float32Array);
		updateVertices(core, 7, LAYOUT, 'normals', positions, 0, 4, call);
		expect(core.heap(Float32Array)).toBe(view);
	});
});
