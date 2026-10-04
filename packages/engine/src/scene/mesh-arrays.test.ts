import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	ARRAY_UVS,
	ARRAYS_PROBLEM_INDEX_OUT_OF_RANGE,
	ARRAYS_PROBLEM_MORPH_NOT_FINITE,
	ARRAYS_PROBLEM_MORPH_TOO_LARGE,
	ARRAYS_PROBLEM_NOT_FINITE,
	MESH_ARRAYS_COLORS,
	MESH_ARRAYS_COLORS_ALPHA,
	MESH_ARRAYS_COMPUTE_TANGENTS,
	MESH_ARRAYS_INDICES,
	MESH_ARRAYS_JOINTS,
	MESH_ARRAYS_NORMALS,
	MESH_ARRAYS_UVS,
	MESH_ARRAYS_WEIGHTS,
	MORPH_NORMALS,
	MORPH_POSITIONS,
} from '../generated/core';
import { VERTEX_TYPE_SNORM8, VERTEX_TYPE_UINT16, VERTEX_TYPE_UNORM8 } from '../generated/gpu';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { arraysProblem, meshFromArrays, typeField } from './mesh-arrays';
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
		];
		for (const [morphTargets, message] of cases)
			expect(arraysProblem({ ...QUAD, morphTargets })).toBe(message);
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
